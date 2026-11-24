import { Anonimizador, datosPersonalesEn, esTelefono } from './anonimizar';

const CLAVE = 'clave-de-prueba-0123456789';
const vacio = () => ({ documentos: new Set<string>(), telefonos: new Set<string>(), correos: new Set<string>() });

describe('anonimización determinista', () => {
  it('el mismo cliente real da siempre el mismo cliente ficticio, con la misma clave', () => {
    const a = new Anonimizador(CLAVE, vacio()), b = new Anonimizador(CLAVE, vacio());
    expect(a.nombre('JUAN PEREZ')).toBe(b.nombre('JUAN PEREZ'));
    expect(a.documento('DNI', '12345678')).toBe(b.documento('DNI', '12345678'));
    expect(a.nombre('JUAN PEREZ')).toBe(a.nombre('JUAN PEREZ'));
  });
  it('otra clave da otro resultado: la transformación no se puede repetir sin la clave', () => {
    const a = new Anonimizador(CLAVE, vacio()), b = new Anonimizador(CLAVE + 'x', vacio());
    expect(a.documento('DNI', '12345678')).not.toBe(b.documento('DNI', '12345678'));
  });
  it('clientes distintos dan nombres y documentos distintos', () => {
    const a = new Anonimizador(CLAVE, vacio());
    expect(new Set(['1', '2', '3', '4', '5', '6'].map((n) => a.documento('DNI', `1000000${n}`))).size).toBe(6);
  });
});

describe('documentos ficticios', () => {
  it('mantienen el tipo y el formato: DNI de 8 dígitos, RUC de 11 con su prefijo, carné con el mismo largo', () => {
    const a = new Anonimizador(CLAVE, vacio());
    for (let i = 0; i < 200; i++) {
      expect(a.documento('DNI', String(10000000 + i))).toMatch(/^[1-9]\d{7}$/);
      expect(a.documento('RUC', `20${String(100000000 + i).slice(0, 9)}`)).toMatch(/^20\d{9}$/);
      expect(a.documento('RUC', `10${String(100000000 + i).slice(0, 9)}`)).toMatch(/^10\d{9}$/);
      expect(a.documento('CARNET_EXTRANJERIA', String(100000000 + i))).toMatch(/^[1-9]\d{8}$/);
    }
  });
  it('nunca coinciden con un documento de los datos originales ni se repiten entre clientes', () => {
    const orig = vacio();
    for (let i = 0; i < 300; i++) orig.documentos.add(String(10000000 + i));
    const a = new Anonimizador(CLAVE, orig);
    const salidas = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const d = a.documento('DNI', String(10000000 + i));
      expect(orig.documentos.has(d)).toBe(false);
      salidas.add(d);
    }
    expect(salidas.size).toBe(300);
  });
  it('un documento genérico (como «0000» de Clientes varios) no se cambia', () => {
    expect(new Anonimizador(CLAVE, vacio()).documento('DNI', '0000')).toBe('0000');
  });
});

describe('nombres ficticios', () => {
  it('son texto en mayúsculas, nunca vacío ni igual al real, y las empresas llevan forma societaria', () => {
    const a = new Anonimizador(CLAVE, vacio());
    const n = a.nombre('MARIA ROJAS LOPEZ');
    expect(n).toMatch(/^[A-ZÑ ]{6,}$/);
    expect(n).not.toBe('MARIA ROJAS LOPEZ');
    expect(a.empresa('TALLER REAL SAC')).toMatch(/S\.A\.C\.$/);
  });
});

describe('detección de datos personales', () => {
  it('reconoce teléfonos peruanos con o sin prefijo, correos y documentos originales', () => {
    expect(esTelefono('987654321')).toBe(true);
    expect(esTelefono('+51 987 654 321')).toBe(true);
    expect(esTelefono('12345')).toBe(false);
    const orig = vacio();
    orig.documentos.add('43210987'); orig.correos.add('real@correo.com');
    expect(datosPersonalesEn('llamar al 987654321 o a real@correo.com, dni 43210987', orig).sort()).toEqual(['correo', 'documento', 'telefono']);
  });
  it('no confunde con teléfono un código de orden, una fecha ni un monto', () => {
    const orig = vacio();
    expect(datosPersonalesEn('ODS 2026102800001 del 2026-11-23 por S/ 1234567.89', orig)).toEqual([]);
  });
  it('no confunde con teléfono ni documento un uuid, un hash ni un número de serie', () => {
    const orig = vacio();
    orig.documentos.add('00000000'); orig.documentos.add('12345678');
    expect(datosPersonalesEn('{"id":"00000000-0000-0000-0000-000000000001","x":"ab912345678cd","nroSerie":"EP912345678","h":"!a1b2c3d4e5f6912345678"}', orig)).toEqual([]);
  });
  it('los datos permitidos del investigador no cuentan como hallazgo', () => {
    const orig = vacio();
    orig.telefonos.add('999111222');
    expect(datosPersonalesEn('999111222', orig, new Set(['999111222']))).toEqual([]);
  });
});
