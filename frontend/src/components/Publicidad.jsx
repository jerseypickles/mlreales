import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { ChevronDown, PauseCircle, Split, PlusCircle, TrendingUp, TrendingDown, Target, Layers, Hourglass, Megaphone } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'

// PUBLICIDAD, REDISEÑADA (30-sep-2026). El importador: "mucha info, mucho ruido,
// hay que rediseñar completo". Había ocho bloques que se repetían: tres listas
// de productos, dos asesores (el analista de IA y el learning machine) que
// opinaban por separado, seis cifras sueltas y las tarjetas de campañas.
//
// Ahora una sola voz —la del learning machine (ml/planCampanas.js)— en tres
// niveles: arriba cuánto dejó la publicidad y qué hacer; al medio una tarjeta
// por producto con lo esencial y el detalle al tocarla; abajo, plegado, cómo
// aprende. Todo en plata: lo que dejaron las ventas por anuncio menos lo que
// costó conseguirlas (antes del costo del producto mientras no esté cargado).

const x = (v) => (Number.isFinite(v) ? `${String(Math.round(v * 100) / 100).replace('.', ',')}x` : '—')
const miles = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('es-CL') : '—')
const conSigno = (v) => `${v >= 0 ? '+' : '−'}${fmtPrecio(Math.abs(Math.round(v)))}`

// "Brochas Maquillaje Profesionales Set 8 + Organizador" → "Brochas Maquillaje Set 8"
function nombreCorto(titulo) {
  const w = String(titulo ?? '').split(/\s+/).filter(Boolean)
  const i = w.findIndex((p, k) => k >= 2 && /\d/.test(p))
  if (i < 0) return w.slice(0, 5).join(' ')
  return [...w.slice(0, 2), ...(i - 1 >= 2 ? [w[i - 1]] : []), w[i]].join(' ')
}

const ACCION = {
  arrancar: { t: 'arrancar', c: 'bien' }, 'arrancar-con-cuidado': { t: 'arrancar con cuidado', c: 'medio' },
  organico: { t: 'solo orgánico', c: 'mal' }, 'no-anunciar': { t: 'no anunciar', c: 'mal' },
  esperar: { t: 'esperar', c: 'neutro' }, mantener: { t: 'mantener', c: 'bien' }, subir: { t: 'subir', c: 'bien' },
  'subir-roas': { t: 'subir ROAS', c: 'medio' }, bajar: { t: 'bajar', c: 'medio' }, apagar: { t: 'apagar', c: 'mal' },
  apagada: { t: 'sin anuncio', c: 'neutro' }, 'sin-economia': { t: 'sin precio', c: 'neutro' }, 'sin-datos': { t: 'sin datos', c: 'neutro' },
}
const ICONO = {
  'pausar-anuncio': PauseCircle, separar: Split, 'campana-propia': Split, 'agrupar-chicos': Layers, crear: PlusCircle, 'ajustar-budget': Target,
  subir: TrendingUp, bajar: TrendingDown, apagar: PauseCircle, 'subir-roas': Target, arrancar: PlusCircle, 'arrancar-con-cuidado': PlusCircle, esperar: Hourglass,
}
const FASE = { arranque: 'antes de anunciar', 'semana-1': 'prueba · semana 1', 'semana-2': 'prueba · semana 2', ajuste: 'ajuste', regular: 'en régimen', apagada: 'sin anuncio' }

function haceCuanto(iso) {
  if (!iso) return null
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'recién'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  return `hace ${Math.round(s / 3600)} h`
}

