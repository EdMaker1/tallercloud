-- Bancos (RF-091): cuentas, movimientos y apertura/cierre de caja. Se crean las cuentas habituales de cada empresa.
CREATE TABLE "CuentaBanco" (
  "id" TEXT NOT NULL,
  "organizacionId" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "numero" TEXT,
  "tipo" TEXT NOT NULL,
  "localId" TEXT,
  "saldoInicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CuentaBanco_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CuentaBanco_organizacionId_idx" ON "CuentaBanco"("organizacionId");
ALTER TABLE "CuentaBanco" ADD CONSTRAINT "CuentaBanco_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MovimientoBanco" (
  "id" TEXT NOT NULL,
  "organizacionId" TEXT NOT NULL,
  "cuentaId" TEXT NOT NULL,
  "localId" TEXT,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tipo" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "concepto" TEXT,
  "origen" TEXT NOT NULL,
  "referenciaId" TEXT,
  "transferenciaId" TEXT,
  "usuarioId" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MovimientoBanco_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MovimientoBanco_cuentaId_fecha_idx" ON "MovimientoBanco"("cuentaId", "fecha");
CREATE INDEX "MovimientoBanco_organizacionId_fecha_idx" ON "MovimientoBanco"("organizacionId", "fecha");
CREATE INDEX "MovimientoBanco_usuarioId_idx" ON "MovimientoBanco"("usuarioId");
CREATE INDEX "MovimientoBanco_transferenciaId_idx" ON "MovimientoBanco"("transferenciaId");
ALTER TABLE "MovimientoBanco" ADD CONSTRAINT "MovimientoBanco_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaBanco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoBanco" ADD CONSTRAINT "MovimientoBanco_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MovimientoBanco" ADD CONSTRAINT "MovimientoBanco_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CajaDia" (
  "id" TEXT NOT NULL,
  "organizacionId" TEXT NOT NULL,
  "localId" TEXT NOT NULL,
  "fecha" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "detalle" JSONB,
  "usuarioId" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CajaDia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CajaDia_localId_fecha_tipo_key" ON "CajaDia"("localId", "fecha", "tipo");
ALTER TABLE "CajaDia" ADD CONSTRAINT "CajaDia_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CajaDia" ADD CONSTRAINT "CajaDia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cuentas habituales: compartidas por todas las sedes, más un efectivo por cada sede y la caja chica de administración (interna).
INSERT INTO "CuentaBanco" ("id", "organizacionId", "nombre", "tipo")
SELECT gen_random_uuid()::text, o."id", c.nombre, c.tipo FROM "Organizacion" o,
  (VALUES ('Yape', 'YAPE'), ('Interbank personal (Plin)', 'BANCO'), ('Interbank empresa', 'BANCO'), ('Caja chica de administración', 'CAJA_ADMIN')) AS c(nombre, tipo);
INSERT INTO "CuentaBanco" ("id", "organizacionId", "nombre", "tipo", "localId")
SELECT gen_random_uuid()::text, l."organizacionId", 'Efectivo ' || l."nombre", 'EFECTIVO', l."id" FROM "Local" l;
