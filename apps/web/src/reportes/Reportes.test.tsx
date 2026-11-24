// Reportes de solo lectura: acceso por nivel, filtros que viajan a la API, tabla, aviso para el contador y descarga en CSV.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';

const me = (nivel: 'A' | 'V') => ({
  usuario: { id: 'm', nombre: 'Administrador Demo', correo: 'admin@demo.local', organizacionId: 'o1' }, roles: ['Administrador'],
  permisos: { rep_ops: nivel, rep_igv: nivel, rep_ventas: nivel },
  menu: [{ id: 'rep_ops', label: 'Operaciones', grupo: 'Reportes', nivel }, { id: 'rep_ventas', label: 'Ventas generales', grupo: 'Reportes', nivel }, { id: 'rep_igv', label: 'Descarga para el contador', grupo: 'Reportes', nivel }],
  actuandoComo: false, esPlataforma: false, real: { id: 'm', nombre: 'Administrador Demo' },
});
const llamadas: string[] = [];
let blobs = 0;

function simular(nivel: 'A' | 'V') {
  sessionStorage.setItem('posventa-token', 't');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => { blobs++; return 'blob:x'; }, revokeObjectURL: () => undefined }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url);
    llamadas.push(u.pathname + u.search);
    const clave = u.pathname;
    if (u.searchParams.get('formato') === 'csv') return { ok: true, status: 200, blob: async () => new Blob(['﻿a,b\r\n']) };
    const base: Record<string, unknown> = {
      '/me': me(nivel),
      '/ordenes/catalogos': { locales: [{ id: 'l1', nombre: 'Local Prohogar' }, { id: 'l2', nombre: 'Local Union' }] },
      '/reportes/servicios-top': { codigo: 'servicios-top', titulo: 'Top 10 de servicios más realizados', encabezados: ['N.º', 'Ítem', 'Veces realizado', 'Venta total (S/)'], filas: [[1, 'Cambio de aceite', 12, 1440.5], [2, 'Escaneo', 3, 90]] },
      '/reportes/contador-ventas': { codigo: 'contador-ventas', titulo: 'Notas de venta del periodo para el contador', encabezados: ['Serie', 'Número', 'Total'], filas: [['NV01', 7, 148]], aviso: 'Datos del sistema para el contador; el sistema no calcula impuestos. Vale lo realmente emitido en la SUNAT.', resumen: { notas: 1 } },
      '/reportes/ventas-mes': { codigo: 'ventas-mes', titulo: 'Ventas de hoy frente al mes anterior', encabezados: ['Concepto', 'Importe (S/)'], filas: [['Ventas de hoy', 25]], resumen: { variacionPct: -27.08 } },
    };
    return { ok: true, status: 200, json: async () => base[clave] ?? {} };
  }));
}
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'false'); sessionStorage.clear(); localStorage.clear(); llamadas.length = 0; blobs = 0; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('Reportes: el top se muestra con sus montos y los filtros de fecha y local viajan a la API', async () => {
  simular('A');
  window.location.hash = '#/rep_ops';
  render(<App />);
  expect(await screen.findByText('Cambio de aceite')).toBeInTheDocument();
  expect(screen.getByText('1440.50')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Desde'), '2026-11-01');
  await userEvent.selectOptions(screen.getByLabelText('Local'), 'l2');
  await waitFor(() => expect(llamadas.some((l) => l.startsWith('/reportes/servicios-top') && l.includes('desde=2026-11-01') && l.includes('localId=l2'))).toBe(true));
});

it('Reportes: el selector cambia de reporte y la descarga pide el CSV con los mismos filtros', async () => {
  simular('A');
  window.location.hash = '#/rep_igv';
  render(<App />);
  expect(await screen.findByRole('note')).toHaveTextContent('el sistema no calcula impuestos');
  expect(screen.getByText('148')).toBeInTheDocument();
  expect(screen.getByText('Notas de venta: 1')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Hasta'), '2026-11-30');
  await userEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }));
  await waitFor(() => expect(llamadas.some((l) => l.startsWith('/reportes/contador-ventas') && l.includes('formato=csv') && l.includes('hasta=2026-11-30'))).toBe(true));
  expect(blobs).toBe(1);
});

it('Reportes sin fechas: ventas de hoy no ofrece Desde ni Hasta y muestra la variación', async () => {
  simular('A');
  window.location.hash = '#/rep_ventas';
  render(<App />);
  expect(await screen.findByText('Ventas de hoy')).toBeInTheDocument();
  expect(screen.queryByLabelText('Desde')).toBeNull();
  expect(screen.getByText('Variación frente al mes anterior (%): -27.08')).toBeInTheDocument();
});

it('Reportes: con nivel de solo ver no se llama a la API y se avisa que no hay acceso', async () => {
  simular('V');
  window.location.hash = '#/rep_ops';
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no tiene acceso a este reporte.');
  expect(llamadas.some((l) => l.startsWith('/reportes/'))).toBe(false);
});
