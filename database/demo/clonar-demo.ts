// Crea la base de demostración: clona la base de la tesis a una base NUEVA y anonimiza solo el clon.
// La base original no se modifica. Uso (desde database/):  dotenv -e ../.env -- tsx demo/clonar-demo.ts [--rehacer]
// Variables (en .env, nunca en el repositorio): DATABASE_URL (origen), DEMO_CLAVE_ANONIMIZACION (obligatoria, 16+ caracteres),
// DEMO_DATABASE_URL (opcional; por defecto la misma conexión con la base «posventa_demo»), DEMO_CLIENTE_TELEFONO y DEMO_CLIENTE_CORREO (opcionales).
import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Anonimizador, Originales } from '../../apps/api/src/demo/anonimizar';
import { OMITIDAS } from './comun';

const LOTE = 2000;
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const digitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');

function conexionDemo(origen: string) {
  const dada = process.env.DEMO_DATABASE_URL;
  if (dada) return dada;
  const u = new URL(origen);
  u.pathname = '/posventa_demo';
  return u.toString();
}
const nombreBase = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

/** Orden de copia: primero las tablas de las que dependen otras. Las referencias a sí misma se parchean al final. */
function ordenDeModelos() {
  const modelos = Prisma.dmmf.datamodel.models.filter((m) => !OMITIDAS.includes(m.name));
  const nombres = new Set(modelos.map((m) => m.name));
  const deps = new Map(modelos.map((m) => [m.name, new Set(m.fields.filter((f) => f.relationFromFields?.length && f.type !== m.name && nombres.has(f.type)).map((f) => f.type))]));
  const orden: string[] = [];
  while (orden.length < modelos.length) {
    const listos = [...deps.entries()].filter(([n, d]) => !orden.includes(n) && [...d].every((x) => orden.includes(x))).map(([n]) => n);
    if (!listos.length) throw new Error('Hay un ciclo de dependencias entre tablas.');
    orden.push(...listos);
  }
  return orden.map((n) => modelos.find((m) => m.name === n)!);
}

const delegado = (cliente: PrismaClient, modelo: string) => (cliente as unknown as Record<string, { findMany: (a?: object) => Promise<Record<string, unknown>[]>; createMany: (a: object) => Promise<unknown>; count: () => Promise<number>; update: (a: object) => Promise<unknown> }>)[modelo[0].toLowerCase() + modelo.slice(1)];

