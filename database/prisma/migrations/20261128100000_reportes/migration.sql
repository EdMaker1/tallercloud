-- Reportes: días de stock que debe cubrir cada producto antes de alertar (editable por empresa).
ALTER TABLE "Organizacion" ADD COLUMN "stockObjetivoDias" INTEGER NOT NULL DEFAULT 15;
