import { describe, expect, it } from 'vitest';
import { desgloseCompra, IMPUESTOS_POR_DEFECTO, opcionesVenta, pct, tiposCompra } from './impuestos';
import { totalesDe } from './FormNota';

describe('impuestos editables (ventas y compras)', () => {
  it('en ventas solo Gravado y No aplica; una nota antigua conserva su tipo', () => {
    expect(opcionesVenta('GRAVADO').map(([v]) => v)).toEqual(['GRAVADO', 'NO_APLICA']);
    expect(opcionesVenta('EXONERADO').map(([v]) => v)).toEqual(['GRAVADO', 'NO_APLICA', 'EXONERADO']);
  });
  it('los nombres de compra llevan la tasa de la empresa: Gravado 18 %, Gravado 10 % y No aplica', () => {
    expect(tiposCompra(IMPUESTOS_POR_DEFECTO).map(([, t]) => t)).toEqual(['Gravado 18 %', 'Gravado 10 %', 'No aplica']);
    expect(tiposCompra({ ...IMPUESTOS_POR_DEFECTO, igvPct: 15 }).map(([, t]) => t)[0]).toBe('Gravado 15 %');
    expect(pct(7.5)).toBe('7,5');
  });
  it('la nota usa la tasa y el umbral de detracción de la empresa', () => {
    const lineas = [{ tipo: 'servicio', total: 800, tipoIgv: 'GRAVADO' as const }, { tipo: 'producto', total: 30, tipoIgv: 'NO_APLICA' as const }];
    const base = totalesDe(lineas);
    expect(base).toMatchObject({ gravada: 677.97, igv: 122.03, noAplica: 30, total: 830, proponeDetraccion: true, detraccion: 100 });
    const otra = totalesDe(lineas, { ...IMPUESTOS_POR_DEFECTO, igvPct: 15, detraccionPct: 10, detraccionDesde: 1000 });
    expect(otra).toMatchObject({ gravada: 695.65, igv: 104.35, proponeDetraccion: false, detraccion: 83 });
  });
  it('el desglose de la compra sale del total y el IGV del comprobante manda', () => {
    expect(desgloseCompra(118, 'GRAVADO', IMPUESTOS_POR_DEFECTO)).toEqual({ baseImponible: 100, igv: 18, igvPct: 18 });
    expect(desgloseCompra(110, 'GRAVADO_REDUCIDO', IMPUESTOS_POR_DEFECTO)).toEqual({ baseImponible: 100, igv: 10, igvPct: 10 });
    expect(desgloseCompra(50, 'NO_APLICA', IMPUESTOS_POR_DEFECTO)).toEqual({ baseImponible: 50, igv: 0, igvPct: 0 });
    expect(desgloseCompra(118, 'GRAVADO', IMPUESTOS_POR_DEFECTO, 17.99)).toEqual({ baseImponible: 100.01, igv: 17.99, igvPct: 18 });
  });
});
