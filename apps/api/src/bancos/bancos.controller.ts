import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { auditar, Requiere, Sesion, SesionActual, SesionReal } from '../comun/acceso';
import { PrismaService } from '../comun/prisma.service';
import { aNumero, empresaDe, texto } from '../comun/validacion';
import { saldoDe, TIPOS_CUENTA } from './bancos.logica';
import { registrarMovimiento } from './bancos.servicio';

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const inicioDe = (f: string) => new Date(`${f}T00:00:00-05:00`);
const finDe = (f: string) => new Date(`${f}T23:59:59.999-05:00`);
const COBROS = ['NOTA_VENTA', 'ABONO', 'COBRO'];

function cadena(v: unknown, campo: string) {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string') throw new BadRequestException(`El filtro ${campo} no es válido.`);
  return v;
}
function fecha(v: unknown, campo: string) {
  const t = cadena(v, campo);
  if (t === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(inicioDe(t).getTime())) throw new BadRequestException(`${campo}: la fecha no es válida (AAAA-MM-DD).`);
  return t;
}
function monto(v: unknown, campo = 'El monto', minimo = 0.01) {
  const x = aNumero(v);
  if (!Number.isFinite(x) || x < minimo || x > 10_000_000) throw new BadRequestException(`${campo}: escribe un importe entre ${minimo} y 10 000 000.`);
  return r2(x);
}

/**
 * Bancos (RF-091). Administrador y Superadministrador (nivel «todo»): todas las cuentas, por sede y en general, con saldos y movimientos.
 * Cajera (nivel «editar»): solo el efectivo de su sede con su saldo real y, en las demás cuentas, lo que ella facturó hoy; nunca el saldo de
 * una cuenta que no sea efectivo ni la caja chica de administración, y esto se aplica aquí, en la API, no solo en la pantalla.
 */
@Controller('bancos')
export class BancosController {
  constructor(private prisma: PrismaService) {}

  private admin = (s: Sesion) => s.permisos['bancos'] === 'A';

  private async saldos(organizacionId: string, extra: Prisma.MovimientoBancoWhereInput = {}) {
    const g = await this.prisma.movimientoBanco.groupBy({ by: ['cuentaId', 'tipo'], where: { organizacionId, ...extra }, _sum: { monto: true } });
    const m = new Map<string, { ingresos: number; egresos: number }>();
    for (const x of g) {
      const e = m.get(x.cuentaId) ?? { ingresos: 0, egresos: 0 };
      if (x.tipo === 'INGRESO') e.ingresos = n(x._sum.monto); else e.egresos = n(x._sum.monto);
      m.set(x.cuentaId, e);
    }
    return m;
  }

  /** El efectivo de la sede de quien consulta; sin sede no hay caja. */
  private async efectivoDe(organizacionId: string, s: Sesion) {
    if (!s.localId) throw new ConflictException('Tu usuario no tiene una sede asignada: la caja de efectivo es de la sede.');
    const c = await this.prisma.cuentaBanco.findFirst({ where: { organizacionId, tipo: 'EFECTIVO', localId: s.localId, activa: true } });
    if (!c) throw new ConflictException('Tu sede no tiene una cuenta de efectivo.');
    return c;
  }

  private fila(m: { id: string; fecha: Date; tipo: string; monto: Prisma.Decimal; concepto: string | null; origen: string; cuenta: { id: string; nombre: string }; local: { nombre: string } | null; usuario: { nombre: string } }) {
    return { id: m.id, fecha: m.fecha.toISOString(), cuentaId: m.cuenta.id, cuenta: m.cuenta.nombre, tipo: m.tipo, monto: n(m.monto), concepto: m.concepto, origen: m.origen, sede: m.local?.nombre ?? null, usuario: m.usuario.nombre };
  }

