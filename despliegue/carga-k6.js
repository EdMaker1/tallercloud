// Prueba de carga y escalabilidad con k6 (https://k6.io). Instalar: winget install k6  (o choco install k6)
//
// Uso (PowerShell):
//   k6 run -e API_URL=https://tallercloud-api.onrender.com -e CORREO=admin@demo.local -e CLAVE=<SEED_PASSWORD> despliegue/carga-k6.js
// Guardar evidencia:  añadir  --summary-export despliegue/resultados/k6-resumen.json
//
// Escenario: sube de 0 a 10, 25 y 50 usuarios virtuales y baja. Cada usuario abre su sesión (/me),
// lista órdenes y clientes, como haría alguien trabajando en la pantalla. El ingreso se hace UNA vez
// en setup() para no activar el bloqueo por intentos (5 por correo cada 15 minutos).
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = (__ENV.API_URL || 'http://localhost:3000').replace(/\/+$/, '');

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // calentamiento (además despierta el plan gratuito)
    { duration: '1m', target: 25 },   // carga normal de un taller con varias sedes
    { duration: '1m', target: 50 },   // pico
    { duration: '30s', target: 0 },   // bajada
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],          // menos de 1 % de errores
    http_req_duration: ['p(95)<1500'],        // 95 % de respuestas en menos de 1,5 s
    'http_req_duration{ruta:health}': ['p(95)<500'],
  },
};

export function setup() {
  // Despertar el servicio (plan gratuito duerme tras 15 min sin uso).
  for (let i = 0; i < 10; i++) {
    if (http.get(`${API}/health`, { timeout: '90s' }).status === 200) break;
    sleep(5);
  }
  const r = http.post(`${API}/auth/login`, JSON.stringify({ correo: __ENV.CORREO, password: __ENV.CLAVE }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(r, { 'login correcto': (x) => x.status === 200 || x.status === 201 });
  return { token: r.json('token') };
}

export default function (datos) {
  const h = { headers: { Authorization: `Bearer ${datos.token}` } };
  check(http.get(`${API}/health`, { tags: { ruta: 'health' } }), { 'health 200': (r) => r.status === 200 });
  check(http.get(`${API}/me`, { ...h, tags: { ruta: 'me' } }), { 'me 200': (r) => r.status === 200 });
  check(http.get(`${API}/ordenes`, { ...h, tags: { ruta: 'ordenes' } }), { 'ordenes 200': (r) => r.status === 200 });
  check(http.get(`${API}/clientes`, { ...h, tags: { ruta: 'clientes' } }), { 'clientes 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2); // tiempo de "pensar" de una persona
}
