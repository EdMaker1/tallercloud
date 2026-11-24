// Reglas de impuestos: ventas (Gravado, No aplica) y compras (Gravado, Gravado reducido, No aplica), con tasas editables por empresa.
import { desgloseCompra, detraccionDe, IMPUESTOS_POR_DEFECTO, proponeDetraccion, TIPOS_IGV, TIPOS_IGV_COMPRA, tipoIgvPorDefecto, totalesNota } from './notaVenta.reglas';

describe('tipos de IGV', () => {
  it('en ventas solo se ofrecen Gravado y No aplica; en compras, tres', () => {
    expect([...TIPOS_IGV]).toEqual(['GRAVADO', 'NO_APLICA']);
    expect([...TIPOS_IGV_COMPRA]).toEqual(['GRAVADO', 'GRAVADO_REDUCIDO', 'NO_APLICA']);
  });
  it('los valores por defecto son 18 %, 10 %, detracción de 12 % desde S/ 700', () => {
    expect(IMPUESTOS_POR_DEFECTO).toEqual({ igvPct: 18, igvReducidoPct: 10, detraccionPct: 12, detraccionDesde: 700 });
  });
  it('un ítem de la ODS sin impuesto sale como No aplica', () => {
    expect(tipoIgvPorDefecto('NINGUNO')).toBe('NO_APLICA');
    expect(tipoIgvPorDefecto('IGV')).toBe('GRAVADO');
  });
});

describe('totales de la nota de venta', () => {
  it('gravado 15,00 y no aplica 30,00 dan base 12,71, IGV 2,29, no aplica 30,00 y total 45,00', () => {
    const t = totalesNota([{ tipo: 'producto', total: 15, tipoIgv: 'GRAVADO' }, { tipo: 'servicio', total: 30, tipoIgv: 'NO_APLICA' }]);
    expect(t).toMatchObject({ gravada: 12.71, igv: 2.29, noAplica: 30, exonerada: 0, inafecta: 0, total: 45 });
  });
  it('con la tasa de 15 % el IGV baja y el total no cambia', () => {
    const t = totalesNota([{ tipo: 'producto', total: 115, tipoIgv: 'GRAVADO' }], 15);
    expect(t).toMatchObject({ gravada: 100, igv: 15, total: 115 });
  });
  it('las notas antiguas con exonerado o inafecto siguen sumando en su línea', () => {
    const t = totalesNota([{ tipo: 'servicio', total: 10, tipoIgv: 'EXONERADO' }, { tipo: 'servicio', total: 20, tipoIgv: 'INAFECTO' }]);
    expect(t).toMatchObject({ exonerada: 10, inafecta: 20, noAplica: 0, total: 30 });
  });
});

describe('detracción editable', () => {
  const servicio = [{ tipo: 'servicio', total: 800, tipoIgv: 'GRAVADO' as const }];
  it('se propone desde S/ 700 por defecto y desde el umbral que configure la empresa', () => {
    expect(proponeDetraccion(servicio, 800)).toBe(true);
    expect(proponeDetraccion(servicio, 800, 1000)).toBe(false);
    expect(proponeDetraccion([{ tipo: 'producto', total: 5000, tipoIgv: 'GRAVADO' }], 5000)).toBe(false);
  });
  it('usa el porcentaje configurado: 12 % por defecto, 10 % si baja', () => {
    expect(detraccionDe(1000)).toMatchObject({ pct: 12, exacta: 120, redondeada: 120 });
    expect(detraccionDe(1000, 10)).toMatchObject({ pct: 10, exacta: 100, redondeada: 100 });
  });
});

describe('desglose de la compra', () => {
  const imp = IMPUESTOS_POR_DEFECTO;
  it('Gravado 18 %: base e IGV salen del total', () => {
    expect(desgloseCompra(118, 'GRAVADO', imp)).toEqual({ baseImponible: 100, igv: 18, igvPct: 18 });
  });
  it('Gravado 10 %: usa la tasa reducida', () => {
    expect(desgloseCompra(110, 'GRAVADO_REDUCIDO', imp)).toEqual({ baseImponible: 100, igv: 10, igvPct: 10 });
  });
  it('No aplica: la base es el total y no hay IGV', () => {
    expect(desgloseCompra(50, 'NO_APLICA', imp)).toEqual({ baseImponible: 50, igv: 0, igvPct: 0 });
  });
  it('el IGV editable según el comprobante manda y la base es el resto', () => {
    expect(desgloseCompra(118, 'GRAVADO', imp, 17.99)).toEqual({ baseImponible: 100.01, igv: 17.99, igvPct: 18 });
  });
  it('un IGV editado mayor al total o negativo se rechaza', () => {
    expect(() => desgloseCompra(100, 'GRAVADO', imp, 150)).toThrow();
    expect(() => desgloseCompra(100, 'GRAVADO', imp, -1)).toThrow();
  });
  it('con No aplica no se admite un IGV editado distinto de cero', () => {
    expect(() => desgloseCompra(100, 'NO_APLICA', imp, 5)).toThrow();
  });
  it('base más IGV siempre suman el total, con cualquier tasa', () => {
    for (const total of [0.01, 9.99, 118, 1234.56, 99999.99]) for (const pct of [0, 10, 15, 18]) {
      const d = desgloseCompra(total, 'GRAVADO', { ...imp, igvPct: pct });
      expect(Math.round((d.baseImponible + d.igv) * 100) / 100).toBe(total);
    }
  });
});
