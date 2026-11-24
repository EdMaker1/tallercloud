#!/usr/bin/env bash
# Construcción de la API en Render: dependencias, cliente de Prisma, migraciones y compilación.
# Las migraciones se aplican aquí porque el plan gratuito de Render no tiene "pre-deploy command".
set -euo pipefail

PNPM="pnpm"
command -v pnpm >/dev/null 2>&1 || PNPM="npx --yes pnpm@9.15.9"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Falta DATABASE_URL en las variables de entorno de Render." >&2
  exit 1
fi

$PNPM install --frozen-lockfile --prod=false
$PNPM --filter @posventa/database exec prisma generate --schema prisma/schema.prisma
$PNPM --filter @posventa/database exec prisma migrate deploy --schema prisma/schema.prisma
$PNPM --filter @posventa/api build
echo "API construida: apps/api/dist/src/main.js"
