import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { PauseCircle, Split, PlusCircle, TrendingUp, TrendingDown, Target, Layers, Hourglass, Megaphone, CheckCircle2, XCircle, CircleDot, MousePointerClick } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'

// PUBLICIDAD EN CUATRO PESTAÑAS (30-sep-2026). El importador pidió, tras un
// primer rediseño demasiado escueto: vista por campaña, gráficos en el tiempo,
// las métricas completas de ML, el seguimiento del learning machine, y "un
// estudio por producto: qué hacer, cómo va, si debería tener campaña o no".
//
//   Resumen          cuánto dejó, la curva diaria y qué hacer hoy
//   Campañas         cada campaña con sus productos adentro y sus diales
//   Productos        el estudio de cada producto, con su veredicto de campaña
//   Learning machine pruebas en curso, historial de lo recomendado y cómo aprende
//
// Todo en plata: lo que dejaron las ventas por anuncio (precio cobrado menos
// comisión, envío y costo) menos lo que costó conseguirlas. Sin costo cargado
// es antes de pagar el producto, y se dice.

const x = (v) => (Number.isFinite(v) ? `${String(Math.round(v * 100) / 100).replace('.', ',')}x` : '—')
const miles = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('es-CL') : '—')
const pct = (v) => (Number.isFinite(v) ? `${String(Math.round(v * 10) / 10).replace('.', ',')}%` : '—')
const conSigno = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${fmtPrecio(Math.abs(Math.round(v)))}` : '—')

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
  'revisar-anuncio': { t: 'revisar anuncio', c: 'medio' },
  apagada: { t: 'sin anuncio', c: 'neutro' }, 'sin-stock': { t: 'sin stock', c: 'neutro' }, 'sin-economia': { t: 'sin precio', c: 'neutro' }, 'sin-datos': { t: 'sin datos', c: 'neutro' },
}
const ICONO = {
  'pausar-anuncio': PauseCircle, separar: Split, 'campana-propia': Split, 'agrupar-chicos': Layers, crear: PlusCircle, 'ajustar-budget': Target,
  subir: TrendingUp, bajar: TrendingDown, apagar: PauseCircle, 'subir-roas': Target, 'revisar-anuncio': MousePointerClick, arrancar: PlusCircle, 'arrancar-con-cuidado': PlusCircle, esperar: Hourglass,
}
// el diagnóstico del clic (ml/planCampanas.js diagnosticoClic)
const CLIC = {
  cayo: { c: 'mal', etiqueta: 'El clic cayó solo en este producto: revisar precio contra la competencia, foto y título', ayuda: 'Bajó contra su propio CTR de las 4 semanas anteriores mucho más que los demás productos, cada uno contra sí mismo.' },
  bajo: { c: 'mal', etiqueta: 'CTR bajo la mitad del de tus otros productos: el anuncio no atrae', ayuda: 'Menos de la mitad del CTR mediano de tus otros productos la misma semana.' },
  'cayo-con-el-mercado': { c: 'medio', etiqueta: 'El clic bajó, pero igual que tus otros productos: es el mercado (época, fin de mes, competencia)', ayuda: 'Los demás productos, cada uno contra sí mismo, cayeron parecido en las mismas fechas. Sin el efecto de la mezcla.' },
  'cayo-por-puja': { c: 'medio', etiqueta: 'El clic bajó y además se abarató: ML lo muestra en ubicaciones más baratas (revisar budget o ROAS objetivo antes que el anuncio)', ayuda: 'El costo por clic cayó más de 25% a la vez que el CTR: se está pujando menos.' },
  normal: { c: 'bien', ayuda: 'CTR en línea con su historia y con la cuenta.' },
  'poca-muestra': { c: '', ayuda: 'Menos de 3.000 impresiones en 7 días: el CTR todavía es ruido.' },
}
// el CTR va con sus dos decimales: 0,26% redondeado a 0,3% esconde la caída
const pctClic = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`)

const FASE = { arranque: 'antes de anunciar', 'semana-1': 'prueba · semana 1', 'semana-2': 'prueba · semana 2', ajuste: 'ajuste (semana 3)', regular: 'en régimen', apagada: 'sin anuncio' }

// lo que dejaron unas ventas por anuncio, con el precio cobrado
function dejaron(ventaAds, unidadesAds, eco) {
  if (!eco || !(unidadesAds > 0)) return 0
  const venta = ventaAds > 0 ? ventaAds : eco.precio * unidadesAds
  return venta * (1 - (eco.comisionPct ?? 17) / 100) - unidadesAds * ((eco.envio ?? 800) + (eco.costo ?? 0))
}

// ¿DEBERÍA TENER CAMPAÑA? El veredicto del estudio por producto, armado con
// lo que ya decidió el plan (acción y estructura) y la economía de su precio.
function veredictoCampana(p, acciones, ticket) {
  const suyas = acciones.filter((a) => a.itemId === p.itemId || a.itemIds?.includes(p.itemId))
  const razones = []
  const deja = p.economia?.deja
  if (p.economia?.precio && deja != null) razones.push(`Cada venta deja ${fmtPrecio(deja)}${p.economia.esTecho ? ' antes del costo del producto' : ''}; la publicidad empata con ROAS ${x(p.economia.roasEmpate)}.`)
  if (ticket?.pctConAds != null) razones.push(`A ${fmtPrecio(ticket.precio)}, con publicidad queda ${ticket.pctConAds}% del precio${ticket.pctConAds < 40 ? ': ticket bajo, la publicidad se come casi todo' : ''}.`)
  const m = p.metricas ?? {}
  if (m.resultado30 != null) razones.push(`En 30 días la publicidad dejó ${conSigno(m.resultado30)}.`)
  else if (m.resultado7 != null) razones.push(`En los últimos 7 días dejó ${conSigno(m.resultado7)} con ROAS ${x(m.roas7)}.`)
  if (p.accion === 'apagada') return { tipo: 'pausado', titulo: 'Hoy no tiene anuncio (sin stock o pausado)', razones: [...razones, 'Sin gasto en la última semana. Cuando vuelva el stock, el learning machine lo revisa de nuevo.'] }
  if (suyas.some((a) => a.tipo === 'pausar-anuncio') || ['apagar', 'organico', 'no-anunciar'].includes(p.accion)) {
    return { tipo: 'no', titulo: 'No: que venda orgánico', razones }
  }
  if (suyas.some((a) => ['separar', 'campana-propia', 'crear'].includes(a.tipo))) {
    const a = suyas.find((y) => ['separar', 'campana-propia', 'crear'].includes(y.tipo))
    return { tipo: 'propia', titulo: `Sí: campaña propia${p.budgetDiario ? ` de ${fmtPrecio(p.budgetDiario)}/día` : ''}`, razones: [...razones, a.tipo === 'separar' ? 'Es el que más budget merece: la campaña actual debería quedar solo para él.' : 'Mezclado con otros, ML le reparte el gasto a su criterio y no se puede medir.'] }
  }
  if (suyas.some((a) => a.tipo === 'agrupar-chicos')) {
    const a = suyas.find((y) => y.tipo === 'agrupar-chicos')
    return { tipo: 'agrupada', titulo: `Sí, pero agrupado: campaña de prueba de ${fmtPrecio(a.budgetDiario ?? 1000)}/día`, razones: [...razones, 'Vende poco para una campaña propia; junto a productos de economía parecida se prueba 2 semanas fuera de la sombra del que más gasta.'] }
  }
  return { tipo: 'ya', titulo: p.campana ? `Sí: sigue en «${p.campana}»` : 'Sí', razones }
}

