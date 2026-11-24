import { useEffect, useState } from 'react';
import { api, TablaReporte } from '../comun/api';

/** Reportes de cada módulo «rep_…»: qué reportes trae y cuáles no usan fechas. */
export const REPORTES: Record<string, [string, string][]> = {
  rep_ops: [['servicios-top', 'Top 10 de servicios'], ['productos-top', 'Top 10 de productos'], ['items-top', 'Top 10 combinado']],
  rep_items: [['items-venta-top', 'Top 10 de mayor venta'], ['ventas-servicio', 'Ventas por servicio']],
  rep_tec: [['produccion-tecnicos', 'Producción de técnicos']],
  rep_ventas: [['ventas-mes', 'Ventas de hoy frente al mes anterior']],
  rep_igv: [['contador-ventas', 'Notas de venta'], ['contador-compras', 'Compras']],
};
const SIN_FECHAS = new Set(['ventas-mes']);
const ROTULO: Record<string, string> = { masProduce: 'Produce más', menosProduce: 'Produce menos', variacionPct: 'Variación frente al mes anterior (%)', notas: 'Notas de venta', compras: 'Compras' };
const dato = (v: string | number | null) => (v === null ? '' : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v));

/** Reporte de solo lectura con filtros de fechas y local y descarga en CSV. */
export default function Reportes({ modulo, nivel }: { modulo: string; nivel: 'A' | 'E' | 'V' }) {
  const lista = REPORTES[modulo] ?? [];
  const [codigo, setCodigo] = useState(lista[0]?.[0] ?? '');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [localId, setLocalId] = useState('');
  const [locales, setLocales] = useState<{ id: string; nombre: string }[]>([]);
  const [tabla, setTabla] = useState<TablaReporte | null>(null);
  const [error, setError] = useState('');
  const [bajando, setBajando] = useState(false);
  const filtros = () => ({ ...(desde && !SIN_FECHAS.has(codigo) ? { desde } : {}), ...(hasta && !SIN_FECHAS.has(codigo) ? { hasta } : {}), ...(localId ? { localId } : {}) });

  useEffect(() => { api.catalogosOds().then((c) => setLocales((c.locales ?? []).map((l) => ({ id: l.id, nombre: l.nombre })))).catch(() => undefined); }, []);
  useEffect(() => {
    if (!codigo || nivel !== 'A') return;
    let vigente = true;
    setError('');
    api.reporte(codigo, filtros()).then((t) => { if (vigente) setTabla(t); }).catch((e) => { if (vigente) { setTabla(null); setError((e as Error).message); } });
    return () => { vigente = false; };
  }, [codigo, desde, hasta, localId, nivel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function descargar() {
    setBajando(true);
    try {
      const blob = await api.reporteCsv(codigo, filtros());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${codigo}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); } finally { setBajando(false); }
  }

  if (nivel !== 'A') return <div className="panel"><p className="error" role="alert">Tu rol no tiene acceso a este reporte.</p></div>;
  return (
    <div className="panel">
      <div className="fila entre">
        <h1>{lista.find(([c]) => c === codigo)?.[1] ?? 'Reportes'}</h1>
        <button type="button" onClick={() => void descargar()} disabled={bajando || !tabla}>Descargar CSV</button>
      </div>
      <div className="filtros-reporte fila">
        {lista.length > 1 && (
          <div className="campo"><label htmlFor="r-rep">Reporte</label>
            <select id="r-rep" value={codigo} onChange={(e) => setCodigo(e.target.value)}>{lista.map(([c, t]) => <option key={c} value={c}>{t}</option>)}</select></div>
        )}
        {!SIN_FECHAS.has(codigo) && (
          <>
            <div className="campo"><label htmlFor="r-desde">Desde</label><input id="r-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div className="campo"><label htmlFor="r-hasta">Hasta</label><input id="r-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></div>
          </>
        )}
        <div className="campo"><label htmlFor="r-local">Local</label>
          <select id="r-local" value={localId} onChange={(e) => setLocalId(e.target.value)}><option value="">Todos</option>{locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tabla?.aviso && <p className="aviso-reporte" role="note">{tabla.aviso}</p>}
      {tabla && (
        <div className="tabla">
          <table aria-label={tabla.titulo}>
            <thead><tr>{tabla.encabezados.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {tabla.filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j} className={typeof v === 'number' ? 'der' : undefined}>{dato(v)}</td>)}</tr>)}
              {tabla.filas.length === 0 && <tr><td colSpan={tabla.encabezados.length} className="suave">Sin datos en el periodo.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tabla?.resumen && Object.entries(tabla.resumen).some(([, v]) => v !== null) && (
        <p className="resumen-reporte">{Object.entries(tabla.resumen).filter(([, v]) => v !== null).map(([k, v]) => `${ROTULO[k] ?? k}: ${v}`).join(' · ')}</p>
      )}
    </div>
  );
}
