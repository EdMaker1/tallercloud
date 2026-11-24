-- Impuestos editables por empresa (IGV, IGV reducido, detracción y umbral), «No aplica» en la nota de venta y desglose de IGV en la compra.
ALTER TABLE "Organizacion" ADD COLUMN "igvPct" DECIMAL(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN "igvReducidoPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN "detraccionPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
  ADD COLUMN "detraccionDesde" DECIMAL(12,2) NOT NULL DEFAULT 700;
ALTER TABLE "NotaVenta" ADD COLUMN "noAplica" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igvPct" DECIMAL(5,2) NOT NULL DEFAULT 18;
ALTER TABLE "Cotizacion" ADD COLUMN "noAplica" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Compra" ADD COLUMN "tipoIgv" TEXT NOT NULL DEFAULT 'NO_APLICA',
  ADD COLUMN "igvPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "baseImponible" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igv" DECIMAL(12,2) NOT NULL DEFAULT 0;
-- Las compras anteriores no llevaban desglose: se registran sin IGV, con la base igual al total.
UPDATE "Compra" SET "baseImponible" = "total";
