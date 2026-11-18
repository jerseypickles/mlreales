import { useCallback, useEffect, useState } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { api } from '../api.js'
import { useEstadoGuardado } from '../lib/estadoGuardado.js'
import { IconoExterno, Cargando } from './ui.jsx'
import { EncabezadoPagina, Etiqueta, Pendientes, Cifra, Cifras } from './sistema.jsx'
import { calidadDeEntrada, resumenPendientes } from '../lib/calidadMl.js'
import { MiniSerie, HistogramaPrecios } from './graficos.jsx'
import {
  Tag,
  PiggyBank,
  Percent,
  Eye,
  Package,
  Sparkles,
  PackagePlus,
  Zap,
  BadgePercent,
  ChevronDown,
  ExternalLink,
  Trash2,
  LineChart,
  Users,
  ArrowLeftRight,
  X,
  ArrowDownWideNarrow,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Warehouse,
  ChevronLeft,
  ChevronRight,
  Video,
  ListChecks,
  Barcode,
  Image as IconoFoto,
  Type,
  CircleAlert,
  ScanSearch,
  Megaphone,
} from 'lucide-react'
import { publicacionVigente, inventarioEntrada, coincideFiltro, filtrarEntradas, paginarEntradas, seriePrecioEntrada } from '../lib/catalogoPropios.js'
import { BotonCopiar } from './Listing.jsx'
import { PlanPublicidad, resumenPlan } from './PlanPublicidad.jsx'
import { StockFull, resumenStock } from './StockFull.jsx'
import { PlataVenta, resumenPlata } from './PlataVenta.jsx'
import { QuienVendeLoMismo } from './QuienVendeLoMismo.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'
import { agruparPorFamilia, ordenarEntradas, metricasDe, etiquetaVariantes, nombreVariante } from '../lib/familiasPropias.js'

const FACTOR_VENTAS = 25 // misma heurística del score: ~1 reseña por cada 25 ventas

// estado: 'buena' | 'mala' | 'atenta' | undefined — pinta el tile según el negocio
function Metrica({ etiqueta, children, alerta, estado, Icono }) {
  const clase = ['propio-metrica']
  if (estado) clase.push(`m-${estado}`)
  else if (alerta) clase.push('propio-metrica-alerta')
  return (
    <span className={clase.join(' ')}>
      <span className="propio-metrica-etiqueta">
        {Icono ? <Icono aria-hidden="true" /> : null}
        {etiqueta}
      </span>
      <span className="propio-metrica-valor">{children}</span>
    </span>
  )
}

// Comparador de cartera propia: con 2+ productos en un nicho, tus SKUs son un
// A/B natural. Qué convierte, qué trae tráfico y qué copiarle a cuál.
function CarteraNicho({ c }) {
  const ICONO = { trasplante: ArrowLeftRight, cierre: Percent, exposicion: Eye, 'no-es-precio': Tag }
  // PLEGADA POR DEFECTO. Abierta ocupaba media pantalla ANTES de la grilla y
  // repetía por producto lo que las tarjetas ya muestran: "así abierto solo
  // ruido". Lo que sí vale de un vistazo —cuánto rota la cartera y qué
  // porcentaje de tus ingresos se lleva ML en ese nicho— sube al resumen, que
  // es lo único visible sin abrir.
  const pctMl =
    c.cargosMl30d?.ingresos30d > 0
      ? Math.round((c.cargosMl30d.totalClp / c.cargosMl30d.ingresos30d) * 100)
      : null
  return (
    <details className="cartera">
      <summary className="cartera-head">
        <Users aria-hidden="true" />
        <h3>Tu cartera en “{c.keyword}”</h3>
        <span className="cartera-share">
          {c.ventasDia} u/día
          {c.sharePct != null ? ` · ${c.sharePct}% del nicho` : ''}
          {pctMl != null ? <b className={pctMl > 50 ? 'cartera-ml-alto' : undefined}> · ML se lleva {pctMl}%</b> : null}
          {c.lecciones?.length ? ` · ${c.lecciones.length} hallazgo(s)` : ''}
        </span>
      </summary>
      <div className="cartera-tabla">
        {c.productos.map((p, i) => (
          <div key={p.sku} className={i === 0 ? 'cartera-fila lider' : 'cartera-fila'}>
            <span className="cartera-pos">{i + 1}</span>
            <span className="cartera-tit" title={p.titulo}>{p.titulo}</span>
            <span className="cartera-dato"><b>{p.conversion != null ? `${p.conversion}%` : '—'}</b> conv.</span>
            <span className="cartera-dato">{fmtNum(p.visitas)} visitas</span>
            <span className="cartera-dato">{fmtNum(p.ventas)} ventas</span>
            <span className="cartera-dato">{fmtPrecio(p.precio)}</span>
          </div>
        ))}
      </div>
      {c.cargosMl30d ? (
        <div className="cartera-cargos">
          <span className="cartera-cargos-tit">Lo que ML cobró en este nicho (30d)</span>
          <span>
            comisión <b>{fmtPrecio(c.cargosMl30d.comisionClp)}</b>
          </span>
          <span>
            envío <b>{fmtPrecio(c.cargosMl30d.envioClp)}</b>
          </span>
          {c.cargosMl30d.adsClp ? (
            <span>
              publicidad <b>{fmtPrecio(c.cargosMl30d.adsClp)}</b>
            </span>
          ) : null}
          <span className="cartera-cargos-total">
            total <b>{fmtPrecio(c.cargosMl30d.totalClp)}</b>
            {c.cargosMl30d.ingresos30d > 0
              ? ` · ${Math.round((c.cargosMl30d.totalClp / c.cargosMl30d.ingresos30d) * 100)}% de tus ingresos`
              : ''}
          </span>
        </div>
      ) : null}
      {c.lecciones.map((l, i) => {
        const Icono = ICONO[l.tipo] ?? Sparkles
        return (
          <p key={i} className={`cartera-leccion lec-${l.tipo}`}>
            <Icono aria-hidden="true" />
            <span>{l.texto}</span>
          </p>
        )
      })}
    </details>
  )
}

