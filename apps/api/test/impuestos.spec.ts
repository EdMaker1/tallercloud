// Impuestos editables: IGV, IGV reducido y detracción por empresa; «No aplica» en ventas; tipo de IGV en compras.
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
const SUPER = 'ti@demo.local', ADMIN = 'admin@demo.local', CAJERA = 'cajera@demo.local';
const sx = `${Date.now() % 100000}`;
const hoy = new Date().toISOString().slice(0, 10);
const POR_DEFECTO = { igvPct: 18, igvReducidoPct: 10, detraccionPct: 12, detraccionDesde: 700 };
let clienteId = '', proveedorId = '', localId = '', k = 0;
const compra = (extra: object = {}) => ({ proveedorId, localId, tipoDocumento: 'FACTURA', serie: 'F009', numero: `${sx}${k++}`, fecha: hoy, condicion: 'CONTADO', items: [{ descripcion: 'Gasto de prueba', cantidad: 1, costo: 118 }], ...extra });
const nota = (items: object[]) => como(CAJERA, 'post', '/notas-venta', { clienteId, items, conDetraccion: undefined });

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
  await app.listen(0);
  clienteId = (await como(CAJERA, 'post', '/clientes', { tipoDocumento: 'DNI', documento: `6${sx.padStart(5, '0')}41`, nombre: 'Cliente impuestos prueba' })).body.id;
  proveedorId = (await como(ADMIN, 'post', '/proveedores', { tipoDocumento: 'RUC', documento: `20${sx.padStart(5, '0')}0088`, nombre: 'Proveedor impuestos prueba' })).body.id;
  localId = (await prisma.usuario.findUniqueOrThrow({ where: { correo: CAJERA } })).localId as string;
});
afterAll(async () => {
  await como(SUPER, 'patch', '/empresa', { impuestos: POR_DEFECTO });
  await prisma.compra.deleteMany({ where: { proveedorId } });
  const notas = await prisma.notaVenta.findMany({ where: { clienteId } });
  await prisma.abono.deleteMany({ where: { notaId: { in: notas.map((x) => x.id) } } });
  await prisma.notaVenta.deleteMany({ where: { clienteId } });
  await prisma.auditoria.deleteMany({ where: { registroId: { in: [...notas.map((x) => x.id), proveedorId, clienteId] } } });
  await prisma.proveedor.deleteMany({ where: { id: proveedorId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await app.close();
  await prisma.$disconnect();
});

describe('impuestos de la empresa', () => {
  it('valen 18 %, 10 %, detracción de 12 % desde S/ 700 y el Superadministrador los ve', async () => {
    const r = await como(SUPER, 'get', '/empresa');
    expect(r.body.impuestos).toEqual(POR_DEFECTO);
  });
  it('se editan y se rechazan los valores fuera de rango o que no son números', async () => {
    for (const malo of [{ igvPct: 'x' }, { igvPct: 99 }, { igvPct: -1 }, { detraccionPct: 101 }, { detraccionDesde: -5 }]) {
      expect((await como(SUPER, 'patch', '/empresa', { impuestos: malo })).status).toBe(400);
    }
    expect((await como(SUPER, 'patch', '/empresa', { impuestos: 'x' })).status).toBe(400);
    const ok = await como(SUPER, 'patch', '/empresa', { impuestos: { igvPct: 15, detraccionPct: 10 } });
    expect(ok.status).toBe(200);
    expect(ok.body.impuestos).toMatchObject({ igvPct: 15, igvReducidoPct: 10, detraccionPct: 10, detraccionDesde: 700 });
    await como(SUPER, 'patch', '/empresa', { impuestos: POR_DEFECTO });
  });
  it('solo quien tiene el módulo de ajustes con nivel «todo» los cambia', async () => {
    expect((await como(CAJERA, 'patch', '/empresa', { impuestos: { igvPct: 1 } })).status).toBe(403);
  });
});

describe('nota de venta: Gravado y No aplica', () => {
  it('calcula con el IGV de la empresa y guarda la tasa usada; No aplica va en su línea', async () => {
    const n = await nota([{ tipo: 'producto', descripcion: 'a', cantidad: 1, precio: 15, tipoIgv: 'GRAVADO' }, { tipo: 'producto', descripcion: 'b', cantidad: 1, precio: 30, tipoIgv: 'NO_APLICA' }]);
    expect(n.status).toBe(201);
    expect(n.body).toMatchObject({ gravada: 12.71, igv: 2.29, noAplica: 30, exonerada: 0, inafecta: 0, total: 45, igvPct: 18 });
  });
  it('si la empresa baja el IGV a 15 %, la nota nueva lo usa y la anterior no cambia', async () => {
    const antes = await nota([{ tipo: 'producto', descripcion: 'c', cantidad: 1, precio: 115, tipoIgv: 'GRAVADO' }]);
    await como(SUPER, 'patch', '/empresa', { impuestos: { igvPct: 15 } });
    try {
      const despues = await nota([{ tipo: 'producto', descripcion: 'c', cantidad: 1, precio: 115, tipoIgv: 'GRAVADO' }]);
      expect(despues.body).toMatchObject({ gravada: 100, igv: 15, igvPct: 15 });
      expect((await como(CAJERA, 'get', `/notas-venta/${antes.body.id}`)).body).toMatchObject({ igv: 17.54, igvPct: 18 });
    } finally { await como(SUPER, 'patch', '/empresa', { impuestos: POR_DEFECTO }); }
  });
  it('la detracción usa el porcentaje y el umbral configurados', async () => {
    await como(SUPER, 'patch', '/empresa', { impuestos: { detraccionPct: 10, detraccionDesde: 1000 } });
    try {
      const bajo = await nota([{ tipo: 'servicio', descripcion: 's', cantidad: 1, precio: 900, tipoIgv: 'GRAVADO' }]);
      expect(bajo.body.conDetraccion).toBe(false);
      const alto = await nota([{ tipo: 'servicio', descripcion: 's', cantidad: 1, precio: 1200, tipoIgv: 'GRAVADO' }]);
      expect(alto.body).toMatchObject({ conDetraccion: true, detraccionPct: 10, detraccion: 120 });
    } finally { await como(SUPER, 'patch', '/empresa', { impuestos: POR_DEFECTO }); }
  });
  it('Exonerado e Inafecto ya no se ofrecen: se rechazan con 400', async () => {
    for (const t of ['EXONERADO', 'INAFECTO', 'GRATUITO']) {
      expect((await nota([{ tipo: 'producto', descripcion: 'x', cantidad: 1, precio: 10, tipoIgv: t }])).status).toBe(400);
    }
  });
});

describe('compras: tipo de IGV', () => {
  it('Gravado 18 %: base e IGV salen del total', async () => {
    const r = await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRAVADO' }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tipoIgv: 'GRAVADO', igvPct: 18, baseImponible: 100, igv: 18, total: 118 });
  });
  it('Gravado 10 % usa la tasa reducida de la empresa', async () => {
    const r = await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRAVADO_REDUCIDO', items: [{ descripcion: 'x', cantidad: 1, costo: 110 }] }));
    expect(r.body).toMatchObject({ tipoIgv: 'GRAVADO_REDUCIDO', igvPct: 10, baseImponible: 100, igv: 10 });
  });
  it('No aplica: la base es el total y no hay IGV', async () => {
    const r = await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'NO_APLICA' }));
    expect(r.body).toMatchObject({ tipoIgv: 'NO_APLICA', igvPct: 0, baseImponible: 118, igv: 0 });
  });
  it('sin indicar el tipo queda en No aplica, y el IGV escrito según el comprobante manda', async () => {
    expect((await como(ADMIN, 'post', '/compras', compra())).body).toMatchObject({ tipoIgv: 'NO_APLICA', igv: 0 });
    const r = await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRAVADO', igv: 17.99 }));
    expect(r.body).toMatchObject({ igv: 17.99, baseImponible: 100.01 });
  });
  it('rechaza un tipo desconocido, un IGV mayor al total, negativo o distinto de cero en No aplica', async () => {
    expect((await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRATUITO' }))).status).toBe(400);
    expect((await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRAVADO', igv: 500 }))).status).toBe(400);
    expect((await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'GRAVADO', igv: -1 }))).status).toBe(400);
    expect((await como(ADMIN, 'post', '/compras', compra({ tipoIgv: 'NO_APLICA', igv: 5 }))).status).toBe(400);
  });
  it('el catálogo del formulario trae las tasas de la empresa', async () => {
    expect((await como(ADMIN, 'get', '/compras/catalogos')).body.impuestos).toEqual(POR_DEFECTO);
  });
});
