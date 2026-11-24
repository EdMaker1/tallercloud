#!/usr/bin/env bash
# Construcción de la pantalla en Render (sitio estático). VITE_API_URL se fija en tiempo de compilación.
set -euo pipefail

PNPM="pnpm"
command -v pnpm >/dev/null 2>&1 || PNPM="npx --yes pnpm@9.15.9"

if [ -z "${VITE_API_URL:-}" ]; then
  echo "Falta VITE_API_URL (URL pública de la API) en las variables de entorno de Render." >&2
  exit 1
fi

$PNPM install --frozen-lockfile --prod=false
$PNPM --filter @posventa/web build
echo "Pantalla construida en apps/web/dist apuntando a $VITE_API_URL"
