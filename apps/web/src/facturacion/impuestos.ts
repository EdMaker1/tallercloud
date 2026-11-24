import { TipoIgv } from '../comun/api';

/** Impuestos de la empresa, editables en Empresa y parámetros: IGV, IGV reducido (compras) y detracción con su umbral. */
export interface Impuestos { igvPct: number; igvReducidoPct: number; detraccionPct: number; detraccionDesde: number }
export const IMPUESTOS_POR_DEFECTO: Impuestos = { igvPct: 18, igvReducidoPct: 10, detraccionPct: 12, detraccionDesde: 700 };
export const impuestosDe = (e?: { impuestos?: Impuestos } | null): Impuestos => e?.impuestos ?? IMPUESTOS_POR_DEFECTO;
/** Porcentaje sin ceros de sobra y con coma decimal: 18 → «18», 7,5 → «7,5». */
export const pct = (n: number) => String(n).replace('.', ',');

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** En ventas solo se ofrecen Gravado y No aplica; una nota anterior con Exonerado o Inafecto conserva su tipo. */
export const TIPOS_VENTA: [TipoIgv, string][] = [['GRAVADO', 'Gravado'], ['NO_APLICA', 'No aplica']];
export const opcionesVenta = (actual: TipoIgv): [TipoIgv, string][] => (TIPOS_VENTA.some(([v]) => v === actual) ? TIPOS_VENTA : [...TIPOS_VENTA, [actual, actual === 'EXONERADO' ? 'Exonerado' : 'Inafecto']]);

export type TipoIgvCompra = 'GRAVADO' | 'GRAVADO_REDUCIDO' | 'NO_APLICA';
/** Los nombres llevan la tasa vigente de la empresa: «Gravado 18 %», «Gravado 10 %» y «No aplica». */
export const tiposCompra = (imp: Impuestos): [TipoIgvCompra, string][] => [['GRAVADO', `Gravado ${pct(imp.igvPct)} %`], ['GRAVADO_REDUCIDO', `Gravado ${pct(imp.igvReducidoPct)} %`], ['NO_APLICA', 'No aplica']];

/** Mismo desglose que el servidor: base e IGV a partir del total; si se escribe el IGV del comprobante, ese manda. */
export function desgloseCompra(total: number, tipo: TipoIgvCompra, imp: Impuestos, igvEditado?: number) {
  if (tipo === 'NO_APLICA') return { baseImponible: r2(total), igv: 0, igvPct: 0 };
  const igvPct = tipo === 'GRAVADO' ? imp.igvPct : imp.igvReducidoPct;
  if (igvEditado !== undefined && Number.isFinite(igvEditado)) return { baseImponible: r2(total - igvEditado), igv: r2(igvEditado), igvPct };
  const baseImponible = r2(total / (1 + igvPct / 100));
  return { baseImponible, igv: r2(total - baseImponible), igvPct };
}
