import { origenesCors, puertoDe } from './entorno';

describe('configuración por variables de entorno', () => {
  it('el puerto sale de API_PORT, luego de PORT (plataformas en la nube) y por defecto es 3000', () => {
    expect(puertoDe({ API_PORT: '4000', PORT: '8080' })).toBe(4000);
    expect(puertoDe({ PORT: '8080' })).toBe(8080);
    expect(puertoDe({})).toBe(3000);
  });
  it('un puerto inválido cae al valor por defecto en vez de arrancar mal', () => {
    expect(puertoDe({ API_PORT: 'abc' })).toBe(3000);
    expect(puertoDe({ API_PORT: '0' })).toBe(3000);
    expect(puertoDe({ API_PORT: '70000' })).toBe(3000);
  });
  it('el origen permitido sale de CORS_ORIGIN (uno o varios separados por coma, sin barra final)', () => {
    expect(origenesCors({ CORS_ORIGIN: 'https://tesis.ejemplo.app' })).toEqual(['https://tesis.ejemplo.app']);
    expect(origenesCors({ CORS_ORIGIN: ' https://a.app/ , https://b.app ' })).toEqual(['https://a.app', 'https://b.app']);
  });
  it('sin CORS_ORIGIN solo se permite localhost con el puerto de la pantalla', () => {
    expect(origenesCors({})).toEqual(['http://localhost:5173']);
    expect(origenesCors({ WEB_PORT: '3001' })).toEqual(['http://localhost:3001']);
  });
  it('un asterisco se ignora: no se abre el acceso a cualquier origen', () => {
    expect(origenesCors({ CORS_ORIGIN: '*' })).toEqual(['http://localhost:5173']);
  });
});
