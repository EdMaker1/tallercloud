// Reglas de Bancos (RF-091) sin base de datos, para probarlas solas.
export const TIPOS_CUENTA = ['YAPE', 'BANCO', 'EFECTIVO', 'CAJA_ADMIN'] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];
export interface Cuenta { id: string; nombre: string; tipo: string; localId: string | null; activa: boolean }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Saldo = saldo inicial + ingresos − egresos, sumando en centavos para que los decimales no se desvíen. */
export function saldoDe(inicial: number, movimientos: { tipo: string; monto: number }[]) {
  const centavos = movimientos.reduce((a, m) => a + (m.tipo === 'INGRESO' ? 1 : -1) * Math.round(m.monto * 100), Math.round(inicial * 100));
  return r2(centavos / 100);
}

/**
 * Cuenta por defecto según el método de pago, cuando quien registra no elige una.
 * Ventas: efectivo → efectivo de la sede; Yape → Yape; transferencia y tarjeta → Interbank empresa; otro → Interbank personal.
 * Compras: efectivo → efectivo de la sede; lo demás → caja chica de administración.
 */
export function cuentaPorMetodo(metodo: string, cuentas: Cuenta[], localId: string | null, paraCompra = false): Cuenta | null {
  const activas = cuentas.filter((c) => c.activa);
  const efectivo = () => (localId ? activas.find((c) => c.tipo === 'EFECTIVO' && c.localId === localId) ?? null : null);
  const banco = (parte: string) => activas.find((c) => c.tipo === 'BANCO' && c.nombre.toLowerCase().includes(parte)) ?? null;
  if (metodo === 'Efectivo') return efectivo();
  if (paraCompra) return ['Yape', 'Transferencia', 'Tarjeta', 'Otro'].includes(metodo) ? activas.find((c) => c.tipo === 'CAJA_ADMIN') ?? null : null;
  if (metodo === 'Yape') return activas.find((c) => c.tipo === 'YAPE') ?? null;
  if (metodo === 'Transferencia' || metodo === 'Tarjeta') return banco('empresa');
  if (metodo === 'Otro') return banco('personal');
  return null;
}
