// Verifica la base de demostración contra la original: que no queden documentos, teléfonos ni correos de los clientes,
// que el número de clientes y de órdenes no cambió y que no hay referencias rotas. No imprime ningún dato personal, solo conteos.
// Uso (desde database/):  dotenv -e ../.env -- tsx demo/verificar-demo.ts
import { PrismaClient } from '@prisma/client';
import { datosPersonalesEn, Originales } from '../../apps/api/src/demo/anonimizar';
import { OMITIDAS } from './comun';

const digitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');

/** Pares clave/valor de todos los textos de una fila (incluye los que van dentro de objetos y listas). */
function textos(v: unknown, clave = ''): [string, string][] {
  if (typeof v === 'string') return [[clave, v]];
  if (Array.isArray(v)) return v.flatMap((x) => textos(x, clave));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => textos(x, k));
  return [];
}

async function main() {
  const origen = process.env.DATABASE_URL;
  if (!origen) throw new Error('Falta DATABASE_URL.');
  const u = new URL(origen);
  u.pathname = '/posventa_demo';
  const destino = process.env.DEMO_DATABASE_URL ?? u.toString();
  const src = new PrismaClient({ datasources: { db: { url: origen } } });
  const dst = new PrismaClient({ datasources: { db: { url: destino } } });
  const fallos: string[] = [];
  const falla = (t: string) => fallos.push(t);

  // Originales (clientes, proveedores y usuarios) y permitidos (el cliente del investigador, leído del entorno).
  const originales: Originales = { documentos: new Set(), telefonos: new Set(), correos: new Set() };
  const nombresOriginales = new Set<string>();
  for (const c of await src.cliente.findMany({ select: { nombre: true, documento: true, movil: true, email: true, esGenerico: true } })) {
    // Los documentos de relleno («00000000») no identifican a nadie.
    if (!c.esGenerico && !/^0+$/.test(c.documento)) { originales.documentos.add(c.documento); nombresOriginales.add(c.nombre); }
    if (digitos(c.movil)) originales.telefonos.add(digitos(c.movil));
    if (c.email) originales.correos.add(c.email.toLowerCase());
  }
  for (const p of await src.proveedor.findMany({ select: { movil: true, email: true } })) {
    if (digitos(p.movil)) originales.telefonos.add(digitos(p.movil));
    if (p.email) originales.correos.add(p.email.toLowerCase());
  }
  for (const x of await src.usuario.findMany({ select: { correo: true } })) originales.correos.add(x.correo.toLowerCase());
  const permitidos = new Set<string>();
  if (digitos(process.env.DEMO_CLIENTE_TELEFONO)) permitidos.add(digitos(process.env.DEMO_CLIENTE_TELEFONO));
  if (process.env.DEMO_CLIENTE_CORREO) permitidos.add(process.env.DEMO_CLIENTE_CORREO.trim().toLowerCase());

  // 1. Conteos: mismos clientes y órdenes (más el cliente y el vehículo del investigador).
  const cuenta = async (c: PrismaClient, m: 'cliente' | 'ordenServicio' | 'notaVenta' | 'detalleODS' | 'vehiculo' | 'abono') => (c[m] as unknown as { count: () => Promise<number> }).count();
  const esperado: Record<string, number> = { cliente: 1, vehiculo: 1, ordenServicio: 0, notaVenta: 0, detalleODS: 0, abono: 0 };
  const conteos: Record<string, string> = {};
  for (const m of Object.keys(esperado) as (keyof typeof esperado)[]) {
    const a = await cuenta(src, m as 'cliente'), b = await cuenta(dst, m as 'cliente');
    conteos[m] = `${a} → ${b}`;
    if (b !== a + esperado[m]) falla(`El número de ${m} cambió: ${a} → ${b}`);
  }

  // 2. Ningún cliente conserva el nombre ni el documento originales (salvo los genéricos).
  const clientes = await dst.cliente.findMany({ select: { nombre: true, documento: true, esGenerico: true, movil: true, email: true } });
  let conNombreOriginal = 0, conDocumentoOriginal = 0, conTelefono = 0, conCorreo = 0;
  for (const c of clientes) {
    if (c.esGenerico) continue;
    if (nombresOriginales.has(c.nombre)) conNombreOriginal++;
    if (originales.documentos.has(c.documento)) conDocumentoOriginal++;
    if (c.movil && !permitidos.has(digitos(c.movil))) conTelefono++;
    if (c.email && !permitidos.has(c.email.toLowerCase())) conCorreo++;
  }
  if (conNombreOriginal) falla(`${conNombreOriginal} clientes conservan su nombre original`);
  if (conDocumentoOriginal) falla(`${conDocumentoOriginal} clientes conservan su documento original`);
  if (conTelefono) falla(`${conTelefono} clientes tienen teléfono`);
  if (conCorreo) falla(`${conCorreo} clientes tienen correo`);

  // 3. Barrido de todas las filas de la base de demostración en busca de teléfonos, correos y documentos originales.
  const tablas = ((await dst.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`)) as { tablename: string }[]).map((t) => t.tablename);
  const hallazgos: Record<string, Record<string, number>> = {};
  let filasRevisadas = 0;
  for (const t of tablas) {
    if (OMITIDAS.includes(t)) { const n = Number(((await dst.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`)) as { n: number }[])[0].n); if (n) falla(`La tabla ${t} debía quedar vacía y tiene ${n} filas`); continue; }
    for (let pagina = 0; ; pagina++) {
      const filas = (await dst.$queryRawUnsafe(`SELECT row_to_json(x)::text AS j FROM (SELECT * FROM "${t}" ORDER BY 1 LIMIT 5000 OFFSET ${pagina * 5000}) x`)) as { j: string }[];
      if (!filas.length) break;
      for (const f of filas) {
        filasRevisadas++;
        // Solo se revisan los valores de texto (un kilometraje numérico no es un teléfono) y, en el documento de un cliente, solo si es uno original.
        const cat = new Set<string>();
        for (const [clave, valor] of textos(JSON.parse(f.j))) {
          const hallados = datosPersonalesEn(valor, originales, permitidos);
          for (const h of hallados) if (!(clave === 'documento' && h === 'telefono')) cat.add(h);
        }
        for (const c of cat) { hallazgos[t] ??= {}; hallazgos[t][c] = (hallazgos[t][c] ?? 0) + 1; }
      }
    }
  }
  for (const [t, cs] of Object.entries(hallazgos)) falla(`${t}: ${Object.entries(cs).map(([c, n]) => `${n} filas con ${c}`).join(', ')}`);

  // 4. Referencias rotas: la base las impide (llaves foráneas); se revisa que las llaves de las órdenes apunten a algo.
  const rotas = Number(((await dst.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "OrdenServicio" o LEFT JOIN "Cliente" c ON c.id = o."clienteId" LEFT JOIN "Vehiculo" v ON v.id = o."vehiculoId" WHERE c.id IS NULL OR v.id IS NULL`)) as { n: number }[])[0].n);
  if (rotas) falla(`${rotas} órdenes apuntan a un cliente o vehículo que no existe`);
  const desalineadas = Number(((await dst.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "OrdenServicio" o JOIN "Vehiculo" v ON v.id = o."vehiculoId" WHERE v."clienteId" <> o."clienteId"`)) as { n: number }[])[0].n);
  const desalineadasOrigen = Number(((await src.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "OrdenServicio" o JOIN "Vehiculo" v ON v.id = o."vehiculoId" WHERE v."clienteId" <> o."clienteId"`)) as { n: number }[])[0].n);
  const nuevas = desalineadas - desalineadasOrigen;
  conteos['ordenes con cliente distinto al del vehículo (origen → demo)'] = `${desalineadasOrigen} → ${desalineadas}`;
  if (nuevas > 3) falla(`La reasignación dejó ${nuevas} órdenes con un cliente distinto al de su vehículo`);

  console.log('Conteos origen → demo:');
  console.table(conteos);
  console.log(`Filas revisadas en busca de datos personales: ${filasRevisadas}.`);
  if (fallos.length) {
    console.error(`VERIFICACIÓN FALLIDA (${fallos.length}):`);
    for (const f of fallos) console.error(` - ${f}`);
    process.exitCode = 1;
  } else console.log('VERIFICACIÓN CORRECTA: sin documentos, teléfonos ni correos de los datos originales (salvo los permitidos del investigador).');
  await src.$disconnect();
  await dst.$disconnect();
}
main().catch((e) => { console.error(`ERROR: ${(e as Error).message}`); process.exit(1); });
