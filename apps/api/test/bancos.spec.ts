// Bancos (RF-091): cuentas, movimientos con sede, transferencias, caja de efectivo y, sobre todo, lo que la cajera puede y no puede ver desde la API.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

const prisma = new PrismaClient();
let app: INestApplication;
const CLAVE = process.env.SEED_PASSWORD as string;
const tokens: Record<string, string> = {};
const tokenDe = async (c: string) => (tokens[c] ??= (await request(app.getHttpServer()).post('/auth/login').send({ correo: c, password: CLAVE })).body.token as string);
const como = async (c: string, metodo: 'get' | 'post' | 'patch' | 'put' | 'delete', ruta: string, cuerpo?: object) => {
  const r = request(app.getHttpServer())[metodo](ruta).set('Authorization', `Bearer ${await tokenDe(c)}`);
  return cuerpo ? r.send(cuerpo) : r;
};
const SUPER = 'ti@demo.local', ADMIN = 'admin@demo.local', CAJERA = 'cajera@demo.local', JEFE = 'jefe@demo.local', TECNICO = 'tecnico@demo.local', LOGISTICO = 'logistico@demo.local';
const sx = `${Date.now() % 100000}`;
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
let clienteId = '', proveedorId = '', sedeCajera = '', otraSede = '', nombreSede = '', k = 0;
type Cuenta = { id: string; nombre: string; tipo: string; activa?: boolean; saldo?: number; facturadoHoy?: number; sede?: string | null; localId?: string | null };
const cuentasAdmin = async (q = '') => (await como(ADMIN, 'get', `/bancos/cuentas${q}`)).body as Cuenta[];
const cuentasCajera = async () => (await como(CAJERA, 'get', '/bancos/cuentas')).body as Cuenta[];
const porNombre = (cs: Cuenta[], parte: string) => cs.find((c) => c.nombre.includes(parte))!;
const nota = (pagos: object[], precio = 100) => como(CAJERA, 'post', '/notas-venta', { clienteId, items: [{ tipo: 'servicio', descripcion: `bancos ${sx}`, cantidad: 1, precio, tipoIgv: 'GRAVADO' }], pagos });
const compra = (extra: object = {}) => como(ADMIN, 'post', '/compras', { proveedorId, localId: sedeCajera, tipoDocumento: 'FACTURA', serie: 'F007', numero: `${sx}${k++}`, fecha: hoy, condicion: 'CONTADO', tipoIgv: 'GRAVADO', items: [{ descripcion: 'Gasto de prueba', cantidad: 1, costo: 118 }], ...extra });

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
  await app.listen(0);
  const u = await prisma.usuario.findUniqueOrThrow({ where: { correo: CAJERA }, include: { local: true } });
  sedeCajera = u.localId as string; nombreSede = u.local!.nombre;
  otraSede = (await prisma.local.findFirstOrThrow({ where: { organizacionId: u.organizacionId as string, id: { not: sedeCajera } } })).id;
  await prisma.cajaDia.deleteMany({ where: { localId: sedeCajera, fecha: hoy } });
  clienteId = (await como(CAJERA, 'post', '/clientes', { tipoDocumento: 'DNI', documento: `2${sx.padStart(5, '0')}63`, nombre: `bancos ${sx} cliente` })).body.id;
  proveedorId = (await como(ADMIN, 'post', '/proveedores', { tipoDocumento: 'RUC', documento: `20${sx.padStart(5, '0')}0066`, nombre: `bancos ${sx} proveedor` })).body.id;
});
afterAll(async () => {
  const notas = await prisma.notaVenta.findMany({ where: { clienteId } });
  const ordenes = await prisma.ordenServicio.findMany({ where: { clienteId } });
  await prisma.abono.deleteMany({ where: { OR: [{ notaId: { in: notas.map((x) => x.id) } }, { ordenId: { in: ordenes.map((o) => o.id) } }] } });
  await prisma.notaVenta.deleteMany({ where: { clienteId } });
  for (const t of ['solicitudOds', 'evidenciaIngreso', 'detalleODS', 'bitacora'] as const) await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { ordenId: { in: ordenes.map((o) => o.id) } } });
  await prisma.ordenServicio.deleteMany({ where: { clienteId } });
  const vs = await prisma.vehiculo.findMany({ where: { clienteId } });
  await prisma.lecturaKm.deleteMany({ where: { vehiculoId: { in: vs.map((v) => v.id) } } });
  await prisma.vehiculo.deleteMany({ where: { clienteId } });
  await prisma.compra.deleteMany({ where: { proveedorId } });
  await prisma.cajaDia.deleteMany({ where: { localId: sedeCajera, fecha: hoy } });
  await prisma.auditoria.deleteMany({ where: { registroId: { in: [...notas.map((x) => x.id), ...ordenes.map((o) => o.id), proveedorId, clienteId] } } });
  await prisma.proveedor.deleteMany({ where: { id: proveedorId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await app.close();
  await prisma.$disconnect();
});

describe('cuentas habituales y acceso por rol', () => {
  it('la empresa trae Yape, Interbank personal, Interbank empresa, la caja chica de administración y un efectivo por sede', async () => {
    const cs = await cuentasAdmin();
    for (const parte of ['Yape', 'Interbank personal', 'Interbank empresa', 'Caja chica de administración']) expect(porNombre(cs, parte)).toBeTruthy();
    const efectivos = cs.filter((c) => c.tipo === 'EFECTIVO');
    expect(efectivos.length).toBeGreaterThanOrEqual(2);
    expect(new Set(efectivos.map((c) => c.localId)).size).toBe(efectivos.length);
    expect(typeof porNombre(cs, 'Yape').saldo).toBe('number');
  });
  it('Jefe de taller, Técnico y Logístico no entran a Bancos; sin sesión, 401', async () => {
    for (const quien of [JEFE, TECNICO, LOGISTICO]) for (const ruta of ['/bancos/cuentas', '/bancos/movimientos', '/bancos/caja/hoy']) expect([quien, ruta, (await como(quien, 'get', ruta)).status]).toEqual([quien, ruta, 403]);
    expect((await request(app.getHttpServer()).get('/bancos/cuentas')).status).toBe(401);
  });
  it('Administrador y Superadministrador ven todas las cuentas con sus saldos', async () => {
    for (const quien of [ADMIN, SUPER]) expect((await como(quien, 'get', '/bancos/cuentas')).status).toBe(200);
  });
});

describe('lo que ve la cajera: la API nunca le entrega saldos reales de cuentas que no sean efectivo', () => {
  it('ve el efectivo de SU sede con saldo real y, en Yape y bancos, solo lo facturado hoy, sin ninguna cifra de saldo', async () => {
    const cs = await cuentasCajera();
    const efectivo = cs.filter((c) => c.tipo === 'EFECTIVO');
    expect(efectivo).toHaveLength(1);
    expect(efectivo[0].nombre).toContain(nombreSede);
    expect(typeof efectivo[0].saldo).toBe('number');
    for (const c of cs.filter((x) => x.tipo !== 'EFECTIVO')) {
      expect(Object.keys(c).sort()).toEqual(['facturadoHoy', 'id', 'nombre', 'tipo']);
      expect(typeof c.facturadoHoy).toBe('number');
    }
  });
  it('la caja chica de administración y el efectivo de otras sedes no existen para ella', async () => {
    const admin = await cuentasAdmin();
    const ocultas = admin.filter((c) => c.tipo === 'CAJA_ADMIN' || (c.tipo === 'EFECTIVO' && c.localId !== sedeCajera));
    expect(ocultas.length).toBeGreaterThanOrEqual(2);
    const cs = await cuentasCajera();
    const texto = JSON.stringify(cs);
    for (const o of ocultas) { expect(cs.some((c) => c.id === o.id)).toBe(false); expect(texto).not.toContain(o.nombre); }
    for (const o of ocultas) {
      expect([o.nombre, (await como(CAJERA, 'get', `/bancos/movimientos?cuentaId=${o.id}`)).status]).toEqual([o.nombre, 404]);
      expect([o.nombre, (await como(CAJERA, 'post', '/bancos/movimientos', { cuentaId: o.id, tipo: 'EGRESO', monto: 1 })).status]).toEqual([o.nombre, 404]);
    }
  });
  it('tampoco puede pedir los movimientos o movimientos manuales de Yape ni de un banco, ni crear cuentas, ni transferir', async () => {
    const admin = await cuentasAdmin();
    for (const c of admin.filter((x) => x.tipo === 'YAPE' || x.tipo === 'BANCO')) {
      expect((await como(CAJERA, 'get', `/bancos/movimientos?cuentaId=${c.id}`)).status).toBe(404);
      expect((await como(CAJERA, 'post', '/bancos/movimientos', { cuentaId: c.id, tipo: 'INGRESO', monto: 5 })).status).toBe(404);
      expect((await como(CAJERA, 'get', `/bancos/cuentas/${c.id}`)).status).toBe(403);
    }
    expect((await como(CAJERA, 'post', '/bancos/cuentas', { nombre: 'x', tipo: 'BANCO' })).status).toBe(403);
    expect((await como(CAJERA, 'patch', `/bancos/cuentas/${admin[0].id}`, { nombre: 'x' })).status).toBe(403);
    expect((await como(CAJERA, 'post', '/bancos/transferencias', { origenId: admin[0].id, destinoId: admin[1].id, monto: 1 })).status).toBe(403);
  });
  it('un listado de movimientos sin filtro solo trae el efectivo de su sede, de hoy', async () => {
    await como(ADMIN, 'post', '/bancos/transferencias', { origenId: porNombre(await cuentasAdmin(), 'Interbank empresa').id, destinoId: porNombre(await cuentasAdmin(), 'Yape').id, monto: 7 });
    const efectivo = (await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!;
    const filas = (await como(CAJERA, 'get', '/bancos/movimientos')).body as { cuentaId: string; sede: string }[];
    expect(filas.every((f) => f.cuentaId === efectivo.id)).toBe(true);
    for (const q of ['?localId=' + otraSede, '?desde=2020-01-01&hasta=2020-01-02']) expect((await como(CAJERA, 'get', `/bancos/movimientos${q}`)).body.every((f: { cuentaId: string }) => f.cuentaId === efectivo.id)).toBe(true);
  });
});

describe('ingresos: cada cobro entra a la cuenta que corresponde, con sede y usuario', () => {
  it('una nota pagada con Yape: el administrador ve el ingreso con la sede de la cajera; la cajera ve su total del día, no el saldo', async () => {
    const yape0 = porNombre(await cuentasCajera(), 'Yape').facturadoHoy!, saldo0 = porNombre(await cuentasAdmin(), 'Yape').saldo!;
    const r = await nota([{ metodo: 'Yape', valor: 100 }]);
    expect(r.status).toBe(201);
    expect(porNombre(await cuentasCajera(), 'Yape').facturadoHoy).toBeCloseTo(yape0 + 100, 2);
    expect(porNombre(await cuentasAdmin(), 'Yape').saldo).toBeCloseTo(saldo0 + 100, 2);
    const yape = porNombre(await cuentasAdmin(), 'Yape');
    const m = ((await como(ADMIN, 'get', `/bancos/movimientos?cuentaId=${yape.id}`)).body as { tipo: string; monto: number; sede: string; usuario: string; origen: string }[]).find((x) => x.origen === 'NOTA_VENTA' && x.monto === 100)!;
    expect(m).toMatchObject({ tipo: 'INGRESO', sede: nombreSede, usuario: 'Cajera Demo' });
  });
  it('un pago en efectivo sube el efectivo de la sede y la cajera lo ve; no sube el de otras sedes', async () => {
    const ef0 = (await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!.saldo!;
    const otro0 = (await cuentasAdmin()).filter((c) => c.tipo === 'EFECTIVO' && c.localId !== sedeCajera).map((c) => c.saldo);
    expect((await nota([{ metodo: 'Efectivo', valor: 40 }], 40)).status).toBe(201);
    expect((await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!.saldo).toBeCloseTo(ef0 + 40, 2);
    expect((await cuentasAdmin()).filter((c) => c.tipo === 'EFECTIVO' && c.localId !== sedeCajera).map((c) => c.saldo)).toEqual(otro0);
  });
  it('transferencia y tarjeta van a Interbank empresa y otro a Interbank personal', async () => {
    const antes = await cuentasAdmin();
    for (const [metodo, parte] of [['Transferencia', 'Interbank empresa'], ['Tarjeta', 'Interbank empresa'], ['Otro', 'Interbank personal']] as const) {
      const s0 = porNombre(await cuentasAdmin(), parte).saldo!;
      expect((await nota([{ metodo, valor: 10 }], 10)).status).toBe(201);
      expect(porNombre(await cuentasAdmin(), parte).saldo).toBeCloseTo(s0 + 10, 2);
    }
    void antes;
  });
  it('un cobro no puede entrar a la caja chica de administración', async () => {
    const caja = porNombre(await cuentasAdmin(), 'Caja chica');
    expect((await nota([{ metodo: 'Yape', valor: 10, cuentaId: caja.id }], 10)).status).toBe(400);
    expect((await nota([{ metodo: 'Yape', valor: 10, cuentaId: 'no-existe' }], 10)).status).toBe(400);
  });
  it('el abono de una ODS y el cobro de una nota a crédito también registran su ingreso', async () => {
    const v = (await como(CAJERA, 'post', '/vehiculos', { clienteId, placa: `BK${sx}${k++}` })).body;
    const o = (await como(CAJERA, 'post', '/ordenes', { vehiculoId: v.id, tipoAtencion: 'Mantenimiento correctivo' })).body;
    await como(CAJERA, 'put', `/ordenes/${o.id}/detalles`, { detalles: [{ tipo: 'servicio', descripcion: `bancos ${sx} ods`, precio: 300 }] });
    const y0 = porNombre(await cuentasAdmin(), 'Yape').saldo!;
    expect((await como(CAJERA, 'post', `/ordenes/${o.id}/abonos`, { metodo: 'Yape', valor: 50 })).status).toBe(201);
    expect(porNombre(await cuentasAdmin(), 'Yape').saldo).toBeCloseTo(y0 + 50, 2);
    const credito = await como(CAJERA, 'post', '/notas-venta', { clienteId, condicion: 'CREDITO', fechaVencimiento: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), items: [{ tipo: 'servicio', descripcion: `bancos ${sx} credito`, cantidad: 1, precio: 80, tipoIgv: 'GRAVADO' }] });
    expect(credito.status).toBe(201);
    expect((await como(CAJERA, 'post', `/notas-venta/${credito.body.id}/cobros`, { metodo: 'Yape', valor: 30 })).status).toBe(201);
    expect(porNombre(await cuentasAdmin(), 'Yape').saldo).toBeCloseTo(y0 + 80, 2);
  });
});

describe('egresos y transferencias', () => {
  it('una compra pagada sale de la caja chica de administración (o de la cuenta que se elige) y la cajera no la ve', async () => {
    const caja0 = porNombre(await cuentasAdmin(), 'Caja chica').saldo!;
    const r = await compra({ metodo: 'Transferencia' });
    expect(r.status).toBe(201);
    expect(porNombre(await cuentasAdmin(), 'Caja chica').saldo).toBeCloseTo(caja0 - 118, 2);
    const ef = (await cuentasAdmin()).find((c) => c.tipo === 'EFECTIVO' && c.localId === sedeCajera)!;
    const e0 = ef.saldo!;
    expect((await compra({ metodo: 'Efectivo' })).status).toBe(201);
    expect((await cuentasAdmin()).find((c) => c.id === ef.id)!.saldo).toBeCloseTo(e0 - 118, 2);
    const y0 = porNombre(await cuentasAdmin(), 'Yape').saldo!;
    expect((await compra({ metodo: 'Yape', cuentaId: porNombre(await cuentasAdmin(), 'Yape').id })).status).toBe(201);
    expect(porNombre(await cuentasAdmin(), 'Yape').saldo).toBeCloseTo(y0 - 118, 2);
    expect(JSON.stringify(await cuentasCajera())).not.toContain('Caja chica');
  });
  it('el pago de una compra a crédito sale de una cuenta y no se puede elegir una inexistente', async () => {
    const c = await compra({ condicion: 'CREDITO', fechaVencimiento: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10) });
    expect(c.status).toBe(201);
    const caja0 = porNombre(await cuentasAdmin(), 'Caja chica').saldo!;
    expect((await como(ADMIN, 'post', `/compras/${c.body.id}/pagos`, { metodo: 'Transferencia', valor: 18 })).status).toBe(201);
    expect(porNombre(await cuentasAdmin(), 'Caja chica').saldo).toBeCloseTo(caja0 - 18, 2);
    expect((await como(ADMIN, 'post', `/compras/${c.body.id}/pagos`, { metodo: 'Transferencia', valor: 1, cuentaId: 'x' })).status).toBe(400);
  });
  it('la transferencia genera un egreso en el origen y un ingreso en el destino, que cuadran entre sí', async () => {
    const cs = await cuentasAdmin();
    const origen = cs.find((c) => c.tipo === 'EFECTIVO' && c.localId === sedeCajera)!, destino = porNombre(cs, 'Interbank empresa');
    const r = await como(ADMIN, 'post', '/bancos/transferencias', { origenId: origen.id, destinoId: destino.id, monto: 25.5, concepto: 'Depósito de efectivo' });
    expect(r.status).toBe(201);
    const despues = await cuentasAdmin();
    expect(despues.find((c) => c.id === origen.id)!.saldo).toBeCloseTo(origen.saldo! - 25.5, 2);
    expect(despues.find((c) => c.id === destino.id)!.saldo).toBeCloseTo(destino.saldo! + 25.5, 2);
    const pares = await prisma.movimientoBanco.findMany({ where: { transferenciaId: r.body.transferenciaId } });
    expect(pares.map((m) => m.tipo).sort()).toEqual(['EGRESO', 'INGRESO']);
    expect(new Set(pares.map((m) => Number(m.monto))).size).toBe(1);
  });
  it('rechaza transferencias mal hechas y el ingreso o egreso manual con datos inválidos', async () => {
    const cs = (await cuentasAdmin()).filter((c) => c.activa !== false);
    const a = cs[0], b = cs[1];
    for (const cuerpo of [{ origenId: a.id, destinoId: a.id, monto: 5 }, { origenId: a.id, destinoId: b.id, monto: 0 }, { origenId: a.id, destinoId: b.id, monto: -3 }, { origenId: a.id, destinoId: b.id, monto: 'abc' }, { origenId: a.id, destinoId: b.id, monto: 1e12 }, { origenId: a.id, destinoId: b.id, monto: true }]) {
      expect([JSON.stringify(cuerpo), (await como(ADMIN, 'post', '/bancos/transferencias', cuerpo)).status]).toEqual([JSON.stringify(cuerpo), 400]);
    }
    expect((await como(ADMIN, 'post', '/bancos/transferencias', { origenId: a.id, destinoId: 'no-existe', monto: 5 })).status).toBe(404);
    for (const cuerpo of [{ cuentaId: a.id, tipo: 'OTRO', monto: 5 }, { cuentaId: a.id, tipo: 'EGRESO', monto: 0 }, { cuentaId: a.id, tipo: 'EGRESO', monto: '0x10' }]) expect((await como(ADMIN, 'post', '/bancos/movimientos', cuerpo)).status).toBe(400);
  });
  it('la cajera registra un retiro en el efectivo de su sede y baja el saldo que ella ve', async () => {
    const ef = (await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!;
    const r = await como(CAJERA, 'post', '/bancos/movimientos', { cuentaId: ef.id, tipo: 'EGRESO', monto: 12, concepto: 'Retiro para movilidad' });
    expect(r.status).toBe(201);
    expect((await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!.saldo).toBeCloseTo(ef.saldo! - 12, 2);
    const filas = (await como(CAJERA, 'get', `/bancos/movimientos?cuentaId=${ef.id}`)).body as { concepto: string; usuario: string }[];
    expect(filas.find((f) => f.concepto === 'Retiro para movilidad')?.usuario).toBe('Cajera Demo');
  });
});

describe('vista del administrador por sede y en general', () => {
  it('filtra los movimientos por sede y por cuenta, y cada uno dice de qué sede fue', async () => {
    const yape = porNombre(await cuentasAdmin(), 'Yape');
    const mias = (await como(ADMIN, 'get', `/bancos/movimientos?cuentaId=${yape.id}&localId=${sedeCajera}`)).body as { sede: string }[];
    expect(mias.length).toBeGreaterThan(0);
    expect(mias.every((m) => m.sede === nombreSede)).toBe(true);
    const otras = (await como(ADMIN, 'get', `/bancos/movimientos?cuentaId=${yape.id}&localId=${otraSede}`)).body as { sede: string }[];
    expect(otras.every((m) => m.sede !== nombreSede)).toBe(true);
    const hoyFilas = (await como(ADMIN, 'get', `/bancos/movimientos?desde=${hoy}&hasta=${hoy}`)).body as unknown[];
    expect(hoyFilas.length).toBeGreaterThan(0);
  });
  it('los ingresos y egresos del periodo por cuenta cuadran con el saldo menos el saldo inicial', async () => {
    for (const c of (await cuentasAdmin('?desde=2000-01-01&hasta=2100-01-01')) as (Cuenta & { saldoInicial: number; ingresos: number; egresos: number })[]) {
      expect(c.saldoInicial + c.ingresos - c.egresos).toBeCloseTo(c.saldo!, 2);
    }
  });
  it('filtros mal escritos dan 400', async () => {
    for (const q of ['?desde=ayer', '?localId[a]=1', '?hasta=2026-13-45']) expect((await como(ADMIN, 'get', `/bancos/cuentas${q}`)).status).toBe(400);
  });
});

describe('cuentas: alta, edición y baja lógica', () => {
  it('el administrador crea una cuenta con saldo inicial, la renombra y la desactiva; una desactivada no recibe movimientos', async () => {
    const r = await como(ADMIN, 'post', '/bancos/cuentas', { nombre: `Cuenta prueba ${sx}`, tipo: 'BANCO', numero: '123-456', saldoInicial: 500 });
    expect(r.status).toBe(201);
    expect(porNombre(await cuentasAdmin(), `prueba ${sx}`).saldo).toBe(500);
    expect((await como(ADMIN, 'patch', `/bancos/cuentas/${r.body.id}`, { nombre: `Cuenta renombrada ${sx}` })).status).toBe(200);
    expect(porNombre(await cuentasAdmin(), `renombrada ${sx}`)).toBeTruthy();
    expect((await como(ADMIN, 'patch', `/bancos/cuentas/${r.body.id}`, { activa: 'no' })).status).toBe(400);
    expect((await como(ADMIN, 'patch', `/bancos/cuentas/${r.body.id}`, { activa: false })).status).toBe(200);
    expect((await como(ADMIN, 'post', '/bancos/movimientos', { cuentaId: r.body.id, tipo: 'INGRESO', monto: 1 })).status).toBe(404);
    expect(JSON.stringify(await cuentasCajera())).not.toContain('renombrada');
  });
  it('rechaza un tipo inválido, un nombre vacío y un segundo efectivo para la misma sede', async () => {
    expect((await como(ADMIN, 'post', '/bancos/cuentas', { nombre: 'x', tipo: 'CRIPTO' })).status).toBe(400);
    expect((await como(ADMIN, 'post', '/bancos/cuentas', { nombre: '  ', tipo: 'BANCO' })).status).toBe(400);
    expect((await como(ADMIN, 'post', '/bancos/cuentas', { nombre: 'Otro efectivo', tipo: 'EFECTIVO', localId: sedeCajera })).status).toBe(409);
    expect((await como(ADMIN, 'post', '/bancos/cuentas', { nombre: 'Efectivo sin sede', tipo: 'EFECTIVO' })).status).toBe(400);
    expect((await como(ADMIN, 'patch', '/bancos/cuentas/no-existe', { nombre: 'x' })).status).toBe(404);
  });
});

describe('apertura y cierre de la caja de efectivo', () => {
  it('la cajera registra con cuánto abre una vez por día; la segunda vez da 409', async () => {
    const r = await como(CAJERA, 'post', '/bancos/caja/apertura', { monto: 200 });
    expect(r.status).toBe(201);
    expect((await como(CAJERA, 'post', '/bancos/caja/apertura', { monto: 300 })).status).toBe(409);
    for (const monto of [-1, 'abc', 1e12]) expect((await como(CAJERA, 'post', '/bancos/caja/apertura', { monto })).status).toBe(400);
  });
  it('el cierre guarda lo contado, la diferencia con el sistema y el total del día por cuenta, con fecha, sede y usuario', async () => {
    const sistema = (await cuentasCajera()).find((c) => c.tipo === 'EFECTIVO')!.saldo!;
    const r = await como(CAJERA, 'post', '/bancos/caja/cierre', { monto: 50 });
    expect(r.status).toBe(201);
    expect(r.body.detalle.diferencia).toBeCloseTo(50 - sistema, 2);
    expect(Array.isArray(r.body.detalle.facturadoHoy)).toBe(true);
    expect((await como(CAJERA, 'post', '/bancos/caja/cierre', { monto: 1 })).status).toBe(409);
    const hoyCaja = (await como(CAJERA, 'get', '/bancos/caja/hoy')).body;
    expect(hoyCaja.apertura.monto).toBe(200);
    expect(hoyCaja.apertura.usuario).toBe('Cajera Demo');
    expect(hoyCaja.cierre.monto).toBe(50);
    const fila = await prisma.cajaDia.findFirstOrThrow({ where: { localId: sedeCajera, fecha: hoy, tipo: 'CIERRE' } });
    expect(fila.usuarioId).toBeTruthy();
  });
  it('el cierre que ve el registro no incluye saldos de bancos', async () => {
    const fila = await prisma.cajaDia.findFirstOrThrow({ where: { localId: sedeCajera, fecha: hoy, tipo: 'CIERRE' } });
    expect(JSON.stringify(fila.detalle)).not.toMatch(/saldo(?!Sistema)/i);
  });
});
