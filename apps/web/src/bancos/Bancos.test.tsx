// Bancos: vista completa del administrador y vista limitada de la cajera (sin saldos de bancos), con sus acciones.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';

const me = (nivel: 'A' | 'E') => ({
  usuario: { id: 'm', nombre: nivel === 'A' ? 'Administrador Demo' : 'Cajera Demo', correo: 'x@demo.local', organizacionId: 'o1' }, roles: [nivel === 'A' ? 'Administrador' : 'Cajera'],
  permisos: { bancos: nivel }, menu: [{ id: 'bancos', label: 'Bancos', grupo: 'Finanzas', nivel }],
  actuandoComo: false, esPlataforma: false, real: { id: 'm', nombre: 'Demo' },
});
const admin = [
  { id: 'y', nombre: 'Yape', numero: null, tipo: 'YAPE', localId: null, sede: null, activa: true, saldoInicial: 0, saldo: 350, ingresos: 350, egresos: 0 },
  { id: 'ca', nombre: 'Caja chica de administración', numero: null, tipo: 'CAJA_ADMIN', localId: null, sede: null, activa: true, saldoInicial: 1000, saldo: 880, ingresos: 0, egresos: 120 },
  { id: 'e1', nombre: 'Efectivo Local Unión', numero: null, tipo: 'EFECTIVO', localId: 'l1', sede: 'Local Unión', activa: true, saldoInicial: 0, saldo: 90, ingresos: 90, egresos: 0 },
  { id: 'e2', nombre: 'Efectivo Local Prohogar', numero: null, tipo: 'EFECTIVO', localId: 'l2', sede: 'Local Prohogar', activa: true, saldoInicial: 0, saldo: 40, ingresos: 40, egresos: 0 },
];
const cajera = [{ id: 'e1', nombre: 'Efectivo Local Unión', tipo: 'EFECTIVO', saldo: 90 }, { id: 'y', nombre: 'Yape', tipo: 'YAPE', facturadoHoy: 75 }];
const enviados: { ruta: string; metodo: string; cuerpo: any }[] = [];
const consultas: string[] = [];
let caja: any;

function simular(nivel: 'A' | 'E') {
  sessionStorage.setItem('posventa-token', 't');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url); const metodo = (init?.method ?? 'GET').toUpperCase();
    if (metodo !== 'GET') enviados.push({ ruta: u.pathname, metodo, cuerpo: JSON.parse(String(init?.body)) });
    else consultas.push(u.pathname + u.search);
    const base: Record<string, unknown> = {
      'GET /me': me(nivel),
      'GET /bancos/cuentas': nivel === 'A' ? admin : cajera,
      'GET /bancos/caja/hoy': caja,
      'GET /bancos/movimientos': [{ id: 'm1', fecha: '2026-11-23T15:00:00.000Z', cuentaId: 'e1', cuenta: 'Efectivo Local Unión', tipo: 'EGRESO', monto: 12, concepto: 'Retiro para movilidad', origen: 'MANUAL', sede: 'Local Unión', usuario: 'Cajera Demo' }],
    };
    return { ok: true, status: 200, json: async () => base[`${metodo} ${u.pathname}`] ?? {} };
  }));
}
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'false'); sessionStorage.clear(); localStorage.clear(); enviados.length = 0; consultas.length = 0; caja = { fecha: '2026-11-23', apertura: null, cierre: null }; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('Administrador: ve todas las cuentas con sus saldos, incluida la caja chica de administración', async () => {
  simular('A');
  window.location.hash = '#/bancos';
  render(<App />);
  const tabla = await screen.findByRole('table', { name: 'Cuentas' });
  expect((await within(tabla).findAllByText('Caja chica de administración')).length).toBeGreaterThan(0);
  expect(within(tabla).getByText('S/ 880.00')).toBeInTheDocument();
  expect(within(tabla).getAllByRole('button', { name: 'Trasladar' })).toHaveLength(4);
  await userEvent.selectOptions(screen.getByLabelText('Sede'), 'l1');
  await waitFor(() => expect(consultas.some((c) => c.startsWith('/bancos/cuentas') && c.includes('localId=l1'))).toBe(true));
});

