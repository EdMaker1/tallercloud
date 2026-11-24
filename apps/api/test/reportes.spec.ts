// Reportes de gestión y descarga para el contador: datos propios con prefijo, resultados medidos contra lo que se creó aquí.
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
const P = `rp${sx}`; // prefijo de todo lo creado aquí
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const dia = `desde=${hoy}&hasta=${hoy}`;
let clienteId = '', proveedorId = '', localId = '', tecnicoId = '', k = 0;
let prodMuchoId = '', prodFormulaId = '';
const ordenesCreadas: string[] = [];

const filaDe = (r: { body: { filas: (string | number | null)[][] } }, texto: string) => r.body.filas.find((f) => String(f[1] ?? f[0]).includes(texto));
const crearOds = async (detalles: object[]) => {
  const v = (await como(CAJERA, 'post', '/vehiculos', { clienteId, placa: `RP${sx}${k++}` })).body;
  const o = (await como(CAJERA, 'post', '/ordenes', { vehiculoId: v.id, tipoAtencion: 'Mantenimiento correctivo' })).body;
  ordenesCreadas.push(o.id);
  const r = await como(CAJERA, 'put', `/ordenes/${o.id}/detalles`, { detalles });
  expect(r.status).toBe(200);
  expect((await como(CAJERA, 'patch', `/ordenes/${o.id}`, { estado: 'Cerrada' })).status).toBe(200);
  return o.id as string;
};

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
  await app.listen(0);
  clienteId = (await como(CAJERA, 'post', '/clientes', { tipoDocumento: 'DNI', documento: `3${sx.padStart(5, '0')}52`, nombre: `${P} cliente` })).body.id;
  proveedorId = (await como(ADMIN, 'post', '/proveedores', { tipoDocumento: 'RUC', documento: `20${sx.padStart(5, '0')}0099`, nombre: `${P} proveedor` })).body.id;
  localId = (await prisma.usuario.findUniqueOrThrow({ where: { correo: CAJERA } })).localId as string;
  tecnicoId = (await prisma.usuario.findUniqueOrThrow({ where: { correo: TECNICO } })).id;
  const prod = async (nombre: string) => (await como(ADMIN, 'post', '/productos', { codigo: `${P}${k++}`, nombre, precio: 10 })).body.id as string;
  prodMuchoId = await prod(`${P} producto mucho`);
  prodFormulaId = await prod(`=${P} formula`);
});
afterAll(async () => {
  const notas = await prisma.notaVenta.findMany({ where: { clienteId } });
  await prisma.abono.deleteMany({ where: { OR: [{ notaId: { in: notas.map((x) => x.id) } }, { ordenId: { in: ordenesCreadas } }] } });
  await prisma.notaVenta.deleteMany({ where: { clienteId } });
  await prisma.compra.deleteMany({ where: { proveedorId } });
  for (const t of ['solicitudOds', 'evidenciaIngreso', 'detalleODS', 'bitacora'] as const) await (prisma[t] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { ordenId: { in: ordenesCreadas } } });
  await prisma.ordenServicio.deleteMany({ where: { id: { in: ordenesCreadas } } });
  const vs = await prisma.vehiculo.findMany({ where: { clienteId } });
  await prisma.lecturaKm.deleteMany({ where: { vehiculoId: { in: vs.map((v) => v.id) } } });
  await prisma.vehiculo.deleteMany({ where: { clienteId } });
  const ps = [prodMuchoId, prodFormulaId];
  await prisma.movimientoInventario.deleteMany({ where: { productoId: { in: ps } } });
  await prisma.stockProducto.deleteMany({ where: { productoId: { in: ps } } });
  await prisma.auditoria.deleteMany({ where: { registroId: { in: [...notas.map((x) => x.id), ...ordenesCreadas, ...ps, proveedorId, clienteId] } } });
  await prisma.producto.deleteMany({ where: { id: { in: ps } } });
  await prisma.proveedor.deleteMany({ where: { id: proveedorId } });
  await prisma.cliente.deleteMany({ where: { id: clienteId } });
  await app.close();
  await prisma.$disconnect();
});

const RUTAS = ['servicios-top', 'productos-top', 'items-top', 'items-venta-top', 'ventas-servicio', 'produccion-tecnicos', 'ventas-mes', 'contador-ventas', 'contador-compras'];

describe('acceso', () => {
  it('sin sesión, 401 en todos los reportes', async () => {
    for (const r of RUTAS) expect((await request(app.getHttpServer()).get(`/reportes/${r}`)).status).toBe(401);
  });
  it('Cajera, Técnico y Logístico reciben 403; Administrador y Superadministrador ven todos (200)', async () => {
    for (const r of RUTAS) {
      for (const quien of [CAJERA, TECNICO, LOGISTICO]) expect([r, (await como(quien, 'get', `/reportes/${r}?${dia}`)).status]).toEqual([r, 403]);
      for (const quien of [ADMIN, SUPER]) expect([r, (await como(quien, 'get', `/reportes/${r}?${dia}`)).status]).toEqual([r, 200]);
    }
  });
  it('el Jefe de taller ve solo el operativo (servicios, productos e ítems más realizados) y la producción de técnicos', async () => {
    for (const r of RUTAS) {
      const permitido = ['servicios-top', 'productos-top', 'items-top', 'produccion-tecnicos'].includes(r);
      expect([r, (await como(JEFE, 'get', `/reportes/${r}?${dia}`)).status]).toEqual([r, permitido ? 200 : 403]);
    }
  });
});

