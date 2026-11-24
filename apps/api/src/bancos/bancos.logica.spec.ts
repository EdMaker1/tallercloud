import { cuentaPorMetodo, saldoDe, Cuenta } from './bancos.logica';

const cuentas: Cuenta[] = [
  { id: 'y', nombre: 'Yape', tipo: 'YAPE', localId: null, activa: true },
  { id: 'ip', nombre: 'Interbank personal (Plin)', tipo: 'BANCO', localId: null, activa: true },
  { id: 'ie', nombre: 'Interbank empresa', tipo: 'BANCO', localId: null, activa: true },
  { id: 'ca', nombre: 'Caja chica de administración', tipo: 'CAJA_ADMIN', localId: null, activa: true },
  { id: 'e1', nombre: 'Efectivo Unión', tipo: 'EFECTIVO', localId: 'l1', activa: true },
  { id: 'e2', nombre: 'Efectivo Prohogar', tipo: 'EFECTIVO', localId: 'l2', activa: true },
];

describe('saldo de una cuenta', () => {
  it('es el saldo inicial más los ingresos menos los egresos, a dos decimales', () => {
    expect(saldoDe(100, [{ tipo: 'INGRESO', monto: 50.5 }, { tipo: 'EGRESO', monto: 20.25 }, { tipo: 'INGRESO', monto: 0.1 }])).toBe(130.35);
    expect(saldoDe(0, [])).toBe(0);
    expect(saldoDe(0, [{ tipo: 'EGRESO', monto: 10 }])).toBe(-10);
  });
  it('los decimales no se desvían al sumar muchos movimientos pequeños', () => {
    expect(saldoDe(0, Array.from({ length: 1000 }, () => ({ tipo: 'INGRESO', monto: 0.1 })))).toBe(100);
  });
});

describe('cuenta por método de pago (cuando no se elige una)', () => {
  it('en ventas: efectivo va al efectivo de la sede; Yape a Yape; transferencia y tarjeta a Interbank empresa; otro a Interbank personal', () => {
    expect(cuentaPorMetodo('Efectivo', cuentas, 'l1')?.id).toBe('e1');
    expect(cuentaPorMetodo('Efectivo', cuentas, 'l2')?.id).toBe('e2');
    expect(cuentaPorMetodo('Yape', cuentas, 'l1')?.id).toBe('y');
    expect(cuentaPorMetodo('Transferencia', cuentas, 'l1')?.id).toBe('ie');
    expect(cuentaPorMetodo('Tarjeta', cuentas, 'l1')?.id).toBe('ie');
    expect(cuentaPorMetodo('Otro', cuentas, 'l1')?.id).toBe('ip');
  });
  it('en compras: efectivo sale del efectivo de la sede y todo lo demás de la caja chica de administración', () => {
    expect(cuentaPorMetodo('Efectivo', cuentas, 'l1', true)?.id).toBe('e1');
    expect(cuentaPorMetodo('Transferencia', cuentas, 'l1', true)?.id).toBe('ca');
    expect(cuentaPorMetodo('Yape', cuentas, 'l2', true)?.id).toBe('ca');
  });
  it('una cuenta inactiva o inexistente no se elige; sin sede no hay efectivo', () => {
    expect(cuentaPorMetodo('Yape', cuentas.map((c) => (c.id === 'y' ? { ...c, activa: false } : c)), 'l1')).toBeNull();
    expect(cuentaPorMetodo('Efectivo', cuentas, null)).toBeNull();
    expect(cuentaPorMetodo('Cheque', cuentas, 'l1')).toBeNull();
  });
});