function haceCuanto(iso) {
  if (!iso) return null
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'recién'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  return `hace ${Math.round(s / 3600)} h`
}

// ── gráficos ────────────────────────────────────────────────────────────────
// Gasto diario en barras y la plata ACUMULADA en línea: si la línea sube, la
// publicidad está dejando plata; si baja, la está perdiendo.
function GraficoPlata({ dias, alto = 150 }) {
  const w = 640, h = alto, pad = 22
  if (!dias?.length) return <p className="pub-vacio">Sin días con datos.</p>
  let acum = 0
  const puntos = dias.map((d) => ({ ...d, acum: (acum += d.plata) }))
  const maxG = Math.max(1, ...puntos.map((d) => d.gasto))
  const minA = Math.min(0, ...puntos.map((d) => d.acum)), maxA = Math.max(1, ...puntos.map((d) => d.acum))
  const bx = (i) => pad + (i / Math.max(1, puntos.length - 1)) * (w - 2 * pad)
  const ya = (v) => h - pad - ((v - minA) / Math.max(1, maxA - minA)) * (h - 2 * pad)
  const ancho = Math.max(2, ((w - 2 * pad) / puntos.length) * 0.7)
  const linea = puntos.map((d, i) => `${i ? 'L' : 'M'}${bx(i).toFixed(1)},${ya(d.acum).toFixed(1)}`).join(' ')
  const final = puntos.at(-1).acum
  return (
    <figure className="pub-grafico">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Gasto diario y plata acumulada">
        <line x1={pad} x2={w - pad} y1={ya(0)} y2={ya(0)} className="pub-cero" />
        {puntos.map((d, i) => (
          <rect key={d.dia} x={bx(i) - ancho / 2} width={ancho} y={h - pad - (d.gasto / maxG) * (h - 2 * pad) * 0.55} height={(d.gasto / maxG) * (h - 2 * pad) * 0.55} className="pub-barra-gasto">
            <title>{d.dia}: gastó {fmtPrecio(d.gasto)}, {d.unidadesAds} ventas por anuncio, dejó {conSigno(d.plata)}</title>
          </rect>
        ))}
        <path d={linea} className={final >= 0 ? 'pub-linea bien' : 'pub-linea mal'} />
        <text x={pad} y={h - 4} className="pub-eje">{puntos[0].dia.slice(8, 10)}/{puntos[0].dia.slice(5, 7)}</text>
        <text x={w - pad} y={h - 4} textAnchor="end" className="pub-eje">{puntos.at(-1).dia.slice(8, 10)}/{puntos.at(-1).dia.slice(5, 7)}</text>
      </svg>
      <figcaption><i className="ley-gasto" /> gasto diario <i className={`ley-linea ${final >= 0 ? 'bien' : 'mal'}`} /> plata acumulada: <b className={final >= 0 ? 'bien' : 'mal'}>{conSigno(final)}</b></figcaption>
    </figure>
  )
}

// Ventas por semana: cuántas trajo el anuncio y cuántas llegaron solas.
function GraficoVentas({ dias }) {
  const semanas = []
  for (let i = 0; i < dias.length; i += 7) {
    const w = dias.slice(i, i + 7)
    const ads = w.reduce((a, d) => a + d.unidadesAds, 0)
    const total = w.some((d) => d.unidades != null) ? w.reduce((a, d) => a + (d.unidades ?? 0), 0) : null
    semanas.push({ desde: w[0].dia, ads, organicas: total != null ? Math.max(0, total - ads) : null })
  }
  const max = Math.max(1, ...semanas.map((s) => s.ads + (s.organicas ?? 0)))
  return (
    <figure className="pub-ventas">
      <div className="pub-ventas-barras">
        {semanas.map((s) => (
          <div key={s.desde} title={`Semana del ${s.desde}: ${Math.round(s.ads)} por anuncio${s.organicas != null ? `, ${Math.round(s.organicas)} solas` : ''}`}>
            <span className="org" style={{ height: `${((s.organicas ?? 0) / max) * 80}px` }} />
            <span className="ads" style={{ height: `${(s.ads / max) * 80}px` }} />
            <small>{s.desde.slice(8, 10)}/{s.desde.slice(5, 7)}</small>
          </div>
        ))}
      </div>
      <figcaption><i className="ley-ads" /> ventas por anuncio <i className="ley-org" /> ventas que llegaron solas</figcaption>
    </figure>
  )
}

