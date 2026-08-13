import { useCallback, useEffect, useRef, useState } from 'react'
import { api, claveApi } from './api.js'
import { Resumen } from './components/Resumen.jsx'
import { Productos } from './components/Productos.jsx'
import { Simulador } from './components/Simulador.jsx'
import { Analisis } from './components/Analisis.jsx'
import { Listing } from './components/Listing.jsx'
import { MisProductos } from './components/MisProductos.jsx'
import { Publicidad } from './components/Publicidad.jsx'
import { Oportunidades } from './components/Oportunidades.jsx'
import { Radar } from './components/Sugerencias.jsx'
import { Busqueda } from './components/Busqueda.jsx'
import { Contabilidad } from './components/Contabilidad.jsx'
import { Cargando, ScoreRing, MarcaIcono } from './components/ui.jsx'
import { Radar as RadarIcono, Landmark } from 'lucide-react'
import { fmtNum, fmtPrecio, fmtFecha } from './lib/formato.js'
import { GRUPOS, agruparNichos, anidarFamilias } from './lib/sidebar.js'

function PresupuestoChip() {
  const [gastos, setGastos] = useState(null)

  useEffect(() => {
    let vigente = true
    const cargar = () => api.gastos().then((g) => vigente && setGastos(g)).catch(() => {})
    cargar()
    const intervalo = setInterval(cargar, 5 * 60_000)
    return () => {
      vigente = false
      clearInterval(intervalo)
    }
  }, [])

  if (!gastos) return null
  const pct = Math.min(100, Math.round((gastos.gastadoUsd / gastos.presupuestoUsd) * 100))
  return (
    <div
      className="presupuesto"
      title={`Gasto de ${gastos.mes}: Apify + IA${
        gastos.apify?.topeUsd
          ? ` · saldo REAL Apify: US$${Math.round(gastos.apify.gastadoUsd)} de ${gastos.apify.topeUsd} (ciclo hasta ${String(gastos.apify.cicloHasta ?? '').slice(0, 10)})`
          : ''
      }`}
    >
      <span className="presupuesto-texto">
        US$ {gastos.gastadoUsd.toFixed(2)} <span className="presupuesto-tope">/ {gastos.presupuestoUsd} este mes</span>
      </span>
      <span className="presupuesto-riel" aria-hidden="true">
        <span className={pct >= 80 ? 'presupuesto-uso alto' : 'presupuesto-uso'} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

// Ventas reales de la cuenta ML en el topbar: el ciclo de propios las trae
// cada ~45 min — la primera alegría del día sin abrir Seller Central
function VentasChip() {
  const [resumen, setResumen] = useState(null)

  useEffect(() => {
    let vigente = true
    const cargar = () => api.ventasResumen().then((r) => vigente && setResumen(r)).catch(() => {})
    cargar()
    const intervalo = setInterval(cargar, 5 * 60_000)
    return () => {
      vigente = false
      clearInterval(intervalo)
    }
  }, [])

  if (!resumen || (!resumen.hoy?.unidades && !resumen.semana?.unidades)) return null
  const conHoy = resumen.hoy.unidades > 0
  const { unidades, ingresosClp } = conHoy ? resumen.hoy : resumen.semana
  return (
    <div className="presupuesto" title="Ventas reales de tu cuenta ML (órdenes pagadas; se refresca cada ~45 min)">
      <span className="presupuesto-texto">
        🛒 {unidades} {unidades === 1 ? 'venta' : 'ventas'} {conHoy ? 'hoy' : 'esta semana'} ·{' '}
        {fmtPrecio(ingresosClp)}
      </span>
    </div>
  )
}

function FormNuevoNicho({ onCreado }) {
  const [keyword, setKeyword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    if (keyword.trim().length < 2) return
    setEnviando(true)
    setError(null)
    try {
      const { nicho } = await api.crearNicho(keyword.trim())
      setKeyword('')
      onCreado(nicho)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="form-nicho" onSubmit={enviar}>
      <input
        type="text"
        placeholder="Nueva keyword, ej: foco solares"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        disabled={enviando}
        aria-label="Keyword del nuevo nicho"
      />
      <button type="submit" className="boton-primario" disabled={enviando || keyword.trim().length < 2}>
        {enviando ? 'Creando…' : 'Crear nicho'}
      </button>
      {error ? <span className="error-inline">{error}</span> : null}
    </form>
  )
}

const ETAPAS = {
  cola: 'en cola, esperando turno…',
  escaneando: 'escaneando listado…',
  detalle: 'leyendo detalle de productos…',
  analizando: 'analizando con IA…',
  reintento: 'ML bloqueó el detalle — reintento programado (horas)…',
}

const esNuevo = (n) => n.creadoEl && Date.now() - new Date(n.creadoEl).getTime() < 72 * 3600e3

// cuenta regresiva del próximo scan programado; "al caer" = ya venció y el
// programador (pasa cada 30 min) lo encola en su próxima pasada
function fmtProximoScan(fecha) {
  const falta = new Date(fecha).getTime() - Date.now()
  if (falta <= 0) return 'al caer'
  if (falta < 3600e3) return `en ${Math.max(1, Math.round(falta / 60_000))} min`
  if (falta < 48 * 3600e3) return `en ${Math.round(falta / 3600e3)} h`
  return `en ${Math.round(falta / 86400e3)} d`
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fmtMes = (aaaamm) => {
  if (!aaaamm) return ''
  const [a, m] = aaaamm.split('-')
  return `${MESES[Number(m) - 1]}${a !== String(new Date().getFullYear()) ? ` ${a.slice(2)}` : ''}`
}

// La ventana la calcula el backend (services/ventana.js) desde los meses pico
// del radar; acá solo se traduce a una etiqueta corta. Un nicho bueno con la
// ventana cerrada es peor negocio que uno mediano comprable hoy.
function chipVentana(n) {
  if (n.estado === 'pausado' && n.revisarEl) {
    const m = String(n.revisarEl).slice(0, 7)
    return { clase: 'futura', texto: `vuelve ${fmtMes(m)}`, ayuda: 'Re-evaluación programada: el sistema lo reactiva solo' }
  }
  const v = n.ventana
  if (!v || v.estado === 'sin-temporada') return null
  // de dónde sale la fecha: la curva son 5 años de búsquedas reales, la
  // estacionalidad la infirió la IA. La diferencia importa cuando hay que
  // gastar un contenedor, así que se dice en el tooltip.
  const medida = v.fuente === 'curva-medida'
  const origen = medida
    ? ` · MEDIDO en 5 años de búsquedas (pico ${v.ratioPico}× el promedio)`
    : v.fuente === 'analisis'
      ? ' · fecha dictada por el análisis'
      : ' · temporada estimada por IA, sin medir'
  const pico = (v.pico ? ` · pico ${fmtMes(v.pico)}` : '') + origen
  if (v.estado === 'ultimo-mes') {
    return { clase: 'ahora', texto: `último mes para pedir`, icono: '🔥', ayuda: `Comprando este mes llega justo al pico${pico}` }
  }
  if (v.estado === 'ahora') {
    return { clase: 'ahora', texto: `pedir hasta ${fmtMes(v.hasta)}`, icono: '🎯', ayuda: `Ventana abierta ${fmtMes(v.desde)}–${fmtMes(v.hasta)}${pico}` }
  }
  if (v.estado === 'pronto') {
    return { clase: 'pronto', texto: `pedir ${fmtMes(v.desde)}`, ayuda: `La ventana abre en ${v.mesesAl} mes(es)${pico}` }
  }
  return {
    clase: 'futura',
    texto: `pedir ${fmtMes(v.desde)}`,
    ayuda: v.perdioLaTemporada
      ? `La temporada de este año ya no se alcanza (lead time de ~3 meses). Próxima ventana: ${fmtMes(v.desde)}–${fmtMes(v.hasta)}${pico}`
      : `Faltan ${v.mesesAl} mes(es) para la ventana${pico}`,
  }
}

// ¿Alguien BUSCA esta keyword? Sin esto un nicho puede tener veredicto de
// entrada y ser puro ruido: mide un listado que ningún comprador ve.
const NIVELES = {
  alto: { texto: 'búsqueda alta', clase: 'nb-alto' },
  medio: { texto: 'búsqueda media', clase: 'nb-medio' },
  bajo: { texto: 'cola larga', clase: 'nb-bajo' },
  // el producto se busca, la keyword no: es un arreglo, no un descarte
  renombrar: { texto: 'keyword mal escrita', clase: 'nb-renombrar' },
  nulo: { texto: 'nadie la busca', clase: 'nb-nulo' },
}

function chipBusqueda(n) {
  const nb = n.nivelBusqueda
  if (!nb?.nivel) return null
  const info = NIVELES[nb.nivel]
  if (!info) return null
  return { ...info, ayuda: nb.explicacion ?? '' }
}

// Grupo plegable del sidebar: recuerda abierto/cerrado por usuario (localStorage)
function GrupoNichos({ id, titulo, cantidad, ayuda, abiertoPorDefecto = false, children }) {
  const [abierto, setAbierto] = useState(() => {
    const guardado = localStorage.getItem(`sidebar-grupo-${id}`)
    return guardado === null ? abiertoPorDefecto : guardado === '1'
  })

  function alternar(e) {
    e.preventDefault()
    setAbierto((a) => {
      localStorage.setItem(`sidebar-grupo-${id}`, a ? '0' : '1')
      return !a
    })
  }

  return (
    <details className="grupo-nichos" data-grupo={id} open={abierto}>
      <summary className="grupo-titulo grupo-plegable" onClick={alternar} title={ayuda}>
        {titulo} <span className="grupo-cuenta">{cantidad}</span>
      </summary>
      {children}
    </details>
  )
}

// El producto se busca pero con otra palabra: se ofrece medir la búsqueda real
// de un clic. Proponer es del sistema, gastar el scan es del importador.
function SugerenciaKeyword({ n, onMedirKeyword }) {
  const [estado, setEstado] = useState(null)
  const nb = n.nivelBusqueda
  if (nb?.nivel !== 'renombrar' || !nb.keywordSugerida || !onMedirKeyword) return null

  async function medir() {
    setEstado('creando')
    try {
      await onMedirKeyword(nb.keywordSugerida)
      setEstado('creado')
    } catch (err) {
      setEstado(/ya existe/i.test(err.message) ? 'ya existe' : err.message)
    }
  }

  return (
    <div className="sugerencia-kw">
      <span className="sugerencia-kw-texto" title={nb.explicacion ?? ''}>
        la gente busca <strong>{nb.keywordSugerida}</strong>
        {nb.posicionSugerida ? ` (#${nb.posicionSugerida})` : ''}
      </span>
      {estado === 'creado' ? (
        <span className="sugerencia-kw-ok">✓ midiendo</span>
      ) : (
        <button className="sugerencia-kw-boton" onClick={medir} disabled={estado === 'creando'}>
          {estado === 'creando' ? 'creando…' : estado ? estado : 'medirla →'}
        </button>
      )}
    </div>
  )
}

function NichoItem({ n, seleccionado, onSeleccionar, anidado = false, onMedirKeyword }) {
  const score = n.ultimoReporte?.scoreOportunidad
  const etapa = n.etapaCompra && n.etapaCompra !== 'evaluando' ? n.etapaCompra : null
  return (
    <li className={anidado ? 'nicho-anidado' : undefined}>
      <button
        className={n._id === seleccionado ? 'nicho activo' : 'nicho'}
        onClick={() => onSeleccionar(n._id)}
        title={
          n.ultimoReporte
            ? `mediana ${fmtPrecio(n.ultimoReporte.precioMediana)}` +
              (n.ultimoReporte.ventasEstimadasPorDia != null
                ? ` · ~${fmtNum(Math.round(n.ultimoReporte.ventasEstimadasPorDia))} ventas/día`
                : '') +
              ` · último scan ${fmtFecha(n.ultimoScanEl)}`
            : n.ultimoScanEl
              ? 'scan hecho, sin reporte'
              : 'scan pendiente…'
        }
      >
        <span className="nicho-fila">
          <span className="nicho-keyword">
            {anidado ? (
              <span
                className="familia-marca"
                title={
                  n.esJugadaDelLider
                    ? `sub-nicho de jugada de "${n.familiaLider}" (medición a propósito)`
                    : `mide el mismo mercado que "${n.familiaLider}" (${n.familiaSolapePct}% del top compartido)`
                }
              >
                ↳
              </span>
            ) : null}
            {n.origen === 'radar' ? <span className="punto-radar" title="descubierto por el radar" /> : null}
            {n.keyword}
            {!anidado && n.familiaLider ? (
              <span
                className="familia-chip"
                title={
                  n.esJugadaDelLider
                    ? `sub-nicho de jugada de "${n.familiaLider}": mide la apuesta de ese análisis en forma pura`
                    : `mide el mismo mercado que "${n.familiaLider}" (${n.familiaSolapePct}% del top compartido)`
                }
              >
                ↳ {n.familiaLider}
              </span>
            ) : null}
            {esNuevo(n) ? <span className="badge-nuevo" title="creado hace menos de 3 días">nuevo</span> : null}
            {n.vueltaTemporadaEl && Date.now() - new Date(n.vueltaTemporadaEl).getTime() < 7 * 86400e3 ? (
              <span className="badge-nuevo" title="descartado estacional que volvió a evaluación: su ventana de compra llegó">
                vuelve por temporada
              </span>
            ) : null}
          </span>
          {n.madurando ? (
            <span
              className="mini-madurando"
              title={`Midiendo entrabilidad: ${n.scansConDemanda} de 5 scans con demanda — el score y el veredicto aparecen al graduar la serie`}
            >
              {n.scansConDemanda}/5
            </span>
          ) : score != null ? (
            <ScoreRing valor={score} size={30} grosor={3.5} />
          ) : null}
        </span>
        <span className="nicho-meta">
          {n.enProceso ? (
            <span className="en-proceso">
              <span className="spinner" aria-hidden="true" />
              {ETAPAS[n.enProceso] ?? 'procesando…'}
            </span>
          ) : (
            <>
              {(() => {
                const b = chipBusqueda(n)
                return b ? (
                  <span className={`chip-busqueda ${b.clase}`} title={b.ayuda}>
                    {b.texto}
                  </span>
                ) : null
              })()}
              {(() => {
                const v = chipVentana(n)
                return v ? (
                  <span className={`chip-ventana v-${v.clase}`} title={v.ayuda}>
                    {v.icono ? `${v.icono} ` : ''}
                    {v.texto}
                  </span>
                ) : null
              })()}
              {n.ultimoReporte?.topMezclado ? (
                <span
                  className="chip-mezclado"
                  title={`El top mezcla familias de producto: "${n.ultimoReporte.categoriaDominante ?? '—'}" es solo el ${n.ultimoReporte.categoriaDominantePct ?? '?'}%. La mediana, el %Full y la demanda describen la mezcla, no tu producto.`}
                >
                  ⚠ mezclado
                </span>
              ) : null}
              {etapa ? <span className="etapa-mini" title={n.notaEtapa ?? ''}>{etapa.replace(/-/g, ' ')}</span> : null}
              {n.tieneListing ? <span className="etapa-mini" title="Borrador de listing generado">listing ✓</span> : null}
              {n.madurando ? (
                <span
                  className="etapa-mini"
                  title={
                    n.enCupoMaduracion === false
                      ? 'En fila de exploración: el cupo diario está lleno — corre semanal hasta que se libere lugar (la cartera madura a diario sin fila)'
                      : 'El sistema lo escanea a diario solo hasta juntar la serie'
                  }
                >
                  madurando
                  {n.proximoScanEl ? ` · ⏱ ${fmtProximoScan(n.proximoScanEl)}` : ''}
                </span>
              ) : n.veredicto && n.veredicto !== 'entrar' ? (
                <span className={`veredicto veredicto-${n.veredicto}`}>{n.veredicto.replace(/_/g, ' ')}</span>
              ) : null}
            </>
          )}
        </span>
      </button>
      <SugerenciaKeyword n={n} onMedirKeyword={onMedirKeyword} />
    </li>
  )
}

function ListaNichos({ nichos, seleccionado, onSeleccionar, onMedirBusqueda, onMedirKeyword }) {
  const [filtro, setFiltro] = useState('')
  const [midiendo, setMidiendo] = useState(false)

  if (!nichos.length) {
    return <p className="vacio">Sin nichos todavía. Crea el primero con una keyword.</p>
  }

  const q = filtro.trim().toLowerCase()
  const visibles = q ? nichos.filter((n) => n.keyword.includes(q)) : nichos
  const porGrupo = agruparNichos(visibles)
  const sinMedir = nichos.filter((n) => !n.nivelBusqueda).length

  const render = (lista) =>
    anidarFamilias(lista).flatMap(({ nicho, hijos }) => [
      <NichoItem
        key={nicho._id}
        n={nicho}
        seleccionado={seleccionado}
        onSeleccionar={onSeleccionar}
        onMedirKeyword={onMedirKeyword}
      />,
      ...hijos.map((h) => (
        <NichoItem
          key={h._id}
          n={h}
          seleccionado={seleccionado}
          onSeleccionar={onSeleccionar}
          onMedirKeyword={onMedirKeyword}
          anidado
        />
      )),
    ])

  async function medir() {
    setMidiendo(true)
    try {
      await onMedirBusqueda()
    } finally {
      setMidiendo(false)
    }
  }

  return (
    <div className="lista-envoltura">
      {nichos.length > 6 ? (
        <input
          type="search"
          className="filtro-nichos"
          placeholder="Filtrar nichos…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Filtrar nichos"
        />
      ) : null}

      {sinMedir ? (
        <button
          className="medir-busqueda"
          onClick={medir}
          disabled={midiendo}
          title="Mide contra el autocompletado de ML si la gente escribe cada keyword. Gratis: no gasta Apify ni IA."
        >
          {midiendo ? 'Midiendo…' : `🔍 Medir nivel de búsqueda (${sinMedir} sin medir)`}
        </button>
      ) : null}

      {GRUPOS.map((g) => {
        const lista = porGrupo.get(g.id)
        if (!lista.length) return null
        return (
          <GrupoNichos
            key={g.id}
            id={g.id}
            titulo={g.titulo}
            ayuda={g.ayuda}
            cantidad={lista.length}
            abiertoPorDefecto={g.abierto}
          >
            <ul className="lista-nichos">{render(lista)}</ul>
          </GrupoNichos>
        )
      })}
    </div>
  )
}

function VistaNicho({ nichoId, alCambiarNichos, onAbrirNicho }) {
  const [datos, setDatos] = useState(null)
  const [estado, setEstado] = useState('cargando')
  const [error, setError] = useState(null)
  const [pestana, setPestana] = useState('resumen')
  const [productos, setProductos] = useState(null)
  const [escaneando, setEscaneando] = useState(false)
  const [precioSimulador, setPrecioSimulador] = useState(null)
  const encuesta = useRef(null)

  const cargar = useCallback(async () => {
    try {
      const cuerpo = await api.reporte(nichoId)
      setDatos(cuerpo)
      setEstado('listo')
      api.productosNicho(nichoId).then(setProductos).catch(() => setProductos(null))
      return cuerpo
    } catch (err) {
      if (String(err.message).includes('aún no hay scans')) setEstado('sin-datos')
      else {
        setEstado('error')
        setError(err.message)
      }
      return null
    }
  }, [nichoId])

  useEffect(() => {
    setEstado('cargando')
    setDatos(null)
    setProductos(null)
    setPestana('resumen')
    setPrecioSimulador(null)
    cargar()
    return () => clearInterval(encuesta.current)
  }, [cargar])

  function vigilarNuevoReporte(fechaAnterior) {
    clearInterval(encuesta.current)
    encuesta.current = setInterval(async () => {
      const cuerpo = await cargar()
      const fechaNueva = cuerpo?.reporte?.fecha
      if (fechaNueva && fechaNueva !== fechaAnterior) {
        clearInterval(encuesta.current)
        setEscaneando(false)
        alCambiarNichos()
      }
    }, 10_000)
  }

  async function escanear() {
    setEscaneando(true)
    try {
      await api.escanear(nichoId)
      vigilarNuevoReporte(datos?.reporte?.fecha ?? null)
    } catch (err) {
      setEscaneando(false)
      setError(err.message)
    }
  }

  function simularProducto(producto) {
    setPrecioSimulador(producto.precio)
    setPestana('simulador')
  }

  if (estado === 'cargando') return <Cargando texto="Cargando reporte…" />
  if (estado === 'error') return <p className="error-bloque">Error: {error}</p>
  if (estado === 'sin-datos') {
    return (
      <div>
        <p className="vacio">
          Aún no hay scans completados (el primero corre solo al crear el nicho, toma 1-5 min con el
          nivel de detalle).
        </p>
        <button onClick={cargar} className="boton-secundario">
          Revisar de nuevo
        </button>
      </div>
    )
  }

  const { nicho, reporte, scans } = datos

  async function alternarEstado() {
    const nuevo = nicho.estado === 'pausado' ? 'activo' : 'pausado'
    try {
      await api.ajustarNicho(nichoId, { estado: nuevo })
      await cargar()
      alCambiarNichos()
    } catch (err) {
      setError(err.message)
    }
  }

  const pestanas = [
    ['resumen', 'Resumen'],
    ['productos', productos ? `Productos (${productos.total})` : 'Productos'],
    [
      'analisis',
      scans?.madurando
        ? `Análisis: madurando ${scans.conDemanda}/5`
        : reporte.analisis
          ? `Análisis: ${reporte.analisis.veredicto?.replace(/_/g, ' ')}${scans?.trasAnalisis ? ' ⚠' : ''}`
          : 'Análisis IA',
    ],
    ['listing', nicho.listingDraft ? 'Listing ✓' : 'Listing'],
    ['simulador', 'Simulador'],
  ]

  return (
    <div>
      <div className="reporte-encabezado">
        <div>
          <h2>{nicho.keyword}</h2>
          <p className="reporte-fecha">
            Último scan: {fmtFecha(reporte.fecha)}
            {scans?.total ? ` · scan N°${scans.total}` : ''}
            {escaneando ? ' · escaneando…' : ''}
          </p>
        </div>
        <div className="acciones-nicho">
          <button
            onClick={alternarEstado}
            className={nicho.estado === 'pausado' ? 'boton-primario' : 'chip'}
            title={
              nicho.estado === 'pausado'
                ? 'Nicho pausado: no se escanea ni gasta. Click para reactivarlo (vuelve a evaluación y el programador lo escanea solo).'
                : 'Nicho activo. Click para pausarlo: deja de escanearse y de gastar (rechazo manual).'
            }
          >
            {nicho.estado === 'pausado' ? '▶ Reactivar nicho' : '⏸ pausar'}
          </button>
          <span
            className="chip"
            title="La cadencia es automática: los nichos en cartera (veredicto de entrada) se escanean a diario hasta confirmar la demanda; el resto, semanal."
          >
            cadencia automática
          </span>
          <button onClick={escanear} disabled={escaneando} className="boton-primario">
            {escaneando ? 'Escaneando…' : 'Re-escanear ahora'}
          </button>
        </div>
      </div>

      <nav className="pestanas" role="tablist">
        {pestanas.map(([clave, etiqueta]) => (
          <button
            key={clave}
            role="tab"
            aria-selected={pestana === clave}
            className={pestana === clave ? 'pestana activa' : 'pestana'}
            onClick={() => setPestana(clave)}
          >
            {etiqueta}
          </button>
        ))}
      </nav>

      {pestana === 'resumen' ? (
        <>
          <Busqueda
            keyword={nicho.keyword}
            nivelBusqueda={nicho.nivelBusqueda}
            familia={datos?.familia}
            onNichoCreado={alCambiarNichos}
            onAbrirNicho={onAbrirNicho}
          />
          <Resumen
            reporte={reporte}
            productos={productos?.productos}
            nichoId={nichoId}
            nicho={nicho}
            porMarcaVehiculo={datos?.porMarcaVehiculo}
          />
        </>
      ) : null}
      {pestana === 'productos' ? (
        <Productos nichoId={nichoId} keyword={nicho.keyword} analisis={reporte.analisis} onSimular={simularProducto} />
      ) : null}
      {pestana === 'analisis' ? (
        <Analisis
          nichoId={nichoId}
          analisisInicial={reporte.analisis}
          contextoInicial={nicho.contextoUsuario}
          revisarElInicial={nicho.revisarEl}
          scans={scans}
          onRegenerado={cargar}
          onNichoCreado={alCambiarNichos}
        />
      ) : null}
      {pestana === 'listing' ? <Listing nichoId={nichoId} listingInicial={nicho.listingDraft} /> : null}
      {pestana === 'simulador' ? (
        <Simulador nicho={nicho} reporte={reporte} precioInicial={precioSimulador} />
      ) : null}
    </div>
  )
}

function Candado() {
  const [clave, setClave] = useState('')
  return (
    <div className="candado">
      <h2>Acceso</h2>
      <p className="vacio">Esta herramienta es privada. Ingresa la clave de acceso.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          claveApi.guardar(clave.trim())
          location.reload()
        }}
      >
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          placeholder="Clave de acceso"
          aria-label="Clave de acceso"
          autoFocus
        />
        <button type="submit" className="boton-primario" disabled={!clave.trim()}>
          Entrar
        </button>
      </form>
    </div>
  )
}

// Riel de mundos, a la derecha. Icono + etiqueta corta: con dos entradas el
// icono solo ya sería un acertijo, y esto va a crecer.
const MUNDOS = [
  { id: 'inteligencia', titulo: 'Inteligencia', Icono: RadarIcono, ayuda: 'Nichos, búsqueda, oportunidades y tus publicaciones' },
  { id: 'contabilidad', titulo: 'Contabilidad', Icono: Landmark, ayuda: 'Posición de IVA: débito de ventas contra crédito de importaciones y gastos' },
]

function RielMundos({ mundo, onCambiar }) {
  return (
    <nav className="riel" aria-label="Áreas del sistema">
      {MUNDOS.map(({ id, titulo, Icono, ayuda }) => (
        <button
          key={id}
          className={`riel-boton${mundo === id ? ' activo' : ''}`}
          onClick={() => onCambiar(id)}
          title={ayuda}
          aria-current={mundo === id ? 'page' : undefined}
        >
          <Icono aria-hidden="true" />
          <span>{titulo}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [nichos, setNichos] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [errorLista, setErrorLista] = useState(null)
  const [bloqueada, setBloqueada] = useState(false)
  const [vista, setVista] = useState('oportunidades')
  // Los dos mundos del sistema. Son trabajos distintos: uno decide QUÉ traer,
  // el otro lleva la plata de lo ya traído. Se cambian con el riel de la
  // derecha, no con las pestañas de arriba, justamente para que no se mezclen.
  const [mundo, setMundo] = useState('inteligencia')

  useEffect(() => {
    const alBloquear = () => {
      claveApi.borrar()
      setBloqueada(true)
    }
    window.addEventListener('api-bloqueada', alBloquear)
    return () => window.removeEventListener('api-bloqueada', alBloquear)
  }, [])

  const cargarNichos = useCallback(async () => {
    try {
      const { nichos: lista } = await api.listarNichos()
      setNichos(lista)
      setErrorLista(null)
      setSeleccionado((actual) => actual ?? lista[0]?._id ?? null)
    } catch (err) {
      setErrorLista(err.message)
    }
  }, [])

  useEffect(() => {
    cargarNichos()
    // el radar y los scans corren solos: refrescar la lista para ver el avance en vivo
    const intervalo = setInterval(cargarNichos, 15_000)
    return () => clearInterval(intervalo)
  }, [cargarNichos])

  if (bloqueada) return <Candado />

  return (
    <div className="app con-riel">
      <RielMundos mundo={mundo} onCambiar={setMundo} />
      <header>
        <div className="marca">
          <span className="marca-icono" aria-hidden="true">
            <MarcaIcono />
          </span>
          <div className="marca-texto">
            <h1>MELI Intel</h1>
            <span className="subtitulo">
              {mundo === 'contabilidad'
                ? 'contabilidad · IVA y costos reales'
                : 'inteligencia de nichos · mercadolibre.cl'}
            </span>
          </div>
        </div>
        <nav className="secciones" aria-label="Secciones" hidden={mundo !== 'inteligencia'}>
          <button
            className={vista === 'oportunidades' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('oportunidades')}
          >
            Oportunidades
          </button>
          <button
            className={vista === 'nichos' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('nichos')}
          >
            Nichos
          </button>
          <button
            className={vista === 'propios' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('propios')}
          >
            Mis productos
          </button>
          <button
            className={vista === 'publicidad' ? 'seccion activa' : 'seccion'}
            onClick={() => setVista('publicidad')}
          >
            Publicidad
          </button>
        </nav>
        <VentasChip />
        <PresupuestoChip />
      </header>
      {mundo === 'contabilidad' ? (
        <Contabilidad />
      ) : vista === 'oportunidades' ? (
        <Oportunidades
          onAbrirNicho={(id) => {
            setSeleccionado(id)
            setVista('nichos')
          }}
          alCambiarNichos={cargarNichos}
        />
      ) : vista === 'propios' ? (
        <MisProductos />
      ) : vista === 'publicidad' ? (
        <Publicidad />
      ) : (
      <div className="cuerpo">
        <aside>
          <FormNuevoNicho
            onCreado={(nicho) => {
              cargarNichos()
              setSeleccionado(nicho._id)
            }}
          />
          {errorLista ? <p className="error-bloque">No se pudo cargar la lista: {errorLista}</p> : null}
          <ListaNichos
            nichos={nichos}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            onMedirBusqueda={async () => {
              await api.medirNivelBusqueda().catch(() => null)
              // la medición corre en la cola: el refresco de 15 s la va mostrando
              setTimeout(cargarNichos, 4000)
            }}
            onMedirKeyword={async (keyword) => {
              const { nicho } = await api.crearNicho(keyword)
              await cargarNichos()
              setSeleccionado(nicho._id)
            }}
          />
          <Radar />
        </aside>
        <main>
          {seleccionado ? (
            <VistaNicho
              key={seleccionado}
              nichoId={seleccionado}
              alCambiarNichos={cargarNichos}
              onAbrirNicho={setSeleccionado}
            />
          ) : (
            <p className="vacio">Selecciona o crea un nicho para ver su reporte.</p>
          )}
        </main>
      </div>
      )}
    </div>
  )
}