  @Get('cuentas')
  @Requiere('bancos', 'E')
  async cuentas(@SesionActual() s: Sesion, @Query() f: { localId?: string; desde?: string; hasta?: string }) {
    const organizacionId = empresaDe(s);
    if (!this.admin(s)) return this.cuentasCajera(organizacionId, s);
    const localId = cadena(f.localId, 'sede'), desde = fecha(f.desde, 'Desde'), hasta = fecha(f.hasta, 'Hasta');
    const cuentas = await this.prisma.cuentaBanco.findMany({ where: { organizacionId }, include: { local: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
    const total = await this.saldos(organizacionId);
    const periodo = await this.saldos(organizacionId, { ...(localId ? { localId } : {}), ...(desde || hasta ? { fecha: { ...(desde ? { gte: inicioDe(desde) } : {}), ...(hasta ? { lte: finDe(hasta) } : {}) } } : {}) });
    return cuentas.map((c) => {
      const t = total.get(c.id) ?? { ingresos: 0, egresos: 0 }, p = periodo.get(c.id) ?? { ingresos: 0, egresos: 0 };
      return { id: c.id, nombre: c.nombre, numero: c.numero, tipo: c.tipo, localId: c.localId, sede: c.local?.nombre ?? null, activa: c.activa, saldoInicial: n(c.saldoInicial), saldo: r2(n(c.saldoInicial) + t.ingresos - t.egresos), ingresos: r2(p.ingresos), egresos: r2(p.egresos) };
    });
  }

  /** Vista de la cajera: el efectivo de su sede con su saldo real y lo que ella facturó hoy en las demás cuentas. Sin saldos de bancos. */
  private async cuentasCajera(organizacionId: string, s: Sesion) {
    const efectivo = await this.efectivoDe(organizacionId, s);
    const otras = await this.prisma.cuentaBanco.findMany({ where: { organizacionId, activa: true, tipo: { in: ['YAPE', 'BANCO'] } }, orderBy: { nombre: 'asc' } });
    const hoy = hoyLima();
    const mios = await this.prisma.movimientoBanco.groupBy({ by: ['cuentaId'], where: { organizacionId, localId: s.localId, usuarioId: s.id, tipo: 'INGRESO', origen: { in: COBROS }, fecha: { gte: inicioDe(hoy), lte: finDe(hoy) } }, _sum: { monto: true } });
    const total = (await this.saldos(organizacionId, { cuentaId: efectivo.id })).get(efectivo.id) ?? { ingresos: 0, egresos: 0 };
    return [
      { id: efectivo.id, nombre: efectivo.nombre, tipo: 'EFECTIVO', saldo: r2(n(efectivo.saldoInicial) + total.ingresos - total.egresos) },
      ...otras.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, facturadoHoy: r2(n(mios.find((x) => x.cuentaId === c.id)?._sum.monto)) })),
    ];
  }

  @Get('movimientos')
  @Requiere('bancos', 'E')
  async movimientos(@SesionActual() s: Sesion, @Query() f: { cuentaId?: string; localId?: string; desde?: string; hasta?: string; n?: string }) {
    const organizacionId = empresaDe(s);
    let cuentaId = cadena(f.cuentaId, 'cuenta'), localId = cadena(f.localId, 'sede');
    let desde = fecha(f.desde, 'Desde'), hasta = fecha(f.hasta, 'Hasta');
    if (!this.admin(s)) {
      // La cajera solo ve los movimientos del efectivo de su sede; de cualquier otra cuenta, nada.
      const efectivo = await this.efectivoDe(organizacionId, s);
      if (cuentaId && cuentaId !== efectivo.id) throw new NotFoundException('Cuenta no encontrada.');
      cuentaId = efectivo.id; localId = undefined;
      if (!desde && !hasta) { desde = hoyLima(); hasta = desde; }
    }
    const where: Prisma.MovimientoBancoWhereInput = { organizacionId, ...(cuentaId ? { cuentaId } : {}), ...(localId ? { localId } : {}), ...(desde || hasta ? { fecha: { ...(desde ? { gte: inicioDe(desde) } : {}), ...(hasta ? { lte: finDe(hasta) } : {}) } } : {}) };
    const filas = await this.prisma.movimientoBanco.findMany({ where, include: { cuenta: true, local: true, usuario: true }, orderBy: { fecha: 'desc' }, take: Math.min(Number(f.n) || 200, 1000) });
    return filas.map((m) => this.fila(m));
  }

  @Post('cuentas')
  @Requiere('bancos', 'A')
  async crearCuenta(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const nombre = texto(b?.nombre, 80);
    if (!nombre) throw new BadRequestException('Escribe el nombre de la cuenta.');
    const tipo = String(b?.tipo ?? '');
    if (!(TIPOS_CUENTA as readonly string[]).includes(tipo)) throw new BadRequestException('El tipo de cuenta es Yape, banco, efectivo o caja chica de administración.');
    let localId: string | null = null;
    if (tipo === 'EFECTIVO') {
      const l = await this.prisma.local.findFirst({ where: { id: String(b?.localId ?? ''), organizacionId } });
      if (!l) throw new BadRequestException('El efectivo es de una sede: elige la sede.');
      if (await this.prisma.cuentaBanco.findFirst({ where: { organizacionId, tipo: 'EFECTIVO', localId: l.id, activa: true } })) throw new ConflictException('Esa sede ya tiene una cuenta de efectivo.');
      localId = l.id;
    }
    const c = await this.prisma.cuentaBanco.create({ data: { organizacionId, nombre, numero: texto(b?.numero, 40), tipo, localId, saldoInicial: b?.saldoInicial === undefined ? 0 : monto(b.saldoInicial, 'El saldo inicial', 0) } });
    await auditar(this.prisma, real, s, 'cuentaBanco', c.id, null, { nombre, tipo }, 'Cuenta creada');
    return { id: c.id };
  }

