import { useCallback, useEffect, useState } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { api } from '../api.js'
import { IconoExterno, Cargando } from './ui.jsx'
import { MiniSerie } from './graficos.jsx'
import {
  Tag,
  ShoppingCart,
  DollarSign,
  PiggyBank,
  Percent,
  Eye,
  Star,
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
} from 'lucide-react'
import { BotonCopiar } from './Listing.jsx'
import { fmtNum, fmtPrecio, fmtFecha } from '../lib/formato.js'

const FACTOR_VENTAS = 25 // misma heurística del score: ~1 reseña por cada 25 ventas

function deltas(mediciones) {
  if (!mediciones?.length) return null
  const ultima = mediciones[mediciones.length - 1]
  const previa = mediciones.length > 1 ? mediciones[mediciones.length - 2] : null
  const delta = (campo) =>
    previa && Number.isFinite(ultima[campo]) && Number.isFinite(previa[campo])
      ? ultima[campo] - previa[campo]
      : null
  return { ultima, dReviews: delta('numReviews'), dPrecio: delta('precio'), dVendidos: delta('vendidos') }
}

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

// Qué pasa con CADA venta al precio de hoy, y cuánto queda para pagar el
// producto. Es la pregunta que el importador hace de verdad: "¿en cuánto me
// tiene que llegar para que esto valga la pena?". El techo se muestra aunque
// todavía no haya costo cargado — sirve para decidir la compra.
function GananciaUnidad({ p, onGuardarCosto, onCambiarPrecio }) {
  const e = p.economiaUnidad
  const [costo, setCosto] = useState(p.costoUnitarioClp ?? '')
  const [guardando, setGuardando] = useState(false)
  const [editandoPrecio, setEditandoPrecio] = useState(false)
  const [precio, setPrecio] = useState('')
  const [aplicando, setAplicando] = useState(false)
  useEffect(() => {
    setCosto(p.costoUnitarioClp ?? '')
  }, [p.costoUnitarioClp])
  if (!e) return null

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true)
    try {
      await onGuardarCosto(p, costo === '' ? null : Number(costo))
    } finally {
      setGuardando(false)
    }
  }

  async function aplicarPrecio(ev) {
    ev.preventDefault()
    setAplicando(true)
    try {
      await onCambiarPrecio(p, Number(precio))
      setEditandoPrecio(false)
    } finally {
      setAplicando(false)
    }
  }

  const g = e.gananciaClp
  return (
    <div className="pc-ganancia" onClick={(ev) => ev.stopPropagation()}>
      {editandoPrecio ? (
        <form className="gan-precio-form" onSubmit={aplicarPrecio}>
          <label>nuevo precio</label>
          <input
            type="number"
            min="1"
            step="1"
            autoFocus
            value={precio}
            onChange={(ev) => setPrecio(ev.target.value)}
            placeholder={String(e.precioClp)}
          />
          <button type="submit" className="boton-secundario boton-chico" disabled={aplicando || !precio}>
            {aplicando ? 'aplicando…' : 'aplicar en ML'}
          </button>
          <button type="button" className="boton-plano boton-chico" onClick={() => setEditandoPrecio(false)}>
            cancelar
          </button>
        </form>
      ) : (
        <div className="gan-titulo">
          Por cada venta a {fmtPrecio(e.precioClp)}
          <button
            type="button"
            className="gan-cambiar"
            title="Cambiar el precio en Mercado Libre"
            onClick={() => {
              setPrecio(String(e.precioClp))
              setEditandoPrecio(true)
            }}
          >
            cambiar
          </button>
        </div>
      )}
      <ul className="gan-desglose">
        <li>
          <span>comisión ML{e.comisionPct ? ` ${e.comisionPct}%` : ''}</span>
          <b>{e.comisionClp != null ? `−${fmtPrecio(e.comisionClp)}` : 'sin dato'}</b>
        </li>
        {e.esFull ? (
          <li>
            {/* El envío facturado le gana a la tarifa: sobre los propios de
                agosto el tarifario decía $799 donde ML cobró $2.487, y con eso
                la ganancia salía optimista justo en los de ticket bajo. */}
            <span
              title={
                e.envioBase === 'facturado'
                  ? `Promedio de lo que ML facturó por envío en los últimos 30 días.${
                      e.envioTarifarioClp != null ? ` El tarifario estimaba ${fmtPrecio(e.envioTarifarioClp)}.` : ''
                    }`
                  : 'Estimado del tarifario de ML: todavía no hay envíos facturados de este producto.'
              }
            >
              envío Full{e.envioBase === 'facturado' ? ' (facturado)' : e.envioSupuesto ? ' (caja estimada)' : ''}
            </span>
            <b>{e.envioClp != null ? `−${fmtPrecio(e.envioClp)}` : 'sin dato'}</b>
          </li>
        ) : (
          // sin Full el cargo de despacho existe igual pero ML no lo tarifica
          // acá: decirlo, o el techo se lee como si fuera completo
          <li className="gan-ojo">
            <span>envío</span>
            <b>no incluido (no es Full)</b>
          </li>
        )}
        <li className="gan-queda">
          <span>te queda</span>
          <b>{fmtPrecio(e.quedaParaProductoClp)}</b>
        </li>
      </ul>
      <form className="gan-costo" onSubmit={guardar}>
        <label htmlFor={`costo-${p._id}`}>llegó a</label>
        <input
          id={`costo-${p._id}`}
          type="number"
          min="0"
          step="1"
          placeholder="costo puesto en bodega"
          value={costo}
          onChange={(ev) => setCosto(ev.target.value)}
        />
        <button type="submit" className="boton-secundario boton-chico" disabled={guardando}>
          {guardando ? '…' : 'guardar'}
        </button>
      </form>
      {g === null ? (
        <p className="gan-vacio">
          Escribe en cuánto te llegó puesto en bodega de ML (producto + flete + internación + despacho).
          Tienes <b>{fmtPrecio(e.quedaParaProductoClp)}</b> de techo: sobre eso, cada venta pierde plata.
        </p>
      ) : (
        <div className={`gan-resultado ${g < 0 ? 'gan-mal' : 'gan-bien'}`}>
          <span>{g < 0 ? 'pierdes por unidad' : 'ganancia por unidad'}</span>
          <b>
            {fmtPrecio(g)}
            {e.gananciaPct != null ? ` · ${e.gananciaPct}%` : ''}
          </b>
        </div>
      )}
    </div>
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

function Reposicion({ r }) {
  if (!r) return null
  const tono = TONO_URGENCIA[r.urgencia]
  const texto =
    r.urgencia === 'quebrado'
      ? 'Sin stock'
      : r.urgencia === 'sin_ventas'
        ? `${fmtNum(r.stock)} en bodega · sin ventas que proyectar`
        : `Se quiebra en ${r.diasCobertura} días`

  return (
    <div className={`pc-repo${tono ? ` pc-repo-${tono}` : ''}`}>
      <strong>{texto}</strong>
      <span>
        {fmtNum(r.stock)} en bodega
        {r.enCamino ? ` · ${fmtNum(r.enCamino)} en camino` : ''}
        {r.velocidadDia > 0 ? ` · ${r.velocidadDia}/día (${r.base})` : ''}
      </span>
      {r.aEnviar > 0 ? <b className="pc-repo-accion">enviar {fmtNum(r.aEnviar)}</b> : null}
      {r.retenido > 0 ? (
        <em className="pc-repo-retenido" title={r.motivosRetenido.map((m) => `${m.motivo}: ${m.unidades}`).join(' · ')}>
          {fmtNum(r.retenido)} retenida(s) en ML
        </em>
      ) : null}
      {/* el item y la bodega deberían decir lo mismo; cuando no, es dato */}
      {r.descuadreItem ? (
        <em className="pc-repo-descuadre" title="ML declara en el item un stock distinto al que tiene en bodega">
          el item declara {r.descuadreItem > 0 ? '+' : ''}{fmtNum(r.descuadreItem)}
        </em>
      ) : null}
    </div>
  )
}

// los tres que se miran para decidir; el resto baja al pliegue
const PRINCIPALES = new Set(['Ventas 7d', 'Margen 30d', 'ML cobra 30d'])

function TarjetaPropio({ p, nichos, onEliminar, onAbrir, onCablear, onAuditar, onVerAuditoria, onGuardarCosto, onCambiarPrecio, expandida = false, onExpandir, prefijos = null }) {
  const d = deltas(p.mediciones)
  const a = p.auditoria
  const generando =
    a?.estado === 'generando' &&
    (!a.solicitadaEl || Date.now() - new Date(a.solicitadaEl).getTime() < 30 * 60e3)
  const ventas7 = p.ventas7d?.unidades ?? (p.ventas30d ? 0 : null)
  const promo = p.promoMl?.activa ?? null
  const precioEfectivo = promo?.precio ?? d?.ultima?.precioEfectivo ?? d?.ultima?.precio
  const intervenciones = p.impacto?.intervenciones ?? []
  const midiendo = intervenciones.filter((i) => i.veredicto === 'midiendo').length

  // NUEVE KPIS ERAN OCHO DE MÁS.
  //
  // La tarjeta mostraba precio, ventas, conversión, visitas, margen, cargos ML,
  // stock, reseñas e ingresos — todos del mismo tamaño y del mismo color. El
  // importador lo dijo así: "hay mucho relleno". Y tenía razón: con nueve
  // números iguales ninguno resalta, y la pregunta que uno trae a esta pantalla
  // ("¿tengo que hacer algo con este producto hoy?") no la contesta ninguno.
  //
  // Ahora tres arriba —lo que vende, lo que deja, lo que ML se lleva— y el
  // resto plegado. La reposición va en su propia banda, porque es lo único que
  // exige acción hoy.
  const kpis = [
    {
      k: 'Precio',
      v: fmtPrecio(precioEfectivo),
      extra: promo ? <span className="precio-lista">{fmtPrecio(d?.ultima?.precio)}</span> : null,
      Icono: Tag,
      tono: promo ? 'aviso' : null,
    },
    {
      k: 'Ventas 7d',
      v: ventas7 != null ? fmtNum(ventas7) : '—',
      Icono: ShoppingCart,
      tono: ventas7 > 0 ? 'bien' : ventas7 === 0 ? 'mal' : null,
    },
    {
      k: 'Conversión',
      v: p.conversion7d != null ? `${p.conversion7d}%` : '—',
      Icono: Percent,
      tono: p.conversion7d >= 3 ? 'bien' : null,
    },
    { k: 'Visitas 7d', v: fmtNum(d?.ultima?.visitas), Icono: Eye, tono: (d?.ultima?.visitas ?? 0) < 10 ? 'mal' : null },
    {
      k: 'Margen 30d',
      v: p.margen30d ? fmtPrecio(p.margen30d.margenClp) : p.ventas30d ? 'falta costo' : '—',
      Icono: PiggyBank,
      tono: p.margen30d ? (p.margen30d.margenClp < 0 ? 'mal' : 'bien') : p.ventas30d ? 'aviso' : null,
      ayuda: p.margen30d
        ? `Base: ${p.margen30d.base ?? '—'}\ningresos ${fmtPrecio(p.ventas30d?.ingresosClp)}\n− ML ${fmtPrecio(p.margen30d.cargosMlClp ?? p.margen30d.comisionClp)}\n− costo ${fmtPrecio(p.margen30d.costoClp)}`
        : 'Carga el costo por unidad (clic en la tarjeta) para ver el margen real',
    },
    // lo que ML cobra DE VERDAD: comisión + envío + ads, del detalle de facturación
    {
      k: 'ML cobra 30d',
      v: p.cargosMl30d ? fmtPrecio(p.cargosMl30d.totalClp) : '—',
      Icono: Percent,
      tono: p.cargosMl30d && p.ventas30d?.ingresosClp
        ? p.cargosMl30d.totalClp / p.ventas30d.ingresosClp > 0.5
          ? 'mal'
          : 'aviso'
        : null,
      ayuda: p.cargosMl30d
        ? [
            `comisión ${fmtPrecio(p.cargosMl30d.comisionClp)}`,
            `envío ${fmtPrecio(p.cargosMl30d.envioClp)}`,
            `publicidad ${fmtPrecio(p.cargosMl30d.adsClp)}`,
            // bolsillos que antes caían en "otros" y no se veían
            p.cargosMl30d.colectaClp ? `colecta ${fmtPrecio(p.cargosMl30d.colectaClp)}` : null,
            p.cargosMl30d.almacenajeClp ? `almacenaje ${fmtPrecio(p.cargosMl30d.almacenajeClp)}` : null,
            p.cargosMl30d.otrosClp ? `otros ${fmtPrecio(p.cargosMl30d.otrosClp)}` : null,
            `${p.cargosMl30d.lineas} línea(s) facturadas`,
          ]
            .filter(Boolean)
            .join('\n')
        : 'Se sincroniza a diario desde el detalle de facturación de ML',
    },
    { k: 'Stock', v: fmtNum(d?.ultima?.stock), Icono: Package, tono: d?.ultima?.stock <= 3 ? 'aviso' : null },
    {
      k: 'Reseñas',
      v: `${fmtNum(d?.ultima?.numReviews)}${d?.ultima?.rating ? ` ★${d.ultima.rating}` : ''}`,
      Icono: Star,
      tono: d?.ultima?.numReviews ? 'bien' : 'mal',
    },
    { k: 'Ingresos 30d', v: p.ventas30d ? fmtPrecio(p.ventas30d.ingresosClp) : '—', Icono: DollarSign },
  ]

  // COLAPSADA: la foto manda y el resto se resume.
  //
  // Con 8 productos la lista vertical se leía; con 40 es scroll infinito. El
  // importador lo pidió así: grilla con la foto del producto, que se abra.
  // Acá la tarjeta tiene DOS estados y la misma identidad — abrir no navega a
  // otra parte, expande en su lugar. Eso conserva el contexto: sigues viendo
  // dónde estabas en la grilla.
  if (!expandida) {
    const r = p.reposicion
    const urg = r ? TONO_URGENCIA[r.urgencia] : null
    return (
      <article className={`propio-card pc-mini${urg ? ` pc-mini-${urg}` : ''}`}>
        <button
          className="pc-mini-abrir"
          onClick={() => onExpandir?.(p._id)}
          aria-expanded={false}
          aria-label={`Abrir ${p.titulo ?? p.sku}`}
        >
          <span className="pc-mini-foto">
            {p.imagen ? (
              <img src={p.imagen} alt="" loading="lazy" />
            ) : (
              <span className="sin-imagen" />
            )}
            {/* el estado de quiebre va SOBRE la foto: es lo único que hay que
                ver sin abrir nada, y desde lejos */}
            {/* UN SELLO, NO DOS. Una publicación pausada casi siempre lo está
                PORQUE se quedó sin stock en Full — mostrar "sin stock" y
                "pausada" una al lado de la otra dice lo mismo dos veces y
                ensucia la foto. Cuando coinciden gana la causa, con la
                consecuencia como letra chica. */}
            {r?.urgencia === 'quebrado' ? (
              <span className="pc-mini-sello pc-mini-sello-mal">
                sin stock{p.estadoMl === 'paused' ? <i> · pausada</i> : null}
              </span>
            ) : r && r.urgencia !== 'holgado' && r.urgencia !== 'sin_ventas' ? (
              <span className={`pc-mini-sello pc-mini-sello-${urg}`}>{r.diasCobertura} días</span>
            ) : p.estadoMl === 'paused' ? (
              <span className="pc-mini-sello pc-mini-sello-pausa">pausada</span>
            ) : null}
          </span>
          {/* EL PRECIO AL QUE SE ESTÁ VENDIENDO HOY, justo bajo la foto.
              Es el dato con el que se leen todos los demás: una conversión de
              4% dice cosas muy distintas a $2.960 que a $6.780. Va antes del
              título porque se busca con la vista junto con la imagen, no
              leyendo.
              Con promoción activa manda el precio EFECTIVO —lo que el comprador
              paga y sobre lo que ML cobra comisión— con el de lista tachado al
              lado, igual que se ve en ML. */}
          {Number.isFinite(precioEfectivo) ? (
            <span className="pc-mini-precio">
              <b>{fmtPrecio(precioEfectivo)}</b>
              {promo?.precioOriginal > precioEfectivo ? (
                <s title={`${promo.nombre ?? 'Promoción'}: el cliente paga ${fmtPrecio(precioEfectivo)}`}>
                  {fmtPrecio(promo.precioOriginal)}
                </s>
              ) : null}
            </span>
          ) : null}
          <span className="pc-mini-titulo" title={p.titulo ?? p.sku}>
            {tituloCorto(p.titulo ?? p.sku, prefijos?.get(p.titulo) ?? '')}
          </span>
          {/* SEMÁFORO DE LOS ÚLTIMOS 7 DÍAS: ¿este producto va bien AHORA?
              Verde vende y convierte, rojo no vende, ámbar convierte poco o le
              falta el costo para saber si gana. El stock no está acá porque ya
              vive sobre la foto. */}
          <span className="pc-mini-kpis">
            <em className={`k-${ventas7 > 0 ? 'bien' : ventas7 === 0 ? 'mal' : 'neutro'}`}>
              <b>{ventas7 != null ? fmtNum(ventas7) : '—'}</b> vend. 7d
            </em>
            <em className={`k-${p.conversion7d == null ? 'neutro' : p.conversion7d >= 3 ? 'bien' : p.conversion7d >= 1.5 ? 'aviso' : 'mal'}`}>
              <b>{p.conversion7d != null ? `${p.conversion7d}%` : '—'}</b> conv.
            </em>
            <em className={`k-${p.margen30d ? (p.margen30d.margenClp > 0 ? 'bien' : 'mal') : p.ventas30d ? 'aviso' : 'neutro'}`}>
              <b>{p.margen30d ? fmtPrecio(p.margen30d.margenClp) : p.ventas30d ? 'falta costo' : '—'}</b> margen
            </em>
          </span>
          {p.reposicion?.aEnviar > 0 ? (
            <span className="pc-mini-accion">enviar {fmtNum(p.reposicion.aEnviar)}</span>
          ) : null}
        </button>
      </article>
    )
  }

  return (
    <article className="propio-card pc-abierta">
      <header className="pc-head">
        <button className="pc-foto" onClick={() => onAbrir(p)} aria-label="Ver series del producto">
          {p.imagen ? <img src={p.imagen} alt="" loading="lazy" width="64" height="64" /> : <span className="sin-imagen" />}
        </button>
        <div className="pc-ident">
          <h3 onClick={() => onAbrir(p)}>{p.titulo ?? p.sku}</h3>
          <div className="pc-chips">
            {p.envioMl?.logistica === 'fulfillment' ? (
              <span className="chip-full">
                <Zap aria-hidden="true" />
                FULL
              </span>
            ) : p.envioMl?.logistica ? (
              <span className="badge badge-neutro">{p.envioMl.flex ? 'Flex' : 'colecta'}</span>
            ) : null}
            {p.estadoMl && p.estadoMl !== 'active' ? (
              <span className="badge badge-neutro">{p.estadoMl === 'paused' ? 'pausada' : p.estadoMl}</span>
            ) : null}
            {promo ? <span className="chip-promo">–{Math.round((1 - promo.precio / promo.precioOriginal) * 100)}%</span> : null}
            <span className="pc-pos">
              {p.posicionReciente
                ? `#${p.posicionReciente.posicion} en “${p.posicionReciente.keyword}”`
                : 'fuera de los listados trackeados'}
            </span>
          </div>
        </div>
        <div className="pc-acciones">
          <button className="icono-boton" onClick={() => onAbrir(p)} aria-label="Ver series">
            <LineChart aria-hidden="true" />
          </button>
          <a href={p.url} target="_blank" rel="noreferrer" className="icono-boton" aria-label="Abrir en Mercado Libre">
            <ExternalLink aria-hidden="true" />
          </a>
          <button className="icono-boton icono-peligro" onClick={() => onEliminar(p)} aria-label="Quitar producto">
            <Trash2 aria-hidden="true" />
          </button>
          <button className="icono-boton" onClick={() => onExpandir?.(null)} aria-label="Cerrar la tarjeta" aria-expanded>
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      <Reposicion r={p.reposicion} />

      <div className="pc-kpis" onClick={() => onAbrir(p)}>
        {kpis.filter((x) => PRINCIPALES.has(x.k)).map(({ k, v, extra, Icono, tono, ayuda }) => (
          <div key={k} className={`kpi${tono ? ` kpi-${tono}` : ''}`} title={ayuda}>
            <span className="kpi-k">
              <Icono aria-hidden="true" />
              {k}
            </span>
            <span className="kpi-v">
              {v}
              {extra}
            </span>
          </div>
        ))}
      </div>

      {/* el resto no desaparece: baja a un pliegue, que es donde vive lo que se
          consulta a veces y no se decide todos los días */}
      <details className="pc-mas">
        <summary>Más números</summary>
        <div className="pc-kpis pc-kpis-menor">
          {kpis.filter((x) => !PRINCIPALES.has(x.k)).map(({ k, v, extra, Icono, tono, ayuda }) => (
            <div key={k} className={`kpi${tono ? ` kpi-${tono}` : ''}`} title={ayuda}>
              <span className="kpi-k">
                <Icono aria-hidden="true" />
                {k}
              </span>
              <span className="kpi-v">
                {v}
                {extra}
              </span>
            </div>
          ))}
        </div>
      </details>

      <GananciaUnidad p={p} onGuardarCosto={onGuardarCosto} onCambiarPrecio={onCambiarPrecio} />

      <div className="pc-optimizador">
        <span className="propio-optimizacion-marca">
          <Sparkles aria-hidden="true" />
          Opus 5
        </span>
        <select
          className="selector-nicho"
          value={p.nichoId ?? ''}
          onChange={(e) => onCablear(p, e.target.value || null)}
          aria-label="Nicho contra el que se optimiza"
        >
          <option value="">— elegir nicho —</option>
          {nichos.map((n) => (
            <option key={n._id} value={n._id}>
              {n.keyword}
            </option>
          ))}
        </select>
        {!p.nichoId ? (
          <span className="vacio">cablea un nicho para comparar contra los peces gordos</span>
        ) : generando ? (
          <span className="badge badge-neutro">leyendo a los ganadores del nicho…</span>
        ) : a?.estado === 'ok' ? (
          <>
            <button className="boton-secundario boton-chico" onClick={() => onVerAuditoria(p)}>
              ver optimización{a.resultado?.quickWins?.length ? ` (${a.resultado.quickWins.length})` : ''}
            </button>
            {a.resultado?.quickWins?.[0] ? (
              <span className="propio-quickwin" title={a.resultado.quickWins[0]}>
                1º: {a.resultado.quickWins[0]}
              </span>
            ) : null}
          </>
        ) : (
          <button
            className="boton-secundario boton-chico"
            title={a?.estado === 'error' ? `la anterior falló: ${a.error}` : 'Opus 5 lee título, descripción, ficha y fotos reales de los peces gordos'}
            onClick={() => onAuditar(p)}
          >
            {a?.estado === 'error' ? 'reintentar optimización' : 'optimizar con Opus 5'}
          </button>
        )}
      </div>

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
              ? `${intervenciones.length} cambio(s) · ${midiendo} midiendo`
              : `${intervenciones.length} cambio(s) medidos`
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
          resumen={`${p.surtido.sugeridos.length} formato(s) que venden en “${p.surtido.keyword}” y no tienes`}
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

export function MisProductos() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [abierto, setAbierto] = useState(null)
  // una sola tarjeta abierta a la vez: dos expandidas vuelven a ser una lista
  const [expandido, setExpandido] = useState(null)
  const [orden, setOrden] = useState('urgencia')
  const [meli, setMeli] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [nichos, setNichos] = useState([])
  const [auditoriaDe, setAuditoriaDe] = useState(null) // _id del propio con el panel de auditoría abierto
  const [aplicando, setAplicando] = useState(false)
  const [revisandoFicha, setRevisandoFicha] = useState(false)

  const cargar = useCallback(() => {
    api.listarPropios().then(setDatos).catch((e) => setError(e.message))
  }, [])

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
    if (!confirm(`¿Dejar de seguir "${p.titulo ?? p.sku}"?`)) return
    try {
      await api.eliminarPropio(p._id)
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  async function cablearNicho(p, nichoId) {
    setError(null)
    try {
      await api.ajustarPropio(p._id, { nichoId })
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  // costo real puesto en bodega: el dato que solo el importador conoce, y el
  // único que falta para que la ganancia por venta deje de ser un techo
  async function guardarCosto(p, costo) {
    setError(null)
    try {
      await api.ajustarPropio(p._id, { costoUnitarioClp: costo })
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  // escribe el precio EN Mercado Libre (no es un campo local): se confirma
  // antes porque lo ve el comprador en cuanto ML lo procesa
  async function cambiarPrecio(p, precioClp) {
    setError(null)
    if (!Number.isFinite(precioClp) || precioClp <= 0) {
      setError('precio inválido')
      return
    }
    const actual = p.economiaUnidad?.precioClp
    if (!confirm(`¿Cambiar el precio en Mercado Libre de ${fmtPrecio(actual)} a ${fmtPrecio(precioClp)}?\n\n${p.titulo ?? p.sku}`)) {
      return
    }
    try {
      const { resultado } = await api.cambiarPrecio(p._id, precioClp)
      if (resultado?.sinStock) {
        setAviso(
          `Precio actualizado a ${fmtPrecio(resultado.precio)}. La publicación está pausada por falta de stock: ` +
            'ML la reactivará a este precio cuando llegue mercadería a Full.',
        )
      }
      cargar()
    } catch (err) {
      setError(err.message)
    }
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
  const PESO_URGENCIA = { quebrado: 0, critico: 1, reponer: 2, holgado: 3, sin_ventas: 4 }
  const prefijoTitulos = prefijosPorFamilia((datos?.propios ?? []).map((x) => x.titulo))
  const ordenados = [...(datos?.propios ?? [])].sort((a, b) => {
    if (orden === 'ventas') return (b.ventas7d?.unidades ?? 0) - (a.ventas7d?.unidades ?? 0)
    if (orden === 'margen') return (b.margen30d?.margenClp ?? -Infinity) - (a.margen30d?.margenClp ?? -Infinity)
    if (orden === 'alfabetico') return (a.titulo ?? '').localeCompare(b.titulo ?? '')
    const pa = PESO_URGENCIA[a.reposicion?.urgencia] ?? 5
    const pb = PESO_URGENCIA[b.reposicion?.urgencia] ?? 5
    if (pa !== pb) return pa - pb
    return (a.reposicion?.diasCobertura ?? 9999) - (b.reposicion?.diasCobertura ?? 9999)
  })

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Mis productos</h2>
          <p className="reporte-fecha">
            Se actualiza solo: ventas, visitas y stock por API oficial cada ~45 min; detalle completo y
            publicaciones nuevas a diario; optimización los martes.
          </p>
          {datos?.calibracion ? (
            <p
              className="reporte-fecha"
              title="Ventas reales de tu cuenta vs reseñas nuevas de tus publicaciones desde la primera venta: el ancla que convierte el factor teórico 25 en dato. Converge a medida que vendes."
            >
              Calibración reseñas→ventas: {fmtNum(datos.calibracion.ventas)} venta(s) real(es) ·{' '}
              {fmtNum(datos.calibracion.resenasNuevas)} reseña(s) nueva(s) →{' '}
              {datos.calibracion.factorObservado != null
                ? `factor observado ${datos.calibracion.factorObservado} (teórico 25)`
                : 'factor aún sin datos: falta la primera reseña propia (teórico 25)'}
            </p>
          ) : null}
        </div>
        <div className="toolbar">
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
      {error ? <p className="error-bloque">{error}</p> : null}
      {aviso ? <p className="nota">{aviso}</p> : null}

      {!datos ? (
        <Cargando texto="Cargando tus productos…" />
      ) : !datos.propios.length ? (
        <p className="vacio">
          Aún no sigues ningún producto. Pega la URL de una publicación tuya y el sistema la medirá
          todos los días: si aparece en los listados de tus nichos, también verás tu posición.
        </p>
      ) : (
        <>
          {Object.entries(datos.carteras ?? {}).map(([nichoId, c]) => (
            <CarteraNicho key={nichoId} c={c} />
          ))}

          {/* EL ORDEN ES LA MITAD DEL REDISEÑO.
              Una grilla de 40 tarjetas sin ordenar es el mismo scroll infinito
              con otra forma. Por defecto manda lo que se quiebra antes: eso es
              lo que uno viene a resolver a esta pantalla. */}
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
            <span className="propios-cuenta">{ordenados.length} producto(s)</span>
          </div>

          <div className="propios-grilla">
            {ordenados.map((p) => (
              <TarjetaPropio
                key={p._id}
                p={p}
                nichos={nichos}
                onEliminar={eliminar}
                onAbrir={setAbierto}
                onCablear={cablearNicho}
                onAuditar={auditar}
                onVerAuditoria={(x) => setAuditoriaDe(x._id)}
                onGuardarCosto={guardarCosto}
                onCambiarPrecio={cambiarPrecio}
                expandida={expandido === p._id}
                onExpandir={setExpandido}
                prefijos={prefijoTitulos}
              />
            ))}
          </div>
        </>
      )}

      <p className="nota">
        Con la cuenta de Mercado Libre conectada, stock, ventas, visitas, ingresos y caja de compra
        vienen de la API oficial (exactos). "Caja de compra" aplica a publicaciones de catálogo: si
        no estás ganando, muestra el precio que la ganaría. "Ingresos 30d" suma tus órdenes pagadas
        reales. La chapa "real" marca ventas del período medidas por ML; la cifra con ~ es la
        estimación por reseñas (~{FACTOR_VENTAS} por reseña nueva). Cablea un nicho del tablero y
        "optimizar con Opus 5" lee el título, la descripción, la ficha y las fotos reales de los
        peces gordos del listado (los que más han vendido) y te dice dónde estás fallando, con
        títulos, descripción y plan de fotos listos para pegar.
      </p>

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
