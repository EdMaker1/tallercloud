import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Sesion } from '../comun/acceso';
import { Cuenta, cuentaPorMetodo } from './bancos.logica';

type Db = Prisma.TransactionClient | PrismaClient;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DatosMovimiento {
  organizacionId: string; cuentaId: string; localId: string | null; tipo: 'INGRESO' | 'EGRESO'; monto: number; concepto?: string | null;
  origen: string; referenciaId?: string | null; transferenciaId?: string | null; usuarioId: string;
}

/** Un movimiento de cuenta: el monto siempre es positivo y el tipo da el signo. */
export const registrarMovimiento = (db: Db, d: DatosMovimiento) =>
  db.movimientoBanco.create({ data: { organizacionId: d.organizacionId, cuentaId: d.cuentaId, localId: d.localId, tipo: d.tipo, monto: r2(d.monto), concepto: d.concepto ?? null, origen: d.origen, referenciaId: d.referenciaId ?? null, transferenciaId: d.transferenciaId ?? null, usuarioId: d.usuarioId } });

/**
 * Cuenta de un cobro o de un pago: la que se elige o, si no, la que corresponde al método de pago.
 * Un cobro nunca entra a la caja chica de administración. Si la empresa no tiene la cuenta, devuelve null y no se registra movimiento.
 */
export async function resolverCuenta(db: Db, organizacionId: string, p: { metodo: string; cuentaId?: unknown; localId: string | null; compra?: boolean; ingreso?: boolean }): Promise<Cuenta | null> {
  const cuentas = (await db.cuentaBanco.findMany({ where: { organizacionId } })) as Cuenta[];
  if (p.cuentaId !== undefined && p.cuentaId !== null && p.cuentaId !== '') {
    const c = typeof p.cuentaId === 'string' ? cuentas.find((x) => x.id === p.cuentaId && x.activa) : undefined;
    if (!c) throw new BadRequestException('La cuenta elegida no existe o está inactiva.');
    if (p.ingreso && c.tipo === 'CAJA_ADMIN') throw new BadRequestException('Un cobro no puede entrar a la caja chica de administración.');
    return c;
  }
  const c = cuentaPorMetodo(p.metodo, cuentas, p.localId, p.compra);
  return c && p.ingreso && c.tipo === 'CAJA_ADMIN' ? null : c;
}

/** Registra el movimiento de un cobro (ingreso) o de un pago a proveedor (egreso) en la cuenta que corresponde, con la sede de quien lo registra. */
export async function movimientoDePago(db: Db, s: Sesion, real: Sesion, p: { organizacionId: string; metodo: string; cuentaId?: unknown; monto: number; tipo: 'INGRESO' | 'EGRESO'; concepto: string; origen: string; referenciaId: string }) {
  const cuenta = await resolverCuenta(db, p.organizacionId, { metodo: p.metodo, cuentaId: p.cuentaId, localId: s.localId, compra: p.tipo === 'EGRESO', ingreso: p.tipo === 'INGRESO' });
  if (!cuenta) return null;
  return registrarMovimiento(db, { organizacionId: p.organizacionId, cuentaId: cuenta.id, localId: s.localId, tipo: p.tipo, monto: p.monto, concepto: p.concepto, origen: p.origen, referenciaId: p.referenciaId, usuarioId: real.id });
}
