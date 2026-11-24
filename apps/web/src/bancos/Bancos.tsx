import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api, CajaHoy, CuentaBanco, MovimientoBancoFila } from '../comun/api';
import { leerNumero, soles } from '../ordenServicio/ordenServicio.util';

const TIPOS: Record<string, string> = { YAPE: 'Yape', BANCO: 'Banco', EFECTIVO: 'Efectivo', CAJA_ADMIN: 'Caja chica de administración' };
const ORIGEN: Record<string, string> = { NOTA_VENTA: 'Nota de venta', ABONO: 'Abono', COBRO: 'Cobro', COMPRA: 'Compra', PAGO_COMPRA: 'Pago de compra', MANUAL: 'Manual', TRANSFERENCIA: 'Transferencia' };
const hora = (iso: string) => new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });

function Modal({ titulo, alCerrar, children }: { titulo: string; alCerrar: () => void; children: ReactNode }) {
  return (
    <div className="fondo-modal">
      <div className="modal-form" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="fila entre"><h2>{titulo}</h2><button type="button" className="cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button></div>
        {children}
      </div>
    </div>
  );
}

/** Bancos (RF-091). Administradores: todas las cuentas con saldos, por sede y en general. Cajera: el efectivo de su sede y lo que facturó hoy. */
export default function Bancos({ nivel }: { nivel: 'A' | 'E' | 'V' }) {
  const admin = nivel === 'A';
  const [cuentas, setCuentas] = useState<CuentaBanco[]>([]);
  const [sede, setSede] = useState('');
  const [caja, setCaja] = useState<CajaHoy | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [modal, setModal] = useState<{ tipo: 'movs' | 'mov' | 'trans' | 'cuenta' | 'caja'; cuenta?: CuentaBanco; sentido?: 'INGRESO' | 'EGRESO'; cierre?: boolean } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCuentas(await api.cuentasBanco(admin && sede ? { localId: sede } : {}));
      if (!admin) setCaja(await api.cajaHoy());
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, [admin, sede]);
  useEffect(() => { void cargar(); }, [cargar]);

  const hecho = async (m: string) => { setModal(null); setMensaje(m); await cargar(); };
  const sedes = [...new Map(cuentas.filter((c) => c.localId && c.sede).map((c) => [c.localId as string, c.sede as string])).entries()];

  return (
    <div className="panel">
      <div className="fila entre">
        <h1>Bancos</h1>
        {admin && <button type="button" className="primario chico" onClick={() => setModal({ tipo: 'cuenta' })}>+ Cuenta</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {mensaje && <p className="ok" role="status">{mensaje}</p>}
      {admin ? (
        <>
          <div className="filtros-reporte fila">
            <div className="campo"><label htmlFor="b-sede">Sede</label>
              <select id="b-sede" value={sede} onChange={(e) => setSede(e.target.value)}><option value="">Todas las sedes</option>{sedes.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></div>
          </div>
          <div className="tabla">
            <table aria-label="Cuentas">
              <thead><tr><th>Acciones</th><th>Nombre</th><th>Número</th><th>Tipo</th><th>Sede</th><th className="der">Saldo inicial</th><th className="der">Ingresos</th><th className="der">Egresos</th><th className="der">Saldo actual</th></tr></thead>
              <tbody>
                {cuentas.map((c) => (
                  <tr key={c.id} className={c.activa === false ? 'inactiva' : undefined}>
                    <td className="acciones">
                      <button type="button" onClick={() => setModal({ tipo: 'movs', cuenta: c })}>Movimientos</button>
                      {c.activa !== false && <button type="button" onClick={() => setModal({ tipo: 'mov', cuenta: c, sentido: 'INGRESO' })}>Ingreso</button>}
                      {c.activa !== false && <button type="button" onClick={() => setModal({ tipo: 'mov', cuenta: c, sentido: 'EGRESO' })}>Egreso</button>}
                      {c.activa !== false && <button type="button" onClick={() => setModal({ tipo: 'trans', cuenta: c })}>Trasladar</button>}
                      <button type="button" onClick={() => setModal({ tipo: 'cuenta', cuenta: c })}>Editar</button>
                    </td>
                    <td><b>{c.nombre}</b>{c.activa === false && ' (inactiva)'}</td><td>{c.numero ?? '—'}</td><td>{TIPOS[c.tipo] ?? c.tipo}</td><td>{c.sede ?? 'Todas'}</td>
                    <td className="der">{soles(c.saldoInicial ?? 0)}</td><td className="der">{soles(c.ingresos ?? 0)}</td><td className="der">{soles(c.egresos ?? 0)}</td><td className="der"><b>{soles(c.saldo ?? 0)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {caja && (
            <section className="bloque-nota" aria-label="Caja de hoy">
              <h3>Caja de hoy · {caja.fecha}</h3>
              <p>Apertura: {caja.apertura ? <b>{soles(caja.apertura.monto)}</b> : <span className="suave">sin registrar</span>} · Cierre: {caja.cierre ? <b>{soles(caja.cierre.monto)}</b> : <span className="suave">sin registrar</span>}</p>
              <div className="fila">
                {!caja.apertura && <button type="button" className="primario chico" onClick={() => setModal({ tipo: 'caja' })}>Registrar apertura</button>}
                {!caja.cierre && <button type="button" onClick={() => setModal({ tipo: 'caja', cierre: true })}>Cerrar caja</button>}
              </div>
            </section>
          )}
          <div className="tabla">
            <table aria-label="Cuentas">
              <thead><tr><th>Acciones</th><th>Cuenta</th><th>Tipo</th><th className="der">Monto</th></tr></thead>
              <tbody>
                {cuentas.map((c) => (
                  <tr key={c.id}>
                    <td className="acciones">{c.tipo === 'EFECTIVO' && (<>
                      <button type="button" onClick={() => setModal({ tipo: 'movs', cuenta: c })}>Movimientos</button>
                      <button type="button" onClick={() => setModal({ tipo: 'mov', cuenta: c, sentido: 'INGRESO' })}>Ingreso</button>
                      <button type="button" onClick={() => setModal({ tipo: 'mov', cuenta: c, sentido: 'EGRESO' })}>Retiro</button></>)}</td>
                    <td><b>{c.nombre}</b></td><td>{TIPOS[c.tipo] ?? c.tipo}</td>
                    <td className="der">{c.tipo === 'EFECTIVO' ? <><span className="suave">En caja </span><b>{soles(c.saldo ?? 0)}</b></> : <><span className="suave">Facturado hoy </span><b>{soles(c.facturadoHoy ?? 0)}</b></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {modal?.tipo === 'movs' && modal.cuenta && <Movimientos cuenta={modal.cuenta} sede={admin ? sede : ''} alCerrar={() => setModal(null)} />}
      {modal?.tipo === 'mov' && modal.cuenta && modal.sentido && <FormMovimiento cuenta={modal.cuenta} sentido={modal.sentido} alHecho={hecho} alCerrar={() => setModal(null)} />}
      {modal?.tipo === 'trans' && modal.cuenta && <FormTransferencia origen={modal.cuenta} cuentas={cuentas.filter((c) => c.activa !== false)} alHecho={hecho} alCerrar={() => setModal(null)} />}
      {modal?.tipo === 'cuenta' && <FormCuenta cuenta={modal.cuenta} sedes={sedes} alHecho={hecho} alCerrar={() => setModal(null)} />}
      {modal?.tipo === 'caja' && <FormCaja cierre={!!modal.cierre} alHecho={hecho} alCerrar={() => setModal(null)} />}
    </div>
  );
}

function Movimientos({ cuenta, sede, alCerrar }: { cuenta: CuentaBanco; sede: string; alCerrar: () => void }) {
  const [filas, setFilas] = useState<MovimientoBancoFila[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.movimientosBanco({ cuentaId: cuenta.id, ...(sede ? { localId: sede } : {}) }).then(setFilas).catch((e) => setError((e as Error).message)); }, [cuenta.id, sede]);
  return (
    <Modal titulo={`Movimientos de ${cuenta.nombre}`} alCerrar={alCerrar}>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="tabla">
        <table aria-label="Movimientos">
          <thead><tr><th>Fecha</th><th>Tipo</th><th className="der">Monto</th><th>Concepto</th><th>Origen</th><th>Sede</th><th>Usuario</th></tr></thead>
          <tbody>
            {(filas ?? []).map((m) => <tr key={m.id}><td>{hora(m.fecha)}</td><td>{m.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}</td><td className="der">{m.tipo === 'EGRESO' ? '−' : ''}{soles(m.monto)}</td><td>{m.concepto ?? ''}</td><td>{ORIGEN[m.origen] ?? m.origen}</td><td>{m.sede ?? '—'}</td><td>{m.usuario}</td></tr>)}
            {filas && filas.length === 0 && <tr><td colSpan={7} className="suave">Sin movimientos.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function useEnvio(alHecho: (m: string) => Promise<void> | void) {
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (accion: () => Promise<unknown>, mensaje: string) => {
    setEnviando(true);
    try { await accion(); setError(''); await alHecho(mensaje); } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  };
  return { error, setError, enviando, enviar };
}

function FormMovimiento({ cuenta, sentido, alHecho, alCerrar }: { cuenta: CuentaBanco; sentido: 'INGRESO' | 'EGRESO'; alHecho: (m: string) => Promise<void> | void; alCerrar: () => void }) {
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const { error, setError, enviando, enviar } = useEnvio(alHecho);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const v = leerNumero(monto);
    if (v === null || v <= 0) return setError('Escribe un importe mayor a cero.');
    void enviar(() => api.movimientoBanco({ cuentaId: cuenta.id, tipo: sentido, monto: v, concepto: concepto.trim() || undefined }), `${sentido === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado en ${cuenta.nombre}.`);
  };
  return (
    <Modal titulo={`${sentido === 'INGRESO' ? 'Ingreso' : 'Egreso'} en ${cuenta.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="campo"><label htmlFor="bm-monto">Importe *</label><input id="bm-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        <div className="campo"><label htmlFor="bm-concepto">Concepto</label><input id="bm-concepto" maxLength={200} value={concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        <div className="fila fin"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" className="primario chico" disabled={enviando}>Guardar</button></div>
      </form>
    </Modal>
  );
}

function FormTransferencia({ origen, cuentas, alHecho, alCerrar }: { origen: CuentaBanco; cuentas: CuentaBanco[]; alHecho: (m: string) => Promise<void> | void; alCerrar: () => void }) {
  const [destino, setDestino] = useState('');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const { error, setError, enviando, enviar } = useEnvio(alHecho);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const v = leerNumero(monto);
    if (!destino) return setError('Elige la cuenta de destino.');
    if (v === null || v <= 0) return setError('Escribe un importe mayor a cero.');
    void enviar(() => api.transferirBanco({ origenId: origen.id, destinoId: destino, monto: v, concepto: concepto.trim() || undefined }), 'Transferencia registrada.');
  };
  return (
    <Modal titulo={`Trasladar desde ${origen.nombre}`} alCerrar={alCerrar}>
      <form onSubmit={guardar} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="campo"><label htmlFor="bt-destino">Cuenta de destino *</label>
          <select id="bt-destino" value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">Seleccionar</option>{cuentas.filter((c) => c.id !== origen.id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <div className="campo"><label htmlFor="bt-monto">Importe *</label><input id="bt-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        <div className="campo"><label htmlFor="bt-concepto">Concepto</label><input id="bt-concepto" maxLength={200} value={concepto} onChange={(e) => setConcepto(e.target.value)} /></div>
        <div className="fila fin"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" className="primario chico" disabled={enviando}>Trasladar</button></div>
      </form>
    </Modal>
  );
}

function FormCuenta({ cuenta, sedes, alHecho, alCerrar }: { cuenta?: CuentaBanco; sedes: [string, string][]; alHecho: (m: string) => Promise<void> | void; alCerrar: () => void }) {
  const [nombre, setNombre] = useState(cuenta?.nombre ?? '');
  const [numero, setNumero] = useState(cuenta?.numero ?? '');
  const [tipo, setTipo] = useState(cuenta?.tipo ?? 'BANCO');
  const [localId, setLocalId] = useState(cuenta?.localId ?? '');
  const [inicial, setInicial] = useState(String(cuenta?.saldoInicial ?? 0));
  const [activa, setActiva] = useState(cuenta?.activa !== false);
  const { error, setError, enviando, enviar } = useEnvio(alHecho);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const v = leerNumero(inicial);
    if (!nombre.trim()) return setError('Escribe el nombre de la cuenta.');
    if (v === null || v < 0) return setError('El saldo inicial no es válido.');
    if (cuenta) void enviar(() => api.editarCuentaBanco(cuenta.id, { nombre: nombre.trim(), numero: numero.trim() || null, saldoInicial: v, activa }), 'Cuenta guardada.');
    else void enviar(() => api.crearCuentaBanco({ nombre: nombre.trim(), numero: numero.trim() || undefined, tipo, localId: tipo === 'EFECTIVO' ? localId : undefined, saldoInicial: v }), 'Cuenta creada.');
  };
  return (
    <Modal titulo={cuenta ? `Editar ${cuenta.nombre}` : 'Nueva cuenta'} alCerrar={alCerrar}>
      <form onSubmit={guardar} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="campo"><label htmlFor="bc-nombre">Nombre *</label><input id="bc-nombre" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="campo"><label htmlFor="bc-numero">Número</label><input id="bc-numero" maxLength={40} value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
        {!cuenta && (
          <div className="campo"><label htmlFor="bc-tipo">Tipo *</label>
            <select id="bc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as CuentaBanco['tipo'])}>{Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        )}
        {!cuenta && tipo === 'EFECTIVO' && (
          <div className="campo"><label htmlFor="bc-sede">Sede *</label>
            <select id="bc-sede" value={localId} onChange={(e) => setLocalId(e.target.value)}><option value="">Seleccionar</option>{sedes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        )}
        <div className="campo"><label htmlFor="bc-inicial">Saldo inicial</label><input id="bc-inicial" inputMode="decimal" value={inicial} onChange={(e) => setInicial(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        {cuenta && <label className="check"><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Cuenta activa</label>}
        <div className="fila fin"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" className="primario chico" disabled={enviando}>Guardar</button></div>
      </form>
    </Modal>
  );
}

function FormCaja({ cierre, alHecho, alCerrar }: { cierre: boolean; alHecho: (m: string) => Promise<void> | void; alCerrar: () => void }) {
  const [monto, setMonto] = useState('');
  const { error, setError, enviando, enviar } = useEnvio(alHecho);
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const v = leerNumero(monto);
    if (v === null || v < 0) return setError(cierre ? 'Escribe cuánto hay en caja.' : 'Escribe con cuánto abres la caja.');
    void enviar(() => (cierre ? api.cerrarCaja(v) : api.abrirCaja(v)), cierre ? 'Caja cerrada.' : 'Apertura de caja registrada.');
  };
  return (
    <Modal titulo={cierre ? 'Cerrar caja' : 'Apertura de caja'} alCerrar={alCerrar}>
      <form onSubmit={guardar} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="campo"><label htmlFor="bk-monto">{cierre ? 'Efectivo contado *' : 'Efectivo con el que abres *'}</label><input id="bk-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))} /></div>
        <div className="fila fin"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" className="primario chico" disabled={enviando}>Guardar</button></div>
      </form>
    </Modal>
  );
}