// ── arriba: cuánto dejó ─────────────────────────────────────────────────────
function Resultado({ tot, neto, marcador, sinCosto }) {
  const semanas = (marcador ?? []).slice(-8)
  const escala = Math.max(1, ...semanas.map((s) => Math.abs(s.resultado)))
  const roas = tot.gasto ? tot.venta / tot.gasto : null
  return (
    <section className="pub-resultado">
      <div className="pub-resultado-numeros">
        <div className={`pub-grande ${neto >= 0 ? 'bien' : 'mal'}`}>
          <span>la publicidad dejó</span>
          <strong>{conSigno(neto)}</strong>
          <small>{sinCosto ? 'antes de pagar el producto (falta cargar costos)' : 'después de pagar el producto'}</small>
        </div>
        <div className="pub-chico"><span>gastaste</span><strong>{fmtPrecio(Math.round(tot.gasto))}</strong></div>
        <div className="pub-chico"><span>vendió por anuncio</span><strong>{miles(tot.unidades)} u</strong></div>
        <div className="pub-chico"><span>ROAS</span><strong>{x(roas)}</strong></div>
      </div>
      {semanas.length ? (
        <div className="pub-semanas" aria-label="Lo que dejó la publicidad por semana">
          {semanas.map((s) => (
            <div key={s.semana} className={s.resultado >= 0 ? 'gana' : 'pierde'} title={`Semana del ${s.semana}: gastó ${fmtPrecio(s.gasto)}, ${s.ventasAds} ventas por anuncio, dejó ${conSigno(s.resultado)}`}>
              <i style={{ height: `${Math.max(3, (Math.abs(s.resultado) / escala) * 48)}px` }} />
              <span>{s.semana.slice(8, 10)}/{s.semana.slice(5, 7)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

// ── qué hacer: una sola lista, sin repetir ─────────────────────────────────
function QueHacer({ plan, fotos }) {
  const pasos = useMemo(() => {
    const est = plan?.estructura?.acciones ?? []
    const cubiertos = new Set(est.map((a) => a.itemId).filter(Boolean))
    const extra = (plan?.productos ?? [])
      .filter((p) => !cubiertos.has(p.itemId) && ['subir', 'bajar', 'subir-roas', 'apagar', 'arrancar', 'arrancar-con-cuidado'].includes(p.accion))
      .map((p) => ({ tipo: p.accion, itemId: p.itemId, prioridad: p.accion === 'apagar' ? 1 : 2, texto: `${nombreCorto(p.titulo)}: ${p.texto}` }))
    return [...est, ...extra].sort((a, b) => a.prioridad - b.prioridad)
  }, [plan])
  if (!pasos.length) {
    return (
      <section className="pub-hacer vacio-ok">
        <h3>Qué hacer</h3>
        <p>Nada que cambiar hoy: las campañas están como recomienda el learning machine.</p>
      </section>
    )
  }
  return (
    <section className="pub-hacer">
      <h3>Qué hacer <small>{pasos.length} {pasos.length === 1 ? 'paso' : 'pasos'} · recomendado, lo haces tú en ML</small></h3>
      <ol>
        {pasos.map((a, i) => {
          const Icono = ICONO[a.tipo] ?? Megaphone
          return (
            <li key={i} className={`prio-${a.prioridad}`}>
              {a.itemId && fotos.get(a.itemId) ? <img src={fotos.get(a.itemId)} alt="" width="36" height="36" loading="lazy" /> : <span className="pub-hacer-icono"><Icono size={18} aria-hidden="true" /></span>}
              <p>{a.texto}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ── tus productos: lo esencial, el detalle al tocar ────────────────────────
function MedidorRoas({ roas, empate }) {
  if (!Number.isFinite(roas) || !Number.isFinite(empate)) return null
  const tope = Math.max(roas, empate) * 1.4
  return (
    <div className="pub-medidor" title={`ROAS ${x(roas)} · bajo ${x(empate)} la publicidad pierde plata`}>
      <div className="pub-medidor-barra">
        <i className={roas >= empate ? 'bien' : 'mal'} style={{ width: `${(roas / tope) * 100}%` }} />
        <b style={{ left: `${(empate / tope) * 100}%` }} />
      </div>
      <span>ROAS {x(roas)} <small>· empate {x(empate)}</small></span>
    </div>
  )
}

function Producto({ p, ad, efecto, abierto, onToggle }) {
  const a = ACCION[p.accion] ?? { t: p.accion, c: 'neutro' }
  const m = p.metricas ?? {}
  const ctr = ad?.impresiones ? (ad.clicks / ad.impresiones) * 100 : null
  const conv = ad?.clicks ? (ad.unidades / ad.clicks) * 100 : null
  return (
    <li className={`pub-prod${abierto ? ' abierto' : ''}`}>
      <button type="button" className="pub-prod-cab" onClick={onToggle} aria-expanded={abierto}>
        {ad?.foto ? <img src={ad.foto} alt="" width="56" height="56" loading="lazy" /> : <span className="pub-foto-vacia" aria-hidden="true" />}
        <span className="pub-prod-nombre">
          <strong>{nombreCorto(p.titulo)}</strong>
          <small>{FASE[p.fase] ?? p.fase}{p.campana ? ` · «${p.campana}»` : ''}</small>
        </span>
        <em className={`pub-accion ${a.c}`}>{a.t}</em>
        <ChevronDown size={16} className="pub-chevron" aria-hidden="true" />
      </button>
      <div className="pub-prod-numeros">
        <div><span>gasta hoy</span><strong>{m.gastoDiario != null ? `${fmtPrecio(m.gastoDiario)}/día` : '—'}</strong></div>
        <div><span>recomendado</span><strong className={a.c}>{p.budgetDiario ? `${fmtPrecio(p.budgetDiario)}/día` : '$0'}</strong></div>
        <div><span>dejó 7 días</span><strong className={m.resultado7 >= 0 ? 'bien' : 'mal'}>{m.resultado7 != null ? conSigno(m.resultado7) : '—'}</strong></div>
      </div>
      <MedidorRoas roas={m.roas7} empate={p.economia?.roasEmpate} />
      {abierto ? (
        <div className="pub-prod-detalle">
          <p className="pub-prod-texto">{p.texto}</p>
          <dl>
            <div><dt>precio cobrado</dt><dd>{fmtPrecio(p.precio)}</dd></div>
            <div><dt>deja cada venta</dt><dd>{fmtPrecio(p.economia?.deja)}{p.economia?.esTecho ? <small> antes del costo</small> : null}</dd></div>
            {ad ? <div><dt>vistas → clics → ventas</dt><dd>{miles(ad.impresiones)} → {miles(ad.clicks)} ({ctr != null ? `${ctr.toFixed(1).replace('.', ',')}%` : '—'}) → {ad.unidades || 0} ({conv != null ? `${conv.toFixed(1).replace('.', ',')}%` : '—'})</dd></div> : null}
            {efecto ? <div title="ML se atribuye ventas que en parte iban a llegar solas; el learning machine lo mide contra las ventas totales"><dt>ML atribuye / trajo de verdad</dt><dd>{efecto.ventasAtribuidasMl} / {Math.round(efecto.ventasIncrementales)}</dd></div> : null}
            {efecto?.costoVentaMarginal ? <div title="Lo que cuesta la próxima venta al gasto de hoy"><dt>la próxima venta cuesta</dt><dd className={p.economia?.deja && efecto.costoVentaMarginal > p.economia.deja ? 'mal' : ''}>{fmtPrecio(efecto.costoVentaMarginal)}</dd></div> : null}
            {m.budgetOptimoAprendido != null ? <div><dt>techo aprendido</dt><dd>{fmtPrecio(m.budgetOptimoAprendido)}/día</dd></div> : null}
          </dl>
        </div>
      ) : null}
    </li>
  )
}

// ── abajo, plegado: cómo aprende ───────────────────────────────────────────
function ComoAprende({ plan, aprendido }) {
  const e = aprendido?.ultimo?.efecto
  const t = aprendido?.ultimo?.parametros?.ticket
  const r = plan?.reglas
  const ev = plan?.evaluacion
  return (
    <details className="pub-aprende">
      <summary>Cómo aprende el learning machine</summary>
      <div className="pub-aprende-tarjetas">
        {e?.estado ? (
          <div>
            <strong>Efecto real de la publicidad</strong>
            <p>Entrenado con {e.dias} días de ventas totales contra gasto. {e.estado === 'aprendido' ? <>Con la publicidad predice <b>{e.validacion?.mejoraPct}% mejor</b> los días que no vio.</> : 'Todavía sin efecto confiable.'} Trajo {e.ventasIncrementales} ventas contra {e.ventasAtribuidasMl} que se atribuye ML.</p>
          </div>
        ) : null}
        {r ? (
          <div>
            <strong>Regla para subir el budget</strong>
            <p>{r.estado === 'aprendido' ? <>Aprendida con {r.n} cambios de gasto: subir conviene sobre <b>{x(r.umbral)}</b> el empate.</> : <>Todavía la inicial (1,3× el empate): {r.n} cambios de gasto medidos, {r.estado === 'pocos-casos' ? 'necesita 12' : 'sin un corte claro aún'}. La prueba de 2 semanas de cada producto nuevo le da los casos que faltan.</>}</p>
          </div>
        ) : null}
        <div>
          <strong>Sus recomendaciones</strong>
          <p>{ev?.evaluadas ? <>{ev.seguidas} seguidas; <b>{ev.tasaAcierto ?? '—'}%</b> dejaron más plata{ev.tasaSinSeguir != null ? ` (las no seguidas: ${ev.tasaSinSeguir}%)` : ''}.</> : 'Cada recomendación se evalúa 7 días después: si se siguió y si la plata mejoró.'}</p>
        </div>
        {t?.medido ? (
          <div>
            <strong>Cuánto deja según el precio</strong>
            <p>Comisión {String(t.medido.comisionPct).replace('.', ',')}%, publicidad {String(t.medido.publicidadPct).replace('.', ',')}% de lo vendido y envío ~{fmtPrecio(t.medido.envioMedio)}: con publicidad queda 40% o más desde <b>{fmtPrecio(t.minimo40)}</b>{t.valles?.length ? `; ojo con ${fmtPrecio(t.valles[0].desde)}+ (salta el envío)` : ''}.</p>
          </div>
        ) : null}
      </div>
    </details>
  )
}

export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [plan, setPlan] = useState(null)
  const [aprendido, setAprendido] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [, setTic] = useState(0)

  const traer = useCallback((forzar = false) => {
    setCargando(true)
    return api.ads(dias, forzar).then((d) => { setDatos(d); setError(null) }).catch((e) => setError(e.message)).finally(() => setCargando(false))
  }, [dias])
  useEffect(() => { traer() }, [traer])
  useEffect(() => {
    api.aprendizajeCampanas().then(setPlan).catch(() => setPlan(null))
    api.aprendizajePublicidad().then(setAprendido).catch(() => setAprendido(null))
  }, [])
  useEffect(() => { const id = setInterval(() => traer(), 60_000); return () => clearInterval(id) }, [traer])
  useEffect(() => { const id = setInterval(() => setTic((t) => t + 1), 15_000); return () => clearInterval(id) }, [])

  if (error && !datos) return <main><p className="error-inline">{error}</p></main>
  if (!datos) return <Cargando texto="Leyendo campañas de Product Ads…" />

  const economia = datos.economia ?? {}
  const tot = datos.totales ?? { gasto: 0, venta: 0, unidades: 0 }
  const neto = Object.values(economia).reduce((a, f) => a + (f.contribucionGenerada ?? 0), 0) - tot.gasto
  const fotos = new Map(Object.entries(economia).map(([id, f]) => [id, f.foto]))
  const efectoDe = new Map((aprendido?.ultimo?.efecto?.productos ?? []).map((p) => [p.itemId, p]))
  const productos = plan?.productos ?? []
  const conAnuncio = productos.filter((p) => !['apagada', 'arrancar', 'arrancar-con-cuidado', 'organico', 'no-anunciar'].includes(p.accion))
    .sort((a, b) => (b.metricas?.gasto7 ?? 0) - (a.metricas?.gasto7 ?? 0))
  const sinAnuncio = productos.filter((p) => !conAnuncio.includes(p))

  return (
    <main className={`pub${cargando ? ' ads-refrescando' : ''}`}>
      <header className="pub-cabeza">
        <h2>Publicidad</h2>
        <div className="pub-controles">
          <button type="button" className="pub-refrescar" onClick={() => traer(true)} disabled={cargando} title="Vuelve a preguntarle a ML">
            {cargando ? 'actualizando…' : haceCuanto(datos.refrescoEl) ?? 'actualizar'}
          </button>
          <div className="segmentado" role="group" aria-label="Período">
            {[7, 30].map((d) => <button key={d} className={dias === d ? 'activo' : ''} onClick={() => setDias(d)}>{d} días</button>)}
          </div>
        </div>
      </header>
      {error ? <p className="ads-error-suave">No se pudo actualizar: {error}. Se muestra la última lectura.</p> : null}

      <Resultado tot={tot} neto={neto} marcador={plan?.marcador} sinCosto={plan?.sinCosto > 0} />
      <QueHacer plan={plan} fotos={fotos} />

      {conAnuncio.length ? (
        <section className="pub-productos">
          <h3>Tus productos con publicidad</h3>
          <ul>
            {conAnuncio.map((p) => (
              <Producto key={p.itemId} p={p} ad={economia[p.itemId]} efecto={efectoDe.get(p.itemId)} abierto={abierto === p.itemId} onToggle={() => setAbierto(abierto === p.itemId ? null : p.itemId)} />
            ))}
          </ul>
        </section>
      ) : null}

      {sinAnuncio.length ? (
        <section className="pub-sin">
          <h3>Sin publicidad</h3>
          <div>
            {sinAnuncio.map((p) => {
              const a = ACCION[p.accion] ?? { t: p.accion, c: 'neutro' }
              return (
                <span key={p.itemId} className="pub-sin-chip" title={p.texto}>
                  {fotos.get(p.itemId) ? <img src={fotos.get(p.itemId)} alt="" width="24" height="24" loading="lazy" /> : null}
                  {nombreCorto(p.titulo)} <em className={`pub-accion ${a.c}`}>{a.t}</em>
                </span>
              )
            })}
          </div>
        </section>
      ) : null}

      <ComoAprende plan={plan} aprendido={aprendido} />
    </main>
  )
}
