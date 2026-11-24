# TallerCloud

Sistema web multiempresa de gestión para talleres automotrices: clientes, vehículos, órdenes de servicio, cotización y nota de venta, compras con kárdex, bancos por sede y reportes. Trabajo final del curso de Cloud Computing.

Esta carpeta es una exportación del repositorio de la tesis, hecha con `exportar_curso.py`. No contiene datos reales de clientes ni archivos de entorno.

## Pila

- API: NestJS (TypeScript).
- Web: React (TypeScript).
- Base de datos: PostgreSQL 16 con Prisma.
- Pruebas automáticas de la API y de la interfaz, e integración continua con GitHub Actions.

## Cómo correrlo en local

1. Copiar `.env.example` a `.env` y completar los valores (cadena de conexión, secreto de sesión, puertos). Los secretos nunca se suben al repositorio.
2. Levantar PostgreSQL (`pnpm db:dev` o `infra/docker-compose.yml`).
3. `pnpm install`, `pnpm db:deploy`, `pnpm db:seed` y `pnpm dev`.

## Despliegue

Por variables de entorno: `DATABASE_URL`, `JWT_SECRET`, `API_PORT` o `PORT`, `CORS_ORIGIN`. La ruta `GET /health` sirve para la comprobación de salud. El acceso es solo con usuarios creados por el responsable; no hay registro público.

## Datos de demostración

Se generan con los scripts de `database/demo/` a partir de una base propia, con los clientes anonimizados. Los datos no forman parte del repositorio.