// Tarjeta de producto (rediseño 8-ago): la altura estaba fuera de control con
// 5 bloques apilados. Ahora manda la jerarquía: identidad + KPIs + la acción de
// Opus 5 siempre visibles; lupa, promoción y surtido viven en secciones
// colapsables (Radix: accesibles y animadas) que se abren cuando decides mirar.
function Seccion({ icono: Icono, titulo, resumen, tono, children, abiertaPorDefecto = false }) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto)
  return (
    <Collapsible.Root open={abierta} onOpenChange={setAbierta} className={`seccion-plegable tono-${tono ?? 'neutro'}`}>
      <Collapsible.Trigger className="seccion-cabeza">
        <Icono aria-hidden="true" className="seccion-icono" />
        <span className="seccion-titulo">{titulo}</span>
        <span className="seccion-resumen">{resumen}</span>
        <ChevronDown aria-hidden="true" className="seccion-chevron" />
      </Collapsible.Trigger>
      <Collapsible.Content className="seccion-cuerpo">
        <div className="seccion-contenido">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

// EL TÍTULO SIN EL PREFIJO QUE TODOS COMPARTEN.
//
// Los títulos de ML son largos y en una cartera repiten la cabeza: "Brochas
// Maquillaje Profesionales Set 8 + Organizador Rosa" y "Brochas Maquillaje
// Profesionales Set 18 Pcs Makeup Cosmetico Gris". Lo que DISTINGUE está al
// final, así que cortar a una línea deja todas las tarjetas diciendo lo mismo,
// y dejarlas a dos líneas desfigura la tarjeta.
//
// Se quita la cabeza común y queda lo que diferencia. El título completo sigue
// en el `title`, para quien lo necesite.
// Prefijo compartido por un GRUPO. Global no sirve: la cartera mezcla brochas,
// lámpara, saca puntos y pistolas, así que el prefijo común de los ocho es
// vacío y no se recortaba nada — el bug que dejó los títulos enteros.
function prefijoDe(listas) {
  if (listas.length < 2) return ''
  const palabras = []
  for (let i = 0; i < listas[0].length; i++) {
    const w = listas[0][i]
    // se corta antes de dejar el título sin nada: al menos dos palabras propias
    if (!listas.every((l) => l.length > i + 2 && l[i].toLowerCase() === w.toLowerCase())) break
    palabras.push(w)
  }
  return palabras.join(' ')
}

// Devuelve, por título, el prefijo que comparte con SUS PARIENTES. Se agrupa por
// las dos primeras palabras: "Brochas Maquillaje" junta a las cinco brochas sin
// arrastrar a la lámpara ni a las pistolas.
export function prefijosPorFamilia(titulos = []) {
  const grupos = new Map()
  for (const t of titulos) {
    if (!t) continue
    const clave = t.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase()
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(t)
  }
  const mapa = new Map()
  for (const [, miembros] of grupos) {
    const pre = prefijoDe(miembros.map((t) => t.trim().split(/\s+/)))
    for (const t of miembros) mapa.set(t, pre)
  }
  return mapa
}

export function tituloCorto(titulo, prefijo) {
  if (!titulo) return ''
  if (!prefijo || !titulo.toLowerCase().startsWith(prefijo.toLowerCase())) return titulo
  return titulo.slice(prefijo.length).replace(/^[\s\-–·+]+/, '') || titulo
}

// LO ÚNICO QUE EXIGE ACCIÓN HOY.
//
// Se construye sobre el stock REAL de la bodega de Full, no sobre el
// `available_quantity` del item — medido el 28-ago, en las Brochas Set 18 el
// item decía 20 y la bodega tenía 9. Y la velocidad se divide por los días que
// el producto estuvo disponible, no por la ventana del reporte.
const TONO_URGENCIA = {
  quebrado: 'mal',
  critico: 'mal',
  reponer: 'aviso',
  holgado: 'bien',
  sin_ventas: null,
}

// SU GAMA DENTRO DEL NICHO (src/services/gama.js). El importador, 21-oct-2026:
// "la manguera que estamos mostrando es diferente a las demás, calidad,
// material… el sistema piensa que todo es igual". El sistema compara por
// búsqueda; acá se ve contra qué publicaciones compite de verdad —las de su
// rango de precio— y se corrige a mano: sacar la que no es comparable, sumar
// la que sí. El auditor elige a sus rivales de esta gama.
const SIN_GAMA = {
  'sin-nicho': 'Cablea un nicho para ver tu gama.',
  'sin-scan': 'El nicho todavía no tiene scan.',
  'sin-precio': 'Falta el precio del producto para ubicar su gama.',
}
const AYUDA_GAMA = {
  sacar: 'No es comparable: sacarla de tu gama',
  agregar: 'Sí es comparable: sumarla a tu gama',
  restaurar: 'Devolverla a donde la ubica el precio',
}

function FichaGama({ x, accion, onAccion, ocupado }) {
  const Icono = accion === 'sacar' ? X : accion === 'agregar' ? Plus : RotateCcw
  return (
    <div className={`gama-item${x.origenGama === 'agregada' ? ' gama-sumada' : ''}`}>
      <a href={x.url} target="_blank" rel="noreferrer" title={x.titulo}>
        <img src={x.imagen} alt="" loading="lazy" width="52" height="52" />
      </a>
      <span className="surtido-datos">
        <strong>{fmtPrecio(x.precio)}</strong>
        <span className="surtido-prueba">
          {x.numReviews ? `${fmtNum(x.numReviews)} reseñas` : x.vendidos ? `+${fmtNum(x.vendidos)} vendidos` : 'sin reseñas'}
          {x.posicion ? ` · #${x.posicion}` : ''}
        </span>
        <span className="gama-titulo">{x.titulo}</span>
      </span>
      <button type="button" className="gama-accion" title={AYUDA_GAMA[accion]} aria-label={AYUDA_GAMA[accion]} disabled={ocupado} onClick={() => onAccion(x.sku)}>
        <Icono aria-hidden="true" />
      </button>
    </div>
  )
}

function DetalleGama({ propioId }) {
  const [v, setV] = useState(null)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [rango, setRango] = useState({ desde: '', hasta: '' })
  const tomar = (x) => {
    setV(x)
    setRango({ desde: x.rango?.desde ?? '', hasta: x.rango?.hasta ?? '' })
  }
  useEffect(() => {
    let vivo = true
    api.gamaPropio(propioId).then((x) => vivo && tomar(x)).catch((e) => vivo && setError(e.message))
    return () => {
      vivo = false
    }
  }, [propioId])
  async function cambiar(cambio) {
    setOcupado(true)
    setError(null)
    try {
      tomar(await api.ajustarGama(propioId, cambio))
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }
  if (error && !v) return <p className="vacio">{error}</p>
  if (!v) return <Cargando texto="leyendo el último scan del nicho…" />
  if (v.estado !== 'ok') return <p className="vacio">{SIN_GAMA[v.estado] ?? v.estado}</p>
  const l = v.lectura
  const desde = Number(rango.desde)
  const hasta = Number(rango.hasta)
  const rangoValido = desde > 0 && hasta > desde
  return (
    <div className="gama">
      <div className="gama-cifras">
        <div className="gama-cifra">
          <span>Comparables</span>
          <strong>{fmtNum(l.publicaciones)}</strong>
          <small>de {fmtNum(l.delNicho)} en “{v.keyword}”</small>
        </div>
        <div className="gama-cifra">
          <span>Mediana de tu gama</span>
          <strong>{fmtPrecio(l.medianaPrecio)}</strong>
          <small>la del nicho: {fmtPrecio(l.medianaPrecioNicho)}</small>
        </div>
        <div className="gama-cifra">
          <span>Tu precio</span>
          <strong>{fmtPrecio(v.precio)}</strong>
          <small>{l.masBaratasQueTuPct != null ? `${fmtNum(l.masBaratasQueTuPct)}% de tu gama cobra menos` : '—'}</small>
        </div>
        <div className="gama-cifra">
          <span>Se vende en tu gama</span>
          <strong>{l.reseniasPct != null ? `${fmtNum(l.reseniasPct)}%` : '—'}</strong>
          <small>
            de las reseñas del nicho{l.ventaHoyPct != null ? ` · ${fmtNum(l.ventaHoyPct)}% de la venta de hoy` : ''}
          </small>
        </div>
      </div>
      <HistogramaPrecios
        precios={v.preciosNicho}
        bandaDominante={v.rango}
        titulo={`Precios en “${v.keyword}” y tu gama`}
        etiquetaBanda="tu gama"
        marca={{ precio: v.precio, etiqueta: `tú ${fmtPrecio(v.precio)}` }}
        alto={110}
      />
      <form
        className="gama-rango"
        onSubmit={(e) => {
          e.preventDefault()
          if (rangoValido) cambiar({ desde, hasta })
        }}
      >
        <label>
          desde
          <input type="number" min="0" step="100" value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
        </label>
        <label>
          hasta
          <input type="number" min="0" step="100" value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
        </label>
        <button type="submit" className="boton-secundario boton-chico" disabled={ocupado || !rangoValido}>
          usar este rango
        </button>
        {v.rango.manual ? (
          <button type="button" className="boton-secundario boton-chico" disabled={ocupado} onClick={() => cambiar({ automatico: true })}>
            volver al de tu precio
          </button>
        ) : (
          <small>automático: de 0,7× a 1,6× tu precio</small>
        )}
      </form>
      {error ? <p className="vacio">{error}</p> : null}
      <div className="gama-lista">
        {v.comparables.map((x) => (
          <FichaGama
            key={x.sku}
            x={x}
            accion={x.origenGama === 'agregada' ? 'restaurar' : 'sacar'}
            onAccion={(sku) => cambiar(x.origenGama === 'agregada' ? { restaurar: sku } : { sacar: sku })}
            ocupado={ocupado}
          />
        ))}
      </div>
      {v.fuera.length ? (
        <details className="gama-mas">
          <summary>Fuera de tu gama: las {v.fuera.length} más cercanas en precio</summary>
          <div className="gama-lista">
            {v.fuera.map((x) => (
              <FichaGama key={x.sku} x={x} accion="agregar" onAccion={(sku) => cambiar({ agregar: sku })} ocupado={ocupado} />
            ))}
          </div>
        </details>
      ) : null}
      {v.sacadas.length ? (
        <details className="gama-mas">
          <summary>Sacadas a mano ({v.sacadas.length})</summary>
          <div className="gama-lista">
            {v.sacadas.map((x) => (
              <FichaGama key={x.sku} x={x} accion="restaurar" onAccion={(sku) => cambiar({ restaurar: sku })} ocupado={ocupado} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function SeccionGama({ p }) {
  const r = p.gamaRango
  if (!p.nichoId || !r) return null
  return (
    <Seccion
      icono={Layers}
      titulo="Tu gama"
      resumen={`compite con lo de ${fmtPrecio(r.desde)}–${fmtPrecio(r.hasta)}${r.manual ? ' · rango tuyo' : ''}`}
    >
      <DetalleGama propioId={p._id} />
    </Seccion>
  )
}

// Quién vende lo mismo (QuienVendeLoMismo.jsx): se pide al abrir, lee el último scan del nicho.
function SeccionIguales({ p }) {
  if (!p.nichoId) return null
  return (
    <Seccion icono={ScanSearch} titulo="Quién vende lo mismo" resumen="el mismo producto en otras publicaciones, con su precio por unidad">
      <QuienVendeLoMismo propioId={p._id} />
    </Seccion>
  )
}

// `familia` ({ nombre, variantes }) cuando el producto tiene varios colores en
// ML: la tarjeta es del producto, con sus números sumados (`m`), y lo que se
// decide en ella (precio, costo, nicho) se aplica a todos los colores. `p` es
// la publicación que da la cara: su economía, su gama y su auditoría valen
// para todas, porque comparten precio y página.
function TendenciaPrecio({ puntos, familia }) {
  if (puntos.length < 2) return null
  const valores = puntos.map((p) => p.valor)
  const min = Math.min(...valores), max = Math.max(...valores)
  const trayectoria = valores.map((valor, i) => `${i ? 'L' : 'M'}${2 + i / (valores.length - 1) * 72},${max === min ? 14 : 25 - (valor - min) / (max - min) * 22}`).join(' ')
  return <svg className="pc-tendencia" viewBox="0 0 76 28" role="img" aria-label={`${familia ? 'Precio mínimo entre variantes' : 'Precio'}: últimas ${puntos.length} mediciones`}><title>Historial de precio · {fmtPrecio(valores[0])} → {fmtPrecio(valores.at(-1))}</title><path d={trayectoria} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

// LO QUE PIDE MERCADO LIBRE (11-nov-2026; services/calidadMl.js). ML le pone un puntaje a cada publicación y dice
// qué le falta. Acá va lo que depende de la publicación (video, características, fotos…). Lo comercial —Premium
// para dar cuotas, envío gratis, precio mayorista— no se sigue: «hace que gastemos más», dijo el importador.
const ICONO_PENDIENTE = { UP_SHORTS: Video, UP_TECHNICAL_SPECIFICATIONS_MAIN: ListChecks, UP_PICTURES: IconoFoto, UP_TITLE: Type, UP_GTIN: Barcode }
function CalidadMl({ calidad }) {
  if (!calidad) return null
  const items = calidad.pendientes.map((x) => ({ id: x.clave, Icono: ICONO_PENDIENTE[x.clave] ?? CircleAlert, titulo: x.titulo ?? x.clave, detalle: x.detalle, avance: x.avance }))
  const resumen = calidad.puntajeProducto != null
    ? <Etiqueta tono={items.length ? 'atencion' : 'bien'} title="Puntaje de Mercado Libre para los datos del producto (video, características, fotos, título, código universal)">Datos del producto {calidad.puntajeProducto} de 100</Etiqueta>
    : null
  return (
    <Pendientes titulo={items.length ? 'Lo que falta para subir el puntaje' : 'No pide nada más para esta publicación'} resumen={resumen} items={items}>
      {calidad.comerciales.length
        ? `El puntaje total de ML es ${calidad.puntaje ?? '—'} (${calidad.nivel ?? 'sin nivel'}) porque además pide condiciones de venta que cuestan plata y acá no se siguen: ${calidad.comerciales.join(', ')}.`
        : `Puntaje total de ML: ${calidad.puntaje ?? '—'} (${calidad.nivel ?? 'sin nivel'}).`}
    </Pendientes>
  )
}

function TarjetaPropio({ p, familia = null, m: metricas = null, nichos, onEliminar, onAbrir, onCablear, onAuditar, onVerAuditoria, onGuardarCosto, onCambiarPrecio, onGuardarEnvio, onDecidirReposicion, expandida = false, onExpandir, prefijos = null }) {
  const m = metricas ?? metricasDe(p)
  const a = p.auditoria
  const generando =
    a?.estado === 'generando' &&
    (!a.solicitadaEl || Date.now() - new Date(a.solicitadaEl).getTime() < 30 * 60e3)
  const titulo = familia?.nombre ?? p.titulo ?? p.sku
  const ventas7 = m.ventas7
  // con colores a distinto precio no hay UN precio con su tachado: va el rango
  const promo = m.precioHasta == null ? p.promoMl?.activa ?? null : null
  const precioEfectivo = m.precio
  const intervenciones = p.impacto?.intervenciones ?? []
  const midiendo = intervenciones.filter((i) => i.veredicto === 'midiendo').length

  // lo que Mercado Libre pide para esta tarjeta (una publicación, o los colores de la familia)
  const calidad = calidadDeEntrada(familia ? familia.variantes : [p])
  const pideMl = resumenPendientes(calidad)

  if (!expandida) {
    const r = m.reposicion
    const urg = r ? TONO_URGENCIA[r.urgencia] : null
    const entrada = { p, variantes: familia?.variantes, m }
    const inventario = inventarioEntrada(entrada)
    const alerta = r?.urgencia === 'quebrado' ? 'Sin stock en Full'
      : r?.urgencia === 'agotado' ? 'Agotado, sin reposición'
      : r?.urgencia === 'liquidando' ? 'Se liquida: no se repone'
      : r && ['critico', 'reponer'].includes(r.urgencia) ? `${r.diasCobertura ?? '—'} días de cobertura`
      : m.pausada ? 'Publicación pausada' : null
    return (
      <article className={`propio-card pc-mini pc-compacta${urg ? ` pc-mini-${urg}` : ''}`}>
        <button className="pc-compacta-abrir" onClick={() => onExpandir?.(p._id)} aria-expanded={false} aria-label={`Abrir ${titulo}`}>
          <span className="pc-compacta-foto">
            {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <Package aria-hidden="true" />}
            {familia ? <span className="pc-compacta-variantes">{familia.variantes.slice(0, 3).map((v) => v.imagen ? <img key={v._id} src={v.imagen} alt="" loading="lazy" /> : null)}</span> : null}
          </span>
          <span className="pc-compacta-info">
            <span className="pc-compacta-titulo" title={titulo}>{titulo}</span>
            <span className="pc-compacta-precio">{fmtPrecio(precioEfectivo)}{m.precioHasta != null ? `–${fmtPrecio(m.precioHasta)}` : ''}{promo?.precioOriginal > precioEfectivo ? <s>{fmtPrecio(promo.precioOriginal)}</s> : null}</span>
            <span className="pc-compacta-inventario">
              {inventario.tieneFull ? <span className="pc-stock-full"><Zap aria-hidden="true" />Full <b>{fmtNum(inventario.full)}</b></span> : null}
              {inventario.tieneBodega ? <span><Warehouse aria-hidden="true" />Bodega <b>{fmtNum(inventario.bodega)}</b></span> : null}
              {!inventario.tieneFull && !inventario.tieneBodega ? <span><Package aria-hidden="true" />Stock <b>{fmtNum(m.stock)}</b></span> : null}
              {familia ? <span className="pc-compacta-nvar">{etiquetaVariantes(familia.variantes)}</span> : null}
              {pideMl ? <span className="pc-compacta-ml" title="Lo que Mercado Libre pide para subir la calidad de esta publicación"><CircleAlert aria-hidden="true" />{pideMl}</span> : null}
            </span>
          </span>
          <span className="pc-compacta-metricas">
            <span><b>{ventas7 == null ? '—' : fmtNum(ventas7)}</b><small>ventas · 7 días</small></span>
            <span><b className={m.margen30d?.margenClp < 0 ? 'pc-numero-negativo' : undefined}>{m.margen30d ? fmtPrecio(m.margen30d.margenClp) : '—'}</b><small>margen · 30 días</small></span>
            <TendenciaPrecio puntos={seriePrecioEntrada(entrada)} familia={Boolean(familia)} />
          </span>
          <span className={`pc-compacta-pie${alerta ? ` pc-alerta-${urg ?? 'pausa'}` : ''}`}>
            <span>{alerta ?? 'Ver detalle'}{alerta && familia && r?.variante && !r.todas ? ` · ${r.variante}` : ''}{m.aEnviar > 0 ? ` · enviar ${fmtNum(m.aEnviar)} u` : ''}</span><ChevronRight aria-hidden="true" />
          </span>
        </button>
      </article>
    )
  }

  // LA TARJETA ABIERTA, ORDENADA (18-nov-2026). Pedido del importador: «cuando un producto tiene variante es
  // complicado ver, como también cuando no tiene; falta mejorar completo eso». Adentro había siete bloques, cada uno
  // con su propio estilo: renglones de texto por color, tres recuadros con el detalle escondido en textos flotantes,
  // una lista de restas, nueve cifras chicas de publicidad… Ahora es la misma estructura con o sin colores:
  //   1. cuatro cifras con su explicación a la vista (lo que vendió, lo que deja cada venta, el mes y el stock);
  //   2. el stock por color en columnas, con el envío a Full anotado en un paso (StockFull.jsx);
  //   3. todo lo demás en secciones que dicen lo importante en una línea y se abren para el detalle.
  const e = p.economiaUnidad
  const filasStock = familia ? familia.variantes.map((v) => ({ p: v, nombre: nombreVariante(v), m: metricasDe(v) })) : [{ p, nombre: null, m }]
  const stock = resumenStock(filasStock)
  const plata = resumenPlata(e)
  const enFull = filasStock.some((f) => f.p.reposicion)
  const decimal = (n) => String(n).replace('.', ',')
  const mes = m.margen30d
    ? { etiqueta: m.margen30d.margenClp < 0 ? 'Perdiste en 30 días' : 'Ganaste en 30 días', valor: fmtPrecio(Math.abs(m.margen30d.margenClp)), tono: m.margen30d.margenClp < 0 ? 'problema' : 'bien',
        detalle: `vendiste ${fmtPrecio(m.ventas30d?.ingresosClp)} · Mercado Libre ${fmtPrecio(m.margen30d.cargosMlClp ?? m.margen30d.comisionClp)} · costo ${fmtPrecio(m.margen30d.costoClp)}` }
    : m.ventas30d
      ? { etiqueta: 'Vendiste en 30 días', valor: fmtPrecio(m.ventas30d.ingresosClp), detalle: 'falta el costo para saber cuánto ganaste' }
      : { etiqueta: 'En 30 días', valor: '—', detalle: 'sin ventas' }
  const mejoras = a?.resultado?.quickWins ?? []
  const resumenMejoras = !p.nichoId ? 'elige el nicho contra el que se compara'
    : generando ? 'leyendo a los que más venden en el nicho…'
      : a?.estado === 'ok' ? `${mejoras.length ? `${fmtNum(mejoras.length)} ${mejoras.length === 1 ? 'mejora propuesta' : 'mejoras propuestas'}` : 'revisada'}${mejoras[0] ? ` · primera: ${mejoras[0]}` : ''}`
        : a?.estado === 'error' ? 'la revisión anterior falló' : 'todavía sin revisar'

  return (
    <article className="propio-card pc-abierta">
      <header className="pc-head">
        <button className="pc-foto" onClick={() => onAbrir(p)} aria-label="Ver la historia del producto">
          {p.imagen ? <img src={p.imagen} alt="" loading="lazy" width="64" height="64" /> : <span className="sin-imagen" />}
        </button>
        <div className="pc-ident">
          <h3 onClick={() => onAbrir(p)}>{titulo}</h3>
          <div className="pc-chips">
            <Etiqueta tono="destacada">{fmtPrecio(precioEfectivo)}{m.precioHasta != null ? ` a ${fmtPrecio(m.precioHasta)}` : ''}</Etiqueta>
            {promo ? <Etiqueta tono="atencion">{Math.round((1 - promo.precio / promo.precioOriginal) * 100)}% de descuento, antes {fmtPrecio(promo.precioOriginal)}</Etiqueta> : null}
            {familia ? <Etiqueta>{etiquetaVariantes(familia.variantes)}</Etiqueta> : null}
            {p.envioMl?.logistica === 'fulfillment' ? <Etiqueta tono="bien"><Zap size={12} aria-hidden="true" /> Full</Etiqueta> : p.envioMl?.logistica ? <Etiqueta>{p.envioMl.flex ? 'Flex' : 'colecta'}</Etiqueta> : null}
            {(familia ? m.pausada : p.estadoMl && p.estadoMl !== 'active') ? <Etiqueta tono="atencion">{familia || p.estadoMl === 'paused' ? 'pausada' : p.estadoMl}</Etiqueta> : null}
            <Etiqueta>{m.numReviews ? `${m.rating ? `★ ${decimal(m.rating)} · ` : ''}${fmtNum(m.numReviews)} ${m.numReviews === 1 ? 'reseña' : 'reseñas'}` : 'sin reseñas'}</Etiqueta>
            <span className="pc-pos">{m.posicionReciente ? `puesto ${m.posicionReciente.posicion} en “${m.posicionReciente.keyword}”` : 'no aparece en las búsquedas que medimos'}</span>
          </div>
        </div>
        <div className="pc-acciones">
          <button className="icono-boton" onClick={() => onAbrir(p)} aria-label="Ver la historia" title="Ver la historia">
            <LineChart aria-hidden="true" />
          </button>
          <a href={p.url} target="_blank" rel="noreferrer" className="icono-boton" aria-label="Abrir en Mercado Libre" title="Abrir en Mercado Libre">
            <ExternalLink aria-hidden="true" />
          </a>
          <button className="icono-boton icono-peligro" onClick={() => onEliminar(p)} aria-label="Quitar producto" title="Quitar producto">
            <Trash2 aria-hidden="true" />
          </button>
          <button className="icono-boton" onClick={() => onExpandir?.(null)} aria-label="Cerrar la tarjeta" title="Cerrar" aria-expanded>
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="pc-cifras">
        <Cifras>
          <Cifra etiqueta="Vendiste en 7 días" valor={ventas7 == null ? '—' : fmtNum(ventas7)} tono={ventas7 > 0 ? 'bien' : ventas7 === 0 ? 'problema' : undefined}
            detalle={`${fmtNum(m.visitas7 ?? 0)} ${m.visitas7 === 1 ? 'visita' : 'visitas'}${m.conversion7d != null ? ` · compran ${decimal(m.conversion7d)} de cada 100` : ''}`} />
          <Cifra etiqueta={e?.gananciaClp < 0 ? 'Pierdes en cada venta' : 'Te deja cada venta'} valor={!e ? '—' : e.gananciaClp != null ? fmtPrecio(Math.abs(e.gananciaClp)) : 'falta el costo'}
            tono={e?.gananciaClp == null ? undefined : e.gananciaClp < 0 ? 'problema' : 'bien'}
            detalle={!e ? 'sin precio medido' : e.gananciaClp != null ? `a ${fmtPrecio(e.precioClp)}, después de Mercado Libre y del costo` : `quedan ${fmtPrecio(e.quedaParaProductoClp)} para pagar el producto`} />
          <Cifra etiqueta={mes.etiqueta} valor={mes.valor} tono={mes.tono} detalle={mes.detalle} />
          <Cifra etiqueta={enFull ? 'En Full' : 'Stock'} valor={stock.valor} tono={stock.tono} detalle={stock.detalle} />
        </Cifras>
      </div>

      <StockFull filas={filasStock} mostrarPrecio={m.precioHasta != null} onAbrir={onAbrir} onGuardarEnvio={onGuardarEnvio} onDecidir={onDecidirReposicion} />

      <div className="pc-secciones">
        <Seccion icono={PiggyBank} titulo="Plata por venta" tono={plata?.tono} resumen={plata?.texto ?? 'sin precio medido'} abiertaPorDefecto={Boolean(e) && e.gananciaClp == null}>
          <PlataVenta p={p} m={m} aplicaA={familia ? etiquetaVariantes(familia.variantes, { conArticulo: true }) : null} onGuardarCosto={onGuardarCosto} onCambiarPrecio={onCambiarPrecio} />
        </Seccion>

        {p.planPublicidad ? (
          <Seccion icono={Megaphone} titulo="Publicidad" resumen={resumenPlan(p.planPublicidad)}>
            <PlanPublicidad plan={p.planPublicidad} compacto />
          </Seccion>
        ) : null}

        {calidad ? (
          <Seccion icono={ListChecks} titulo="Lo que pide Mercado Libre" tono={pideMl ? 'aviso' : 'neutro'}
            resumen={`${pideMl ? `falta ${pideMl.replace(/^ML pide /, '')}` : 'no pide nada más'}${calidad.puntajeProducto != null ? ` · datos del producto ${calidad.puntajeProducto} de 100` : ''}`}>
            <CalidadMl calidad={calidad} />
          </Seccion>
        ) : null}

        <Seccion icono={Sparkles} titulo="Mejorar la publicación" resumen={resumenMejoras}>
          <div className="s-acciones">
            <label htmlFor={`nicho-${p._id}`}>Se compara con el nicho</label>
            <select id={`nicho-${p._id}`} className="selector-nicho" value={p.nichoId ?? ''} onChange={(ev) => onCablear(p, ev.target.value || null)}>
              <option value="">— elegir nicho —</option>
              {nichos.map((n) => (
                <option key={n._id} value={n._id}>
                  {n.keyword}
                </option>
              ))}
            </select>
            {!p.nichoId ? null : generando ? (
              <Etiqueta>leyendo a los que más venden…</Etiqueta>
            ) : a?.estado === 'ok' ? (
              <button className="boton-secundario boton-chico" onClick={() => onVerAuditoria(p)}>
                ver la revisión completa{mejoras.length ? ` (${mejoras.length})` : ''}
              </button>
            ) : (
              <button className="boton-secundario boton-chico" title={a?.estado === 'error' ? `la anterior falló: ${a.error}` : 'Opus 5 lee el título, la descripción, la ficha y las fotos de los que más venden en el nicho'} onClick={() => onAuditar(p)}>
                {a?.estado === 'error' ? 'reintentar la revisión' : 'revisar con Opus 5'}
              </button>
            )}
          </div>
          {!p.nichoId ? <p className="sec-linea">Sin un nicho no hay con quién comparar el título, la ficha y las fotos.</p> : null}
          {a?.estado === 'ok' && mejoras.length ? (
            <Pendientes titulo="Lo primero que conviene cambiar" items={mejoras.slice(0, 3).map((q, i) => ({ id: i, Icono: Sparkles, titulo: q }))}>
              {mejoras.length > 3 ? `Y ${fmtNum(mejoras.length - 3)} más en la revisión completa.` : null}
            </Pendientes>
          ) : null}
        </Seccion>

        <SeccionGama p={p} />
        <SeccionIguales p={p} />

      {promo || p.promoMl?.ofertaPropia || p.promoMl?.campanasDisponibles?.length ? (
        <Seccion
          icono={BadgePercent}
          titulo="Promoción"
          tono={promo ? 'aviso' : 'neutro'}
          resumen={
            promo
              ? `${promo.nombre} · el cliente paga ${fmtPrecio(promo.precio)} hasta ${String(promo.terminaEl).slice(0, 10)}`
              : 'sin promo activa · puedes ofertar o postular a campañas'
          }
        >
          {p.promoMl?.ofertaPropia?.maximo ? (
            <p className="sec-linea">
              Oferta propia posible: {fmtPrecio(p.promoMl.ofertaPropia.minimo)} a{' '}
              {fmtPrecio(p.promoMl.ofertaPropia.maximo)} · ML sugiere {fmtPrecio(p.promoMl.ofertaPropia.sugerido)}
            </p>
          ) : null}
          {p.promoMl?.campanasDisponibles?.length ? (
            <p className="sec-linea">
              Campañas para postular:{' '}
              {p.promoMl.campanasDisponibles.map((c) => `${c.nombre} (${String(c.desde).slice(0, 10)})`).join(' · ')}
            </p>
          ) : null}
        </Seccion>
      ) : null}

      {intervenciones.length ? (
        <Seccion
          icono={LineChart}
          titulo="Lupa"
          resumen={
            midiendo
              ? `${fmtNum(intervenciones.length)} ${intervenciones.length === 1 ? 'cambio' : 'cambios'} · ${fmtNum(midiendo)} midiéndose`
              : `${fmtNum(intervenciones.length)} ${intervenciones.length === 1 ? 'cambio medido' : 'cambios medidos'}`
          }
        >
          <ul className="lupa-lista">
            {intervenciones.slice(-4).reverse().map((i, idx) => (
              <li key={idx} className={`lupa-${i.veredicto.replace('ó', 'o')}`}>
                <span className="lupa-que">
                  {i.tipo === 'titulo'
                    ? 'título'
                    : i.tipo === 'descripcion'
                      ? 'descripción'
                      : i.tipo === 'logistica'
                        ? 'logística'
                        : i.tipo}
                </span>
                <span className="lupa-fecha">{fmtFecha(i.fecha)}</span>
                <span className="lupa-veredicto">{i.veredicto}</span>
                <span className="lupa-lectura">{i.lectura}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      ) : null}

      {p.surtido?.sugeridos?.length ? (
        <Seccion
          icono={PackagePlus}
          titulo="Surtido que falta"
          tono="exito"
          resumen={`${fmtNum(p.surtido.sugeridos.length)} ${p.surtido.sugeridos.length === 1 ? 'formato que vende' : 'formatos que venden'} en “${p.surtido.keyword}” y no tienes`}
        >
          <div className="surtido-lista">
            {p.surtido.sugeridos.map((s) => (
              <a key={s.sku} className="surtido-item" href={s.url} target="_blank" rel="noreferrer" title={s.titulo}>
                <img src={s.imagen} alt="" loading="lazy" width="52" height="52" />
                <span className="surtido-datos">
                  <strong>
                    {s.unidades ? `${s.unidades} pcs` : 'premium'} · {fmtPrecio(s.precio)}
                  </strong>
                  <span className="surtido-prueba">
                    {s.ventasDia ? `${fmtNum(s.ventasDia)}/día` : `${fmtNum(s.numReviews)} reseñas`}
                    {s.esFull === true ? (
                      <span className="chip-full">
                        <Zap aria-hidden="true" />
                        FULL
                      </span>
                    ) : null}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </Seccion>
      ) : null}
      </div>
    </article>
  )
}

function PanelPropio({ propio, onCerrar, onGuardarCosto }) {
  const serie = (campo) => (propio.mediciones ?? []).map((m) => ({ fecha: m.fecha, valor: m[campo] }))
  const [costo, setCosto] = useState(propio.costoUnitarioClp ?? '')
  const [guardando, setGuardando] = useState(false)
  async function guardarCosto(e) {
    e.preventDefault()
    setGuardando(true)
    try {
      await onGuardarCosto(propio, costo === '' ? null : Number(costo))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel" onClick={(e) => e.stopPropagation()} aria-label="Serie del producto propio">
        <div className="panel-encabezado">
          {propio.imagen ? <img className="panel-imagen" src={propio.imagen} alt="" width="64" height="64" /> : null}
          <div>
            <h3>{propio.titulo ?? propio.sku}</h3>
            <p className="panel-meta">
              {propio.sku} · seguido desde {fmtFecha(propio.creadoEl)} ·{' '}
              {propio.mediciones?.length ?? 0} mediciones
            </p>
          </div>
          <button className="boton-cerrar" onClick={onCerrar} aria-label="Cerrar panel">✕</button>
        </div>
        <form className="form-nicho" onSubmit={guardarCosto}>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Costo por unidad en bodega (CLP)"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            aria-label="Costo unitario en CLP"
          />
          <button type="submit" className="boton-secundario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar costo'}
          </button>
        </form>
        <p className="panel-meta">
          Con el costo real por unidad, cada venta calcula su margen: precio − comisión ML − <b>cargo por
          envío de Full</b> − costo. El envío no es menor: en un producto de ticket bajo pesa más que la
          comisión, y sobre $19.990 ML lo triplica.
        </p>
        <div className="panel-graficos">
          <MiniSerie titulo="Vendidos acumulados (real)" puntos={serie('vendidos')} alto={110} />
          <MiniSerie titulo="Visitas (ventana 7d)" puntos={serie('visitas')} alto={110} />
          <MiniSerie titulo="Precio efectivo (lo que paga el cliente)" puntos={serie('precioEfectivo')} formato={fmtPrecio} alto={110} />
          <MiniSerie titulo="Stock" puntos={serie('stock')} alto={110} />
          <MiniSerie titulo="Reseñas acumuladas" puntos={serie('numReviews')} alto={110} />
          <MiniSerie titulo="Rating" puntos={serie('rating')} alto={110} />
        </div>
      </aside>
    </div>
  )
}

function SeccionFallas({ fallas }) {
  if (!fallas?.length) return null
  return (
    <ul className="lista-riesgos">
      {fallas.map((f, i) => (
        <li key={i}>{f}</li>
      ))}
    </ul>
  )
}

// Auditoría de listing: mi título/descripción/fotos vs los ganadores del nicho
function PanelAuditoria({ propio, onCerrar, onRegenerar, onAplicar, aplicando, onRevisarFicha, revisandoFicha }) {
  const a = propio.auditoria
  const r = a?.resultado
  if (!r) return null
  const aplicadoTitulo = (a.aplicado ?? []).filter((x) => x.campo === 'titulo').map((x) => x.valor)
  const descripcionAplicada = (a.aplicado ?? []).some((x) => x.campo === 'descripcion')
  const miPrimeraFoto = a.miPublicacion?.fotos?.[0] ?? propio.imagen ?? null
  return (
    <div className="panel-fondo" onClick={onCerrar}>
      <aside className="panel panel-ancho" onClick={(e) => e.stopPropagation()} aria-label="Auditoría de listing">
        <div className="panel-encabezado">
          {propio.imagen ? <img className="panel-imagen" src={propio.imagen} alt="" width="64" height="64" /> : null}
          <div>
            <h3>{propio.titulo ?? propio.sku}</h3>
            <p className="panel-meta">
              Opus 5 leyó el título, la descripción, la ficha
              {a.fotosAnalizadas ? ' y las fotos reales' : ''} de los {a.competidores?.length ?? 0} peces
              gordos de “{a.keyword}” y los comparó con tu publicación · {fmtFecha(a.generadoEl)} · US${' '}
              {a.costoUsd?.toFixed(2) ?? '—'}
            </p>
          </div>
          <div className="panel-acciones">
            <button className="boton-secundario" onClick={() => onRegenerar(propio)}>
              Re-auditar
            </button>
            <button className="boton-cerrar" onClick={onCerrar} aria-label="Cerrar panel">✕</button>
          </div>
        </div>

        <p className="auditoria-veredicto">{r.veredicto}</p>

        {r.quickWins?.length ? (
          <section>
            <h4>Primero lo que más mueve</h4>
            <ol className="lista-riesgos">
              {r.quickWins.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </section>
        ) : null}

        <section>
          <h4>Los peces gordos que Opus 5 leyó</h4>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th aria-label="imagen" />
                  <th>Publicación</th>
                  <th className="num">Pos.</th>
                  <th className="num">Precio</th>
                  <th className="num">Reseñas</th>
                  <th className="num">Rating</th>
                  <th className="num">Ventas/día</th>
                  <th className="num">Fotos</th>
                </tr>
              </thead>
              <tbody>
                <tr className="fila-mia">
                  <td className="celda-imagen">
                    {propio.imagen ? <img src={propio.imagen} alt="" width="36" height="36" /> : null}
                  </td>
                  <td className="celda-titulo" title={a.miPublicacion?.titulo ?? ''}>
                    <strong>Tu publicación</strong>
                  </td>
                  <td className="num">
                    {a.miPublicacion?.posicionEnElListado ? `#${a.miPublicacion.posicionEnElListado}` : 'fuera'}
                  </td>
                  <td className="num">{fmtPrecio(a.miPublicacion?.precio)}</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numReviews)}</td>
                  <td className="num">{a.miPublicacion?.rating ?? '—'}</td>
                  <td className="num">—</td>
                  <td className="num">{fmtNum(a.miPublicacion?.numFotos)}</td>
                </tr>
                {(a.competidores ?? []).map((c) => (
                  <tr key={c.sku}>
                    <td className="celda-imagen">
                      {c.imagen ? <img src={c.imagen} alt="" loading="lazy" width="36" height="36" /> : null}
                    </td>
                    <td className="celda-titulo" title={c.titulo}>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer">
                          {c.titulo}
                        </a>
                      ) : (
                        c.titulo
                      )}
                    </td>
                    <td className="num">{c.posicion ? `#${c.posicion}` : '—'}</td>
                    <td className="num">{fmtPrecio(c.precio)}</td>
                    <td className="num">{fmtNum(c.numReviews)}</td>
                    <td className="num">{c.rating ?? '—'}</td>
                    <td className="num">{c.ventasDia != null ? `~${fmtNum(c.ventasDia)}` : '—'}</td>
                    <td className="num">{c.numFotos ? fmtNum(c.numFotos) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h4>Primera foto: tú contra ellos</h4>
          <p className="auditoria-diagnostico">
            La primera foto decide el clic en una miniatura de 100 px. Compárala tú también:
          </p>
          <div className="fotos-cara-a-cara">
            <figure className="foto-vs foto-vs-mia">
              {miPrimeraFoto ? <img src={miPrimeraFoto} alt="Tu primera foto" loading="lazy" /> : <span className="sin-imagen" />}
              <figcaption>Tú</figcaption>
            </figure>
            {(a.competidores ?? []).map((c) => {
              const foto = c.fotos?.[0] ?? c.imagen
              return foto ? (
                <figure className="foto-vs" key={c.sku}>
                  <a href={c.url ?? undefined} target="_blank" rel="noreferrer">
                    <img src={foto} alt="" loading="lazy" />
                  </a>
                  <figcaption>{fmtNum(c.numReviews)} reseñas</figcaption>
                </figure>
              ) : null
            })}
          </div>
        </section>

        <section>
          <h4>Título</h4>
          <p className="auditoria-diagnostico">{r.titulo?.diagnostico}</p>
          {a.pesos?.length ? (
            <>
              <p className="dato-label">Peso de búsqueda medido (autocompletado de ML)</p>
              <div className="chips listing-chips">
                {a.pesos.map((p) => (
                  <span
                    className={`chip chip-peso-${p.peso}`}
                    key={p.frase}
                    title={
                      p.peso === 'nulo'
                        ? 'ML no la sugiere: nadie la escribe así'
                        : `aparece tecleando “${p.prefijo}”${p.posicion ? `, en posición ${p.posicion}` : ''}`
                    }
                  >
                    {p.frase} · {p.peso}
                  </span>
                ))}
              </div>
            </>
          ) : a.busquedasReales && Object.keys(a.busquedasReales).length ? (
            <>
              <p className="dato-label">Lo que la gente escribe de verdad (autocompletado ML, por volumen)</p>
              <div className="chips listing-chips">
                {[...new Set(Object.values(a.busquedasReales).flat())].slice(0, 14).map((b) => (
                  <span className="chip" key={b}>
                    {b}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {!a.busquedasReales || !Object.keys(a.busquedasReales).length ? (
            <p className="error-bloque">
              El autocompletado de ML no respondió en esta corrida: estas propuestas NO están validadas por
              volumen de búsqueda. Vuelve a optimizar antes de usarlas.
            </p>
          ) : a.arranquesSinVolumen?.length ? (
            <p className="error-bloque">
              Ojo: {a.arranquesSinVolumen.length} propuesta(s) arrancan con una frase que el autocompletado no
              registra — prefiere las que parten con una búsqueda real.
            </p>
          ) : null}
          <p className="nota">
            ML no deja cambiar el título por API en publicaciones nuevas (formato user products): copia el
            texto y pégalo en tu publicación. El color final ("Negro", "Rosa"…) lo agrega ML solo.
          </p>
          <SeccionFallas fallas={r.titulo?.fallas} />
          {a.miPublicacion?.titulo ? (
            <div className="listing-titulo titulo-actual">
              <span className="listing-titulo-texto">{a.miPublicacion.titulo}</span>
              <span className="contador">{a.miPublicacion.titulo.length}/60 · actual</span>
            </div>
          ) : null}
          <div className="listing-titulos">
            {(r.titulo?.propuestas ?? []).map((t, i) => (
              <div className="listing-titulo" key={i}>
                <span className="listing-titulo-texto">{t}</span>
                <span className={t.length > 60 ? 'contador excedido' : 'contador'}>{t.length}/60</span>
                <BotonCopiar texto={t} etiqueta="Copiar" />
                <a
                  className="copiar"
                  href={`https://www.mercadolibre.cl/publicaciones/${propio.itemIdMl ?? propio.sku}/modificar`}
                  target="_blank"
                  rel="noreferrer"
                  title="Abre la publicación en Mercado Libre para pegar el título (ML no permite cambiarlo por API en publicaciones nuevas)"
                >
                  Copiar y editar en ML ↗
                </a>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="listing-seccion-encabezado">
            <h4>Descripción</h4>
            {r.descripcion?.propuesta ? (
              <span className="acciones-inline">
                <BotonCopiar texto={r.descripcion.propuesta} etiqueta="Copiar propuesta" />
                {descripcionAplicada ? (
                  <span className="badge badge-full">en ML ✓</span>
                ) : (
                  <button
                    className="copiar"
                    disabled={aplicando}
                    onClick={() => {
                      if (confirm('¿Reemplazar la descripción de la publicación en Mercado Libre por la propuesta?')) {
                        onAplicar(propio, { descripcion: r.descripcion.propuesta })
                      }
                    }}
                  >
                    {aplicando ? 'Aplicando…' : 'Aplicar en ML'}
                  </button>
                )}
              </span>
            ) : null}
          </div>
          <p className="auditoria-diagnostico">{r.descripcion?.diagnostico}</p>
          <SeccionFallas fallas={r.descripcion?.fallas} />
          {a.miPublicacion?.descripcion ? (
            <details className="descripcion-actual">
              <summary>Ver tu descripción actual</summary>
              <pre className="listing-descripcion">{a.miPublicacion.descripcion}</pre>
            </details>
          ) : null}
          {r.descripcion?.propuesta ? <pre className="listing-descripcion">{r.descripcion.propuesta}</pre> : null}
        </section>

        <section>
          <h4>Fotos</h4>
          <p className="auditoria-diagnostico">{r.fotos?.diagnostico}</p>
          <SeccionFallas fallas={r.fotos?.fallas} />
          {r.fotos?.plan?.length ? (
            <>
              <p className="dato-label">Plan de fotos (en orden)</p>
              <ol className="lista-riesgos">
                {r.fotos.plan.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </>
          ) : null}
        </section>

        <section>
          <div className="listing-seccion-encabezado">
            <h4>Características (ficha técnica)</h4>
            <button className="copiar" disabled={revisandoFicha} onClick={() => onRevisarFicha(propio)}>
              {revisandoFicha ? 'Revisando…' : a.ficha ? 'Revisar de nuevo' : 'Revisar ficha con Opus 5'}
            </button>
          </div>
          {a.ficha ? (
            <>
              <p className="auditoria-diagnostico">{a.ficha.diagnostico}</p>
              {a.ficha.correcciones?.length ? (
                <>
                  <div className="tabla-envoltura">
                    <table>
                      <thead>
                        <tr>
                          <th>Atributo</th>
                          <th>Valor propuesto</th>
                          <th>Por qué</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.ficha.correcciones.map((c) => (
                          <tr key={c.id}>
                            <td className="celda-secundaria sin-corte">{c.nombre}</td>
                            <td><strong>{c.valor}</strong></td>
                            <td className="celda-secundaria">{c.razon}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(a.aplicado ?? []).some((x) => x.campo === 'atributos') ? (
                    <p className="nota">Ficha aplicada en ML ✓</p>
                  ) : (
                    <button
                      className="boton-secundario boton-chico"
                      disabled={aplicando}
                      onClick={() => {
                        if (confirm(`¿Escribir ${a.ficha.correcciones.length} atributo(s) de la ficha en Mercado Libre?`)) {
                          onAplicar(propio, { atributos: a.ficha.correcciones.map((c) => ({ id: c.id, valor: c.valor })) })
                        }
                      }}
                    >
                      {aplicando ? 'Aplicando…' : 'Aplicar ficha en ML'}
                    </button>
                  )}
                </>
              ) : (
                <p className="nota">La ficha está bien: sin correcciones con evidencia.</p>
              )}
              {a.ficha.faltanSinDato?.length ? (
                <p className="vacio">
                  Faltan datos que solo tú sabes: {a.ficha.faltanSinDato.join(' · ')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="vacio">
              Opus 5 compara tus Características contra lo que la categoría define y lo que los ganadores
              llenan — y las corrige por API.
            </p>
          )}
        </section>

        {r.otrasBrechas?.length ? (
          <section>
            <h4>Otras brechas</h4>
            <ul className="lista-riesgos">
              {r.otrasBrechas.map((b, i) => (
                <li key={i}>
                  <strong>{b.aspecto}:</strong> {b.detalle}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  )
}

// `buscarInicial`: el texto con que parte el buscador cuando se llega desde otra pantalla a ver un producto.
export function MisProductos({ buscarInicial = null }) {
  // lo último leído queda en memoria: al volver a la pantalla se muestra al tiro y se actualiza detrás
  const [datos, setDatos] = useEstadoGuardado('propios-lista', null)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [abierto, setAbierto] = useState(null)
  // una sola tarjeta abierta a la vez: dos expandidas vuelven a ser una lista
  const [expandido, setExpandido] = useState(null)
  const [orden, setOrden] = useState('urgencia')
  const [busqueda, setBusqueda] = useState(buscarInicial ?? '')
  const [filtro, setFiltro] = useState('todos')
  const [pagina, setPagina] = useState(1)
  useEffect(() => { setPagina(1); setExpandido(null) }, [busqueda, filtro, orden])
  const [meli, setMeli] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [nichos, setNichos] = useState([])
  const [auditoriaDe, setAuditoriaDe] = useState(null) // _id del propio con el panel de auditoría abierto
  const [aplicando, setAplicando] = useState(false)
  const [revisandoFicha, setRevisandoFicha] = useState(false)

  // devuelve la promesa: quien guarda algo espera la lista nueva antes de dar por terminado el guardado
  const cargar = useCallback(() => api.listarPropios().then(setDatos).catch((e) => setError(e.message)), [setDatos])

  useEffect(() => {
    cargar()
    const intervalo = setInterval(cargar, 30_000)
    return () => clearInterval(intervalo)
  }, [cargar])

  const cargarNichos = useCallback(() => {
    api
      .listarNichos()
      .then(({ nichos: lista }) => setNichos([...lista].sort((a, b) => a.keyword.localeCompare(b.keyword))))
      .catch(() => setNichos([]))
  }, [])

  useEffect(() => {
    cargarNichos()
  }, [cargarNichos])

  // mientras hay una auditoría generándose, refrescar más seguido que los 30 s de base
  const hayAuditoriaEnCurso = datos?.propios?.some(
    (p) =>
      p.auditoria?.estado === 'generando' &&
      (!p.auditoria.solicitadaEl || Date.now() - new Date(p.auditoria.solicitadaEl).getTime() < 30 * 60e3),
  )
  useEffect(() => {
    if (!hayAuditoriaEnCurso) return
    const intervalo = setInterval(cargar, 10_000)
    return () => clearInterval(intervalo)
  }, [hayAuditoriaEnCurso, cargar])

  useEffect(() => {
    // al volver del callback OAuth el dashboard aterriza con ?meli=…: avisar y limpiar la URL
    const params = new URLSearchParams(window.location.search)
    const resultado = params.get('meli')
    if (resultado === 'error') {
      setError(`la conexión con Mercado Libre falló: ${params.get('detalle') ?? 'sin detalle'}`)
    }
    if (resultado) window.history.replaceState(null, '', window.location.pathname)
    api.meliEstado().then(setMeli).catch(() => setMeli(null))
  }, [])

  // UN PRODUCTO, VARIOS COLORES: las publicaciones de una misma familia de ML
  // van en una sola tarjeta (lib/familiasPropias.js)
  const propiosVigentes = (datos?.propios ?? []).filter(publicacionVigente)
  const entradas = agruparPorFamilia(propiosVigentes)
  const entradaDe = new Map(entradas.flatMap((e) => (e.variantes ?? [e.p]).map((v) => [v._id, e])))
  // lo que se decide para el producto —precio, costo, nicho, dejar de
  // seguirlo— vale para todos sus colores; el stock, "ya lo envié" y la
  // auditoría siguen siendo de cada publicación
  const miembrosDe = (p) => entradaDe.get(p._id)?.variantes ?? [p]
  const nombreDe = (p) => entradaDe.get(p._id)?.titulo ?? p.titulo ?? p.sku

  async function conectarMeli() {
    setError(null)
    try {
      const { url: urlOauth } = await api.meliConectar()
      window.location = urlOauth
    } catch (err) {
      setError(err.message)
    }
  }

  async function importarMeli() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const r = await api.meliImportar()
      setAviso(
        `${r.importados} publicación(es) importada(s), ${r.yaSeguidos} ya seguida(s) de ${r.total} en tu cuenta` +
          (r.importados ? ' — midiendo ahora, los números aparecen en un par de minutos' : ''),
      )
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function agregar(e) {
    e.preventDefault()
    if (!url.trim()) return
    setOcupado(true)
    setError(null)
    try {
      await api.crearPropio(url.trim())
      setUrl('')
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function eliminar(p) {
    const miembros = miembrosDe(p)
    const pregunta =
      miembros.length > 1
        ? `¿Dejar de seguir "${nombreDe(p)}" y sus ${miembros.length} publicaciones (${miembros.map(nombreVariante).join(', ')})?`
        : `¿Dejar de seguir "${p.titulo ?? p.sku}"?`
    if (!confirm(pregunta)) return
    try {
      for (const v of miembros) await api.eliminarPropio(v._id)
    } catch (err) {
      setError(err.message)
    }
    cargar()
  }

  async function cablearNicho(p, nichoId) {
    setError(null)
    try {
      for (const v of miembrosDe(p)) await api.ajustarPropio(v._id, { nichoId })
    } catch (err) {
      setError(err.message)
    }
    cargar()
  }

  // costo real puesto en bodega: el dato que solo el importador conoce, y el
  // único que falta para que la ganancia por venta deje de ser un techo
  async function guardarCosto(p, costo) {
    setError(null)
    try {
      for (const v of miembrosDe(p)) await api.ajustarPropio(v._id, { costoUnitarioClp: costo })
    } catch (err) {
      setError(err.message)
    }
    cargar()
  }

  // lo que ya salió hacia Full y la bodega todavía no recibió: cuenta como
  // stock para que el panel no pida reponer dos veces lo mismo
  // `envios`: [{ p, unidades }] — el envío completo de un producto (un valor por color) se guarda de una vez;
  // unidades null borra lo anotado
  async function guardarEnvio(envios) {
    setError(null)
    try {
      for (const { p, unidades } of envios) await api.ajustarPropio(p._id, { enCamino: unidades == null ? null : { unidades } })
    } catch (err) {
      setError(err.message)
    }
    await cargar()
  }

  // lo que el dueño dice de reponer una publicación en Full: 'no' (se acabó o se liquida: deja de avisar), 'si'
  // (seguir avisando aunque lleve mucho sin stock) o null (lo decide el tiempo sin stock)
  async function decidirReposicion(p, decision) {
    setError(null)
    try {
      await api.ajustarPropio(p._id, { reponerFull: decision })
    } catch (err) {
      setError(err.message)
    }
    await cargar()
  }

  // escribe el precio EN Mercado Libre (no es un campo local): se confirma
  // antes porque lo ve el comprador en cuanto ML lo procesa. En un producto
  // con colores va a todas sus publicaciones: cada color tiene su precio en ML
  async function cambiarPrecio(p, precioClp) {
    setError(null)
    if (!Number.isFinite(precioClp) || precioClp <= 0) {
      setError('precio inválido')
      return
    }
    const miembros = miembrosDe(p)
    const varios = miembros.length > 1
    const actual = p.economiaUnidad?.precioClp
    const cuales = varios ? `\n\nSe cambia en sus ${miembros.length} publicaciones: ${miembros.map(nombreVariante).join(', ')}.` : ''
    if (!confirm(`¿Cambiar el precio en Mercado Libre de ${fmtPrecio(actual)} a ${fmtPrecio(precioClp)}?\n\n${nombreDe(p)}${cuales}`)) {
      return
    }
    const pausadas = []
    const fallas = []
    for (const v of miembros) {
      try {
        const { resultado } = await api.cambiarPrecio(v._id, precioClp)
        if (resultado?.sinStock) pausadas.push(nombreVariante(v))
      } catch (err) {
        fallas.push(varios ? `${nombreVariante(v)}: ${err.message}` : err.message)
      }
    }
    if (fallas.length) setError(varios ? `El precio no cambió en ${fallas.join(' · ')}` : fallas[0])
    if (pausadas.length) {
      setAviso(
        `Precio actualizado a ${fmtPrecio(precioClp)}. ` +
          (!varios
            ? 'La publicación está pausada por falta de stock: ML la reactivará a este precio cuando llegue mercadería a Full.'
            : pausadas.length === 1
              ? `${pausadas[0]} está pausada por falta de stock: ML la reactivará a este precio cuando llegue mercadería a Full.`
              : `${pausadas.join(', ')} están pausadas por falta de stock: ML las reactivará a este precio cuando llegue mercadería a Full.`),
      )
    }
    cargar()
  }

  async function autoCablear() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const { resultados = [], omitido, motivo } = await api.autoCablearPropios()
      if (omitido) {
        setAviso(motivo)
        return
      }
      const cuenta = (accion) => resultados.filter((r) => r.accion === accion).length
      const partes = []
      const rankea = cuenta('rankea') + cuenta('existente')
      if (rankea) partes.push(`${rankea} cableado(s) a nichos existentes`)
      if (cuenta('creado'))
        partes.push(`${cuenta('creado')} nicho(s) nuevo(s) creados y escaneando (primeros datos en ~10-15 min)`)
      if (cuenta('presupuesto')) partes.push(`${cuenta('presupuesto')} sin crear por presupuesto mensual agotado`)
      if (cuenta('sin-validar'))
        partes.push(`${cuenta('sin-validar')} sin crear porque el autocompletado de ML no respondió (reintenta luego)`)
      if (cuenta('sin-keyword') + cuenta('sin-titulo'))
        partes.push(`${cuenta('sin-keyword') + cuenta('sin-titulo')} sin keyword clara (cablea a mano)`)
      if (cuenta('sin-ia')) partes.push(`${cuenta('sin-ia')} sin IA configurada`)
      setAviso(partes.length ? `Auto-cableado: ${partes.join(' · ')}.` : 'Auto-cableado sin cambios.')
      cargar()
      cargarNichos()
    } catch (err) {
      setError(err.message)
    } finally {
      setOcupado(false)
    }
  }

  async function aplicarEnMl(p, cambios) {
    setAplicando(true)
    setError(null)
    try {
      const { resultado } = await api.aplicarPropio(p._id, cambios)
      const fallas = Object.entries(resultado)
        .filter(([, v]) => !v.ok)
        .map(([campo, v]) => `${campo}: ${v.error}`)
      if (fallas.length) setError(`Mercado Libre rechazó ${fallas.join(' · ')}`)
      else setAviso('Cambio aplicado en Mercado Libre ✓ (puede tardar unos minutos en verse)')
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setAplicando(false)
    }
  }

  async function revisarFicha(p) {
    setRevisandoFicha(true)
    setError(null)
    try {
      await api.revisarFicha(p._id)
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setRevisandoFicha(false)
    }
  }

  async function auditar(p) {
    setError(null)
    setAuditoriaDe(null)
    try {
      await api.auditarPropio(p._id)
      setAviso(
        'Opus 5 está leyendo el título, la descripción, la ficha y las fotos de los peces gordos del nicho — la optimización aparece aquí en 2-5 minutos.',
      )
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  // ORDEN. Por defecto lo que se quiebra antes: sin ventas al final, porque un
  // producto que no vende no tiene urgencia de reposición aunque tenga 0 stock.
  // Un producto con colores se ordena por el color que se quiebra antes.
  const prefijoTitulos = prefijosPorFamilia(entradas.map((e) => e.titulo))
  const ordenadas = ordenarEntradas(filtrarEntradas(entradas, { busqueda, filtro }), orden)
  const paginaActual = paginarEntradas(ordenadas, pagina)
  const filtros = [['todos', 'Todos'], ['full', 'Full'], ['bodega', 'Bodega'], ['reponer', 'Por reponer'], ['pausados', 'Pausados']]

  return (
    <main className="mis-productos">
      <EncabezadoPagina titulo="Mis productos" bajada={`${entradas.length} productos · ${propiosVigentes.length} publicaciones vigentes`}>
        <details className="propios-gestion"><summary><Plus size={16} aria-hidden="true" />Gestionar publicaciones</summary><div className="toolbar">
          {meli?.conectado ? (
            <>
              {/* UN SOLO CONTROL, NO TRES PIEZAS SUELTAS.
                  Antes eran un pill de 10px, un link subrayado de 11px y un
                  botón de 14px alineados en fila: tres pesos distintos que se
                  leían como descuido. Ahora el estado y su acción viven en el
                  mismo bloque, a la misma altura que los botones. */}
              <span className="ml-conexion" title={`conectado el ${fmtFecha(meli.conectadoEl)}`}>
                <i className="ml-punto" aria-hidden="true" />
                <b>{meli.nickname ?? meli.userId}</b>
                {/* re-autorizar tras cambiar permisos de la app en DevCenter:
                    la nueva autorización trae los scopes nuevos al mismo token */}
                <button onClick={conectarMeli}>reconectar</button>
              </span>
              <button className="boton-secundario" onClick={importarMeli} disabled={ocupado}>
                {ocupado ? 'Importando…' : 'Importar mis publicaciones'}
              </button>
            </>
          ) : (
            <button className="boton-secundario" onClick={conectarMeli}>
              Conectar Mercado Libre
            </button>
          )}
          {datos?.propios?.some((p) => !p.nichoId) ? (
            <button
              className="boton-secundario"
              onClick={autoCablear}
              disabled={ocupado}
              title="Detecta el nicho de cada producto (por ranking o por título con IA); si no existe en el tablero, lo crea y lo escanea"
            >
              {ocupado ? 'Cableando…' : 'Cablear nichos (auto)'}
            </button>
          ) : null}
        </div>
      <form className="form-propio" onSubmit={agregar}>
        <input
          type="text"
          placeholder="Pega la URL de tu publicación en Mercado Libre…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={ocupado}
          aria-label="URL de tu publicación"
        />
        <button className="boton-primario" type="submit" disabled={ocupado || !url.trim()}>
          Seguir producto
        </button>
      </form>
      {datos?.calibracion ? <p className="nota">Calibración reseñas → ventas: {fmtNum(datos.calibracion.ventas)} ventas reales · {fmtNum(datos.calibracion.resenasNuevas)} reseñas nuevas · {datos.calibracion.factorObservado != null ? `factor observado ${datos.calibracion.factorObservado}` : 'factor aún sin datos'}.</p> : null}
        </details>
      </EncabezadoPagina>
      {error ? <p className="error-bloque">{error}</p> : null}
      {aviso ? <p className="nota">{aviso}</p> : null}

      {!datos ? (
        <Cargando texto="Cargando tus productos…" />
      ) : !propiosVigentes.length ? (
        <p className="vacio">
          Aún no sigues ningún producto. Pega la URL de una publicación tuya y el sistema la medirá
          todos los días: si aparece en los listados de tus nichos, también verás tu posición.
        </p>
      ) : (
        <>
          <div className="propios-controles">
            <label className="propios-buscador"><Search aria-hidden="true" /><span className="sr-solo">Buscar productos</span><input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, variante o publicación…" /></label>
            <div className="propios-filtros" role="group" aria-label="Filtrar productos">{filtros.map(([valor, nombre]) => <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}>{valor === 'full' ? <Zap size={14} aria-hidden="true" /> : null}{nombre}<span>{entradas.filter((e) => coincideFiltro(e, valor)).length}</span></button>)}</div>
          </div>
          <div className="propios-barra">
            <label>
              <ArrowDownWideNarrow aria-hidden="true" />
              <span className="sr-solo">Ordenar por</span>
              <select value={orden} onChange={(e) => setOrden(e.target.value)}>
                <option value="urgencia">Lo que se quiebra antes</option>
                <option value="ventas">Lo que más vende</option>
                <option value="margen">Lo que más deja</option>
                <option value="alfabetico">Nombre</option>
              </select>
            </label>
            <span className="propios-cuenta" role="status">
              {paginaActual.desde}–{paginaActual.hasta} de {paginaActual.total} productos
            </span>
          </div>

          <div className="propios-grilla propios-grilla-compacta">
            {paginaActual.entradas.map((e) => (
              <TarjetaPropio
                key={e.clave}
                p={e.p}
                familia={e.variantes ? { nombre: e.titulo, variantes: e.variantes } : null}
                m={e.m}
                nichos={nichos}
                onEliminar={eliminar}
                onAbrir={setAbierto}
                onCablear={cablearNicho}
                onAuditar={auditar}
                onVerAuditoria={(x) => setAuditoriaDe(x._id)}
                onGuardarCosto={guardarCosto}
                onGuardarEnvio={guardarEnvio}
                onDecidirReposicion={decidirReposicion}
                onCambiarPrecio={cambiarPrecio}
                expandida={expandido === e.clave}
                onExpandir={(abrir) => setExpandido(abrir ? e.clave : null)}
                prefijos={prefijoTitulos}
              />
            ))}
          </div>
          {!ordenadas.length ? <div className="propios-vacio"><Search aria-hidden="true" /><p>No hay productos con estos filtros.</p><button className="boton-secundario" onClick={() => { setBusqueda(''); setFiltro('todos') }}>Mostrar todos</button></div> : null}
          {paginaActual.paginas > 1 ? <nav className="propios-paginacion" aria-label="Páginas de productos"><button type="button" disabled={paginaActual.pagina === 1} onClick={() => { setPagina(paginaActual.pagina - 1); setExpandido(null) }}><ChevronLeft size={16} />Anterior</button><span>Página {paginaActual.pagina} de {paginaActual.paginas}</span><button type="button" disabled={paginaActual.pagina === paginaActual.paginas} onClick={() => { setPagina(paginaActual.pagina + 1); setExpandido(null) }}>Siguiente<ChevronRight size={16} /></button></nav> : null}
          {Object.keys(datos.carteras ?? {}).length ? <details className="propios-comparar"><summary><LineChart size={16} aria-hidden="true" />Comparar mis productos por nicho</summary>{Object.entries(datos.carteras).map(([nichoId, c]) => <CarteraNicho key={nichoId} c={c} />)}</details> : null}
        </>
      )}


      {abierto ? (
        <PanelPropio propio={abierto} onCerrar={() => setAbierto(null)} onGuardarCosto={guardarCosto} />
      ) : null}
      {(() => {
        // el panel lee del listado fresco: si se re-audita, se actualiza solo
        const propioAuditado = datos?.propios?.find((x) => x._id === auditoriaDe)
        return propioAuditado?.auditoria?.estado === 'ok' ? (
          <PanelAuditoria
            propio={propioAuditado}
            onCerrar={() => setAuditoriaDe(null)}
            onRegenerar={auditar}
            onAplicar={aplicarEnMl}
            aplicando={aplicando}
            onRevisarFicha={revisarFicha}
            revisandoFicha={revisandoFicha}
          />
        ) : null
      })()}
    </main>
  )
}
