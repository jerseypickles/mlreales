import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, CircleDashed, Pause, Clock, Flame, PackageX, RefreshCw, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react'
import { api } from '../api.js'
import { Cargando, Miniatura } from './ui.jsx'
import { fmtFecha, fmtNum, fmtPrecio } from '../lib/formato.js'

// DOS FUENTES QUE SE PUEDEN MIRAR POR DENTRO. El importador: "necesito ver qué
// está obteniendo". El resumen dice cuánto se guardó; esto muestra QUÉ se leyó,
// publicación por publicación, tal como llegó de Mercado Libre.

const dentroDe = (fecha) => {
  const h = (new Date(fecha) - Date.now()) / 3600e3
  if (h <= 0) return 'toca ahora'
  return h < 24 ? `en ${Math.round(h)} h` : `en ${Math.round(h / 24)} d`
}
const hace = (fecha) => {
  const h = (Date.now() - new Date(fecha)) / 3600e3
  return h < 1 ? 'hace minutos' : h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} d`
}

// EL STOCK COMO MEDIDOR. ML lo muestra en seis escalones, de "mucho" a "nada":
// +50 · +25 · +10 · +5 · número exacto (1-5) · agotado. Un vendedor que vende se
// mueve hacia la derecha; uno que repone, salta a la izquierda. Dibujarlo así
// hace visible de un vistazo lo que en una tabla eran chips de texto.
const ESCALONES = [
  { id: 'mas50', etiqueta: '+50', ayuda: 'más de 50: no se ve nada' },
  { id: 'mas25', etiqueta: '+25', ayuda: 'entre 26 y 50' },
  { id: 'mas10', etiqueta: '+10', ayuda: 'entre 11 y 25' },
  { id: 'mas5', etiqueta: '+5', ayuda: 'entre 6 y 10' },
  { id: 'exacto', etiqueta: '1-5', ayuda: 'número exacto: cada baja es una venta contada' },
  { id: 'agotado', etiqueta: '0', ayuda: 'agotado' },
]
const escalonDe = (l) => {
  if (!l || l.stock == null) return -1
  if (l.topado) return l.stock >= 51 ? 0 : l.stock >= 26 ? 1 : l.stock >= 11 ? 2 : 3
  return l.stock === 0 ? 5 : 4
}

function Medidor({ ahora, antes, compacto = false }) {
  const a = escalonDe(ahora), p = escalonDe(antes)
  if (a === -1) return <span className={`mg mg-vacio${compacto ? ' mg-compacto' : ''}`}>{ESCALONES.map((e) => <i key={e.id} />)}<em>sin leer</em></span>
  return (
    <span className={`mg${compacto ? ' mg-compacto' : ''}`} title={`${ESCALONES[a].ayuda}${p !== -1 && p !== a ? ` · antes: ${ESCALONES[p].etiqueta}` : ''}`}>
      {ESCALONES.map((e, i) => <i key={e.id} className={`${i === a ? `mg-aqui mg-${e.id}` : ''}${i === p && p !== a ? ' mg-antes' : ''}`} />)}
      <em className={`mg-${ESCALONES[a].id}`}>{a === 4 ? `${ahora.stock} ${ahora.stock === 1 ? 'exacta' : 'exactas'}` : a === 5 ? 'agotado' : ESCALONES[a].etiqueta}</em>
    </span>
  )
}

// Se pregunta decenas de veces por publicación (filtros, orden, barras, tarjetas):
// se calcula una vez por objeto y se guarda.
const cacheUltimas = new WeakMap()
const ultimas = (f) => {
  let u = cacheUltimas.get(f)
  if (!u) {
    // SOLO EL STOCK QUE VE EL COMPRADOR. Cuando la ficha no muestra el texto
    // "(N disponibles)" se guarda igual el número de la telemetría, pero ese es
    // el TOPE DE COMPRA por pedido, no el stock: pintarlo como "1 exacta" hacía
    // creer que a un vendedor le queda una unidad cuando solo limita la compra.
    const buenas = (f.serie ?? []).filter((l) => l.ok && l.stock != null && l.fuente !== 'telemetria')
    u = { ahora: buenas.at(-1) ?? null, antes: buenas.at(-2) ?? null, cuantas: buenas.length,
      topeDeCompra: (f.serie ?? []).filter((l) => l.ok && l.fuente === 'telemetria').length }
    u.escalon = escalonDe(u.ahora)
    cacheUltimas.set(f, u)
  }
  return u
}
const dejaVer = (f) => { const e = ultimas(f).escalon; return e >= 1 && e <= 4 }

// Un vendedor: foto, medidor grande, y lo que se sabe de sus ventas.
const TarjetaVendedor = memo(function TarjetaVendedor({ f }) {
  const { ahora, antes, cuantas } = ultimas(f)
  const vendio = f.unidadesPiso > 0
  // vendió y repuso: volvió a meter plata en este producto. La señal más limpia que hay.
  const fuerte = f.fuerza === 'ciclo' || f.fuerza === 'repone'
  // 'probable' = una sola de las dos lecturas dijo de quién era el stock, y era
  // el vendedor que seguimos. Se muestra, pero se dice que falta confirmarlo.
  const porConfirmar = f.atribucion === 'probable'
  return (
    <article className={`sv${vendio ? ' sv-vendio' : ''}${fuerte && !porConfirmar ? ' sv-fuerte' : ''}${f.activo === false ? ' sv-fuera' : ''}`}>
      <a className="sv-foto" href={f.url} target="_blank" rel="noreferrer" aria-label={`Abrir la publicación de ${f.vendedor ?? 'este vendedor'} en Mercado Libre`}>
        {f.imagen ? <Miniatura src={f.imagen} lado={76} /> : <PackageX size={22} aria-hidden="true" />}
      </a>
      <div className="sv-cuerpo">
        <strong className="sv-nombre">{f.esPropio ? 'Tu publicación' : (f.vendedor ?? 'vendedor')}{f.esFull ? <span className="sv-full">Full</span> : null}</strong>
        <span className="sv-titulo">{f.titulo}</span>
        <Medidor ahora={ahora} antes={antes} />
        {!f.esPropio && f.esFull && !f.esCatalogo ? <p className="sv-medible" title="Full: el número es inventario real en la bodega de Mercado Libre, así que se mueve con cada venta."><Flame size={13} aria-hidden="true" />stock real en bodega de ML</p> : null}
        {f.esCatalogo ? <p className="sv-catalogo" title="La ficha de catálogo muestra al ganador de la caja de compra, que rota entre vendedores. Solo se comparan lecturas del mismo vendedor.">
          <Users size={13} aria-hidden="true" />ficha de catálogo{f.cambiosDeVendedor ? <b>· cambió de vendedor {f.cambiosDeVendedor} {f.cambiosDeVendedor === 1 ? 'vez' : 'veces'}</b>
            : f.atribucion === 'confirmada' ? <>· vendedor confirmado en las dos lecturas</>
            : f.atribucion === 'probable' ? <>· vendedor confirmado en una de las dos lecturas</>
              : f.sinAtribuir ? <>· esperando identificar al vendedor</> : ': el stock puede ser de otro vendedor'}</p> : null}
        {fuerte ? <p className={`sv-fuerza${porConfirmar ? ' sv-fuerza-tibia' : ''}`} title={porConfirmar ? 'Solo una de las dos lecturas identificó al vendedor, y coincide con el que seguimos. La próxima lectura lo confirma o lo descarta.' : f.fuerza === 'ciclo' ? 'Su stock bajó y después subió: vendió y volvió a comprar.' : 'Su stock subió sin que se viera la baja: la venta ocurrió dentro de un rango.'}>
          <Flame size={14} aria-hidden="true" /><b>{f.fuerza === 'ciclo' ? 'Fuerte: vendió y repuso' : 'Repone stock'}{porConfirmar ? ' (por confirmar)' : ''}</b>
          <span>metió al menos {fmtNum(f.unidadesRepuestasPiso)} u{f.esFull ? ' a Full' : ''}{f.reposiciones > 1 ? ` en ${f.reposiciones} reposiciones` : ''}{f.ultimaReposicionEl ? ` · ${hace(f.ultimaReposicionEl)}` : ''}</span></p> : null}
        <div className="sv-pie">
          {vendio ? <span className="sv-venta"><TrendingDown size={14} aria-hidden="true" />vendió al menos <b>{fmtNum(f.unidadesPiso)}</b> en {f.dias} d</span>
            : cuantas >= 2 ? <span className="sv-quieto">sin baja visible en {f.dias} d</span>
              : cuantas === 1 ? <span className="sv-quieto">1ª lectura · falta la 2ª para saber si vende</span>
                : ultimas(f).topeDeCompra ? <span className="sv-quieto">su ficha no muestra el stock</span> : <span className="sv-quieto">todavía sin leer</span>}
          {f.ajustes ? <span className="apr-chip apr-chip-mini" title="Subidas de 1-2 unidades: devoluciones u órdenes anuladas, no reposición">{f.ajustes} {f.ajustes === 1 ? 'devolución' : 'devoluciones'}</span> : null}
          {f.activo === false ? <span className="apr-chip apr-chip-aviso apr-chip-mini">{f.motivoBaja}</span> : <span className="sv-cuando"><Clock size={12} aria-hidden="true" />{dentroDe(f.proximaLecturaEl)}</span>}
        </div>
      </div>
    </article>
  )
})

// Cuántos de los seguidos caen en cada escalón: qué tanto del mercado se deja ver.
function Visibilidad({ publicaciones, alto = 12 }) {
  const cuenta = [0, 0, 0, 0, 0, 0]
  let sinLeer = 0
  for (const f of publicaciones) { const e = ultimas(f).escalon; if (e === -1) sinLeer++; else cuenta[e]++ }
  const total = publicaciones.length || 1
  return (
    <span className="vis" style={{ height: alto }} role="img" aria-label={`De ${total} publicaciones: ${cuenta[4]} con número exacto, ${cuenta[3] + cuenta[2] + cuenta[1]} en rangos visibles, ${cuenta[0]} en +50 y ${sinLeer} sin leer`}>
      {[4, 5, 3, 2, 1, 0].map((e) => cuenta[e] ? <i key={e} className={`mg-${ESCALONES[e].id}`} style={{ width: `${(cuenta[e] / total) * 100}%` }} title={`${cuenta[e]} en ${ESCALONES[e].etiqueta}`} /> : null)}
      {sinLeer ? <i className="vis-sinleer" style={{ width: `${(sinLeer / total) * 100}%` }} title={`${sinLeer} sin leer todavía`} /> : null}
    </span>
  )
}

// LA PREGUNTA ES DEL NICHO, NO DEL PRODUCTO. El importador, 19-sep: "lo que quiero
// saber es si el nicho mueve". Las publicaciones son sensores: pocas y bien
// leídas. Cada nicho responde una de tres cosas, y eso es lo que se ve primero.
const VEREDICTOS = {
  mueve: { nombre: 'Se mueve', plural: 'Se mueven', Icono: Activity, ayuda: 'al menos un sensor bajó su stock o repuso' },
  quieto: { nombre: 'Quieto', plural: 'Quietos', Icono: Pause, ayuda: 'dos sensores con tres días de lecturas y ninguna baja' },
  'sin-datos': { nombre: 'Midiendo', plural: 'Midiendo', Icono: CircleDashed, ayuda: 'todavía faltan lecturas para poder decir algo' },
}
const cacheNicho = new WeakMap()
const lecturaDelNicho = (n) => {
  let l = cacheNicho.get(n)
  if (!l) {
    const sensores = n.publicaciones.filter((f) => f.activo !== false)
    l = { mov: n.movimiento ?? (n.vendiendo || n.fuertes ? 'mueve' : 'sin-datos'), sensores,
      conDos: sensores.filter((f) => ultimas(f).cuantas >= 2).length,
      unidades: n.publicaciones.reduce((a, f) => a + (f.unidadesPiso ?? 0), 0),
      hasta: n.estimado?.hasta ?? null,
      dias: Math.max(0, ...n.publicaciones.map((f) => f.dias ?? 0)),
      vendieron: n.publicaciones.filter((f) => f.unidadesPiso > 0),
      fuertes: n.publicaciones.filter((f) => (f.fuerza === 'ciclo' || f.fuerza === 'repone') && f.atribucion !== 'probable'),
      // cuánto se puede confiar en los sensores: exacto ve todo, rango ve poco, +50 nada
      calidad: { exacto: sensores.filter((f) => ultimas(f).escalon === 4).length, rango: sensores.filter((f) => [1, 2, 3].includes(ultimas(f).escalon)).length, ciego: sensores.filter((f) => ultimas(f).escalon === 0).length, sinLeer: sensores.filter((f) => ultimas(f).escalon === -1).length },
      fueraDeLista: n.publicaciones.length - sensores.length }
    cacheNicho.set(n, l)
  }
  return l
}
const FILTROS_STOCK = [['todos', 'Todos'], ['mueve', 'Se mueven'], ['quieto', 'Quietos'], ['sin-datos', 'Midiendo']]
const fmtDias = (d) => `${String(Math.round(d * 10) / 10).replace('.', ',')} ${d === 1 ? 'día' : 'días'}`

// LO GRANDE ES LO QUE SE SABE. El importador, 22-sep: "yo no puedo pensar que lo que
// me muestra es el 100% de las ventas". Antes la tarjeta decía "≥3 unidades" en
// grande y nadie lee el "≥": se leía "vendió 3", y "≥0 unidades" junto a "1 vendió y
// repuso" era una contradicción a la vista. Ahora el orden es: ¿se mueve? (cierto),
// ¿hay alguien fuerte? (cierto), ¿cuánto? (un piso, dicho como piso, y una
// estimación solo cuando la calibración con lo propio la respalda).
const ESCALON_NOMBRE = { mas50: '+50', mas25: '+25', mas10: '+10', mas5: '+5', exacto: 'exacto' }

function Cuanto({ l, n }) {
  if (!l.vendieron.length) return null
  const semana = n.unidadesPisoSemana
  return (
    <span className="nv-cuanto">
      <span className="nv-cuanto-fila"><small>visto</small><b>{fmtNum(l.unidades)}</b><small>u en {fmtDias(l.dias)}{semana ? ` · ≥${fmtNum(semana)}/sem` : ''}</small></span>
      {l.hasta != null && l.hasta > l.unidades
        ? <span className="nv-cuanto-fila nv-cuanto-est"><small>estimado</small><b>{fmtNum(l.unidades)}–{fmtNum(l.hasta)}</b><small>según lo que el método ve en tus productos</small></span>
        : <span className="nv-cuanto-fila nv-cuanto-est"><small>real</small><em>más que eso</em><small>{l.vendieron.some((f) => f.escalonActual && f.escalonActual !== 'exacto') ? 'hay ventas escondidas en el rango del stock' : 'solo se cuenta lo que baja a la vista'}</small></span>}
    </span>
  )
}

// Calidad de los sensores: cuánto pueden ver. Exacto = cada venta se cuenta;
// rango = la venta queda escondida hasta cruzar el escalón; +50 = no se ve nada.
function Calidad({ c, total }) {
  if (!total) return null
  const partes = [['exacto', c.exacto, 'ven cada venta'], ['rango', c.rango, 'ven solo los cruces de escalón'], ['ciego', c.ciego, 'en +50: no ven nada'], ['sinleer', c.sinLeer, 'sin leer']].filter(([, n]) => n)
  return <span className="nv-calidad" title={partes.map(([, n, t]) => `${n} ${t}`).join(' · ')}>{partes.map(([k, n, t]) => <i key={k} className={`nv-cal-${k}`} style={{ flex: n }}><b>{n}</b> {t}</i>)}</span>
}

const TarjetaNicho = memo(function TarjetaNicho({ n, abierto, alAlternar }) {
  const l = lecturaDelNicho(n)
  const v = VEREDICTOS[l.mov]
  const total = l.sensores.length || 1
  const f0 = l.fuertes[0]
  return (
    <div className={`sn nv-${l.mov}${abierto ? ' sn-abierto' : ''}${l.fuertes.length ? ' sn-fuerte' : ''}`}>
      <button type="button" className="sn-cab" aria-expanded={abierto} onClick={() => alAlternar(n.keyword)}>
        <span className="sn-titulo"><strong>{n.keyword}</strong>
          <span className={`nv-sello nv-sello-${l.mov}`} title={v.ayuda}><v.Icono size={14} aria-hidden="true" />{v.nombre}</span></span>
        {l.fuertes.length ? <span className="nv-fuerte-titular"><Flame size={15} aria-hidden="true" />
            <span><b>{l.fuertes.length === 1 ? (f0.vendedor ?? 'un vendedor') : `${l.fuertes.length} vendedores`}</b> {l.fuertes.length === 1 ? 'vendió y repuso' : 'vendieron y repusieron'}{f0.esFull ? ' en Full' : ''} · metió ≥{fmtNum(n.unidadesRepuestasPiso)} u</span></span>
          : n.probables ? <span className="nv-fuerte-titular nv-tibio" title="Movimiento del mismo vendedor, pero solo una de las dos lecturas lo identificó"><Flame size={15} aria-hidden="true" /><span>{n.probables} por confirmar de quién es el stock</span></span> : null}
        {l.mov === 'mueve' ? <Cuanto l={l} n={n} />
          : l.mov === 'quieto' ? <span className="nv-dato"><span><b>0</b> bajas en {fmtDias(l.dias)}</span><small>{l.conDos} sensores leídos más de una vez y ninguno se movió{l.calidad.ciego ? ` · ${l.calidad.ciego} en +50 no verían nada igual` : ''}</small></span>
            : <span className="nv-dato nv-dato-espera"><span className="nv-avance" role="img" aria-label={`${l.conDos} de ${total} sensores con segunda lectura`}><i style={{ width: `${(l.conDos / total) * 100}%` }} /></span>
              <small>{l.conDos} de {total} sensores con 2ª lectura{l.dias ? ` · ${fmtDias(l.dias)} mirando` : ''}</small></span>}
        <span className="sn-fotos nv-sensores">{l.sensores.map((f) => { const e = ultimas(f).escalon; return (
          <span key={f.sku} className={`sn-mini nv-cal-borde-${e === 4 ? 'exacto' : e === 0 ? 'ciego' : e === -1 ? 'sinleer' : 'rango'}${f.fuerza === 'ciclo' || f.fuerza === 'repone' ? ' sn-mini-fuerte' : ''}${f.unidadesPiso > 0 ? ' sn-mini-vendio' : ''}`} title={`${f.vendedor ?? ''} · ${e === 4 ? 'número exacto: cada venta se cuenta' : e === 0 ? '+50: no se ve nada' : e === -1 ? 'sin leer' : 'rango: la venta queda escondida hasta cruzar el escalón'}`}>{f.imagen ? <Miniatura src={f.imagen} lado={56} /> : <span className="mv-sinfoto" />}<Medidor ahora={ultimas(f).ahora} antes={ultimas(f).antes} compacto /></span>) })}</span>
        <Calidad c={l.calidad} total={l.sensores.length} />
        {l.fueraDeLista ? <small className="nv-fuera">+{l.fueraDeLista} que ya no se {l.fueraDeLista === 1 ? 'lee' : 'leen'} (su historia sigue contando)</small> : null}
      </button>
      {abierto ? <div className="sv-grilla sn-detalle">{[...n.publicaciones].sort((a, b) => Number(a.activo === false) - Number(b.activo === false)).map((f) => <TarjetaVendedor key={f.sku} f={f} />)}</div> : null}
    </div>
  )
})

// LA REGLA DE LECTURA, SIEMPRE A LA VISTA. Lo que ves es un piso, no la venta.
// Cuánto falta se mide en tus propios productos, donde la venta real se conoce.
function Regla({ cal }) {
  const esc = cal?.escalones ?? {}
  const conFactor = Object.entries(esc).filter(([, e]) => e.factor)
  return (
    <aside className="nv-regla" role="note">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>Lo que ves es un piso, no la venta.</strong> Mercado Libre muestra el stock por escalones: con número exacto cada venta se cuenta; en un rango (+5, +10, +25) la venta queda escondida hasta cruzar el escalón, y al cruzar se cuenta una sola.
        {cal?.pctVisto != null
          ? <> Hoy, en tus productos, el método ve el <b>{cal.pctVisto}%</b> de las ventas reales ({fmtNum(cal.unidadesVistas)} de {fmtNum(cal.unidadesReales)} unidades en {cal.productos} publicaciones tuyas).{conFactor.length ? <> Por escalón: {conFactor.map(([k, e]) => `${ESCALON_NOMBRE[k]} ve el ${e.pctVisto}%`).join(' · ')}. Con eso se calcula la <b>venta estimada</b> de cada nicho.</> : <> Todavía no hay venta real suficiente por escalón (mínimo {cal.minimoRealPorEscalon} u) para estimar: se muestra solo el piso.</>}</>
          : <> La calibración con tus productos necesita unos días de lecturas.</>}
      </div>
    </aside>
  )
}

export function StockCompetidores() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  // El refresco de cada minuto casi siempre trae lo mismo (las lecturas son cada
  // 2 h): si nada cambió no se toca el estado y no se re-dibuja nada.
  const huella = useRef('')
  const cargar = useCallback(() => api.seguimiento().then((r) => {
    const h = JSON.stringify(r)
    if (h !== huella.current) { huella.current = h; setD(r) }
    setError(null)
  }).catch((e) => setError(e.message)), [])
  const alAlternar = useCallback((k) => setAbierto((a) => (a === k ? null : k)), [])
  const ordenados = useMemo(() => {
    // primero lo que se mueve (y dentro, lo más fuerte); después lo medido y
    // quieto; al final lo que todavía se está midiendo, de más a menos avanzado
    const rango = { mueve: 2, quieto: 1, 'sin-datos': 0 }
    const valor = (n) => { const l = lecturaDelNicho(n); return rango[l.mov] * 1e9 + (n.fuertes ?? 0) * 1e7 + l.unidades * 1e4 + l.conDos * 100 + l.sensores.filter(dejaVer).length }
    return (d?.nichos ?? []).map((n) => [valor(n), n]).sort((a, b) => b[0] - a[0]).map(([, n]) => n)
  }, [d])
  const conteos = useMemo(() => Object.fromEntries(FILTROS_STOCK.map(([id]) => [id, (d?.nichos ?? []).filter((n) => id === 'todos' || lecturaDelNicho(n).mov === id).length])), [d])
  useEffect(() => {
    cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 60_000)
    return () => clearInterval(t)
  }, [cargar])
  if (error && !d) return <p className="error-bloque" role="alert">No se pudo leer el seguimiento: {error}</p>
  if (!d) return <Cargando texto="Leyendo el seguimiento de stock…" />
  const pct = Math.min(100, (d.gasto.mesUsd / d.topeUsdMes) * 100)
  const cal = d.calibracion
  // lo que se está leyendo hoy: los que salieron de la lista no cuentan acá
  const todas = d.nichos.flatMap((n) => n.publicaciones).filter((f) => f.activo !== false)
  const visibles = todas.filter(dejaVer).length
  const nichos = ordenados.filter((n) => filtro === 'todos' || lecturaDelNicho(n).mov === filtro).filter((n) => !busca.trim() || n.keyword.includes(busca.trim().toLowerCase()))
  return (
    <>
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>¿Se mueve el nicho?</h3>
          <p>Cada nicho se mide con pocos sensores —hasta 3 publicaciones, las que mejor dejan ver su stock— leídos seguido. Basta que uno baje para saber que el nicho vende; para decir “quieto” hacen falta dos sensores mirados tres días sin una sola baja.</p></div>
        <Regla cal={cal} />
        <div className="nv-resumen" role="group" aria-label="Filtrar nichos por veredicto">
          {FILTROS_STOCK.filter(([id]) => id !== 'todos').map(([id]) => { const v = VEREDICTOS[id]; return (
            <button key={id} type="button" className={`nv-tesela nv-tesela-${id}${filtro === id ? ' activo' : ''}`} aria-pressed={filtro === id} onClick={() => setFiltro(filtro === id ? 'todos' : id)} title={v.ayuda}>
              <span className="nv-tesela-cab"><v.Icono size={16} aria-hidden="true" />{v.plural}</span>
              <b>{fmtNum(conteos[id])}</b><small>de {fmtNum(conteos.todos)} nichos · {v.ayuda}</small></button>) })}
        </div>
        <span className="nv-barra" role="img" aria-label={`${conteos.mueve} nichos se mueven, ${conteos.quieto} quietos y ${conteos['sin-datos']} midiéndose`}>
          {['mueve', 'quieto', 'sin-datos'].map((id) => conteos[id] ? <i key={id} className={`nv-barra-${id}`} style={{ width: `${(conteos[id] / (conteos.todos || 1)) * 100}%` }} /> : null)}</span>
        <div className="apr-controles">
          <label className="apr-buscar"><PackageX size={14} aria-hidden="true" /><span className="apr-solo-lector">Buscar nicho</span>
            <input type="search" placeholder="Buscar nicho…" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
          {filtro !== 'todos' ? <button type="button" className="nv-quitar" onClick={() => setFiltro('todos')}>Ver los {fmtNum(conteos.todos)}</button> : null}
        </div>
        {!nichos.length ? <p className="apr-vacio">Ningún nicho con ese filtro todavía.</p> : <div className="sn-grilla">{nichos.map((n) => <TarjetaNicho key={n.keyword} n={n} abierto={abierto === n.keyword} alAlternar={alAlternar} />)}</div>}
      </section>

      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Cuánto cuesta y cuánto alcanza a ver</h3></div>
        <div className="apr-fuentes apr-fuentes-auto">
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><Wallet size={17} aria-hidden="true" /></span><h3>Gasto del mes</h3></div>
            <p className="apr-cifra">US${d.gasto.mesUsd.toFixed(2)}<small> de US${d.topeUsdMes}</small></p>
            <div className="apr-medidor"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
            <p className="apr-fuente-detalle">{fmtNum(d.gasto.lecturasMes)} lecturas · el tope es fijo</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CheckCircle2 size={17} aria-hidden="true" /></span><h3>Cuánto ve el método</h3></div>
            <p className="apr-cifra">{cal?.pctVisto != null ? `${cal.pctVisto}%` : '—'}<small>{cal?.pctVisto != null ? ' de tus ventas reales' : ''}</small></p>
            <p className="apr-fuente-detalle">{cal ? `En ${cal.productos} publicaciones tuyas vio ${fmtNum(cal.unidadesVistas)} de ${fmtNum(cal.unidadesReales)} unidades` : 'Se mide leyendo tus publicaciones desde afuera. Necesita unos días.'}</p></article>
          <article className="apr-fuente apr-fuente-fuerte"><div className="apr-cabeza"><span className="apr-icono"><Flame size={17} aria-hidden="true" /></span><h3>Venden y reponen</h3></div>
            <p className="apr-cifra">{fmtNum(d.nichos.reduce((a, n) => a + (n.fuertes ?? 0), 0))}<small> vendedores fuertes</small></p>
            <p className="apr-fuente-detalle">{d.nichos.some((n) => n.fuertes) ? `Repusieron al menos ${fmtNum(d.nichos.reduce((a, n) => a + (n.unidadesRepuestasPiso ?? 0), 0))} unidades en ${fmtNum(d.nichos.filter((n) => n.fuertes).length)} nichos.` : 'Stock que baja y después sube: nadie repone lo que no se vende. Aparece desde la 3ª lectura.'}
              {d.catalogo?.seguidos ? <><br /><span className="apr-ojo">{fmtNum(d.catalogo.seguidos)} de los seguidos son fichas de catálogo: ahí ML muestra al ganador de la caja de compra, así que solo se comparan lecturas del mismo vendedor{d.catalogo.cambiosDeVendedor ? ` (${fmtNum(d.catalogo.cambiosDeVendedor)} cambios descartados)` : ''}.</span></> : null}</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><PackageX size={17} aria-hidden="true" /></span><h3>Cuánto se deja ver</h3></div>
            <p className="apr-cifra">{fmtNum(visibles)}<small> de {fmtNum(todas.length)} sensores</small></p>
            <Visibilidad publicaciones={todas} />
            <p className="apr-fuente-detalle">verde = número exacto · azul = rango visible · gris = “+50” · rayado = sin leer
              {d.calidad ? <><br /><span className="apr-ojo"><b>{fmtNum(d.calidad.medibles)}</b> son Full con publicación propia: los únicos cuyo número es bodega real y se puede atribuir. {fmtNum(d.calidad.catalogo)} son fichas de catálogo y {fmtNum(d.calidad.sinFull)} no tienen Full.</span></> : null}</p></article>
        </div>
      </section>

      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Tus publicaciones, vistas como las ve un competidor</h3><p>Sirven de regla: acá la venta real se conoce, así que dicen cuánto del total alcanza a ver este método.</p></div>
        <div className="sv-grilla">{d.propios.map((f) => <TarjetaVendedor key={f.sku} f={f} />)}</div>
      </section>

      <details className="apr-plegable">
        <summary><PackageX size={14} aria-hidden="true" />Cómo leer el medidor de stock</summary>
        <p className="apr-fuente-detalle">Mercado Libre no muestra el número: muestra un escalón. Cuando un vendedor vende, su marcador se corre hacia la derecha; cuando repone, salta a la izquierda. De “+50” no se ve nada; en “1-5” cada baja es una venta contada. <strong>Bajar y después subir es la señal fuerte:</strong> ese vendedor volvió a meter plata en el producto.</p>
        <div className="mg-leyenda">{ESCALONES.map((e, i) => (
          <div key={e.id} className="mg-leyenda-paso"><span className={`mg-leyenda-barra mg-${e.id}`} /><strong>{e.etiqueta === '0' ? 'agotado' : e.etiqueta}</strong><small>{e.ayuda}</small>{i < 5 ? <i aria-hidden="true">→</i> : null}</div>
        ))}</div>
      </details>

      <details className="apr-plegable apr-tecnico">
        <summary><RefreshCw size={14} aria-hidden="true" />Registro de lo último que se leyó ({fmtNum(d.ultimasLecturas?.length ?? 0)})</summary>
        {!d.ultimasLecturas?.length ? <p className="apr-vacio">Sin lecturas todavía.</p> : <div className="tabla-envoltura apr-tabla apr-tabla-corta"><table>
          <thead><tr><th scope="col">Cuándo</th><th scope="col">De quién</th><th scope="col">Nicho</th><th scope="col">Stock leído</th></tr></thead>
          <tbody>{d.ultimasLecturas.map((l, i) => <tr key={`${l.sku}-${l.fecha}-${i}`}>
            <td title={fmtFecha(l.fecha)}>{hace(l.fecha)}</td>
            <td className="celda-titulo">{l.esPropio ? 'tuya' : (l.vendedor ?? '—')}<small className="st-sub">{l.titulo}</small></td>
            <td>{l.keyword ?? '—'}</td>
            <td>{l.ok ? <Medidor ahora={l} compacto /> : <span className="apr-chip apr-chip-aviso">la ficha no respondió</span>}</td>
          </tr>)}</tbody></table></div>}
      </details>
    </>
  )
}

export function MasVendidosMl() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [abierta, setAbierta] = useState(null)
  useEffect(() => { api.masVendidos().then(setD).catch((e) => setError(e.message)) }, [])
  if (error) return <p className="error-bloque" role="alert">No se pudo leer el ranking: {error}</p>
  if (!d) return <Cargando texto="Leyendo el ranking de más vendidos…" />
  const cats = [...d.categorias].sort((a, b) => (b.nichos?.length ?? 0) - (a.nichos?.length ?? 0))
  const items = cats.flatMap((c) => c.items)
  return (
    <>
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Ranking oficial de más vendidos</h3>
          <p>Los 20 más vendidos de cada categoría, según Mercado Libre y gratis por su API. Se guarda todos los días a las 07:40; con dos días guardados se ve quién entró al top y quién sube.</p></div>
        <div className="apr-fuentes">
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><TrendingUp size={17} aria-hidden="true" /></span><h3>Categorías seguidas</h3></div>
            <p className="apr-cifra">{fmtNum(cats.length)}</p><p className="apr-fuente-detalle">la categoría dominante de cada nicho activo y las de tus productos</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CheckCircle2 size={17} aria-hidden="true" /></span><h3>Productos en los rankings</h3></div>
            <p className="apr-cifra">{fmtNum(items.length)}</p><p className="apr-fuente-detalle">{fmtNum(items.filter((i) => i.titulo).length)} con nombre y foto · {fmtNum(items.filter((i) => i.enNuestroScan).length)} ya estaban en tus scans</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CircleDashed size={17} aria-hidden="true" /></span><h3>Entraron o subieron</h3></div>
            <p className="apr-cifra">{fmtNum(d.entradas?.length ?? 0)}</p><p className="apr-fuente-detalle">{d.entradas?.length ? 'esto es lo que recibe el radar como evidencia' : 'aparece desde el segundo día guardado'}</p></article>
        </div>
      </section>
      {d.entradas?.length ? <section className="apr-seccion"><div className="apr-seccion-cabeza"><h3>Lo que se movió esta semana</h3></div>
        <ul className="apr-lista">{d.entradas.map((e, i) => <li key={i}><strong>#{e.posicion}</strong> {e.nuevo ? 'entró al top 20' : `subió ${e.subio} puestos`}: {e.titulo}{e.nichos?.length ? <small className="st-sub"> categoría de {e.nichos.slice(0, 3).join(', ')}</small> : null}</li>)}</ul></section> : null}
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Por categoría</h3></div>
        {cats.map((c) => (
          <div key={c.categoriaId} className="st-nicho">
            <button type="button" className="st-nicho-cab" aria-expanded={abierta === c.categoriaId} onClick={() => setAbierta(abierta === c.categoriaId ? null : c.categoriaId)}>
              <strong>{c.nichos?.length ? c.nichos.slice(0, 3).join(' · ') : c.categoriaId}</strong>
              <span className="apr-chip">{c.items.length} productos</span>
              <span className="apr-chip">{c.comparadoCon ? `comparado con el ${c.comparadoCon.slice(8)}/${c.comparadoCon.slice(5, 7)}` : `día ${c.diasGuardados} guardado`}</span>
              {c.items.filter((i) => i.nuevo).length ? <span className="apr-chip apr-chip-bien">{c.items.filter((i) => i.nuevo).length} nuevos en el top</span> : null}
            </button>
            {abierta === c.categoriaId ? <ol className="mv-lista st-mv">{c.items.map((i) => (
              <li key={i.id} className="mv-fila"><span className="mv-pos">{i.posicion}</span>
                {i.imagen ? <Miniatura src={i.imagen} lado={40} /> : <span className="mv-sinfoto" aria-hidden="true" />}
                <span className="mv-titulo">{i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.titulo ?? 'ver en Mercado Libre'}</a> : (i.titulo ?? i.id)}{i.precio ? <small>{fmtPrecio(i.precio)}</small> : null}</span>
                <span className="mv-chips">{i.nuevo ? <em className="mv-chip mv-nuevo">entró al top</em> : null}{i.subio >= 2 ? <em className="mv-chip mv-sube">▲ {i.subio}</em> : null}{i.subio <= -2 ? <em className="mv-chip mv-baja">▼ {Math.abs(i.subio)}</em> : null}
                  {i.enNuestroScan ? <em className="mv-chip">en tu scan</em> : null}<em className="mv-chip" title="Días de los guardados en que estuvo en el top 20">{i.diasEnElTop}/{i.diasGuardados} d</em></span></li>))}</ol> : null}
          </div>
        ))}
      </section>
    </>
  )
}