it('Administrador: traslada entre cuentas y registra un egreso con sus validaciones', async () => {
  simular('A');
  window.location.hash = '#/bancos';
  render(<App />);
  const tabla = await screen.findByRole('table', { name: 'Cuentas' });
  await within(tabla).findAllByText('Caja chica de administración');
  await userEvent.click(within(tabla).getAllByRole('button', { name: 'Trasladar' })[2]);
  const d = screen.getByRole('dialog', { name: /Trasladar desde Efectivo Local Unión/ });
  await userEvent.click(within(d).getByRole('button', { name: 'Trasladar' }));
  expect(within(d).getByRole('alert')).toHaveTextContent('Elige la cuenta de destino.');
  await userEvent.selectOptions(within(d).getByLabelText('Cuenta de destino *'), 'y');
  await userEvent.type(within(d).getByLabelText('Importe *'), '25,50');
  await userEvent.click(within(d).getByRole('button', { name: 'Trasladar' }));
  await waitFor(() => expect(enviados.find((e) => e.ruta === '/bancos/transferencias')?.cuerpo).toMatchObject({ origenId: 'e1', destinoId: 'y', monto: 25.5 }));
  expect(await screen.findByRole('status')).toHaveTextContent('Transferencia registrada.');
  await userEvent.click(within(await screen.findByRole('table', { name: 'Cuentas' })).getAllByRole('button', { name: 'Egreso' })[1]);
  const e = screen.getByRole('dialog', { name: /Egreso en Caja chica/ });
  await userEvent.click(within(e).getByRole('button', { name: 'Guardar' }));
  expect(within(e).getByRole('alert')).toHaveTextContent('Escribe un importe mayor a cero.');
});

it('Cajera: ve el efectivo con su saldo y en Yape solo lo facturado hoy; no hay saldos de bancos ni caja chica de administración', async () => {
  simular('E');
  window.location.hash = '#/bancos';
  render(<App />);
  const tabla = await screen.findByRole('table', { name: 'Cuentas' });
  expect(await within(tabla).findByText('S/ 90.00')).toBeInTheDocument();
  expect(within(tabla).getByText(/Facturado hoy/)).toBeInTheDocument();
  expect(within(tabla).getByText('S/ 75.00')).toBeInTheDocument();
  expect(screen.queryByText(/Caja chica/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Trasladar' })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Cuenta' })).toBeNull();
  expect(screen.queryByLabelText('Sede')).toBeNull();
});

it('Cajera: registra con cuánto abre la caja, ve sus movimientos y cierra la caja', async () => {
  simular('E');
  window.location.hash = '#/bancos';
  render(<App />);
  await screen.findByRole('table', { name: 'Cuentas' });
  await userEvent.click(await screen.findByRole('button', { name: 'Registrar apertura' }));
  const a = screen.getByRole('dialog', { name: 'Apertura de caja' });
  await userEvent.click(within(a).getByRole('button', { name: 'Guardar' }));
  expect(within(a).getByRole('alert')).toHaveTextContent('Escribe con cuánto abres la caja.');
  await userEvent.type(within(a).getByLabelText(/Efectivo con el que abres/), '200');
  caja = { fecha: '2026-11-23', apertura: { monto: 200, usuario: 'Cajera Demo', hora: '2026-11-23T14:00:00.000Z' }, cierre: null };
  await userEvent.click(within(a).getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(enviados.find((e) => e.ruta === '/bancos/caja/apertura')?.cuerpo).toEqual({ monto: 200 }));
  expect(await screen.findByText('S/ 200.00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Registrar apertura' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Movimientos' }));
  expect(await screen.findByText('Retiro para movilidad')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar caja' }));
  await userEvent.type(screen.getByLabelText(/Efectivo contado/), '288,50');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Cerrar caja' })).getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(enviados.find((e) => e.ruta === '/bancos/caja/cierre')?.cuerpo).toEqual({ monto: 288.5 }));
});
