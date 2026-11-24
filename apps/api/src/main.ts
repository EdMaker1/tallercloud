import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { origenesCors, puertoDe } from './comun/entorno';

async function main() {
  // El logo de la empresa viaja en base64 dentro del JSON: el tope por defecto (100 KB) no alcanza.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  app.enableCors({ origin: origenesCors(), allowedHeaders: ['Authorization', 'Content-Type', 'X-Ver-Como'] });
  await app.listen(puertoDe(), '0.0.0.0');
}
main();
