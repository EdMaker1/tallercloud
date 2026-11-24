import { PrismaService } from '../comun/prisma.service';
import { Impuestos } from './notaVenta.reglas';

/** Los impuestos de la empresa (IGV, IGV reducido, detracción y su umbral), tal como se editan en Empresa y parámetros. */
export async function impuestosDe(prisma: PrismaService, organizacionId: string): Promise<Impuestos> {
  const e = await prisma.organizacion.findUniqueOrThrow({ where: { id: organizacionId }, select: { igvPct: true, igvReducidoPct: true, detraccionPct: true, detraccionDesde: true } });
  return { igvPct: Number(e.igvPct), igvReducidoPct: Number(e.igvReducidoPct), detraccionPct: Number(e.detraccionPct), detraccionDesde: Number(e.detraccionDesde) };
}
