import { useEffect, useState } from 'react'
import { Landmark, Link2, ShieldCheck, Check, Clock, TriangleAlert, HelpCircle } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// POSICIÓN DE IVA.
//
// La versión anterior mostraba débito y crédito en dos columnas y NUNCA decía
// cuánto se paga. El importador lo dijo así: "veo un enredo y no sé qué es lo
// que se impone, después gastamos en publicidad y no sé cuánto queda". Sus dos
// preguntas eran esas y ninguna estaba en pantalla — había cinco notas
// plegables compitiendo por atención y ningún resultado.
//
// Ahora la página empieza por la respuesta y después explica de dónde sale.
// El texto no se borró: bajó al final, plegado, porque las advertencias siguen
// siendo ciertas (la DIN que no entra sola al Registro de Compras vale
// millones) pero ninguna es lo primero que hay que leer.
//
// Y una advertencia que todavía no puede aplicar tampoco va encendida: la de la
// DIN aparece recién con la primera carga (importaciones.enJuego), porque hasta
// octubre no hay ninguna importación que declarar y la alarma solo compite con
// los casilleros del F29, que es lo que este mes sí hay que mirar.

const IVA = 0.19

function Linea({ etiqueta, valor, detalle, signo, fuerte }) {
  return (
    <div className={`cta-linea${fuerte ? ' cta-linea-fuerte' : ''}`}>
      <span>
        {etiqueta}
        {detalle ? <small>{detalle}</small> : null}
      </span>
      <b className={signo === '-' ? 'cta-resta' : undefined}>
        {signo === '-' ? '−' : ''}
        {valor}
      </b>
    </div>
  )
}

// LOS CASILLEROS DEL F29.
//
// Aviso del SII del 25-ago-2026: ML vende por mandato y lo que se declara son
// las liquidaciones factura que emite, en cuatro códigos. La pantalla mostraba
// la plata correcta pero nunca en qué línea escribirla — y el cruce de líneas
// es justamente lo que deja la declaración observada.
//
// Cada casillero muestra lo que FALTA para poder llenarlo, si falta algo. Un
// número sin esa advertencia se copia al formulario tal cual, y dos de los
// cuatro todavía dependen de leer el documento.
function Casillero({ c }) {
  const vacio = c.valor === null || c.valor === undefined
  return (
    <div className={`f29-casilla${vacio ? ' f29-casilla-vacia' : ''}${c.falta ? ' f29-casilla-abierta' : ''}`}>
      <span className="f29-codigo">[{c.codigo}]</span>
      <b className="f29-valor">
        {vacio ? '—' : c.unidad === 'clp' ? fmtPrecio(c.valor) : c.valor}
        {c.valorSiNeto != null && c.valorSiNeto !== c.valor ? (
          <em className="f29-alt"> o {fmtPrecio(c.valorSiNeto)}</em>
        ) : null}
      </b>
      <span className="f29-que">{c.que}</span>
      {c.fuente ? <span className="f29-fuente">{c.fuente}</span> : null}
      {c.falta ? <span className="f29-falta">falta: {c.falta}</span> : null}
    </div>
  )
}

// EL CIERRE DEL MES: TRES RELOJES QUE NO COINCIDEN.
//
// "Necesito control, porque si cierra ML, ¿cierra el SII o no?". No. La
// facturación de ML corre del 29 al 25, las liquidaciones son semanales y el
// período tributario va del 1 al 31 — y lo que decide en qué F29 cae cada peso
// no es ninguno de esos cierres, es la FECHA DEL DOCUMENTO.
//
// Los tres chequeos separan a propósito "falta que hagas algo" (alerta) de
// "falta que llegue algo" (espera). Mezclarlos convierte el bloque en un
// semáforo siempre rojo que se termina ignorando.
const ICONO_CHEQUEO = { ok: Check, esperando: Clock, alerta: TriangleAlert, sin_datos: HelpCircle }

function Chequeo({ c }) {
  const Icono = ICONO_CHEQUEO[c.estado] ?? HelpCircle
  return (
    <li className={`cierre-chequeo cierre-${c.estado}`}>
      <Icono aria-hidden="true" />
      <div>
        <b>{c.titulo}</b>
        <span>{c.detalle}</span>
      </div>
    </li>
  )
}