  @Patch('cuentas/:id')
  @Requiere('bancos', 'A')
  async editarCuenta(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const antes = await this.prisma.cuentaBanco.findFirst({ where: { id, organizacionId } });
    if (!antes) throw new NotFoundException('Cuenta no encontrada.');
    const d: Prisma.CuentaBancoUpdateInput = {};
    if (b?.nombre !== undefined) { const t = texto(b.nombre, 80); if (!t) throw new BadRequestException('Escribe el nombre de la cuenta.'); d.nombre = t; }
    if (b?.numero !== undefined) d.numero = texto(b.numero, 40);
    if (b?.saldoInicial !== undefined) d.saldoInicial = monto(b.saldoInicial, 'El saldo inicial', 0);
    if (b?.activa !== undefined) { if (typeof b.activa !== 'boolean') throw new BadRequestException('Activa es sí o no.'); d.activa = b.activa; }
    await this.prisma.cuentaBanco.update({ where: { id }, data: d });
    await auditar(this.prisma, real, s, 'cuentaBanco', id, { nombre: antes.nombre, activa: antes.activa }, d, 'Cuenta modificada');
    return { id };
  }

  /** Ingreso o egreso manual (retiro, depósito, pago a un colaborador). La cajera solo lo hace en el efectivo de su sede. */
  @Post('movimientos')
  @Requiere('bancos', 'E')
  async nuevoMovimiento(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const tipo = String(b?.tipo ?? '');
    if (!['INGRESO', 'EGRESO'].includes(tipo)) throw new BadRequestException('El movimiento es un ingreso o un egreso.');
    const cuenta = await this.prisma.cuentaBanco.findFirst({ where: { id: String(b?.cuentaId ?? ''), organizacionId, activa: true } });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada.');
    if (!this.admin(s)) {
      const efectivo = await this.efectivoDe(organizacionId, s);
      if (cuenta.id !== efectivo.id) throw new NotFoundException('Cuenta no encontrada.');
    }
    const localId = cuenta.localId ?? s.localId;
    const m = await registrarMovimiento(this.prisma, { organizacionId, cuentaId: cuenta.id, localId, tipo: tipo as 'INGRESO' | 'EGRESO', monto: monto(b?.monto), concepto: texto(b?.concepto, 200), origen: 'MANUAL', usuarioId: real.id });
    await auditar(this.prisma, real, s, 'movimientoBanco', m.id, null, { cuenta: cuenta.nombre, tipo, monto: n(m.monto) }, 'Movimiento de cuenta registrado');
    return { id: m.id };
  }

