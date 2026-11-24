import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Requiere, Sesion, SesionActual } from '../comun/acceso';
import { PrismaService } from '../comun/prisma.service';
import { empresaDe } from '../comun/validacion';
import { aCsv, comparativoMes, FilaItem, produccionTecnicos, topPor } from './reportes.logica';

const AVISO_CONTADOR = 'Datos del sistema para el contador; el sistema no calcula impuestos. Vale lo realmente emitido en la SUNAT.';
const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ETIQUETA_IGV: Record<string, string> = { GRAVADO: 'Gravado', GRAVADO_REDUCIDO: 'Gravado reducido', NO_APLICA: 'No aplica' };

interface Filtros { desde?: string; hasta?: string; localId?: string; formato?: string; hoy?: string; dias?: string; tipoIgv?: string }
interface Tabla { codigo: string; titulo: string; encabezados: string[]; filas: (string | number | null)[][]; resumen?: Record<string, string | number | null>; aviso?: string }
type Res = { set: (h: Record<string, string>) => void };

/** Fecha «AAAA-MM-DD» válida o 400; los filtros de texto no se mezclan con objetos ni listas de la query. */
function fecha(v: unknown, campo: string) {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T12:00:00-05:00`).getTime())) throw new BadRequestException(`${campo}: la fecha no es válida (AAAA-MM-DD).`);
  return v;
}
function cadena(v: unknown, campo: string) {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string') throw new BadRequestException(`El filtro ${campo} no es válido.`);
  return v;
}
const limaHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const limaDia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

/**
 * Reportes de gestión y descarga de ventas y compras para el contador. Solo lectura, reglas fijas, sin IA.
 * Acceso por la matriz de permisos (módulos «rep_…») con nivel «todo». Administrador y Superadministrador ven todos; el Jefe de taller,
 * solo Operaciones (rankings de servicios, productos e ítems) y Técnicos. Para cambiarlo basta tocar la matriz, no el código.
 */
@Controller('reportes')
export class ReportesController {
  constructor(private prisma: PrismaService) {}

  private rango(f: Filtros) {
    const desde = fecha(f.desde, 'Desde'), hasta = fecha(f.hasta, 'Hasta');
    if (desde && hasta && desde > hasta) throw new BadRequestException('«Desde» no puede ser posterior a «Hasta».');
    return {
      desde, hasta, localId: cadena(f.localId, 'local'),
      gte: desde ? new Date(`${desde}T00:00:00-05:00`) : undefined, lte: hasta ? new Date(`${hasta}T23:59:59.999-05:00`) : undefined,
    };
  }
  private enRango(campo: 'fechaCierre' | 'fechaEmision' | 'fecha', r: { gte?: Date; lte?: Date }) {
    return r.gte || r.lte ? { [campo]: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lte ? { lte: r.lte } : {}) } } : {};
  }
  private salida(t: Tabla, f: Filtros, res: Res) {
    if (f.formato === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.codigo}.csv"`, 'X-Content-Type-Options': 'nosniff' });
      return aCsv(t.encabezados, t.filas, t.aviso) as unknown as Tabla;
    }
    return t;
  }

  /** Ítems de las ODS cerradas del periodo (servicios y productos) y de las ventas directas (notas sin ODS). */
  private async lineas(organizacionId: string, r: ReturnType<ReportesController['rango']>) {
    const orden: Prisma.OrdenServicioWhereInput = { organizacionId, estado: 'Cerrada', eliminada: false, ...this.enRango('fechaCierre', r), ...(r.localId ? { localId: r.localId } : {}) };
    const ods = await this.prisma.detalleODS.findMany({
      where: { orden }, select: { tipo: true, descripcion: true, servicioId: true, productoId: true, cantidad: true, total: true, tecnicoId: true, horas: true, tecnico: { select: { nombre: true } }, orden: { select: { tecnico: { select: { nombre: true } } } } },
    });
    const directas = await this.prisma.detalleNota.findMany({
      where: { nota: { organizacionId, estado: 'EMITIDA', ordenId: null, ...this.enRango('fechaEmision', r), ...(r.localId ? { localId: r.localId } : {}) } },
      select: { tipo: true, descripcion: true, servicioId: true, productoId: true, cantidad: true, total: true },
    });
    return { ods, directas };
  }
  private item(d: { tipo: string; descripcion: string; servicioId: string | null; productoId: string | null; cantidad: Prisma.Decimal; total: Prisma.Decimal }): FilaItem & { tipo: string } {
    const servicio = d.tipo === 'servicio';
    // En un servicio la cantidad son H-H: «realizado» cuenta una vez por línea; en un producto, la cantidad vendida.
    return { clave: `${d.tipo}:${d.servicioId ?? d.productoId ?? norm(d.descripcion)}`, nombre: d.descripcion, cantidad: servicio ? 1 : n(d.cantidad), venta: n(d.total), tipo: d.tipo };
  }
  private tablaTop(codigo: string, titulo: string, filas: FilaItem[], por: 'cantidad' | 'venta', f: Filtros, res: Res, rotuloCantidad = 'Cantidad') {
    const top = topPor(filas, por, 10);
    return this.salida({ codigo, titulo, encabezados: ['N.º', 'Ítem', rotuloCantidad, 'Venta total (S/)'], filas: top.map((x, i) => [i + 1, x.nombre, x.cantidad, x.venta]) }, f, res);
  }

  @Get('servicios-top')
  @Requiere('rep_ops', 'A')
  async serviciosTop(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods } = await this.lineas(empresaDe(s), this.rango(f));
    return this.tablaTop('servicios-top', 'Top 10 de servicios más realizados', ods.filter((d) => d.tipo === 'servicio').map((d) => this.item(d)), 'cantidad', f, res, 'Veces realizado');
  }

  @Get('productos-top')
  @Requiere('rep_ops', 'A')
  async productosTop(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods, directas } = await this.lineas(empresaDe(s), this.rango(f));
    return this.tablaTop('productos-top', 'Top 10 de productos más usados', [...ods, ...directas].filter((d) => d.tipo !== 'servicio').map((d) => this.item(d)), 'cantidad', f, res, 'Cantidad');
  }

  @Get('items-top')
  @Requiere('rep_ops', 'A')
  async itemsTop(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods, directas } = await this.lineas(empresaDe(s), this.rango(f));
    return this.tablaTop('items-top', 'Top 10 combinado de servicios y productos', [...ods, ...directas].map((d) => this.item(d)), 'cantidad', f, res);
  }

  @Get('items-venta-top')
  @Requiere('rep_items', 'A')
  async itemsVentaTop(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods, directas } = await this.lineas(empresaDe(s), this.rango(f));
    return this.tablaTop('items-venta-top', 'Top 10 de ítems de mayor venta', [...ods, ...directas].map((d) => this.item(d)), 'venta', f, res);
  }

  @Get('ventas-servicio')
  @Requiere('rep_items', 'A')
  async ventasServicio(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods, directas } = await this.lineas(empresaDe(s), this.rango(f));
    const filas = [...ods, ...directas].filter((d) => d.tipo === 'servicio').map((d) => this.item(d));
    const todos = topPor(filas, 'venta', Number.MAX_SAFE_INTEGER);
    return this.salida({ codigo: 'ventas-servicio', titulo: 'Ventas por servicio', encabezados: ['N.º', 'Servicio', 'Veces realizado', 'Venta total (S/)'], filas: todos.map((x, i) => [i + 1, x.nombre, x.cantidad, x.venta]) }, f, res);
  }

  @Get('produccion-tecnicos')
  @Requiere('rep_tec', 'A')
  async produccion(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const { ods } = await this.lineas(empresaDe(s), this.rango(f));
    const p = produccionTecnicos(ods.flatMap((d) => {
      const nombre = d.tecnico?.nombre ?? d.orden.tecnico?.nombre;
      return nombre ? [{ tecnico: nombre, total: n(d.total), horas: n(d.horas) }] : [];
    }));
    return this.salida({
      codigo: 'produccion-tecnicos', titulo: 'Producción de los técnicos', encabezados: ['N.º', 'Técnico', 'Importe (S/)', 'Horas'],
      filas: p.filas.map((x, i) => [i + 1, x.tecnico, x.total, x.horas]), resumen: { masProduce: p.mas, menosProduce: p.menos },
    }, f, res);
  }

  @Get('ventas-mes')
  @Requiere('rep_ventas', 'A')
  async ventasMes(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const organizacionId = empresaDe(s);
    const hoy = fecha(f.hoy, 'Hoy') ?? limaHoy();
    const localId = cadena(f.localId, 'local');
    const [a, m] = hoy.split('-').map(Number);
    const inicio = new Date(Date.UTC(m === 1 ? a - 1 : a, m === 1 ? 11 : m - 2, 1) - 5 * 3_600_000);
    const notas = await this.prisma.notaVenta.findMany({ where: { organizacionId, estado: 'EMITIDA', fechaEmision: { gte: inicio }, ...(localId ? { localId } : {}) }, select: { fechaEmision: true, total: true } });
    const c = comparativoMes(notas.map((x) => ({ fecha: limaDia(x.fechaEmision), total: n(x.total) })), hoy);
    return this.salida({
      codigo: 'ventas-mes', titulo: 'Ventas de hoy frente al mes anterior', encabezados: ['Concepto', 'Importe (S/)'],
      filas: [['Ventas de hoy', c.hoy], ['Mes en curso hasta hoy', c.mesActual], ['Mes anterior hasta el mismo día', c.mesAnteriorAlMismoDia], ['Mes anterior completo', c.mesAnteriorCompleto]],
      resumen: { variacionPct: c.variacionPct },
    }, f, res);
  }

  // ---- Descarga para el contador: solo datos, sin ningún cálculo de impuestos ----

  @Get('contador-ventas')
  @Requiere('rep_igv', 'A')
  async contadorVentas(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const organizacionId = empresaDe(s);
    const r = this.rango(f);
    const tipo = cadena(f.tipoIgv, 'tipo de IGV');
    if (tipo !== undefined && !['GRAVADO', 'NO_APLICA'].includes(tipo)) throw new BadRequestException('El tipo de IGV es Gravado o No aplica.');
    const notas = await this.prisma.notaVenta.findMany({
      where: { organizacionId, estado: 'EMITIDA', ...this.enRango('fechaEmision', r), ...(r.localId ? { localId: r.localId } : {}), ...(tipo === 'GRAVADO' ? { gravada: { gt: 0 } } : tipo === 'NO_APLICA' ? { noAplica: { gt: 0 } } : {}) },
      include: { cliente: true }, orderBy: [{ fechaEmision: 'asc' }, { serie: 'asc' }, { numero: 'asc' }],
    });
    // Una fila por nota de venta (no por ODS): una ODS puede tener dos comprobantes o uno solo con todo.
    const filas = notas.map((x) => [x.serie, x.numero, limaDia(x.fechaEmision), x.cliente.tipoDocumento, x.cliente.documento, x.cliente.nombre, n(x.gravada), n(x.exonerada), n(x.inafecta), n(x.noAplica), n(x.igv), n(x.igvPct), n(x.total), x.conDetraccion ? 'Con detracción' : 'Sin detracción', x.conDetraccion ? n(x.detraccion) : 0, x.comentario ?? '']);
    return this.salida({
      codigo: 'contador-ventas', titulo: 'Notas de venta del periodo para el contador',
      encabezados: ['Serie', 'Número', 'Fecha', 'Tipo de documento', 'Documento', 'Cliente', 'Base gravada', 'Exonerada', 'Inafecta', 'No aplica', 'IGV de la nota', 'Tasa IGV %', 'Total', 'Detracción', 'Monto detracción', 'Comentario'],
      filas, aviso: AVISO_CONTADOR, resumen: { notas: filas.length },
    }, f, res);
  }

  @Get('contador-compras')
  @Requiere('rep_igv', 'A')
  async contadorCompras(@SesionActual() s: Sesion, @Query() f: Filtros, @Res({ passthrough: true }) res: Res) {
    const organizacionId = empresaDe(s);
    const r = this.rango(f);
    const compras = await this.prisma.compra.findMany({
      where: { organizacionId, estado: 'REGISTRADA', ...this.enRango('fecha', r), ...(r.localId ? { localId: r.localId } : {}) },
      include: { proveedor: true }, orderBy: [{ fecha: 'asc' }, { serie: 'asc' }, { numero: 'asc' }],
    });
    const filas = compras.map((c) => [c.tipoDocumento, c.serie, c.numero, limaDia(c.fecha), c.proveedor.documento, c.proveedor.nombre, ETIQUETA_IGV[c.tipoIgv] ?? c.tipoIgv, n(c.igvPct), n(c.baseImponible), n(c.igv), n(c.total)]);
    return this.salida({
      codigo: 'contador-compras', titulo: 'Compras del periodo para el contador',
      encabezados: ['Comprobante', 'Serie', 'Número', 'Fecha', 'Documento del proveedor', 'Proveedor', 'Tipo de IGV', 'Tasa IGV %', 'Base imponible', 'IGV del comprobante', 'Total'],
      filas, aviso: AVISO_CONTADOR, resumen: { compras: filas.length },
    }, f, res);
  }
}