function Cierre({ cierre }) {
  if (!cierre) return null
  const { relojes: r, chequeos, puedeDeclarar, alertas, esperando } = cierre
  const titular = puedeDeclarar
    ? 'El mes está listo para declarar'
    : alertas
      ? `${alertas} cosa(s) que revisar antes de declarar`
      : esperando
        ? 'Falta que lleguen documentos'
        : 'Sin datos suficientes'

  return (
    <section className={`cta-caja cierre${puedeDeclarar ? ' cierre-listo' : alertas ? ' cierre-alerta' : ''}`}>
      <h3>Cierre del mes</h3>
      <p className="cierre-titular">{titular}</p>

      {/* los tres relojes, que es lo que nadie tiene en la cabeza */}
      <div className="cierre-relojes">
        <div>
          <span>Facturación de ML</span>
          <b>
            {r.ml ? `${r.ml.desde} → ${r.ml.hasta}` : '—'}
            {r.ml?.estado === 'OPEN' ? <em> abierto</em> : r.ml ? <em> cerrado</em> : null}
          </b>
        </div>
        <div>
          <span>Liquidaciones de ventas</span>
          <b>semanales{r.ultimaLiquidacion ? <em> última {r.ultimaLiquidacion}</em> : null}</b>
        </div>
        <div>
          <span>Período tributario</span>
          <b>
            {r.sii.desde} → {r.sii.hasta}
            <em> lo que manda</em>
          </b>
        </div>
      </div>

      <ul className="cierre-lista">
        {chequeos.map((c) => (
          <Chequeo key={c.id} c={c} />
        ))}
      </ul>

      <p className="cierre-pie">
        Lo que decide en qué F29 cae cada peso no es ninguno de los tres cierres: es la <b>fecha del documento</b>.
        Si ML cierra su facturación y emite la factura de sus cargos con fecha del mes siguiente, el crédito se va a
        ese F29 y este mes lo pagas completo.
      </p>
    </section>
  )
}

// CONECTAR EL SII SIN ENTREGAR LA CLAVE.
//
// No hay API del SII: el RCV se lee llamando los endpoints internos de su
// propia app con una sesión ya abierta. La decisión del importador el
// 25-ago-2026 fue que la clave tributaria NO se guarda en ninguna parte — así
// que el sistema recibe solo las cookies de una sesión que él abrió a mano.
//
// El precio es este formulario: la sesión dura un par de horas y hay que
// repetirlo cuando toque declarar. Para un trámite mensual es barato, y a
// cambio la credencial tributaria de la empresa no vive en Render.
const RECETA = "copy(document.cookie)"