function Sparkline({ valores, clase = '' }) {
  if (!valores?.length) return null
  const max = Math.max(1, ...valores)
  const w = 120, h = 28
  const d = valores.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, valores.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ')
  return <svg className={`pub-spark ${clase}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} /></svg>
}

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

function Metricas({ m }) {
  if (!m) return null
  const ctr = m.prints ? (m.clicks / m.prints) * 100 : null
  const conv = m.clicks ? (m.units_quantity / m.clicks) * 100 : null
  const filas = [
    ['impresiones', miles(m.prints)], ['clics', miles(m.clicks)], ['CTR', pct(ctr)], ['CPC', fmtPrecio(Math.round(m.cpc ?? 0))],
    ['conversión', pct(conv)], ['ACOS', pct(m.acos)], ['gastado', fmtPrecio(Math.round(m.cost ?? 0))], ['facturado', fmtPrecio(Math.round(m.total_amount ?? 0))],
    ['ventas directas', miles(m.direct_units_quantity)], ['ventas indirectas', miles(m.indirect_units_quantity)], ['ventas orgánicas', miles(m.organic_units_quantity)],
  ]
  return (
    <dl className="pub-metricas">
      {filas.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

// ── pestaña Resumen ──────────────────────────────────────────────────────────
function QueHacer({ plan, fotos, max }) {
  const pasos = useMemo(() => {
    const est = plan?.estructura?.acciones ?? []
    const cubiertos = new Set(est.flatMap((a) => [a.itemId, ...(a.itemIds ?? [])]).filter(Boolean))
    const extra = (plan?.productos ?? [])
      .filter((p) => !cubiertos.has(p.itemId) && ['subir', 'bajar', 'subir-roas', 'revisar-anuncio', 'apagar', 'arrancar', 'arrancar-con-cuidado'].includes(p.accion))
      .map((p) => ({ tipo: p.accion, itemId: p.itemId, prioridad: p.accion === 'apagar' ? 1 : 2, texto: `${nombreCorto(p.titulo)}: ${p.texto}` }))
    return [...est, ...extra].sort((a, b) => a.prioridad - b.prioridad)
  }, [plan])
  if (!pasos.length) return <section className="pub-hacer vacio-ok"><h3>Qué hacer hoy</h3><p>Nada que cambiar: las campañas están como recomienda el learning machine.</p></section>
  const mostrados = max ? pasos.slice(0, max) : pasos
  return (
    <section className="pub-hacer">
      <h3>Qué hacer hoy <small>{pasos.length} {pasos.length === 1 ? 'paso' : 'pasos'} · recomendado, lo haces tú en ML</small></h3>
      <ol>
        {mostrados.map((a, i) => {
          const Icono = ICONO[a.tipo] ?? Megaphone
          const foto = a.itemId ? fotos.get(a.itemId) : a.itemIds?.length ? fotos.get(a.itemIds[0]) : null
          return (
            <li key={i} className={`prio-${a.prioridad}`}>
              {foto ? <img src={foto} alt="" width="36" height="36" loading="lazy" /> : <span className="pub-hacer-icono"><Icono size={18} aria-hidden="true" /></span>}
              <p>{a.texto}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function Resumen({ datos, plan, serieTotal, fotos, onIr }) {
  const economia = datos.economia ?? {}
  const tot = datos.totales ?? { gasto: 0, venta: 0, unidades: 0 }
  const neto = Object.values(economia).reduce((a, f) => a + (f.contribucionGenerada ?? 0), 0) - tot.gasto
  const roas = tot.gasto ? tot.venta / tot.gasto : null
  return (
    <>
      <section className="pub-resultado">
        <div className="pub-resultado-numeros">
          <div className={`pub-grande ${neto >= 0 ? 'bien' : 'mal'}`}>
            <span>la publicidad dejó</span>
            <strong>{conSigno(neto)}</strong>
            <small>{plan?.sinCosto ? 'antes de pagar el producto (falta cargar costos)' : 'después de pagar el producto'}</small>
          </div>
          <div className="pub-chico"><span>gastaste</span><strong>{fmtPrecio(Math.round(tot.gasto))}</strong></div>
          <div className="pub-chico"><span>ventas por anuncio</span><strong>{miles(tot.unidades)}</strong></div>
          <div className="pub-chico"><span>ROAS</span><strong>{x(roas)}</strong></div>
        </div>
      </section>
      <section className="pub-caja">
        <h3>Día a día <small>últimos {serieTotal.length} días</small></h3>
        <GraficoPlata dias={serieTotal} />
      </section>
      <QueHacer plan={plan} fotos={fotos} max={5} />
      <button type="button" className="pub-link" onClick={() => onIr('productos')}>Ver el estudio de cada producto →</button>
    </>
  )
}

// ── pestaña Campañas ─────────────────────────────────────────────────────────
function Campanas({ datos, hoy, plan, serie, fotos, ecoDe, onProducto }) {
  // las pausadas sin productos no aportan: van a una línea al final
  const conProductos = (c) => Object.values(datos.porItem ?? {}).some((a) => a.campanaId === c.id)
  const vacias = (datos.campanas ?? []).filter((c) => c.estado !== 'active' && !conProductos(c))
  const campanas = [...(datos.campanas ?? [])].filter((c) => !vacias.includes(c)).sort((a, b) => (a.estado === 'active' ? -1 : 1) - (b.estado === 'active' ? -1 : 1) || (b.metricas?.cost ?? 0) - (a.metricas?.cost ?? 0))
  const gastoHoy = new Map((hoy?.campanas ?? []).map((c) => [c.id, c.metricas?.cost ?? 0]))
  const planDe = new Map((plan?.productos ?? []).map((p) => [p.itemId, p]))
  return (
    <div className="pub-campanas">
      {campanas.map((c) => {
        const m = c.metricas ?? {}
        const productos = Object.entries(datos.porItem ?? {}).filter(([, a]) => a.campanaId === c.id)
        const roasReal = m.cost ? (m.total_amount ?? 0) / m.cost : null
        const g = gastoHoy.get(c.id) ?? 0
        const acciones = (plan?.estructura?.acciones ?? []).filter((a) => a.campana === c.nombre)
        const activa = c.estado === 'active'
        return (
          <section key={c.id} className={`pub-campana${activa ? '' : ' pausada'}`}>
            <header>
              <div>
                <h3>{c.nombre} <em className={`pub-accion ${activa ? 'bien' : 'neutro'}`}>{activa ? 'activa' : 'pausada'}</em></h3>
                <small>{productos.length} {productos.length === 1 ? 'producto' : 'productos'}{productos.length > 1 && activa ? ' mezclados: ML reparte el gasto entre ellos a su criterio' : ''}</small>
              </div>
              <div className="pub-diales">
                <div><span>budget</span><strong>{fmtPrecio(c.presupuestoDiario ?? 0)}/día</strong></div>
                <div><span>ROAS objetivo → real</span><strong>{x(c.roasObjetivo)} → <b className={roasReal != null && c.roasObjetivo && roasReal >= c.roasObjetivo ? 'bien' : 'mal'}>{x(roasReal)}</b></strong></div>
              </div>
            </header>
            {activa ? (
              <div className="pub-hoy" title="Lo gastado hoy contra el presupuesto diario">
                <div className="pub-hoy-barra"><i style={{ width: `${Math.min(100, (g / Math.max(1, c.presupuestoDiario ?? 1)) * 100)}%` }} /></div>
                <span>hoy lleva {fmtPrecio(Math.round(g))} de {fmtPrecio(c.presupuestoDiario ?? 0)}</span>
              </div>
            ) : null}
            <Metricas m={m} />
            {acciones.length ? (
              <ul className="pub-campana-acciones">
                {acciones.map((a, i) => { const I = ICONO[a.tipo] ?? Megaphone; return <li key={i} className={`prio-${a.prioridad}`}><I size={16} aria-hidden="true" />{a.texto}</li> })}
              </ul>
            ) : null}
            {productos.length ? (
              <div className="pub-campana-prods">
                {productos.map(([id, a]) => {
                  const p = planDe.get(id)
                  const s = serie?.porProducto?.[id]?.slice(-30) ?? []
                  const ac = ACCION[p?.accion] ?? { t: a.estado === 'hold' ? 'sin stock' : '—', c: 'neutro' }
                  const eco = ecoDe.get(id)
                  const plata30 = s.reduce((acc, d) => acc + dejaron(d.ventaAds, d.unidadesAds, eco) - d.gasto, 0)
                  return (
                    <button type="button" key={id} className="pub-mini" onClick={() => onProducto(id)}>
                      {fotos.get(id) ? <img src={fotos.get(id)} alt="" width="40" height="40" loading="lazy" /> : <span className="pub-foto-vacia" />}
                      <span className="pub-mini-nombre">{nombreCorto(a.titulo ?? p?.titulo)}</span>
                      <Sparkline valores={s.map((d) => d.gasto)} />
                      <span className="pub-mini-pie"><em className={`pub-accion ${ac.c}`}>{ac.t}</em><b className={plata30 >= 0 ? 'bien' : 'mal'}>{eco ? conSigno(plata30) : '—'}</b></span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
      {vacias.length ? <p className="pub-vacio">{vacias.length} {vacias.length === 1 ? 'campaña pausada' : 'campañas pausadas'} sin productos: {vacias.map((c) => `«${c.nombre}»`).join(', ')}.</p> : null}
    </div>
  )
}

// ── pestaña Productos: el estudio ────────────────────────────────────────────
function Estudio({ p, ad, efecto, serie, veredicto, ticket }) {
  const a = ACCION[p.accion] ?? { t: p.accion, c: 'neutro' }
  const m = p.metricas ?? {}
  const eco = p.economia
  const dias = (serie ?? []).map((d) => ({ ...d, plata: dejaron(d.ventaAds, d.unidadesAds, eco) - d.gasto }))
  const desdeAnuncio = dias.findIndex((d) => d.gasto > 0)
  const conAnuncio = desdeAnuncio >= 0 ? dias.slice(desdeAnuncio) : []
  return (
    <article className="pub-estudio">
      <header>
        {ad?.foto ? <img src={ad.foto} alt="" width="72" height="72" /> : <span className="pub-foto-vacia grande" />}
        <div>
          <h3>{p.titulo}</h3>
          <small>{FASE[p.fase] ?? p.fase}{p.campana ? ` · en «${p.campana}»` : ''} · precio cobrado {fmtPrecio(p.precio)}</small>
        </div>
      </header>

      <section className={`pub-veredicto ${veredicto.tipo}`}>
        <span>¿Debería tener campaña?</span>
        <strong>{veredicto.titulo}</strong>
        <ul>{veredicto.razones.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </section>

      <section className="pub-caja">
        <h4>Qué hacer <em className={`pub-accion ${a.c}`}>{a.t}</em></h4>
        <p className="pub-texto">{p.texto}</p>
        <div className="pub-prod-numeros">
          <div><span>gasta hoy</span><strong>{m.gastoDiario != null ? `${fmtPrecio(m.gastoDiario)}/día` : '—'}</strong></div>
          <div><span>recomendado</span><strong className={a.c}>{p.budgetDiario ? `${fmtPrecio(p.budgetDiario)}/día` : '$0'}</strong></div>
          <div><span>ROAS objetivo</span><strong>{x(p.roasObjetivo)}</strong></div>
          <div><span>dejó 7 días</span><strong className={m.resultado7 >= 0 ? 'bien' : 'mal'}>{conSigno(m.resultado7)}</strong></div>
          {m.resultado30 != null ? <div><span>dejó 30 días</span><strong className={m.resultado30 >= 0 ? 'bien' : 'mal'}>{conSigno(m.resultado30)}</strong></div> : null}
          {m.ctr7 != null ? (
            <div title={CLIC[p.clic?.estado]?.ayuda ?? ''}>
              <span>CTR 7 días</span>
              <strong className={CLIC[p.clic?.estado]?.c ?? ''}>{pctClic(m.ctr7)}</strong>
              <small>{m.ctrPrevio != null ? `antes ${pctClic(m.ctrPrevio)}` : 'sin historia'}{p.clic?.mercadoCtr7 != null ? ` · otros ${pctClic(p.clic.mercadoCtr7)}` : ''}</small>
            </div>
          ) : null}
        </div>
        {p.clic && CLIC[p.clic.estado]?.etiqueta ? <p className={`pub-clic ${CLIC[p.clic.estado].c}`}><MousePointerClick size={13} aria-hidden="true" /> {CLIC[p.clic.estado].etiqueta}</p> : null}
        <MedidorRoas roas={m.roas7} empate={eco?.roasEmpate} />
      </section>

      <section className="pub-caja">
        <h4>Cómo va</h4>
        {conAnuncio.length ? <GraficoPlata dias={conAnuncio.slice(-60)} alto={130} /> : <p className="pub-vacio">Todavía no se ha anunciado.</p>}
        {dias.length ? <GraficoVentas dias={dias.slice(-56)} /> : null}
      </section>

      <div className="pub-estudio-dos">
        <section className="pub-caja">
          <h4>Lo que deja cada venta</h4>
          <dl className="pub-metricas">
            <div><dt>precio cobrado</dt><dd>{fmtPrecio(eco?.precio)}</dd></div>
            <div><dt>comisión ML</dt><dd>−{fmtPrecio(eco?.comision)}</dd></div>
            <div><dt>envío (tu parte)</dt><dd>−{fmtPrecio(eco?.envio)}</dd></div>
            <div><dt>costo producto</dt><dd>{eco?.costo != null ? `−${fmtPrecio(eco.costo)}` : 'sin cargar'}</dd></div>
            <div><dt>deja</dt><dd className={eco?.deja > 0 ? 'bien' : 'mal'}><b>{fmtPrecio(eco?.deja)}</b></dd></div>
            <div><dt>ROAS de empate</dt><dd>{x(eco?.roasEmpate)}</dd></div>
            {ticket ? <div><dt>queda con publicidad</dt><dd className={ticket.pctConAds >= 40 ? 'bien' : 'mal'}>{ticket.pctConAds}% del precio</dd></div> : null}
          </dl>
        </section>
        <section className="pub-caja">
          <h4>Lo que aprendió</h4>
          <dl className="pub-metricas">
            <div title="ML se atribuye ventas que en parte iban a llegar solas"><dt>ML atribuye / trajo de verdad</dt><dd>{efecto ? `${efecto.ventasAtribuidasMl} / ${Math.round(efecto.ventasIncrementales)}` : '—'}</dd></div>
            <div><dt>costo real por venta</dt><dd>{efecto?.costoPorVentaIncremental ? fmtPrecio(efecto.costoPorVentaIncremental) : '—'}</dd></div>
            <div title="Lo que cuesta la próxima venta al gasto de hoy"><dt>la próxima venta cuesta</dt><dd className={eco?.deja && efecto?.costoVentaMarginal > eco.deja ? 'mal' : ''}>{efecto?.costoVentaMarginal ? fmtPrecio(efecto.costoVentaMarginal) : '—'}</dd></div>
            <div><dt>techo de budget</dt><dd>{m.budgetOptimoAprendido != null ? `${fmtPrecio(m.budgetOptimoAprendido)}/día` : efecto?.presupuestoOptimo != null ? `${fmtPrecio(efecto.presupuestoOptimo)}/día` : '—'}</dd></div>
          </dl>
        </section>
      </div>

      {ad?.metricas ? (
        <section className="pub-caja">
          <h4>Métricas de ML <small>período elegido</small></h4>
          <Metricas m={ad.metricas} />
        </section>
      ) : null}
    </article>
  )
}

function Productos({ plan, datos, aprendido, serie, fotos, sel, onSel }) {
  const productos = [...(plan?.productos ?? [])].sort((a, b) => (b.metricas?.gasto7 ?? 0) - (a.metricas?.gasto7 ?? 0))
  const acciones = plan?.estructura?.acciones ?? []
  const efectoDe = new Map((aprendido?.ultimo?.efecto?.productos ?? []).map((p) => [p.itemId, p]))
  const ticketT = aprendido?.ultimo?.parametros?.ticket
  const ticketDe = (precio) => {
    if (!ticketT?.curva?.length || !ticketT.medido || !(precio > 0)) return null
    const punto = [...ticketT.curva].reverse().find((c) => c.precio <= precio) ?? ticketT.curva[0]
    const conAds = precio * (1 - ticketT.medido.comisionPct / 100) - punto.envio - precio * (ticketT.medido.publicidadPct / 100)
    return { precio, pctConAds: Math.round((conAds / precio) * 100) }
  }
  const actual = productos.find((p) => p.itemId === sel) ?? productos[0]
  if (!actual) return <p className="pub-vacio">Sin productos propios.</p>
  const veredictos = new Map(productos.map((p) => [p.itemId, veredictoCampana(p, acciones, ticketDe(p.precio))]))
  const ETIQUETA = { propia: 'campaña propia', agrupada: 'campaña agrupada', no: 'sin campaña', ya: 'con campaña', pausado: 'sin stock / pausado' }
  return (
    <div className="pub-productos-vista">
      <nav className="pub-lista" aria-label="Productos">
        {productos.map((p) => {
          const a = ACCION[p.accion] ?? { t: p.accion, c: 'neutro' }
          const v = veredictos.get(p.itemId)
          return (
            <button key={p.itemId} type="button" className={p.itemId === actual.itemId ? 'activo' : ''} onClick={() => onSel(p.itemId)}>
              {fotos.get(p.itemId) ? <img src={fotos.get(p.itemId)} alt="" width="40" height="40" loading="lazy" /> : <span className="pub-foto-vacia" />}
              <span>
                <strong>{nombreCorto(p.titulo)}</strong>
                <small><em className={`pub-accion ${a.c}`}>{a.t}</em> <i className={`pub-v ${v.tipo}`}>{ETIQUETA[v.tipo]}</i></small>
              </span>
            </button>
          )
        })}
      </nav>
      <Estudio p={actual} ad={datos.economia?.[actual.itemId] ? { ...datos.economia[actual.itemId], metricas: datos.porItem?.[actual.itemId]?.metricas } : null}
        efecto={efectoDe.get(actual.itemId)} serie={serie?.porProducto?.[actual.itemId]} veredicto={veredictos.get(actual.itemId)} ticket={ticketDe(actual.precio)} />
    </div>
  )
}

// ── pestaña Learning machine ─────────────────────────────────────────────────
function LearningMachine({ plan, aprendido, fotos }) {
  const e = aprendido?.ultimo?.efecto
  const t = aprendido?.ultimo?.parametros?.ticket
  const r = plan?.reglas
  const ev = plan?.evaluacion
  const enPrueba = (plan?.productos ?? []).filter((p) => ['semana-1', 'semana-2', 'ajuste', 'arranque'].includes(p.fase) && !['apagada', 'sin-stock'].includes(p.accion))
  // historial: por producto, los últimos 14 días de recomendación como puntos
  const hist = plan?.historial ?? []
  const diasHist = [...new Set(hist.map((h) => h.dia))].sort().slice(-14)
  const porProducto = new Map()
  for (const h of hist) porProducto.set(h.itemId, [...(porProducto.get(h.itemId) ?? []), h])
  const titulo = new Map((plan?.productos ?? []).map((p) => [p.itemId, p.titulo]))
  const evalDe = new Map((ev?.detalle ?? []).map((d) => [`${d.itemId}|${d.dia}`, d]))
  return (
    <div className="pub-lm">
      <section className="pub-caja">
        <h3>Pruebas en curso</h3>
        {enPrueba.length ? (
          <ul className="pub-pruebas">
            {enPrueba.map((p) => {
              const dia = p.metricas?.diasCorriendo ?? 0
              const toca = p.fase === 'arranque' ? `Crear campaña: ${fmtPrecio(p.budgetDiario)}/día` : dia < 7 ? `Semana 1 con ${fmtPrecio(p.metricas?.gastoDiario ?? 0)}/día` : dia < 14 ? 'Semana 2: el budget al doble' : 'Semana 3: ajustar con lo medido'
              return (
                <li key={p.itemId}>
                  {fotos.get(p.itemId) ? <img src={fotos.get(p.itemId)} alt="" width="36" height="36" /> : <span className="pub-foto-vacia" />}
                  <div>
                    <strong>{nombreCorto(p.titulo)}</strong>
                    <div className="pub-prueba-barra"><i style={{ width: `${Math.min(100, (dia / 21) * 100)}%` }} /><b style={{ left: '33.3%' }} /><b style={{ left: '66.6%' }} /></div>
                    <small>{p.fase === 'arranque' ? 'antes de anunciar' : `día ${dia} de 21`} · {toca}</small>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : <p className="pub-vacio">Ningún producto en prueba. Cuando pases un producto a su propia campaña, o llegue uno nuevo, su prueba de 2 semanas aparece acá.</p>}
      </section>

      <section className="pub-caja">
        <h3>Lo que recomendó cada día <small>{diasHist.length ? `${diasHist.length} días` : 'se guarda desde el 30-sep'}</small></h3>
        {diasHist.length ? (
          <div className="pub-historial">
            {[...porProducto].map(([id, filas]) => {
              const porDia = new Map(filas.map((f) => [f.dia, f]))
              return (
                <div key={id} className="pub-hist-fila">
                  <span className="pub-hist-nombre">{fotos.get(id) ? <img src={fotos.get(id)} alt="" width="22" height="22" /> : null}{nombreCorto(titulo.get(id) ?? id)}</span>
                  <span className="pub-hist-puntos">
                    {diasHist.map((d) => {
                      const f = porDia.get(d)
                      const evd = evalDe.get(`${id}|${d}`)
                      const c = f ? (ACCION[f.accion]?.c ?? 'neutro') : 'vacio'
                      return (
                        <i key={d} className={`pub-punto ${c}`} title={f ? `${d}: ${ACCION[f.accion]?.t ?? f.accion}${f.budgetDiario ? ` · ${fmtPrecio(f.budgetDiario)}/día` : ''}${evd ? ` · ${evd.siguio ? 'la seguiste' : 'no la seguiste'}, la plata ${evd.mejoro ? 'mejoró' : 'no mejoró'}` : ''}\n${f.texto ?? ''}` : d}>
                          {evd ? (evd.mejoro ? <CheckCircle2 size={10} /> : <XCircle size={10} />) : null}
                        </i>
                      )
                    })}
                  </span>
                </div>
              )
            })}
            <p className="pub-ley"><CircleDot size={12} /> cada punto es un día (color = acción recomendada); ✓/✗ aparece 7 días después: si la plata mejoró.</p>
          </div>
        ) : <p className="pub-vacio">Todavía no hay días guardados.</p>}
      </section>

      <Bitacoras plan={plan} fotos={fotos} />

      <FormasCampana formas={plan?.formas} />

      <ClicCuenta plan={plan} />

      <DemandaPropia />

      <RankingPropios />

      <div className="pub-aprende-tarjetas">
        <div>
          <strong>Sus aciertos</strong>
          <p>{ev?.evaluadas ? <>{ev.seguidas} recomendaciones seguidas: <b>{ev.tasaAcierto ?? '—'}%</b> dejaron más plata{ev.tasaSinSeguir != null ? ` (las no seguidas: ${ev.tasaSinSeguir}%)` : ''}.</> : 'Se evalúan 7 días después de cada recomendación: desde el 7-oct.'}</p>
        </div>
        {r ? (
          <div>
            <strong>Regla para subir el budget</strong>
            <p>{r.estado === 'aprendido' ? <>Aprendida con {r.n} cambios de gasto: subir conviene sobre <b>{x(r.umbral)}</b> el empate.</> : <>Todavía la inicial (1,3× el empate): {r.n} cambios de gasto medidos, {r.estado === 'pocos-casos' ? 'necesita 12' : 'sin un corte claro'}. Las pruebas de 2 semanas le dan los casos que faltan.</>}</p>
          </div>
        ) : null}
        {e?.estado ? (
          <div>
            <strong>Efecto real de la publicidad</strong>
            <p>{e.dias} días de ventas totales contra gasto. {e.estado === 'aprendido' ? <>Predice <b>{e.validacion?.mejoraPct}% mejor</b> con la publicidad que sin ella.</> : 'Aún sin efecto confiable.'} Trajo {e.ventasIncrementales} ventas; ML se atribuye {e.ventasAtribuidasMl}.</p>
          </div>
        ) : null}
        {t?.medido ? (
          <div>
            <strong>Cuánto deja según el precio</strong>
            <p>Comisión {String(t.medido.comisionPct).replace('.', ',')}%, publicidad {String(t.medido.publicidadPct).replace('.', ',')}% de lo vendido, envío ~{fmtPrecio(t.medido.envioMedio)}: queda 40%+ desde <b>{fmtPrecio(t.minimo40)}</b>{t.valles?.length ? `; ojo desde ${fmtPrecio(t.valles[0].desde)} (salta el envío)` : ''}.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// LA BITÁCORA DE LARGO PLAZO: cada producto semana a semana desde que está en
// su campaña — plata, lo que se recomendó y el veredicto de la serie completa.
const VEREDICTO_LARGO = { escalar: { t: 'escalar', c: 'bien' }, mantener: { t: 'mantener', c: 'bien' }, vigilar: { t: 'vigilar', c: 'medio' }, cortar: { t: 'cortar', c: 'mal' }, midiendo: { t: 'midiendo', c: 'neutro' }, pausado: { t: 'sin publicidad', c: 'neutro' } }
function Bitacoras({ plan, fotos }) {
  const prods = (plan?.productos ?? []).filter((p) => p.bitacora?.semanas?.some((s) => s.gasto > 0))
  if (!prods.length) return null
  return (
    <section className="pub-caja">
      <h3>Bitácora de cada producto <small>semana a semana desde que está en su campaña</small></h3>
      <div className="pub-bitacoras">
        {prods.map((p) => {
          const b = p.bitacora
          const v = VEREDICTO_LARGO[b.veredicto] ?? VEREDICTO_LARGO.midiendo
          const max = Math.max(1, ...b.semanas.map((s) => Math.abs(s.plata ?? 0)))
          return (
            <div key={p.itemId} className="pub-bitacora">
              <div className="pub-bitacora-cab">
                {fotos.get(p.itemId) ? <img src={fotos.get(p.itemId)} alt="" width="32" height="32" /> : null}
                <strong>{nombreCorto(p.titulo)}</strong>
                <em className={`pub-accion ${v.c}`}>{v.t}</em>
              </div>
              <p className="pub-texto">{b.texto}</p>
              <div className="pub-bitacora-semanas">
                {b.semanas.map((s) => (
                  <div key={s.semana} title={`Semana del ${s.semana}: gastó ${fmtPrecio(s.gasto)} (${fmtPrecio(s.gastoDiario)}/día), ${s.ventasAds} ventas por anuncio de ${s.ventas} totales, ROAS ${x(s.roas)}, CTR ${pctClic(s.ctr)}, dejó ${conSigno(s.plata)}${s.recomendo ? ` · se recomendó: ${ACCION[s.recomendo.accion]?.t ?? s.recomendo.accion}` : ''}`}>
                    <span className="pub-bit-barra"><i className={(s.plata ?? 0) >= 0 ? 'bien' : 'mal'} style={{ height: `${Math.max(3, (Math.abs(s.plata ?? 0) / max) * 46)}px` }} /></span>
                    <small>{s.semana.slice(8, 10)}/{s.semana.slice(5, 7)}</small>
                    {s.recomendo ? <em className={`pub-bit-rec ${ACCION[s.recomendo.accion]?.c ?? 'neutro'}`}>{ACCION[s.recomendo.accion]?.t ?? s.recomendo.accion}</em> : <em className="pub-bit-rec vacio">—</em>}
                  </div>
                ))}
              </div>
              <div className="pub-bitacora-pie">
                <span>acumulado <b className={b.acumulado >= 0 ? 'bien' : 'mal'}>{conSigno(b.acumulado)}</b></span>
                <span>{b.semanasConGasto} {b.semanasConGasto === 1 ? 'semana' : 'semanas'} con gasto</span>
                {b.tendencia ? <span>tendencia: <b className={b.tendencia === 'mejora' ? 'bien' : b.tendencia === 'empeora' ? 'mal' : ''}>{b.tendencia}</b></span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// QUÉ FORMA DE CAMPAÑA RINDE MÁS: solo, de 2-3, de 4+, mismo nicho o
// mezclado. Plata por peso de publicidad, comparando cada producto consigo mismo.
function FormasCampana({ formas }) {
  if (!formas) return null
  const NOMBRE = { sola: 'solo en su campaña', chica: 'con 1-2 productos más', grande: 'con 3 o más productos' }
  const crudo = formas.crudo ?? {}
  const max = Math.max(0.01, ...Object.values(crudo).map((c) => Math.abs(c.rinde ?? 0)))
  return (
    <section className="pub-caja">
      <h3>Qué forma de campaña rinde más <small>{formas.estado === 'aprendido' ? 'aprendido' : 'aprendiendo'}</small></h3>
      <p className="pub-texto">
        {formas.estado === 'aprendido'
          ? <>Comparando cada producto consigo mismo: en campaña propia cada peso de publicidad deja <b className={formas.solaVsGrupo >= 0 ? 'bien' : 'mal'}>{formas.solaVsGrupo >= 0 ? '+' : ''}{Math.round(formas.solaVsGrupo * 100)} centavos</b> {formas.solaVsGrupo >= 0 ? 'más' : 'menos'} que agrupado. Las recomendaciones de estructura ya usan esto.</>
          : <>Todavía no puede decirlo: necesita al menos 3 productos que hayan pasado por campaña propia y por campaña agrupada ({formas.productosComparables} hasta hoy). Casi toda la historia es una sola campaña mezclada; cuando separes campañas empieza a comparar.</>}
      </p>
      <div className="pub-formas">
        {['sola', 'chica', 'grande'].map((f) => {
          const c = crudo[f] ?? {}
          return (
            <div key={f}>
              <span>{NOMBRE[f]}</span>
              <div className="pub-forma-barra"><i className={(c.rinde ?? 0) >= 0 ? 'bien' : 'mal'} style={{ width: `${(Math.abs(c.rinde ?? 0) / max) * 100}%` }} /></div>
              <small>{c.semanas ? <>cada peso deja <b>{c.rinde >= 0 ? '+' : ''}{Math.round((c.rinde ?? 0) * 100)} ¢</b> · {c.semanas} semanas, {c.productos} productos</> : 'sin semanas todavía'}</small>
            </div>
          )
        })}
      </div>
      {formas.porNicho?.['mismo-nicho'] || formas.porNicho?.mezclado ? (
        <p className="pub-ley">Agrupados del mismo nicho: {formas.porNicho['mismo-nicho'] ? `${formas.porNicho['mismo-nicho'].semanas} semanas` : 'sin casos'} · mezclados: {formas.porNicho.mezclado ? `${formas.porNicho.mezclado.semanas} semanas` : 'sin casos'}. Se compara cuando haya 3+ productos en cada uno.</p>
      ) : null}
    </section>
  )
}

// ── la página ────────────────────────────────────────────────────────────────
const PESTANAS = [['resumen', 'Resumen'], ['campanas', 'Campañas'], ['productos', 'Productos'], ['lm', 'Learning machine']]

export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [hoy, setHoy] = useState(null)
  const [plan, setPlan] = useState(null)
  const [aprendido, setAprendido] = useState(null)
  const [serie, setSerie] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)
  const [cargando, setCargando] = useState(false)
  const [pestana, setPestana] = useState(() => { try { return localStorage.getItem('pub-pestana') || 'resumen' } catch { return 'resumen' } })
  const [sel, setSel] = useState(null)
  const [, setTic] = useState(0)

  const ir = (p) => { setPestana(p); try { localStorage.setItem('pub-pestana', p) } catch { /* sin almacenamiento */ } }
  const traer = useCallback((forzar = false) => {
    setCargando(true)
    return Promise.all([api.ads(dias, forzar), api.ads(1, forzar).catch(() => null)])
      .then(([d, h]) => { setDatos(d); setHoy(h); setError(null) })
      .catch((e) => setError(e.message)).finally(() => setCargando(false))
  }, [dias])
  useEffect(() => { traer() }, [traer])
  useEffect(() => {
    api.aprendizajeCampanas().then(setPlan).catch(() => setPlan(null))
    api.aprendizajePublicidad().then(setAprendido).catch(() => setAprendido(null))
    api.publicidadSerie(60).then(setSerie).catch(() => setSerie(null))
  }, [])
  useEffect(() => { const id = setInterval(() => traer(), 60_000); return () => clearInterval(id) }, [traer])
  useEffect(() => { const id = setInterval(() => setTic((t) => t + 1), 15_000); return () => clearInterval(id) }, [])

  const ecoDe = useMemo(() => new Map((plan?.productos ?? []).map((p) => [p.itemId, p.economia])), [plan])
  // la curva total: la suma de cada producto con SU economía
  const serieTotal = useMemo(() => {
    if (!serie?.porProducto) return []
    const porDia = new Map()
    for (const [id, filas] of Object.entries(serie.porProducto)) {
      const eco = ecoDe.get(id)
      for (const d of filas) {
        const t = porDia.get(d.dia) ?? { dia: d.dia, gasto: 0, unidadesAds: 0, plata: 0 }
        t.gasto += d.gasto; t.unidadesAds += d.unidadesAds; t.plata += eco ? dejaron(d.ventaAds, d.unidadesAds, eco) - d.gasto : -d.gasto
        porDia.set(d.dia, t)
      }
    }
    return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)).slice(-dias)
  }, [serie, ecoDe, dias])

  if (error && !datos) return <main><p className="error-inline">{error}</p></main>
  if (!datos) return <Cargando texto="Leyendo campañas de Product Ads…" />
  const fotos = new Map(Object.entries(datos.economia ?? {}).map(([id, f]) => [id, f.foto]))

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
      <nav className="pub-pestanas" role="tablist">
        {PESTANAS.map(([k, t]) => <button key={k} role="tab" aria-selected={pestana === k} className={pestana === k ? 'activa' : ''} onClick={() => ir(k)}>{t}</button>)}
      </nav>
      {error ? <p className="ads-error-suave">No se pudo actualizar: {error}. Se muestra la última lectura.</p> : null}

      {pestana === 'resumen' ? <Resumen datos={datos} plan={plan} serieTotal={serieTotal} fotos={fotos} onIr={ir} /> : null}
      {pestana === 'campanas' ? <Campanas datos={datos} hoy={hoy} plan={plan} serie={serie} fotos={fotos} ecoDe={ecoDe} onProducto={(id) => { setSel(id); ir('productos') }} /> : null}
      {pestana === 'productos' ? <Productos plan={plan} datos={datos} aprendido={aprendido} serie={serie} fotos={fotos} sel={sel} onSel={setSel} /> : null}
      {pestana === 'lm' ? <LearningMachine plan={plan} aprendido={aprendido} fotos={fotos} /> : null}
    </main>
  )
}

// EL CLIC DE LA CUENTA, SEMANA A SEMANA (4-oct-2026). La caída de septiembre no
// fue de impresiones sino de clic: esto la deja a la vista, con lo que el
// learning machine aprendió de cada "revisar anuncio" que recomendó.
function ClicCuenta({ plan }) {
  const semanas = (plan?.marcador ?? []).filter((s) => s.impresiones > 0).slice(-10)
  if (!semanas.length) return null
  const max = Math.max(...semanas.map((s) => Math.max(s.ctr ?? 0, s.ctrMezclaConstante ?? 0)), 0.01)
  const ev = plan?.evaluacion?.clic
  return (
    <section className="pub-caja">
      <h4>El clic de la cuenta</h4>
      <p className="pub-texto">CTR de todos tus anuncios por semana{plan?.clicCuenta?.ctr != null ? ` · lo normal de tu historia: ${pctClic(plan.clicCuenta.ctr)}` : ''}. La barra es el CTR bruto; el punto, el mismo CTR <b>a mezcla constante</b> (solo productos que estuvieron las dos semanas). Si la barra cae y el punto no, fue porque salieron productos de clic alto, no porque empeoraran los anuncios.</p>
      <div className="pub-clic-semanas">
        {semanas.map((s) => (
          <div key={s.semana} title={`Semana del ${s.semana}: ${s.impresiones.toLocaleString('es-CL')} impresiones, ${s.clicks} clics, CTR ${pctClic(s.ctr)}${s.ctrMezclaConstante != null ? ` · a mezcla constante ${pctClic(s.ctrMezclaConstante)}` : ''}, ${s.ventasAds} ventas por anuncio${s.salieron?.length ? `\nSalieron: ${s.salieron.join(', ')}` : ''}${s.entraron?.length ? `\nEntraron: ${s.entraron.join(', ')}` : ''}`}>
            <span className="pub-clic-barra">
              <i style={{ height: `${Math.max(4, Math.round((100 * (s.ctr ?? 0)) / max))}%` }} />
              {s.ctrMezclaConstante != null ? <em style={{ bottom: `${Math.min(100, Math.round((100 * s.ctrMezclaConstante) / max))}%` }} aria-hidden="true" /> : null}
            </span>
            <b>{pctClic(s.ctr)}</b>
            {s.ctrMezclaConstante != null ? <small className="pub-clic-mc">{pctClic(s.ctrMezclaConstante)}</small> : null}
            <small>{s.semana.slice(8, 10)}/{s.semana.slice(5, 7)}</small>
            {s.salieron?.length ? <small className="pub-clic-sale">−{s.salieron.join(', ')}</small> : null}
          </div>
        ))}
      </div>
      <p className="pub-ley">{ev?.evaluadas ? `"Revisar anuncio" recomendado ${ev.evaluadas} veces: el clic se recuperó en ${ev.recuperadas}.` : '"Revisar anuncio" se evalúa 7 días después: ¿el clic se recuperó al menos 30%?'}</p>
    </section>
  )
}

// LA DEMANDA DE ML CON TUS PROPIOS ANUNCIOS (8-oct-2026): impresiones por día de
// cada nicho, semana a semana, y si esa semana se puede leer como demanda o la
// limitó la campaña. Con meses, el contraste dice cuánto confiar en Google.
const LECTURA = {
  limpia: { c: 'pub-dp-limpia', t: 'se lee como demanda' },
  limitada: { c: 'pub-dp-limitada', t: 'limitada por el presupuesto: no es demanda' },
  'cambio-config': { c: 'pub-dp-limitada', t: 'cambió el presupuesto o el ROAS en la semana' },
  'sin-dato-campana': { c: 'pub-dp-sindato', t: 'sin dato de la campaña (antes del 8-oct): se lee con cuidado' },
  'poca-muestra': { c: 'pub-dp-sindato', t: 'menos de 3.000 impresiones' },
}
const CONTRASTE = {
  'pocos-meses': (x) => `contraste con Google: faltan ${x.faltan} mes(es) de datos`,
  'google-sirve': (x) => `Google anticipa bien tus impresiones aquí (orden ${String(x.spearman).replace('.', ',')})`,
  'google-a-medias': (x) => `Google anticipa a medias (orden ${String(x.spearman).replace('.', ',')})`,
  'google-no-sirve': (x) => `Google NO anticipa tus impresiones aquí (orden ${String(x.spearman).replace('.', ',')}): manda tu dato`,
  'sin-dato': () => 'contraste con Google sin datos',
}
function DemandaPropia() {
  const [d, setD] = useState(null)
  useEffect(() => { api.demandaPropia().then(setD).catch(() => setD({ nichos: [] })) }, [])
  if (!d?.nichos?.length) return null
  return (
    <section className="pub-caja">
      <h4>Demanda de ML medida con tus anuncios <em className="pub-accion neutro">en sombra</em></h4>
      <p className="pub-texto">Impresiones por día de cada nicho, semana a semana: cuánta gente buscó ese producto en ML y se le mostró tu anuncio. Las semanas en que la campaña gastó su presupuesto no cuentan como demanda (las impresiones las limitó la campaña, no la gente). {d.configCampanasDesde ? `La configuración de las campañas se registra desde el ${d.configCampanasDesde}.` : 'La configuración de las campañas se empieza a registrar hoy.'}</p>
      <div className="pub-dp">
        {d.nichos.map((n) => {
          const max = Math.max(1, ...n.semanas.map((s) => s.impresionesDia))
          return (
            <div key={n.nichoId} className="pub-dp-nicho">
              <strong>{n.keyword}</strong>
              <small>{n.productos} producto(s){n.impresionesDiaLimpias ? ` · ${n.impresionesDiaLimpias.toLocaleString('es-CL')} impresiones/día en semanas limpias` : ''}</small>
              <span className="pub-dp-barras">
                {n.semanas.map((s) => (
                  <i key={s.semana} className={LECTURA[s.lectura]?.c} style={{ height: `${Math.max(6, Math.round((100 * s.impresionesDia) / max))}%` }}
                    title={`Semana del ${s.semana}: ${s.impresionesDia.toLocaleString('es-CL')} impresiones/día, CTR ${s.ctr ?? '—'}%, CPC ${s.cpc != null ? fmtPrecio(s.cpc) : '—'} · ${LECTURA[s.lectura]?.t ?? s.lectura}`} />
                ))}
              </span>
              <small className="pub-dp-google">{CONTRASTE[n.contrasteGoogle?.estado]?.(n.contrasteGoogle) ?? ''}</small>
            </div>
          )
        })}
      </div>
      <p className="pub-ley"><i className="pub-dp-limpia" /> se lee como demanda · <i className="pub-dp-limitada" /> limitada por la campaña · <i className="pub-dp-sindato" /> sin dato de la campaña</p>
    </section>
  )
}

// TUS PRODUCTOS EN EL RANKING DE MÁS VENDIDOS DE ML (8-oct-2026): el puesto de
// cada día en su categoría. Subir en el ranking es la prueba más directa de que
// lo que se hace (precio, publicidad, fotos) funciona.
function RankingPropios() {
  const [d, setD] = useState(null)
  useEffect(() => { api.rankingPropios().then(setD).catch(() => setD({ productos: [] })) }, [])
  const ps = (d?.productos ?? []).filter((p) => p.ranking)
  if (!ps.length) return null
  const TXT = { sube: 'subiendo', baja: 'bajando', estable: 'estable', nuevo: 'recién entró', fuera: 'fuera del top 20' }
  return (
    <section className="pub-caja">
      <h4>Tus productos en el ranking de más vendidos</h4>
      <p className="pub-texto">El puesto de cada día en el top 20 oficial de su categoría (últimas 3 semanas). Arriba es mejor; sin barra, ese día no estuvo en el top 20.</p>
      <div className="pub-rk">
        {ps.map((p) => (
          <div key={p.itemId} className="pub-rk-prod">
            {p.imagen ? <img src={p.imagen} alt="" width="36" height="36" /> : null}
            <span className="pub-rk-txt">
              <strong>{nombreCorto(p.titulo ?? p.itemId)}</strong>
              <small>{p.ranking.puestoActual ? `#${p.ranking.puestoActual} hoy` : p.ranking.ultimoVisto ? `último visto #${p.ranking.ultimoVisto.mejor} el ${p.ranking.ultimoVisto.dia}` : 'no está en el top 20'} · {TXT[p.ranking.tendencia?.estado] ?? '—'}{p.ranking.categoriaCapturada === false ? ' · su categoría todavía no se captura' : ''}</small>
            </span>
            <span className="pub-rk-serie" aria-hidden="true">
              {(p.ranking.serie ?? []).map((x) => <i key={x.dia} title={`${x.dia}: ${x.puesto ? `#${x.puesto}` : 'fuera del top 20'}`} style={{ height: x.puesto ? `${Math.max(8, Math.round(((21 - x.puesto) / 20) * 100))}%` : '0%' }} />)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