describe('filtros', () => {
  it('las fechas mal escritas, invertidas o los filtros que no son texto dan 400', async () => {
    for (const q of ['desde=ayer', 'desde=2026-02-31x', 'desde=2026-12-01&hasta=2026-01-01', 'localId[a]=1', 'localId[]=a&localId[]=b']) {
      expect([q, (await como(ADMIN, 'get', `/reportes/items-top?${q}`)).status]).toEqual([q, 400]);
    }
    expect((await como(ADMIN, 'get', '/reportes/contador-ventas?tipoIgv=EXONERADO')).status).toBe(400);
  });
  it('las alertas de stock ya no existen en el sistema', async () => {
    expect((await como(ADMIN, 'get', '/reportes/alertas-stock')).status).toBe(404);
  });
  it('un local que no existe devuelve vacío y no falla', async () => {
    const r = await como(ADMIN, 'get', '/reportes/items-top?localId=00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(200);
    expect(r.body.filas).toEqual([]);
  });
});

describe('ítems y técnicos de las ODS cerradas', () => {
  it('un servicio cuenta una vez por línea, un producto por su cantidad, y solo cuentan las ODS cerradas', async () => {
    const antes = (await como(ADMIN, 'get', `/reportes/ventas-servicio?${dia}`)).body.filas.length;
    await crearOds([{ tipo: 'servicio', descripcion: `${P} servicio A`, precio: 100, tecnicoId, horas: 2 }, { tipo: 'servicio', descripcion: `${P} servicio B`, precio: 30 }]);
    await crearOds([{ tipo: 'servicio', descripcion: `${P} servicio A`, precio: 100, tecnicoId, horas: 1.5 }]);
    // Una ODS abierta no se cuenta.
    const v = (await como(CAJERA, 'post', '/vehiculos', { clienteId, placa: `RP${sx}${k++}` })).body;
    const abierta = (await como(CAJERA, 'post', '/ordenes', { vehiculoId: v.id, tipoAtencion: 'Mantenimiento correctivo' })).body;
    ordenesCreadas.push(abierta.id);
    await como(CAJERA, 'put', `/ordenes/${abierta.id}/detalles`, { detalles: [{ tipo: 'servicio', descripcion: `${P} servicio ABIERTA`, precio: 999 }] });
    const r = await como(ADMIN, 'get', `/reportes/ventas-servicio?${dia}`);
    expect(r.body.filas.length).toBe(antes + 2);
    expect(filaDe(r, `${P} servicio A`)).toEqual([expect.any(Number), `${P} servicio A`, 2, 200]);
    expect(filaDe(r, `${P} servicio B`)![2]).toBe(1);
    expect(filaDe(r, 'ABIERTA')).toBeUndefined();
  });
  it('el top de servicios y el de productos traen como máximo 10 filas, ordenadas por cantidad', async () => {
    await crearOds([{ tipo: 'producto', descripcion: `${P} producto mucho`, cantidad: 90000, precio: 1, productoId: prodMuchoId }]);
    for (const ruta of ['servicios-top', 'productos-top', 'items-top']) {
      const r = await como(ADMIN, 'get', `/reportes/${ruta}?${dia}`);
      expect(r.body.filas.length).toBeLessThanOrEqual(10);
      const cant = r.body.filas.map((f: number[]) => f[2]);
      expect([...cant].sort((a: number, b: number) => b - a)).toEqual(cant);
    }
    const p = await como(ADMIN, 'get', `/reportes/productos-top?${dia}`);
    expect(p.body.filas[0].slice(1)).toEqual([`${P} producto mucho`, 90000, 90000]);
  });
  it('el top de mayor venta ordena por importe y un ítem caro sale primero', async () => {
    await crearOds([{ tipo: 'servicio', descripcion: `${P} servicio carísimo`, precio: 8_000_000 }]);
    const r = await como(ADMIN, 'get', `/reportes/items-venta-top?${dia}`);
    expect(r.body.filas[0][1]).toBe(`${P} servicio carísimo`);
    const ventas = r.body.filas.map((f: number[]) => f[3]);
    expect([...ventas].sort((a: number, b: number) => b - a)).toEqual(ventas);
  });
  it('la producción del técnico suma importe y horas de sus ítems', async () => {
    const antes = filaDe(await como(ADMIN, 'get', `/reportes/produccion-tecnicos?${dia}`), 'Técnico Demo 1');
    const total0 = Number(antes?.[2] ?? 0), horas0 = Number(antes?.[3] ?? 0);
    await crearOds([{ tipo: 'servicio', descripcion: `${P} trabajo del técnico`, precio: 250, tecnicoId }]);
    const r = await como(ADMIN, 'get', `/reportes/produccion-tecnicos?${dia}`);
    const fila = filaDe(r, 'Técnico Demo 1')!;
    expect(Number(fila[2])).toBeCloseTo(total0 + 250, 2);
    // Las horas salen del catálogo de servicios (el servidor las recalcula): un ítem libre no suma horas.
    expect(Number(fila[3])).toBeCloseTo(horas0, 2);
    expect(r.body.resumen.masProduce).toBeTruthy();
    expect(r.body.resumen.menosProduce).toBeTruthy();
  });
});

describe('ventas de hoy y descarga para el contador', () => {
  it('ventas de hoy suma las notas emitidas de hoy y no las anuladas', async () => {
    const leer = async () => (await como(ADMIN, 'get', '/reportes/ventas-mes')).body.filas as [string, number][];
    const antes = (await leer())[0][1];
    const n1 = await como(CAJERA, 'post', '/notas-venta', { clienteId, items: [{ tipo: 'servicio', descripcion: `${P} venta 1`, cantidad: 1, precio: 118, tipoIgv: 'GRAVADO' }] });
    const n2 = await como(CAJERA, 'post', '/notas-venta', { clienteId, items: [{ tipo: 'servicio', descripcion: `${P} venta 2`, cantidad: 1, precio: 50, tipoIgv: 'NO_APLICA' }] });
    expect([n1.status, n2.status]).toEqual([201, 201]);
    expect((await leer())[0][1]).toBeCloseTo(antes + 168, 2);
    expect((await como(SUPER, 'post', `/notas-venta/${n2.body.id}/anular`, { motivo: 'prueba de reportes' })).status).toBe(201);
    expect((await leer())[0][1]).toBeCloseTo(antes + 118, 2);
  });
  it('descarga de ventas: una fila por nota (no por ODS), con base, IGV, no aplica y detracción, y el aviso del contador', async () => {
    const ods = await crearOds([{ tipo: 'servicio', descripcion: `${P} servicio con nota`, precio: 100 }]);
    void ods;
    const nota = await como(CAJERA, 'post', '/notas-venta', { clienteId, comentario: 'F001-123 emitida en SUNAT', items: [{ tipo: 'servicio', descripcion: 'a', cantidad: 1, precio: 118, tipoIgv: 'GRAVADO' }, { tipo: 'producto', descripcion: 'b', cantidad: 1, precio: 30, tipoIgv: 'NO_APLICA' }], conDetraccion: false });
    expect(nota.status).toBe(201);
    const r = await como(ADMIN, 'get', `/reportes/contador-ventas?${dia}`);
    expect(r.body.aviso).toMatch(/no calcula impuestos/);
    const fila = r.body.filas.find((f: unknown[]) => f[1] === nota.body.numero && f[0] === nota.body.serie);
    expect(fila.slice(6, 15)).toEqual([100, 0, 0, 30, 18, 18, 148, 'Sin detracción', 0]);
    expect(fila[15]).toBe('F001-123 emitida en SUNAT');
    const gravadas = await como(ADMIN, 'get', `/reportes/contador-ventas?${dia}&tipoIgv=NO_APLICA`);
    expect(gravadas.body.filas.every((f: number[]) => f[9] > 0)).toBe(true);
  });
  it('descarga de compras: tipo de IGV, tasa, base, IGV y total del comprobante', async () => {
    const c = await como(ADMIN, 'post', '/compras', { proveedorId, localId, tipoDocumento: 'BOLETA', serie: 'B001', numero: `${sx}2`, fecha: hoy, condicion: 'CONTADO', tipoIgv: 'GRAVADO_REDUCIDO', items: [{ descripcion: 'x', cantidad: 1, costo: 110 }] });
    expect(c.status).toBe(201);
    const r = await como(ADMIN, 'get', `/reportes/contador-compras?${dia}`);
    const fila = r.body.filas.find((f: string[]) => f[2] === `${sx}2`);
    expect(fila).toEqual(['BOLETA', 'B001', `${sx}2`, hoy, expect.any(String), `${P} proveedor`, 'Gravado reducido', 10, 100, 10, 110]);
    expect(r.body.aviso).toMatch(/no calcula impuestos/);
  });
  it('el CSV lleva el tipo correcto, BOM, aviso y neutraliza las fórmulas', async () => {
    await crearOds([{ tipo: 'producto', descripcion: `=${P} formula`, cantidad: 3, precio: 5, productoId: prodFormulaId }]);
    const t = await request(app.getHttpServer()).get(`/reportes/productos-top?${dia}&formato=csv`).set('Authorization', `Bearer ${await tokenDe(ADMIN)}`);
    expect(t.status).toBe(200);
    expect(t.headers['content-type']).toMatch(/text\/csv/);
    expect(t.headers['content-disposition']).toMatch(/productos-top\.csv/);
    expect(t.text.startsWith('﻿')).toBe(true);
    expect(t.text).toContain(`'=${P} formula`);
    const c = await request(app.getHttpServer()).get(`/reportes/contador-ventas?${dia}&formato=csv`).set('Authorization', `Bearer ${await tokenDe(ADMIN)}`);
    expect(c.text.split('\r\n')[0]).toContain('el sistema no calcula impuestos');
  });
});