function ConexionSii({ estado, onConectar }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const conectar = async () => {
    setEnviando(true)
    setError(null)
    try {
      await onConectar(texto.trim())
      setTexto('')
      setAbierto(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const viva = estado?.conectada
  return (
    <div className={`sii-conexion${viva ? ' sii-viva' : ''}`}>
      <span className="sii-estado">
        {viva ? <ShieldCheck aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {viva ? (
          <>
            SII conectado · {estado.rut}
            {estado.expiraEl ? <small>la sesión vence {fmtFecha(estado.expiraEl)}</small> : null}
          </>
        ) : (
          <>
            SII sin conectar
            <small>{estado?.motivo ?? 'los casilleros salen de lo que medimos, no del RCV'}</small>
          </>
        )}
      </span>
      <button type="button" className="sii-btn" onClick={() => setAbierto((v) => !v)}>
        {viva ? 'Reconectar' : 'Conectar'}
      </button>

      {abierto ? (
        <div className="sii-forma">
          <ol>
            <li>
              Entra a <b>sii.cl</b> con tu RUT y clave, y abre el Registro de Compras y Ventas.
            </li>
            <li>
              Abre la consola del navegador y corre <code>{RECETA}</code>
            </li>
            <li>Pega acá lo que quedó copiado.</li>
          </ol>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="TOKEN=...; CSESSIONID=...; RUT_NS=..."
            rows={3}
            spellCheck={false}
          />
          <div className="sii-forma-pie">
            <em>Tu clave no viaja acá y no se guarda: solo las cookies de la sesión.</em>
            <button type="button" onClick={conectar} disabled={!texto.trim() || enviando}>
              {enviando ? 'Conectando…' : 'Guardar sesión'}
            </button>
          </div>
          {error ? <p className="sii-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

// Las liquidaciones factura del período, tal como las ve el SII.
function Liquidaciones({ rcv }) {
  if (!rcv || rcv.error || !rcv.documentos) return null
  return (
    <div className="sii-liq">
      <h4>
        {rcv.documentos} liquidaciones factura en el RCV
        {rcv.pendientes ? <small> · {rcv.pendientes} todavía sin entrar al registro</small> : null}
      </h4>
      <table>
        <thead>
          <tr>
            <th>Folio</th>
            <th>Fecha</th>
            <th>Neto</th>
            <th>IVA</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rcv.detalle.map((d) => (
            <tr key={d.folio} className={d.estadoContab === 'PENDIENTE' ? 'liq-pendiente' : undefined}>
              <td>{d.folio}</td>
              <td>{d.fecha}</td>
              <td>{fmtPrecio(d.netoClp)}</td>
              <td>{fmtPrecio(d.ivaClp)}</td>
              <td>{fmtPrecio(d.totalClp)}</td>
              <td>{d.estadoContab === 'PENDIENTE' ? 'pendiente' : 'registrada'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Nota({ titulo, tono, children }) {
  return (
    <details className={`cta-nota${tono ? ` cta-nota-${tono}` : ''}`}>
      <summary>{titulo}</summary>
      <div>{children}</div>
    </details>
  )
}

// ── TUS F29, MES A MES (services/f29.js) ────────────────────────────────────
// El importador, 30-sep-2026: "muchas cosas están desactualizadas y viven
// manuales; este es el tercer mes que entramos sin pagar impuestos". La página
// mostraba un solo mes y no decía si estaba atrasado. Ahora arriba va cada
// mes desde el inicio de actividades con su total, su vencimiento y su estado.
const ESTADO = {
  atrasado: { t: 'atrasado', c: 'mal' }, 'vence-pronto': { t: 'vence pronto', c: 'medio' }, 'por-declarar': { t: 'por declarar', c: 'medio' },
  'mes-en-curso': { t: 'mes en curso', c: 'neutro' }, declarado: { t: 'declarado', c: 'bien' },
}
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—')
const nombreMes = (p) => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4)

function MarcarDeclarado({ m, onListo }) {
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({ declaradoEl: new Date().toISOString().slice(0, 10), pagadoClp: m.totalAPagar ?? '', remanenteClp: m.remanente || '', folio: '' })
  const [error, setError] = useState(null)
  if (!abierto) return <button type="button" className="boton-secundario boton-chico" onClick={(e) => { e.stopPropagation(); setAbierto(true) }}>ya lo declaré</button>
  const guardar = async (e) => {
    e.preventDefault()
    try { await api.contabilidadDeclarar({ periodo: m.periodo, ...f }); setAbierto(false); onListo() } catch (err) { setError(err.message) }
  }
  return (
    <form className="f29m-form" onClick={(e) => e.stopPropagation()} onSubmit={guardar}>
      <label>declarado el <input type="date" value={f.declaradoEl} onChange={(e) => setF({ ...f, declaradoEl: e.target.value })} required /></label>
      <label>pagaste <input type="number" min="0" value={f.pagadoClp} onChange={(e) => setF({ ...f, pagadoClp: e.target.value })} placeholder="con multa e intereses" /></label>
      <label>remanente [77] <input type="number" min="0" value={f.remanenteClp} onChange={(e) => setF({ ...f, remanenteClp: e.target.value })} placeholder="si quedó crédito" /></label>
      <label>folio <input value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} placeholder="opcional" /></label>
      <button type="submit" className="boton-secundario boton-chico">guardar</button>
      <button type="button" className="enlace-boton" onClick={() => setAbierto(false)}>cancelar</button>
      {error ? <span className="mejora-error">{error}</span> : null}
    </form>
  )
}

function TusF29({ resumen, sel, onSel, onRecargar }) {
  if (!resumen?.meses?.length) return null
  return (
    <section className="f29m">
      <h3>Tus F29</h3>
      {resumen.atrasados ? (
        <p className="f29m-alerta">
          <TriangleAlert size={16} aria-hidden="true" /> <b>{resumen.atrasados} {resumen.atrasados === 1 ? 'F29 atrasado' : 'F29 atrasados'}</b> por {fmtPrecio(resumen.deudaAtrasada)} (sin multa ni intereses).
          El SII suma multa e intereses por cada mes de atraso: declarar cuanto antes, aunque sea sin pago, corta la multa mayor por no declarar.
        </p>
      ) : null}
      <div className="f29m-lista">
        {resumen.meses.map((m) => {
          const e = ESTADO[m.estado] ?? { t: m.estado, c: 'neutro' }
          return (
            <div key={m.periodo} role="button" tabIndex={0} className={`f29m-mes ${e.c}${sel === m.periodo ? ' activo' : ''}`} onClick={() => onSel(m.periodo)} onKeyDown={(ev) => ev.key === 'Enter' && onSel(m.periodo)}>
              <div className="f29m-cab">
                <strong>{nombreMes(m.periodo)}</strong>
                <em className={`f29m-estado ${e.c}`}>{e.t}{m.estado === 'atrasado' ? ` · ${m.diasAtraso} días` : ''}</em>
              </div>
              <div className="f29m-total">
                <span>{m.estado === 'declarado' ? 'pagaste' : m.estado === 'mes-en-curso' ? 'va en' : 'a pagar'}</span>
                <b>{fmtPrecio(m.estado === 'declarado' && m.declaracion?.pagadoClp != null ? m.declaracion.pagadoClp : m.totalAPagar)}</b>
                <small>IVA {fmtPrecio(m.ivaAPagar)} + PPM {fmtPrecio(m.ppm)}{m.remanente ? ` · remanente ${fmtPrecio(m.remanente)}` : ''}</small>
              </div>
              <div className="f29m-pie">
                <small>{m.estado === 'declarado' ? `declarado el ${fechaCorta(m.declaradoEl)}` : `vence el ${fechaCorta(m.vence)}`}</small>
                <small className={m.facturaMl ? 'ok' : ''}>{m.facturaMl ? 'factura de ML ✓' : 'sin factura de ML aún'}</small>
              </div>
              {m.estado !== 'declarado' && m.estado !== 'mes-en-curso' ? <MarcarDeclarado m={m} onListo={onRecargar} /> : null}
            </div>
          )
        })}
      </div>
      <p className="f29-pie">Vence el día 20 del mes siguiente (si cae fin de semana, el lunes; los feriados también lo corren). No existe API del SII para declarar: lo presentas en sii.cl y lo marcas acá.</p>
    </section>
  )
}

function FacturasMl({ f }) {
  if (!f) return null
  return (
    <div className="f29d-bloque">
      <h4>Facturas de Mercado Libre <small>leídas de su XML</small></h4>
      {f.detalle?.length ? (
        <ul className="f29d-docs">
          {f.detalle.map((d) => (
            <li key={`${d.tipoDte}-${d.folio}`}>
              <b>{d.tipoDte === 61 ? 'Nota de crédito' : 'Factura'} {d.folio}</b>
              <span>emitida {fechaCorta(d.fechaEmision)}{d.ventana ? ` · cargos del ${d.ventana}` : ''}</span>
              <span>neto {fmtPrecio(d.netoClp)} · <b>IVA {fmtPrecio(d.ivaClp)}</b> · total {fmtPrecio(d.totalClp)}</span>
              {d.impagoClp ? <span className="mal">{fmtPrecio(d.impagoClp)} sin pagar a ML · vence {fechaCorta(d.vence)}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="pub-vacio">ML todavía no emite la factura con fecha de este mes{f.sinLeer ? ` (${f.sinLeer} documento(s) por leer)` : ''}. La emite al cerrar su período, cerca del 25.</p>}
    </div>
  )
}

function DocumentosManuales({ docs, periodo, onCambio }) {
  const [f, setF] = useState({ tipo: 'din', fecha: `${periodo}-15`, folio: '', proveedor: '', netoClp: '', ivaClp: '', notas: '' })
  const [error, setError] = useState(null)
  const guardar = async (e) => {
    e.preventDefault()
    try { await api.contabilidadDocumento(f); setF({ ...f, folio: '', proveedor: '', netoClp: '', ivaClp: '', notas: '' }); onCambio() } catch (err) { setError(err.message) }
  }
  return (
    <div className="f29d-bloque">
      <h4>DIN de importación y facturas cargadas a mano</h4>
      {docs?.length ? (
        <ul className="f29d-docs">
          {docs.map((d) => (
            <li key={d._id}>
              <b>{d.tipo === 'din' ? 'DIN' : 'Factura'} {d.folio ?? ''}</b>
              <span>{fechaCorta(d.fecha)}{d.proveedor ? ` · ${d.proveedor}` : ''}</span>
              <span>neto {fmtPrecio(d.netoClp)} · <b>IVA {fmtPrecio(d.ivaClp)}</b></span>
              <button type="button" className="enlace-boton" onClick={async () => { await api.contabilidadBorrarDocumento(d._id); onCambio() }}>borrar</button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="f29d-form" onSubmit={guardar}>
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="din">DIN (importación)</option>
          <option value="factura">Factura (fuera del RCV)</option>
        </select>
        <input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required />
        <input placeholder={f.tipo === 'din' ? 'N° de la DIN' : 'folio'} value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} />
        <input placeholder={f.tipo === 'din' ? 'agente de aduana' : 'proveedor'} value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} />
        <input type="number" min="0" placeholder="neto (CIF)" value={f.netoClp} onChange={(e) => setF({ ...f, netoClp: e.target.value })} />
        <input type="number" min="0" placeholder="IVA pagado" value={f.ivaClp} onChange={(e) => setF({ ...f, ivaClp: e.target.value })} required />
        <button type="submit" className="boton-secundario boton-chico">agregar</button>
        {error ? <span className="mejora-error">{error}</span> : null}
      </form>
      <p className="f29-pie">La DIN va al F29 en [534]/[535] y al Registro de Compras como documento no electrónico <b>código 914</b>. Es el crédito de IVA más grande de cada importación: no entra solo.</p>
    </div>
  )
}

export function Contabilidad() {
  const [resumen, setResumen] = useState(null)
  const [periodo, setPeriodo] = useState(null)
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [sii, setSii] = useState(null)
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((v) => v + 1)

  useEffect(() => {
    api.contabilidadF29().then((r) => {
      setResumen(r)
      // por defecto el mes más urgente: el atrasado más viejo, o el último cerrado
      setPeriodo((actual) => actual ?? (r.meses.filter((m) => m.estado === 'atrasado').at(-1) ?? r.meses.find((m) => m.estado !== 'mes-en-curso') ?? r.meses[0])?.periodo)
    }).catch((e) => setError(e.message))
    api.siiEstado().then(setSii).catch(() => setSii({ conectada: false, motivo: 'no se pudo consultar' }))
  }, [version])
  useEffect(() => {
    if (!periodo) return
    setDatos(null)
    api.contabilidad(periodo).then(setDatos).catch((e) => setError(e.message))
  }, [periodo, version])

  const conectarSii = async (cookies) => { await api.siiConectar(cookies); recargar() }

  if (error) return <main className="contabilidad"><p className="error-bloque">Error: {error}</p></main>
  if (!resumen) return <main className="contabilidad"><Cargando texto="Armando tus F29…" /></main>

  return (
    <main className="contabilidad">
      <header className="cont-cabeza">
        <h2><Landmark aria-hidden="true" /> Contabilidad</h2>
        <span className={`cont-sii ${sii?.conectada ? 'ok' : 'off'}`} title={sii?.conectada ? 'Con sesión del SII el débito sale del RCV' : 'Sin sesión del SII el débito se estima de las boletas; el crédito de ML se lee igual de su factura'}>
          SII {sii?.conectada ? 'conectado' : `sin sesión${sii?.motivo ? ` (${sii.motivo})` : ''}`}
        </span>
      </header>

      <TusF29 resumen={resumen} sel={periodo} onSel={setPeriodo} onRecargar={recargar} />

      {!datos ? <Cargando texto={`Cargando ${periodo ?? ''}…`} /> : <DetalleMes datos={datos} sii={sii} onConectarSii={conectarSii} onCambio={recargar} />}
    </main>
  )
}

function DetalleMes({ datos, sii, onConectarSii, onCambio }) {
  const { periodo, ventas, cargosMl, resultado: res, periodoMl, debito, creditoMl, emision, f29, importaciones } = datos
  const familias = cargosMl.familias ?? []
  const completo = f29?.completo
  const est = ESTADO[f29?.estado?.estado] ?? null
  return (
    <>
      <section className="cta-caja f29">
        <h3>F29 de {nombreMes(periodo)} {est ? <em className={`f29m-estado ${est.c}`}>{est.t}{f29.estado.diasAtraso ? ` · ${f29.estado.diasAtraso} días` : ''}</em> : null}</h3>
        {completo ? (
          <div className="cta-respuestas">
            <div className="cta-respuesta">
              <span>{completo.remanente ? 'IVA: queda crédito a favor' : 'Total a pagar'}</span>
              <strong>{fmtPrecio(completo.totalAPagar)}</strong>
              <em>IVA {fmtPrecio(completo.ivaAPagar)} + PPM {fmtPrecio(completo.ppm)}{completo.remanente ? ` · remanente ${fmtPrecio(completo.remanente)} para el mes siguiente` : ''} · vence el {fechaCorta(f29.estado?.vence)}</em>
            </div>
            <div className="cta-respuesta cta-respuesta-caja">
              <span>Lo que queda en caja</span>
              <strong className={res.quedaEnCaja > 0 ? 'res-bien' : 'res-mal'}>{fmtPrecio(res.quedaEnCaja)}</strong>
              <em>vendido menos lo que cobró ML menos el IVA, antes del costo de la mercadería</em>
            </div>
          </div>
        ) : null}
        <div className="f29-grid">
          {(completo?.codigos ?? f29?.codigos ?? []).map((c) => <Casillero key={c.codigo} c={{ ...c, falta: c.falta ?? null }} />)}
        </div>
        <p className="f29-pie">Cada casillero dice de dónde salió. Con sesión del SII el débito [500]/[501] sale del RCV; sin ella, de las boletas que ML emite por tu cuenta (una liquidación por semana). El crédito de ML sale de su factura, leída del XML.</p>
        <FacturasMl f={f29?.facturasMl} />
        <DocumentosManuales docs={f29?.documentosManuales} periodo={periodo} onCambio={onCambio} />
        <ConexionSii estado={sii} onConectar={onConectarSii} />
        <Liquidaciones rcv={f29?.rcv} />
      </section>

      <Cierre cierre={f29?.cierre} />

      <details className="cta-caja cont-detalle">
        <summary>De dónde sale lo que queda en caja</summary>
        <div className="cta-cuenta">
          <Linea etiqueta="Vendiste" detalle={`${debito.documentos} documentos emitidos`} valor={fmtPrecio(res.vendido)} />
          <Linea etiqueta="ML te cobró" detalle={`${cargosMl.lineas} líneas · publicidad ${fmtPrecio(res.publicidad)}`} valor={fmtPrecio(res.cobradoPorMl)} signo="-" />
          {familias.map((f) => <Linea key={f.familia} etiqueta={f.etiqueta} valor={fmtPrecio(f.clp)} detalle=" " />)}
          <Linea etiqueta="IVA a pagar" valor={fmtPrecio(completo?.ivaAPagar ?? res.ivaAPagar)} signo="-" />
          <Linea etiqueta="Queda" valor={fmtPrecio(res.quedaEnCaja)} fuerte />
        </div>
      </details>

      {/* EL PORQUÉ, AL FINAL Y PLEGADO */}
      <section className="cta-notas">
        {importaciones?.enJuego ? (
          <Nota titulo="La DIN no entra sola al Registro de Compras" tono="alerta">
            <p>
              Hay que cargarla a mano como documento no electrónico, código <b>914</b>. Si tu contador no lo hace, el
              IVA de cada importación no se toma como crédito — y en importación ese IVA es el monto grande, mucho
              mayor que todo lo de ML junto.
            </p>
          </Nota>
        ) : (
          <Nota titulo={`Todavía no hay importaciones que declarar · la primera carga llega en ${importaciones?.desde ?? '2026-10'}`}>
            <p>
              Desde ese F29 aparece acá el crédito de la <b>DIN</b>. Son dos pasos distintos: se carga a mano al
              Registro de Compras como documento no electrónico <b>código 914</b>, y en el formulario va en la{' '}
              <b>línea 34</b> — cantidad en el [534] y crédito en el [535]. No entra solo, y en importación ese IVA
              es el monto grande. Mientras no haya carga en aduana no aplica y el aviso queda apagado.
            </p>
          </Nota>
        )}

        {periodoMl?.impagoClp ? (
          <Nota titulo={`ML factura ${fmtPrecio(periodoMl.totalClp)} en su período · ${fmtPrecio(periodoMl.impagoClp)} sin pagar`}>
            <p>
              Su período corre del <b>{periodoMl.desde}</b> al <b>{periodoMl.hasta}</b>, que no es el mes calendario.
              Comisión y envío se descuentan de cada venta; <b>publicidad, colecta y almacenamiento</b> se cobran
              aparte y por eso se acumulan como deuda.
            </p>
          </Nota>
        ) : null}

        <Nota titulo={`No calza con tus ${ventas.ordenes} órdenes de ${fmtPrecio(ventas.brutoClp)} — y está bien`}>
          <p>
            Una boleta puede cubrir <b>varias órdenes</b> del mismo carro, y un carro que cruza el fin de mes se
            factura en un período mientras sus órdenes caen en el otro. Para declarar manda la <b>fecha de emisión</b>.
            {ventas.sinBoleta ? ` Quedan ${ventas.sinBoleta} orden(es) sin documento sincronizado.` : ''}
          </p>
        </Nota>

        {emision ? (
          <Nota titulo={`Las boletas las emite ${emision.emisorNombre}, pero el débito es tuyo`}>
            <p>
              Con folios propios (RUT {emision.emisorRut}) y el mensaje legal{' '}
              <b>“por cuenta y orden de {emision.porCuentaDe}”</b>. Es un mandato de facturación: la venta es tuya y
              este débito también. El SII lo confirmó por correo el 25-ago-2026 y dijo cómo se declara: el débito de
              estas ventas <b>no se toma de estas boletas</b> sino de la liquidación factura que ML te emite, en los
              códigos [500] y [501]. Por eso el bloque de arriba.
            </p>
          </Nota>
        ) : null}

        {cargosMl.anulacionesClp ? (
          <Nota titulo={`Incluye ${fmtPrecio(cargosMl.anulacionesClp)} en anulaciones, ya restadas`}>
            <p>
              ML manda las anulaciones como líneas aparte y con monto positivo (BV anula la comisión, BFF el envío,
              BPAD la publicidad). Sumarlas contaría la devolución como un costo más.
            </p>
          </Nota>
        ) : null}

        <Nota titulo="El crédito no es lo que ML te cobra: es el IVA que va adentro">
          <p>
            De los cargos de ML solo vuelve el <b>IVA</b>, no el monto. Si ML te cobra $100.000 con IVA incluido,
            $84.034 son costo real —bajan tu utilidad, no tu IVA— y solo $15.966 son crédito fiscal. Vale para la
            comisión, los envíos, la publicidad, la colecta y el almacenaje por igual: <b>gastar más en Product Ads
            no te baja el IVA de forma importante</b>, se justifica por las ventas que trae y nunca por el impuesto.
          </p>
        </Nota>

        <Nota titulo="El SII no tiene API para declarar: esto es un panel, no una declaración">
          <p>
            El RCV ya se lee solo —de ahí salen los casilleros— pero <b>no existe forma de presentar el F29 por
            software</b>. La vía oficial de "upload" genera un archivo que igual hay que subir a mano por el
            navegador. Alguien teclea los números en sii.cl; lo que el sistema hace es que sean los correctos.
          </p>
        </Nota>
      </section>
    </>
  )
}

export { IVA }
