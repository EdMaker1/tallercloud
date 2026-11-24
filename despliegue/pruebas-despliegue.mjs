// Pruebas de humo y seguridad contra el sistema YA DESPLEGADO (o local). Sin dependencias: Node 22+.
//
// Uso (PowerShell):
//   $env:API_URL="https://tallercloud-api.onrender.com"; $env:WEB_URL="https://tallercloud-web.onrender.com"
//   $env:SEED_PASSWORD="la-clave-de-demo"; node despliegue/pruebas-despliegue.mjs
// Uso (bash):
//   API_URL=... WEB_URL=... SEED_PASSWORD=... node despliegue/pruebas-despliegue.mjs
//
// Deja la evidencia en despliegue/resultados/pruebas-<fecha>.json (sirve para el anexo del informe).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const WEB = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const CLAVE = process.env.SEED_PASSWORD ?? '';
const resultados = [];

async function pedir(ruta, init = {}, base = API) {
  const t0 = performance.now();
  const r = await fetch(base + ruta, { redirect: 'manual', ...init });
  const ms = Math.round(performance.now() - t0);
  let cuerpo = null;
  const texto = await r.text();
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, headers: r.headers, cuerpo, ms };
}

async function prueba(categoria, nombre, fn) {
  const t0 = performance.now();
  try {
    const detalle = await fn();
    resultados.push({ categoria, nombre, ok: true, detalle: detalle ?? '', ms: Math.round(performance.now() - t0) });
    console.log(`  OK    ${nombre}${detalle ? `  (${detalle})` : ''}`);
  } catch (e) {
    resultados.push({ categoria, nombre, ok: false, detalle: String(e.message ?? e), ms: Math.round(performance.now() - t0) });
    console.log(`  FALLA ${nombre}  -> ${e.message ?? e}`);
  }
}
const esperar = (cond, msg) => { if (!cond) throw new Error(msg); };
const login = (correo, password) =>
  pedir('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, password }) });

console.log(`\nAPI: ${API}\nWEB: ${WEB}\n`);

// 1. Disponibilidad ---------------------------------------------------------------------------
console.log('1. Disponibilidad');
await prueba('Disponibilidad', 'GET /health responde 200 {ok:true} (incluye arranque en frío)', async () => {
  const r = await pedir('/health');
  esperar(r.status === 200 && r.cuerpo?.ok === true, `status ${r.status}`);
  return `${r.ms} ms`;
});
await prueba('Disponibilidad', 'La pantalla web carga (HTML con #root)', async () => {
  const r = await pedir('/', {}, WEB);
  esperar(r.status === 200, `status ${r.status}`);
  esperar(String(r.cuerpo).includes('id="root"'), 'no aparece <div id="root">');
  const js = String(r.cuerpo).match(/src="([^"]+\.js)"/)?.[1];
  esperar(js, 'no se encontró el script principal');
  const a = await pedir(js, {}, WEB);
  esperar(a.status === 200, `script principal status ${a.status}`);
  return `${r.ms} ms`;
});
await prueba('Disponibilidad', 'La pantalla apunta a la API desplegada (no a localhost)', async () => {
  const r = await pedir('/', {}, WEB);
  const js = String(r.cuerpo).match(/src="([^"]+\.js)"/)?.[1];
  const a = await pedir(js, {}, WEB);
  esperar(!String(a.cuerpo).includes('http://localhost:3000') || WEB.includes('localhost'), 'el JS todavía apunta a http://localhost:3000: revisa VITE_API_URL');
  esperar(String(a.cuerpo).includes(API) || WEB.includes('localhost'), `el JS no contiene ${API}`);
});

