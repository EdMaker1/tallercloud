// Cálculo de los reportes de gestión: funciones puras, sin base de datos. Solo lectura y reglas fijas (sin IA).
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MS_DIA = 86_400_000;

export interface FilaItem { clave: string; nombre: string; cantidad: number; venta: number }

/** Agrupa por ítem y devuelve los N primeros por cantidad o por venta total; el empate se resuelve por la otra medida y luego por nombre. */
export function topPor(filas: FilaItem[], por: 'cantidad' | 'venta', n: number) {
  const g = new Map<string, FilaItem>();
  for (const f of filas) {
    const x = g.get(f.clave) ?? { clave: f.clave, nombre: f.nombre, cantidad: 0, venta: 0 };
    x.cantidad += f.cantidad;
    x.venta += f.venta;
    g.set(f.clave, x);
  }
  const otra = por === 'cantidad' ? 'venta' : 'cantidad';
  return [...g.values()]
    .map((x) => ({ ...x, cantidad: Math.round(x.cantidad * 1000) / 1000, venta: r2(x.venta) }))
    .sort((a, b) => b[por] - a[por] || b[otra] - a[otra] || a.nombre.localeCompare(b.nombre))
    .slice(0, n);
}

/** Importe y horas por técnico; el que más y el que menos produce (por importe). */
export function produccionTecnicos(filas: { tecnico: string; total: number; horas: number }[]) {
  const g = new Map<string, { tecnico: string; total: number; horas: number }>();
  for (const f of filas) {
    const x = g.get(f.tecnico) ?? { tecnico: f.tecnico, total: 0, horas: 0 };
    x.total += f.total;
    x.horas += f.horas;
    g.set(f.tecnico, x);
  }
  const lista = [...g.values()].map((x) => ({ tecnico: x.tecnico, total: r2(x.total), horas: Math.round(x.horas * 100) / 100 })).sort((a, b) => b.total - a.total || a.tecnico.localeCompare(b.tecnico));
  return { filas: lista, mas: lista[0]?.tecnico ?? null, menos: lista.at(-1)?.tecnico ?? null };
}

const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * Ventas del mes en curso hasta hoy frente al mes anterior hasta el mismo día (o hasta su último día si es más corto)
 * y frente al mes anterior completo. `hoy` es una fecha «AAAA-MM-DD».
 */
export function comparativoMes(ventas: { fecha: string; total: number }[], hoy: string) {
  const [a, m, d] = hoy.split('-').map(Number);
  const anioAnt = m === 1 ? a - 1 : a, mesAnt = m === 1 ? 12 : m - 1;
  const mismoDia = Math.min(d, diasDelMes(anioAnt, mesAnt));
  const clave = (y: number, mm: number) => `${y}-${String(mm).padStart(2, '0')}`;
  const actual = clave(a, m), anterior = clave(anioAnt, mesAnt);
  let mesActual = 0, hastaMismoDia = 0, completo = 0, deHoy = 0;
  for (const v of ventas) {
    const mes = v.fecha.slice(0, 7), dia = Number(v.fecha.slice(8, 10));
    if (mes === actual && dia <= d) mesActual += v.total;
    if (v.fecha === hoy) deHoy += v.total;
    if (mes === anterior) { completo += v.total; if (dia <= mismoDia) hastaMismoDia += v.total; }
  }
  return {
    hoy: r2(deHoy), mesActual: r2(mesActual), mesAnteriorAlMismoDia: r2(hastaMismoDia), mesAnteriorCompleto: r2(completo),
    variacionPct: hastaMismoDia > 0 ? r2(((mesActual - hastaMismoDia) / hastaMismoDia) * 100) : null,
  };
}

/** CSV para Excel: BOM, comillas escapadas, CRLF y fórmulas neutralizadas (un texto que empieza con = + - @ lleva un apóstrofo delante). */
export function aCsv(encabezados: string[], filas: (string | number | null | undefined)[][], aviso?: string) {
  const celda = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let t = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [...(aviso ? [celda(aviso)] : []), encabezados.map(celda).join(','), ...filas.map((f) => f.map(celda).join(','))];
  return `﻿${lineas.join('\r\n')}\r\n`;
}

export const diasEntre = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MS_DIA);
