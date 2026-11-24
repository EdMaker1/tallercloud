// Configuración del servidor desde variables de entorno (nada de direcciones ni puertos fijos en el código).
type Entorno = Record<string, string | undefined>;

/** Puerto de la API: API_PORT, luego PORT (lo da la plataforma en la nube) y 3000 por defecto. Un valor inválido cae al defecto. */
export function puertoDe(env: Entorno = process.env): number {
  for (const v of [env.API_PORT, env.PORT]) {
    if (v === undefined || v === '') continue;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 3000;
  }
  return 3000;
}

/**
 * Orígenes que pueden llamar a la API desde el navegador: CORS_ORIGIN (uno o varios separados por coma).
 * Sin ella, solo localhost con WEB_PORT. Un «*» se ignora: nunca se abre el acceso a cualquier origen.
 */
export function origenesCors(env: Entorno = process.env): string[] {
  const dados = (env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter((o) => o && o !== '*');
  return dados.length ? dados : [`http://localhost:${env.WEB_PORT || 5173}`];
}