  /** Transferencia entre cuentas: un egreso en el origen y un ingreso en el destino, en una sola transacción. Solo administradores. */
  @Post('transferencias')
  @Requiere('bancos', 'A')
  async transferir(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const origenId = String(b?.origenId ?? ''), destinoId = String(b?.destinoId ?? '');
    if (origenId === destinoId) throw new BadRequestException('El origen y el destino deben ser cuentas distintas.');
    const cuentas = await this.prisma.cuentaBanco.findMany({ where: { id: { in: [origenId, destinoId] }, organizacionId, activa: true } });
    const origen = cuentas.find((c) => c.id === origenId), destino = cuentas.find((c) => c.id === destinoId);
    if (!origen || !destino) throw new NotFoundException('Cuenta no encontrada.');
    const importe = monto(b?.monto);
    const concepto = texto(b?.concepto, 200) ?? `Transferencia de ${origen.nombre} a ${destino.nombre}`;
    const transferenciaId = (await this.prisma.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`)[0].id;
    await this.prisma.$transaction(async (tx) => {
      await registrarMovimiento(tx, { organizacionId, cuentaId: origen.id, localId: origen.localId ?? s.localId, tipo: 'EGRESO', monto: importe, concepto, origen: 'TRANSFERENCIA', transferenciaId, usuarioId: real.id });
      await registrarMovimiento(tx, { organizacionId, cuentaId: destino.id, localId: destino.localId ?? s.localId, tipo: 'INGRESO', monto: importe, concepto, origen: 'TRANSFERENCIA', transferenciaId, usuarioId: real.id });
    });
    await auditar(this.prisma, real, s, 'movimientoBanco', transferenciaId, null, { origen: origen.nombre, destino: destino.nombre, monto: importe }, 'Transferencia entre cuentas');
    return { transferenciaId };
  }

  // ---- Apertura y cierre de la caja de efectivo de la sede ----

  @Get('caja/hoy')
  @Requiere('bancos', 'E')
  async cajaHoy(@SesionActual() s: Sesion) {
    const organizacionId = empresaDe(s);
    if (!s.localId) throw new ConflictException('Tu usuario no tiene una sede asignada.');
    const filas = await this.prisma.cajaDia.findMany({ where: { organizacionId, localId: s.localId, fecha: hoyLima() }, include: { usuario: true } });
    const dato = (t: string) => { const x = filas.find((f) => f.tipo === t); return x ? { monto: n(x.monto), usuario: x.usuario.nombre, hora: x.creadoEn.toISOString(), detalle: x.detalle } : null; };
    return { fecha: hoyLima(), apertura: dato('APERTURA'), cierre: dato('CIERRE') };
  }

  /** Con cuánto abre la caja de efectivo hoy: es el dato más importante de la cajera. Una vez por día y sede. */
  @Post('caja/apertura')
  @Requiere('bancos', 'E')
  async abrir(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const efectivo = await this.efectivoDe(organizacionId, s);
    const importe = monto(b?.monto, 'El monto de apertura', 0);
    const total = (await this.saldos(organizacionId, { cuentaId: efectivo.id })).get(efectivo.id) ?? { ingresos: 0, egresos: 0 };
    return this.guardarCaja(organizacionId, s, real, 'APERTURA', importe, { efectivoSistema: r2(n(efectivo.saldoInicial) + total.ingresos - total.egresos) });
  }

  /** Cierre de caja: guarda lo contado y el total del día por cuenta, con fecha, sede y usuario. */
  @Post('caja/cierre')
  @Requiere('bancos', 'E')
  async cerrar(@SesionActual() s: Sesion, @SesionReal() real: Sesion, @Body() b: Record<string, unknown>) {
    const organizacionId = empresaDe(s);
    const efectivo = await this.efectivoDe(organizacionId, s);
    const importe = monto(b?.monto, 'El monto de cierre', 0);
    const cuentas = (await this.cuentasCajera(organizacionId, s)) as { id: string; nombre: string; tipo: string; saldo?: number; facturadoHoy?: number }[];
    const efectivoSistema = cuentas.find((c) => c.id === efectivo.id)?.saldo ?? 0;
    return this.guardarCaja(organizacionId, s, real, 'CIERRE', importe, {
      efectivoSistema, diferencia: r2(importe - efectivoSistema),
      facturadoHoy: cuentas.filter((c) => c.facturadoHoy !== undefined).map((c) => ({ cuenta: c.nombre, total: c.facturadoHoy })),
    });
  }

  private async guardarCaja(organizacionId: string, s: Sesion, real: Sesion, tipo: 'APERTURA' | 'CIERRE', importe: number, detalle: Record<string, unknown>) {
    try {
      const x = await this.prisma.cajaDia.create({ data: { organizacionId, localId: s.localId as string, fecha: hoyLima(), tipo, monto: importe, detalle: detalle as Prisma.InputJsonValue, usuarioId: real.id } });
      await auditar(this.prisma, real, s, 'cajaDia', x.id, null, { tipo, monto: importe }, tipo === 'APERTURA' ? 'Apertura de caja' : 'Cierre de caja');
      return { id: x.id, fecha: x.fecha, tipo, monto: importe, detalle };
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new ConflictException(tipo === 'APERTURA' ? 'La caja de hoy ya tiene su apertura.' : 'La caja de hoy ya se cerró.');
      throw e;
    }
  }

  /** Solo el administrador entra a lo que la cajera no puede ver: aviso si otra ruta intenta pedir una cuenta ajena. */
  @Get('cuentas/:id')
  @Requiere('bancos', 'A')
  async cuenta(@SesionActual() s: Sesion, @Param('id') id: string) {
    const c = await this.prisma.cuentaBanco.findFirst({ where: { id, organizacionId: empresaDe(s) } });
    if (!c) throw new NotFoundException('Cuenta no encontrada.');
    const t = (await this.saldos(c.organizacionId, { cuentaId: id })).get(id) ?? { ingresos: 0, egresos: 0 };
    return { id: c.id, nombre: c.nombre, tipo: c.tipo, saldo: saldoDe(n(c.saldoInicial), [{ tipo: 'INGRESO', monto: t.ingresos }, { tipo: 'EGRESO', monto: t.egresos }]) };
  }
}

