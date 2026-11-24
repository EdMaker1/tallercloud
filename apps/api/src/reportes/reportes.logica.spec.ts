import { aCsv, comparativoMes, produccionTecnicos, topPor } from './reportes.logica';

describe('top de ítems', () => {
  const filas = [
    { clave: 'a', nombre: 'Aceite', cantidad: 5, venta: 100 },
    { clave: 'b', nombre: 'Filtro', cantidad: 9, venta: 90 },
    { clave: 'a', nombre: 'Aceite', cantidad: 3, venta: 60 },
    { clave: 'c', nombre: 'Bujía', cantidad: 9, venta: 200 },
  ];
  it('agrupa por ítem y ordena por cantidad; el empate se resuelve por venta y luego por nombre', () => {
    const r = topPor(filas, 'cantidad', 10);
    expect(r.map((x) => [x.nombre, x.cantidad, x.venta])).toEqual([['Bujía', 9, 200], ['Filtro', 9, 90], ['Aceite', 8, 160]]);
  });
  it('ordenado por venta total y recortado a N', () => {
    expect(topPor(filas, 'venta', 2).map((x) => x.nombre)).toEqual(['Bujía', 'Aceite']);
  });
  it('N mayor que los datos devuelve todo y sin datos devuelve vacío', () => {
    expect(topPor(filas, 'venta', 50)).toHaveLength(3);
    expect(topPor([], 'cantidad', 10)).toEqual([]);
  });
  it('los montos se redondean a dos decimales', () => {
    expect(topPor([{ clave: 'x', nombre: 'X', cantidad: 1, venta: 0.1 }, { clave: 'x', nombre: 'X', cantidad: 1, venta: 0.2 }], 'venta', 1)[0].venta).toBe(0.3);
  });
});

describe('producción de técnicos', () => {
  it('suma importe y horas por técnico y marca el que más y el que menos produce', () => {
    const r = produccionTecnicos([
      { tecnico: 'Luis', total: 300, horas: 2 }, { tecnico: 'Ana', total: 120, horas: 1 }, { tecnico: 'Luis', total: 50, horas: 0.5 }, { tecnico: 'Rosa', total: 700, horas: 4 },
    ]);
    expect(r.filas.map((x) => [x.tecnico, x.total, x.horas])).toEqual([['Rosa', 700, 4], ['Luis', 350, 2.5], ['Ana', 120, 1]]);
    expect(r.mas).toBe('Rosa');
    expect(r.menos).toBe('Ana');
  });
  it('sin datos no hay quien más ni quien menos produce', () => {
    expect(produccionTecnicos([])).toEqual({ filas: [], mas: null, menos: null });
  });
  it('con un solo técnico es a la vez el que más y el que menos', () => {
    const r = produccionTecnicos([{ tecnico: 'Luis', total: 10, horas: 1 }]);
    expect([r.mas, r.menos]).toEqual(['Luis', 'Luis']);
  });
});

describe('ventas de hoy frente al mes anterior', () => {
  const ventas = [
    { fecha: '2026-11-03', total: 100 }, { fecha: '2026-11-20', total: 50 }, { fecha: '2026-11-23', total: 25 },
    { fecha: '2026-10-05', total: 200 }, { fecha: '2026-10-23', total: 40 }, { fecha: '2026-10-28', total: 60 }, { fecha: '2026-09-30', total: 999 },
  ];
  it('compara el mes en curso hasta hoy con el mes anterior hasta el mismo día y con el mes anterior completo', () => {
    const r = comparativoMes(ventas, '2026-11-23');
    expect(r).toMatchObject({ mesActual: 175, mesAnteriorAlMismoDia: 240, mesAnteriorCompleto: 300, hoy: 25 });
    expect(r.variacionPct).toBeCloseTo(-27.08, 2);
  });
  it('sin ventas del mes anterior no hay variación porcentual (no se divide entre cero)', () => {
    expect(comparativoMes([{ fecha: '2026-11-02', total: 10 }], '2026-11-23').variacionPct).toBeNull();
  });
  it('el 31 frente a un mes de 30 días compara hasta el último día del mes anterior', () => {
    const r = comparativoMes([{ fecha: '2026-10-31', total: 5 }, { fecha: '2026-11-30', total: 7 }], '2026-12-31');
    expect(r.mesAnteriorAlMismoDia).toBe(7);
  });
  it('en enero el mes anterior es diciembre del año anterior', () => {
    const r = comparativoMes([{ fecha: '2025-12-10', total: 80 }, { fecha: '2026-01-05', total: 20 }], '2026-01-15');
    expect(r).toMatchObject({ mesActual: 20, mesAnteriorAlMismoDia: 80, mesAnteriorCompleto: 80 });
  });
});

describe('CSV', () => {
  it('lleva BOM, encabezados, comillas dobles escapadas y comas dentro del texto entre comillas', () => {
    const csv = aCsv(['Nombre', 'Monto'], [['Filtro "grande", de aire', 12.5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Nombre,Monto');
    expect(csv).toContain('"Filtro ""grande"", de aire",12.5');
  });
  it('neutraliza las fórmulas: un texto que empieza con = + - @ no se ejecuta al abrirlo en Excel', () => {
    const csv = aCsv(['x'], [['=1+1'], ['+cmd'], ['-2+3'], ['@SUM(A1)'], ['normal']]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain('normal');
  });
  it('los números negativos reales no se alteran', () => {
    expect(aCsv(['x'], [[-5]])).toContain('-5');
    expect(aCsv(['x'], [[-5]])).not.toContain("'-5");
  });
  it('los saltos de línea dentro de un texto quedan entre comillas y las filas terminan con CRLF; null y undefined salen vacíos', () => {
    const csv = aCsv(['a', 'b'], [['uno\ndos', null], [undefined, 3]]);
    expect(csv).toContain('"uno\ndos",');
    expect(csv.split('\r\n').length).toBe(4);
  });
  it('un aviso inicial opcional sale como primera línea', () => {
    expect(aCsv(['a'], [[1]], 'Aviso').split('\r\n')[0]).toBe('﻿Aviso');
  });
});
