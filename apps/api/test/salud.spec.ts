// Ruta de salud para la plataforma de despliegue: responde sin sesión y no entrega datos.
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

let app: INestApplication;
beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await app.init();
});
afterAll(async () => { await app.close(); });

describe('GET /health', () => {
  it('responde 200 sin iniciar sesión', async () => {
    const r = await request(app.getHttpServer()).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
  it('no deja pasar al resto de las rutas sin sesión', async () => {
    expect((await request(app.getHttpServer()).get('/ordenes')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/health/otra')).status).toBe(404);
  });
});