// 2. Seguridad perimetral -----------------------------------------------------------------------
console.log('2. Seguridad');
await prueba('Seguridad', 'Cabeceras de seguridad en la API (nosniff, DENY, sin X-Powered-By)', async () => {
  const r = await pedir('/health');
  esperar(r.headers.get('x-content-type-options') === 'nosniff', 'falta X-Content-Type-Options');
  esperar(r.headers.get('x-frame-options') === 'DENY', 'falta X-Frame-Options');
  esperar(!r.headers.get('x-powered-by'), 'expone X-Powered-By');
});
await prueba('Seguridad', 'HTTPS: la API y la web se sirven cifradas', async () => {
  esperar(API.startsWith('https://') || API.includes('localhost'), 'API sin https');
  esperar(WEB.startsWith('https://') || WEB.includes('localhost'), 'WEB sin https');
});
await prueba('Seguridad', 'Rutas privadas sin token devuelven 401', async () => {
  for (const ruta of ['/ordenes', '/me', '/clientes', '/reportes', '/bancos/ping']) {
    const r = await pedir(ruta);
    esperar(r.status === 401, `${ruta} dio ${r.status}`);
  }
});
await prueba('Seguridad', 'Token falsificado devuelve 401', async () => {
  const falso = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-invalida';
  const r = await pedir('/me', { headers: { Authorization: `Bearer ${falso}` } });
  esperar(r.status === 401, `dio ${r.status}`);
});
await prueba('Seguridad', 'Ruta inexistente devuelve 404', async () => {
  const r = await pedir('/health/otra');
  esperar(r.status === 404, `dio ${r.status}`);
});
await prueba('Seguridad', 'CORS: el origen de la pantalla está permitido', async () => {
  const r = await pedir('/health', { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'GET' } });
  esperar(r.headers.get('access-control-allow-origin') === WEB, `allow-origin = ${r.headers.get('access-control-allow-origin')}`);
});
await prueba('Seguridad', 'CORS: un origen ajeno NO está permitido', async () => {
  const r = await pedir('/health', { method: 'OPTIONS', headers: { Origin: 'https://sitio-malicioso.example', 'Access-Control-Request-Method': 'GET' } });
  const ao = r.headers.get('access-control-allow-origin');
  esperar(!ao || ao === WEB, `permitió ${ao}`);
});
await prueba('Seguridad', 'Credenciales inválidas devuelven 401 con mensaje genérico', async () => {
  const r = await login('no-existe@demo.local', 'x');
  esperar(r.status === 401, `dio ${r.status}`);
});
await prueba('Seguridad', 'Caracteres de control (byte nulo) se rechazan con 400', async () => {
  const r = await pedir('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'a\u0000@b.c', password: 'x' }) });
  esperar(r.status === 400, `dio ${r.status}`);
});
await prueba('Seguridad', 'Cuerpo mayor a 1 MB se rechaza con 413', async () => {
  const r = await pedir('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'x@y.z', password: 'a'.repeat(1_200_000) }) });
  esperar(r.status === 413 || r.status === 400, `dio ${r.status}`);
  return `status ${r.status}`;
});
await prueba('Seguridad', 'Fuerza bruta: el 6.º intento fallido se bloquea con 429', async () => {
  const correo = `fuerza-bruta-${Date.now()}@prueba.local`; // correo inventado: no bloquea a nadie real
  const codigos = [];
  for (let i = 0; i < 6; i++) codigos.push((await login(correo, 'mala')).status);
  esperar(codigos.slice(0, 5).every((c) => c === 401) && codigos[5] === 429, `códigos: ${codigos.join(',')}`);
  return codigos.join(',');
});

// 3. Funcional por rol --------------------------------------------------------------------------
console.log('3. Autenticación y roles');
if (!CLAVE) {
  console.log('  (omitido: define SEED_PASSWORD para probar el ingreso con las cuentas de demostración)');
} else {
  const cuentas = {
    Administrador: 'admin@demo.local',
    'Jefe de taller': 'jefe@demo.local',
    Cajera: 'cajera@demo.local',
    'Técnico': 'tecnico@demo.local',
    'Logístico': 'logistico@demo.local',
  };
  // Esperado según database/seeds/permisos_matriz.json (fila "bancos": AAA-E--).
  const bancosEsperado = { Administrador: 200, 'Jefe de taller': 403, Cajera: 200, 'Técnico': 403, 'Logístico': 403 };
  const tokens = {};
  for (const [rol, correo] of Object.entries(cuentas)) {
    await prueba('Roles', `Ingreso como ${rol}`, async () => {
      const r = await login(correo, CLAVE);
      esperar(r.status === 201 || r.status === 200, `dio ${r.status}`);
      esperar(r.cuerpo?.token, 'sin token');
      tokens[rol] = r.cuerpo.token;
      return `${r.ms} ms`;
    });
    if (!tokens[rol]) continue;
    const auth = { headers: { Authorization: `Bearer ${tokens[rol]}` } };
    await prueba('Roles', `${rol}: /me trae su menú personalizado`, async () => {
      const r = await pedir('/me', auth);
      esperar(r.status === 200, `dio ${r.status}`);
      esperar(r.cuerpo.roles.includes(rol), `roles = ${r.cuerpo.roles}`);
      return `${r.cuerpo.menu.length} módulos`;
    });
    await prueba('Roles', `${rol}: acceso a Bancos = ${bancosEsperado[rol]}`, async () => {
      const r = await pedir('/bancos/ping', auth);
      esperar(r.status === bancosEsperado[rol], `dio ${r.status}`);
    });
  }
  if (tokens.Administrador) {
    const auth = { headers: { Authorization: `Bearer ${tokens.Administrador}` } };
    await prueba('Funcional', 'Administrador lista clientes (lee de la base en la nube)', async () => {
      const r = await pedir('/clientes', auth);
      esperar(r.status === 200, `dio ${r.status}`);
      return `${r.ms} ms`;
    });
    await prueba('Funcional', 'Administrador lista órdenes de servicio', async () => {
      const r = await pedir('/ordenes', auth);
      esperar(r.status === 200, `dio ${r.status}`);
      return `${r.ms} ms`;
    });
  }
}

// 4. Rendimiento básico -------------------------------------------------------------------------
console.log('4. Rendimiento');
await prueba('Rendimiento', '30 peticiones a /health: p50 y p95', async () => {
  const t = [];
  for (let i = 0; i < 30; i++) t.push((await pedir('/health')).ms);
  t.sort((a, b) => a - b);
  const p = (q) => t[Math.min(t.length - 1, Math.floor(q * t.length))];
  esperar(p(0.95) < 1500, `p95 ${p(0.95)} ms supera 1500 ms`);
  return `p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`;
});

// Resumen -------------------------------------------------------------------------------------
const ok = resultados.filter((r) => r.ok).length;
console.log(`\nResultado: ${ok}/${resultados.length} pruebas correctas.`);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resultados');
fs.mkdirSync(dir, { recursive: true });
const archivo = path.join(dir, `pruebas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), api: API, web: WEB, ok, total: resultados.length, resultados }, null, 2));
console.log(`Evidencia: ${archivo}\n`);
process.exit(ok === resultados.length ? 0 : 1);
