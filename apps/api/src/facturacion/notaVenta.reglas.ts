import { BadRequestException } from '@nestjs/common';

// Reglas de impuestos (RF-088, RN-15). Sin base de datos, para probarlas solas.
// Ventas: Gravado (el precio incluye el IGV) y No aplica. Compras: Gravado, Gravado reducido y No aplica.
// Los porcentajes y el umbral de detracción son de la empresa y se editan en Empresa y parámetros.
export const TIPOS_IGV = ['GRAVADO', 'NO_APLICA'] as const;
export const TIPOS_IGV_COMPRA = ['GRAVADO', 'GRAVADO_REDUCIDO', 'NO_APLICA'] as const;
/** Las notas anteriores pueden traer estos dos tipos; se leen y se suman, pero ya no se ofrecen. */
export type TipoIgv = (typeof TIPOS_IGV)[number] | 'EXONERADO' | 'INAFECTO';
export type TipoIgvCompra = (typeof TIPOS_IGV_COMPRA)[number];

export interface Impuestos { igvPct: number; igvReducidoPct: number; detraccionPct: number; detraccionDesde: number }
export const IMPUESTOS_POR_DEFECTO: Impuestos = { igvPct: 18, igvReducidoPct: 10, detraccionPct: 12, detraccionDesde: 700 };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** El impuesto del ítem de la ODS («IGV» o «NINGUNO») da el tipo de IGV por defecto de la nota. */
export const tipoIgvPorDefecto = (impuesto: string): TipoIgv => (impuesto === 'NINGUNO' ? 'NO_APLICA' : 'GRAVADO');

export interface LineaNota { tipo: string; total: number; tipoIgv: TipoIgv }

/**
 * Totales de la nota. En un ítem gravado el precio ya incluye el IGV: la base es total / (1 + tasa).
 * El total es la suma exacta de los ítems, sin redondeo (DEC-74); el IGV sale de la diferencia para que todo cuadre.
 */
export function totalesNota(lineas: LineaNota[], igvPct = IMPUESTOS_POR_DEFECTO.igvPct) {
  const suma = (t: TipoIgv) => r2(lineas.filter((l) => l.tipoIgv === t).reduce((a, l) => a + l.total, 0));
  const exonerada = suma('EXONERADO');
  const inafecta = suma('INAFECTO');
  const noAplica = suma('NO_APLICA');
  const conIgv = suma('GRAVADO');
  const gravada = r2(conIgv / (1 + igvPct / 100));
  const igv = r2(conIgv - gravada);
  return { exonerada, inafecta, noAplica, gravada, igv, total: r2(exonerada + inafecta + noAplica + conIgv) };
}

/** Se propone la detracción si hay al menos un servicio y el total supera el umbral de la empresa (S/ 700 por defecto, DEC-75). */
export const proponeDetraccion = (lineas: LineaNota[], total: number, desde = IMPUESTOS_POR_DEFECTO.detraccionDesde) => lineas.some((l) => l.tipo === 'servicio') && total > desde;

/** Monto exacto y monto redondeado a soles enteros (desde 0,50 sube). La deposita la empresa: no reduce lo cobrado (DEC-82). */
export function detraccionDe(total: number, pct = IMPUESTOS_POR_DEFECTO.detraccionPct) {
  const exacta = r2((total * pct) / 100);
  return { pct, exacta, redondeada: Math.floor(exacta + 0.5) };
}

/**
 * Desglose de una compra a partir de su total (que incluye el IGV): base imponible, IGV y la tasa usada.
 * Si se escribe el IGV del comprobante, ese manda y la base es el resto. «No aplica» no lleva IGV.
 */
export function desgloseCompra(total: number, tipo: TipoIgvCompra, imp: Impuestos, igvEditado?: number) {
  if (tipo === 'NO_APLICA') {
    if (igvEditado !== undefined && igvEditado !== 0) throw new BadRequestException('Con «No aplica» la compra no lleva IGV.');
    return { baseImponible: r2(total), igv: 0, igvPct: 0 };
  }
  const igvPct = tipo === 'GRAVADO' ? imp.igvPct : imp.igvReducidoPct;
  if (igvEditado !== undefined) {
    if (!Number.isFinite(igvEditado) || igvEditado < 0 || igvEditado > total) throw new BadRequestException('El IGV del comprobante no puede ser negativo ni mayor al total.');
    return { baseImponible: r2(total - igvEditado), igv: r2(igvEditado), igvPct };
  }
  const baseImponible = r2(total / (1 + igvPct / 100));
  return { baseImponible, igv: r2(total - baseImponible), igvPct };
}

/** Código visible del comprobante: serie y número con seis dígitos (NV01-000001). */
export const codigoNota = (serie: string, numero: number) => `${serie}-${String(numero).padStart(6, '0')}`;