async function main() {
  const origen = process.env.DATABASE_URL;
  const clave = process.env.DEMO_CLAVE_ANONIMIZACION;
  if (!origen) throw new Error('Falta DATABASE_URL.');
  if (!clave || clave.length < 16) throw new Error('Falta DEMO_CLAVE_ANONIMIZACION en el .env (mínimo 16 caracteres). Sin ella no se anonimiza.');
  const destino = conexionDemo(origen);
  const base = nombreBase(destino);
  if (destino === origen || !/demo/i.test(base)) throw new Error(`La base de destino «${base}» debe ser distinta de la original y llevar «demo» en el nombre.`);
  const rehacer = process.argv.includes('--rehacer');

  const src = new PrismaClient({ datasources: { db: { url: origen } } });
  // 1. Base nueva (solo se borra una base «demo»).
  const existe = ((await src.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${base.replace(/'/g, "''")}'`)) as unknown[]).length > 0;
  if (existe && !rehacer) throw new Error(`La base «${base}» ya existe. Usa --rehacer para borrarla y volver a crearla.`);
  if (existe) await src.$executeRawUnsafe(`DROP DATABASE "${base}" WITH (FORCE)`);
  await src.$executeRawUnsafe(`CREATE DATABASE "${base}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  const prisma = path.resolve(AQUI, '../node_modules/prisma/build/index.js');
  const mig = spawnSync(process.execPath, [prisma, 'migrate', 'deploy', '--schema', path.resolve(AQUI, '../prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: destino }, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`No se pudieron aplicar las migraciones a «${base}»: ${(mig.stderr || mig.stdout).slice(-400)}`);
  const dst = new PrismaClient({ datasources: { db: { url: destino } } });

  // 2. Lo que debe desaparecer: documentos, teléfonos y correos de los datos originales.
  const originales: Originales = { documentos: new Set(), telefonos: new Set(), correos: new Set() };
  const personas = [
    ...(await src.cliente.findMany({ select: { documento: true, movil: true, email: true } })),
    ...(await src.proveedor.findMany({ select: { documento: true, movil: true, email: true } })),
  ];
  for (const p of personas) {
    if (p.documento) originales.documentos.add(p.documento);
    if (digitos(p.movil)) originales.telefonos.add(digitos(p.movil));
    if (p.email) originales.correos.add(p.email.toLowerCase());
  }
  for (const u of await src.usuario.findMany({ select: { correo: true } })) originales.correos.add(u.correo.toLowerCase());
  const anon = new Anonimizador(clave, originales);

  // 3. Transformaciones por tabla: todo texto libre se borra; los clientes se reemplazan; se conserva lo demás.
  const nulo = (fila: Record<string, unknown>, ...campos: string[]) => { for (const c of campos) fila[c] = null; return fila; };
  const transformar: Record<string, (f: Record<string, unknown>) => Record<string, unknown>> = {
    Cliente: (f) => {
      if (f.esGenerico) return f;
      const tipo = String(f.tipoDocumento);
      const esEmpresa = tipo === 'RUC';
      f.nombre = esEmpresa ? anon.empresa(String(f.nombre)) : anon.nombre(String(f.nombre));
      f.nombreComercial = f.nombreComercial ? anon.empresa(String(f.nombreComercial)) : null;
      f.documento = anon.documento(tipo, String(f.documento));
      return nulo(f, 'movil', 'email', 'direccionFiscal', 'contacto', 'comentario');
    },
    Proveedor: (f) => nulo(f, 'movil', 'email', 'direccionFiscal', 'contacto', 'comentario'),
    Vehiculo: (f) => nulo(f, 'comentario'),
    OrdenServicio: (f) => nulo(f, 'observaciones', 'recomendaciones', 'motivoEliminacion', 'tipoAtencionDetalle', 'estadoVehiculo'),
    NotaVenta: (f) => nulo(f, 'observaciones', 'comentario', 'motivoAnulacion'),
    Cotizacion: (f) => nulo(f, 'observaciones', 'comentario', 'motivoAnulacion'),
    Compra: (f) => nulo(f, 'observaciones', 'motivoAnulacion'),
    Abono: (f) => nulo(f, 'concepto'),
    PagoCompra: (f) => nulo(f, 'concepto'),
    LecturaKm: (f) => nulo(f, 'observacion'),
    SolicitudOds: (f) => nulo(f, 'motivo', 'respuesta', 'cambios'),
    Local: (f) => nulo(f, 'telefono'),
    Organizacion: (f) => nulo(f, 'telefono', 'correo', 'cuentasBancarias', 'ruc'),
    // Nadie entra con las claves anteriores: los usuarios de la demostración se crean a mano en cada despliegue.
    Usuario: (f) => { f.correo = `u${String(f.id).slice(0, 8)}@demo.invalid`; f.passwordHash = `!${randomBytes(30).toString('hex')}`; return f; },
  };

  // 4. Copia por lotes en orden de dependencias.
  const informe: { tabla: string; origen: number; destino: number }[] = [];
  for (const modelo of ordenDeModelos()) {
    const filas = await delegado(src, modelo.name).findMany();
    const jsonCampos = modelo.fields.filter((f) => f.type === 'Json').map((f) => f.name);
    const obligatorios = modelo.fields.filter((f) => f.isRequired && f.kind === 'scalar' && f.type === 'String').map((f) => f.name);
    const propias = modelo.fields.filter((f) => f.relationFromFields?.length && f.type === modelo.name).flatMap((f) => f.relationFromFields as string[]);
    const parches: { id: unknown; campo: string; valor: unknown }[] = [];
    const salida = filas.map((fila) => {
      const f = (transformar[modelo.name] ? transformar[modelo.name]({ ...fila }) : { ...fila }) as Record<string, unknown>;
      // Un texto obligatorio que se borra queda vacío (no se puede dejar nulo).
      for (const c of obligatorios) if (f[c] === null || f[c] === undefined) f[c] = '';
      for (const c of jsonCampos) if (f[c] === null) f[c] = Prisma.DbNull;
      for (const c of propias) if (f[c] != null) { parches.push({ id: f.id, campo: c, valor: f[c] }); f[c] = null; }
      return f;
    });
    for (let i = 0; i < salida.length; i += LOTE) await delegado(dst, modelo.name).createMany({ data: salida.slice(i, i + LOTE) });
    for (const p of parches) await delegado(dst, modelo.name).update({ where: { id: p.id }, data: { [p.campo]: p.valor } });
    informe.push({ tabla: modelo.name, origen: filas.length, destino: await delegado(dst, modelo.name).count() });
  }

  // 5. El cliente del investigador: vehículo ficticio y algunas órdenes (se reasignan las 3 últimas cerradas, con sus notas).
  const tel = digitos(process.env.DEMO_CLIENTE_TELEFONO), correo = (process.env.DEMO_CLIENTE_CORREO ?? '').trim().toLowerCase() || null;
  const org = (await dst.organizacion.findFirstOrThrow()).id;
  const cliente = await dst.cliente.create({ data: { organizacionId: org, tipoDocumento: 'DNI', documento: anon.documento('DNI', 'INVESTIGADOR'), nombre: 'Álvaro André Machaca Meléndez', pais: 'PE', movil: tel || null, email: correo } });
  const placasOriginales = new Set((await src.vehiculo.findMany({ select: { placaNorm: true } })).map((v) => v.placaNorm));
  let placa = 'ZZ9000';
  for (let i = 1; placasOriginales.has(placa); i++) placa = `ZZ9${String(i).padStart(3, '0')}`;
  const vehiculo = await dst.vehiculo.create({ data: { organizacionId: org, clienteId: cliente.id, placa: `${placa.slice(0, 3)}-${placa.slice(3)}`, placaNorm: placa, marca: 'TOYOTA', modelo: 'YARIS', anio: 2018, color: 'GRIS' } });
  const ordenes = await dst.ordenServicio.findMany({ where: { estado: 'Cerrada', eliminada: false }, orderBy: { fechaInicio: 'desc' }, take: 3, select: { id: true } });
  for (const o of ordenes) {
    await dst.ordenServicio.update({ where: { id: o.id }, data: { clienteId: cliente.id, vehiculoId: vehiculo.id } });
    await dst.notaVenta.updateMany({ where: { ordenId: o.id }, data: { clienteId: cliente.id, vehiculoId: vehiculo.id } });
  }

  console.log(`Base «${base}» lista. Cliente del investigador: teléfono ${tel ? 'cargado' : 'NO cargado (falta DEMO_CLIENTE_TELEFONO)'}, correo ${correo ? 'cargado' : 'NO cargado (falta DEMO_CLIENTE_CORREO)'}; ${ordenes.length} órdenes reasignadas.`);
  console.table(informe);
  await src.$disconnect();
  await dst.$disconnect();
}

main().catch((e) => { console.error(`ERROR: ${(e as Error).message}`); process.exit(1); });
