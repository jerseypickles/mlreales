import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Eye, Link2, Megaphone, PackageX,
  RefreshCw, Search, ShoppingBag, Store, TrendingDown, TrendingUp,
} from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtFecha, fmtNum, fmtPrecio } from '../lib/formato.js'
import { StockCompetidores, MasVendidosMl } from './AprendizajeFuentes.jsx'

const decimal = (valor, digitos = 1) => Number.isFinite(valor)
  ? valor.toLocaleString('es-CL', { maximumFractionDigits: digitos }) : '—'
const mes = (periodo) => /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? '')
  ? new Date(`${periodo}-15T12:00:00Z`).toLocaleDateString('es-CL', { month: 'short', timeZone: 'UTC' }).replace('.', '') : '—'
const fecha = (valor) => valor ? new Date(valor.length === 10 ? `${valor}T12:00:00Z` : valor).toLocaleDateString('es-CL', {
  day: 'numeric', month: 'short', timeZone: 'America/Santiago',
}) : '—'

// Barras de una serie diaria. Rectángulos y no un path: con el alto estirado un
// path con vector-effect no se dibuja en todos los motores (ver graficos.jsx).
function Chispa({ puntos, campo, alto = 36, etiqueta, clase = '' }) {
  if (!puntos?.length) return <div className="apr-chispa-vacia" style={{ height: alto }}>sin datos todavía</div>
  const max = Math.max(1, ...puntos.map((p) => p[campo] ?? 0))
  const ancho = 100 / puntos.length
  return (
    <svg className={`apr-chispa ${clase}`} viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" style={{ height: alto }} role="img" aria-label={etiqueta}>
      {puntos.map((p, i) => {
        const h = Math.max(p[campo] > 0 ? 1.5 : 0, ((p[campo] ?? 0) / max) * (alto - 2))
        return <g key={p.dia}>
          {p.sinStock && <rect className="apr-chispa-quiebre" x={i * ancho} y="0" width={ancho} height={alto} />}
          <rect className="apr-chispa-barra" x={i * ancho + ancho * 0.14} y={alto - h} width={ancho * 0.72} height={h} rx="0.6">
            <title>{`${fecha(p.dia)}: ${fmtNum(p[campo] ?? 0)}`}</title>
          </rect>
        </g>
      })}
    </svg>
  )
}

function Fuente({ Icono, titulo, valor, unidad, detalle, estado = 'bien', children }) {
  return (
    <article className={`apr-fuente apr-fuente-${estado}`}>
      <div className="apr-cabeza"><span className="apr-icono"><Icono size={17} aria-hidden="true" /></span><h3>{titulo}</h3>
        <span className={`apr-punto apr-punto-${estado}`} title={estado === 'bien' ? 'Capturando' : estado === 'espera' ? 'Esperando la primera pasada' : 'Revisar'} />
      </div>
      <p className="apr-cifra">{valor}<small>{unidad}</small></p>
      {children}
      <p className="apr-fuente-detalle">{detalle}</p>
    </article>
  )
}

function Avance({ etiqueta, valor, meta, ayuda }) {
  const pct = Math.min(100, Math.round(((valor ?? 0) / meta) * 100))
  return (
    <div className="apr-avance">
      <div className="apr-avance-cabeza"><span>{etiqueta}</span><strong>{fmtNum(valor ?? 0)}<small> de {fmtNum(meta)}</small></strong></div>
      <div className="apr-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={etiqueta}>
        <span style={{ width: `${pct}%` }} className={pct >= 100 ? 'apr-barra-lista' : ''} />
      </div>
      {ayuda && <p className="apr-avance-ayuda">{ayuda}</p>}
    </div>
  )
}

const VARIABLES = {
  crecimiento12m: 'Crecimiento del último año', crecimiento6m: 'Crecimiento de 6 meses', impulso3m: 'Impulso de 3 meses',
  estacionObjetivo: 'Estacionalidad del mes', horizonte: 'Meses hacia adelante',
}

function Comparacion({ filas }) {
  const max = Math.max(...filas.map((f) => f.valor))
  return (
    <div className="apr-comparacion">
      {filas.map((f) => (
        <div key={f.nombre} className={`apr-comp-fila${f.propio ? ' apr-comp-propio' : ''}${f.mejor ? ' apr-comp-mejor' : ''}`}>
          <span className="apr-comp-nombre">{f.nombre}</span>
          <span className="apr-comp-pista"><span style={{ width: `${(f.valor / max) * 100}%` }} /></span>
          <span className="apr-comp-valor">{decimal(f.valor, 3)}</span>
        </div>
      ))}
      <p className="apr-nota">Error promedio de la prueba. Barra más corta = se equivoca menos.</p>
    </div>
  )
}

function Pesos({ coeficientes }) {
  const filas = Object.entries(coeficientes ?? {}).filter(([, v]) => Number.isFinite(v))
  if (!filas.length) return null
  const max = Math.max(...filas.map(([, v]) => Math.abs(v))) || 1
  return (
    <details className="apr-plegable">
      <summary><ChevronDown size={15} aria-hidden="true" />En qué se fija el modelo</summary>
      <div className="apr-pesos">
        {filas.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([nombre, v]) => (
          <div key={nombre} className="apr-peso">
            <span>{VARIABLES[nombre] ?? nombre}</span>
            <span className="apr-peso-eje"><span className={v < 0 ? 'apr-peso-neg' : 'apr-peso-pos'} style={{ width: `${(Math.abs(v) / max) * 50}%` }} /></span>
            <strong>{v > 0 ? '+' : ''}{decimal(v, 2)}</strong>
          </div>
        ))}
        <p className="apr-nota">A la derecha empuja el pronóstico hacia arriba; a la izquierda, hacia abajo.</p>
      </div>
    </details>
  )
}

function Modelo({ modelo, Icono, titulo, pregunta, children }) {
  const e = modelo?.evaluacion
  const entrenado = modelo?.estado === 'sombra'
  const demanda = modelo?.objetivo === 'busquedas-google'
  const referencias = demanda
    ? [{ nombre: 'Repetir el año pasado', valor: e?.referenciaEstacional }, { nombre: 'Mantener el último mes', valor: e?.referenciaPersistencia }]
    : [{ nombre: 'Promedio simple', valor: e?.referencia }, ...(Number.isFinite(e?.referenciaSinContexto) ? [{ nombre: 'Sin datos del nicho', valor: e.referenciaSinContexto }] : [])]
  const validas = referencias.filter((r) => Number.isFinite(r.valor))
  const mejorRef = validas.length ? Math.min(...validas.map((r) => r.valor)) : null
  const mejora = Number.isFinite(e?.maeLog) && mejorRef > 0 ? (1 - e.maeLog / mejorRef) * 100 : null
  const gana = mejora !== null && mejora >= 5
  const estado = !modelo || !entrenado ? 'espera' : !modelo.vigente ? 'mal' : gana ? 'bien' : 'aviso'
  const Chip = { espera: CircleDashed, mal: AlertTriangle, bien: CheckCircle2, aviso: Eye }[estado]
  const textoChip = !modelo ? 'Sin entrenar' : !entrenado ? 'Juntando datos' : !modelo.vigente ? 'Vencido' : gana ? 'Le gana a la regla simple' : 'En observación'
  const filas = entrenado && Number.isFinite(e?.maeLog)
    ? [{ nombre: 'Este modelo', valor: e.maeLog, propio: true }, ...validas].map((f) => ({ ...f, mejor: f.valor === Math.min(e.maeLog, ...validas.map((r) => r.valor)) }))
    : null
  return (
    <article className="apr-modelo">
      <div className="apr-cabeza"><span className="apr-icono"><Icono size={18} aria-hidden="true" /></span>
        <div><h3>{titulo}</h3><p>{pregunta}</p></div>
      </div>
      <span className={`apr-chip apr-chip-${estado}`}><Chip size={13} aria-hidden="true" />{textoChip}</span>
      {filas && <>
        <p className={`apr-veredicto apr-veredicto-${gana ? 'bien' : 'aviso'}`}>
          {gana ? <TrendingUp size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}
          {mejora >= 0 ? `${decimal(mejora, 0)}% mejor` : `${decimal(Math.abs(mejora), 0)}% peor`} que {demanda ? 'repetir el año pasado' : 'la regla simple'}
        </p>
        <Comparacion filas={filas} />
        <p className="apr-nota">{gana ? 'Sigue en observación hasta confirmarlo con meses nuevos.' : 'Mientras no le gane a la regla simple, no se usa para decidir.'}</p>
        <Pesos coeficientes={modelo.coeficientes} />
      </>}
      {!filas && children}
      {modelo && <p className="apr-pie">Último entrenamiento: {fmtFecha(modelo.creadoEl)}</p>}
    </article>
  )
}

function estadoSemana(d, minimoVisitas) {
  if (!d) return { clase: 'espera', Icono: CircleDashed, texto: 'Sin medir' }
  if (d.admisible && d.visitas >= minimoVisitas) return { clase: 'bien', Icono: CheckCircle2, texto: 'Semana válida' }
  if (d.admisible) return { clase: 'aviso', Icono: Eye, texto: `Pocas visitas · ${fmtNum(d.visitas)} de ${minimoVisitas}` }
  const quiebre = /sin stock parte del (\d{4}-\d{2}-\d{2})/.exec(d.motivo ?? '')
  if (quiebre) return { clase: 'mal', Icono: PackageX, texto: `Quiebre de stock el ${fecha(quiebre[1])}` }
  if (/stock/i.test(d.motivo ?? '')) return { clase: 'aviso', Icono: PackageX, texto: 'Stock sin medir algún día' }
  if (/sin visitas/i.test(d.motivo ?? '')) return { clase: 'espera', Icono: CircleDashed, texto: 'Sin visitas' }
  return { clase: 'aviso', Icono: AlertTriangle, texto: d.motivo ?? 'Sin dato' }
}

function Productos({ libro, diagnostico, minimoVisitas }) {
  const porItem = new Map((diagnostico ?? []).map((d) => [d.itemId, d]))
  if (!libro?.porProducto?.length) return <p className="apr-vacio">El libro de ventas se llena con el próximo scan de tus productos.</p>
  // todas las filas comparten el mismo eje de días: un producto más nuevo
  // empieza más a la derecha, no se estira
  const eje = (libro.serie ?? []).map((d) => d.dia)
  const alinear = (serie) => {
    const porDia = new Map((serie ?? []).map((d) => [d.dia, d]))
    return eje.length ? eje.map((dia) => porDia.get(dia) ?? { dia, unidades: 0 }) : serie
  }
  return (
    <div className="tabla-envoltura apr-tabla">
      <table>
        <thead><tr>
          <th scope="col">Producto</th><th scope="col">Unidades por día · últimas 6 semanas</th>
          <th scope="col" className="num">Unidades</th><th scope="col" className="num">Visitas</th>
          <th scope="col" className="num">Ventas cada 100 visitas</th><th scope="col">Esta semana</th>
        </tr></thead>
        <tbody>{libro.porProducto.map((p) => {
          const s = estadoSemana(porItem.get(p.itemId), minimoVisitas)
          return <tr key={p.itemId}>
            <td className="celda-titulo apr-producto"><div className="apr-producto-fila">
              {p.imagen ? <img src={p.imagen.replace(/^http:/, 'https:')} alt="" loading="lazy" width="48" height="48" /> : <span className="apr-foto-vacia" aria-hidden="true"><ShoppingBag size={18} /></span>}
              <div>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.titulo || p.itemId}</a> : (p.titulo || p.itemId)}
                <small>{fmtNum(p.dias)} días guardados · desde {fecha(p.desde)}{p.estadoMl === 'paused' ? ' · pausada en ML' : ''}</small></div>
            </div></td>
            <td className="apr-celda-chispa"><Chispa puntos={alinear(p.serie)} campo="unidades" alto={30} etiqueta={`Unidades por día de ${p.titulo}`} /></td>
            <td className="num"><strong>{fmtNum(p.unidades)}</strong></td><td className="num">{fmtNum(p.visitas)}</td>
            <td className="num">{p.visitas ? decimal((p.unidades / p.visitas) * 100) : '—'}</td>
            <td><span className={`apr-chip apr-chip-${s.clase}`}><s.Icono size={13} aria-hidden="true" />{s.texto}</span></td>
          </tr>
        })}</tbody>
      </table>
      <p className="apr-leyenda"><span className="apr-leyenda-barra" /> unidades vendidas <span className="apr-leyenda-quiebre" /> día con quiebre de stock</p>
    </div>
  )
}

const ORDENES = { volumen: 'Más buscados', sube: 'Los que más suben', baja: 'Los que más bajan' }

function Pronosticos({ nichos, modeloGana }) {
  const [orden, setOrden] = useState('volumen')
  const [texto, setTexto] = useState('')
  const [todos, setTodos] = useState(false)
  // los tres meses que más nichos comparten: son las columnas
  const periodos = useMemo(() => {
    const cuenta = new Map()
    for (const n of nichos) for (const m of n.meses) cuenta.set(m.periodo, (cuenta.get(m.periodo) ?? 0) + 1)
    return [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p).sort()
  }, [nichos])
  const filas = useMemo(() => {
    const conCambio = nichos.map((n) => {
      const meses = n.meses.filter((m) => periodos.includes(m.periodo) && m.referencia > 0)
      const esperado = meses.reduce((a, m) => a + m.estimado, 0), pasado = meses.reduce((a, m) => a + m.referencia, 0)
      return { ...n, cambio: pasado > 0 ? (esperado / pasado - 1) * 100 : null, volumen: Math.max(n.busquedasMes ?? 0, ...meses.map((m) => m.referencia)) }
    }).filter((n) => !texto.trim() || n.nicho.includes(texto.trim().toLowerCase()))
    const por = { volumen: (a, b) => b.volumen - a.volumen, sube: (a, b) => (b.cambio ?? -1e9) - (a.cambio ?? -1e9), baja: (a, b) => (a.cambio ?? 1e9) - (b.cambio ?? 1e9) }
    return conCambio.sort(por[orden])
  }, [nichos, periodos, orden, texto])
  if (!nichos.length) return <p className="apr-vacio">Todavía no hay pronósticos para los nichos del tablero.</p>
  const visibles = todos || texto.trim() ? filas : filas.slice(0, 12)
  return <>
    {!modeloGana && <p className="apr-aviso-linea"><AlertTriangle size={15} aria-hidden="true" />Este modelo todavía se equivoca más que repetir el año pasado. Para decidir una compra, hoy la mejor guía es la barra gris (lo que se buscó ese mes el año pasado); la azul es lo que el modelo espera.</p>}
    <div className="apr-controles">
      <label className="apr-buscar"><Search size={14} aria-hidden="true" /><span className="apr-solo-lector">Buscar nicho</span>
        <input type="search" placeholder="Buscar nicho…" value={texto} onChange={(ev) => setTexto(ev.target.value)} /></label>
      <div className="apr-segmentos" role="group" aria-label="Ordenar">{Object.entries(ORDENES).map(([k, nombre]) =>
        <button key={k} type="button" className={orden === k ? 'activo' : ''} aria-pressed={orden === k} onClick={() => setOrden(k)}>{nombre}</button>)}</div>
    </div>
    <div className="tabla-envoltura apr-tabla">
      <table className="apr-tabla-pron">
        <thead><tr><th scope="col">Nicho</th>{periodos.map((p) => <th key={p} scope="col">{mes(p)}</th>)}<th scope="col" className="num">Los 3 meses vs año pasado</th></tr></thead>
        <tbody>{visibles.map((n) => {
          const tope = Math.max(1, ...n.meses.filter((m) => periodos.includes(m.periodo)).flatMap((m) => [m.estimado ?? 0, m.referencia ?? 0]))
          return <tr key={n.nichoId}>
            <td className="celda-titulo apr-producto">{n.nicho}
              <small>{n.keywordMedida !== n.nicho ? `medido como "${n.keywordMedida}" · ` : ''}{n.mesPico ? `pico en ${n.mesPico}` : 'sin pico marcado'}</small></td>
            {periodos.map((p) => {
              const m = n.meses.find((x) => x.periodo === p)
              if (!m) return <td key={p} className="apr-pron-celda apr-pron-sin">—</td>
              const delta = m.referencia > 0 ? (m.estimado / m.referencia - 1) * 100 : null
              return <td key={p} className="apr-pron-celda" title={`Año pasado: ${fmtNum(m.referencia)} · Modelo: ${fmtNum(m.estimado)}${m.inferior != null ? ` (entre ${fmtNum(m.inferior)} y ${fmtNum(m.superior)})` : ''}${m.real != null ? ` · Real: ${fmtNum(m.real)}` : ''}`}>
                <div className="apr-par"><span className="apr-par-pasado" style={{ width: `${(m.referencia / tope) * 100}%` }} /><span className="apr-par-modelo" style={{ width: `${(m.estimado / tope) * 100}%` }} /></div>
                <div className="apr-par-cifras"><span>{fmtNum(m.referencia)}</span><strong>{fmtNum(m.estimado)}</strong>
                  {delta !== null && <em className={`apr-delta ${delta >= 3 ? 'apr-delta-sube' : delta <= -3 ? 'apr-delta-baja' : ''}`}>{delta > 0 ? '+' : ''}{decimal(delta, 0)}%</em>}</div>
              </td>
            })}
            <td className="num">{n.cambio === null ? '—' : <span className={`apr-chip ${n.cambio >= 3 ? 'apr-chip-bien' : n.cambio <= -3 ? 'apr-chip-mal' : ''}`}>
              {n.cambio >= 3 ? <TrendingUp size={13} aria-hidden="true" /> : n.cambio <= -3 ? <TrendingDown size={13} aria-hidden="true" /> : null}{n.cambio > 0 ? '+' : ''}{decimal(n.cambio, 0)}%</span>}</td>
          </tr>
        })}</tbody>
      </table>
      <p className="apr-leyenda"><span className="apr-leyenda-pasado" /> búsquedas del año pasado <span className="apr-leyenda-barra apr-leyenda-sep" /> lo que espera el modelo</p>
    </div>
    {!texto.trim() && filas.length > 12 && <button type="button" className="boton-secundario apr-mas" onClick={() => setTodos((v) => !v)}>{todos ? 'Ver menos' : `Ver los ${fmtNum(filas.length)} nichos`}</button>}
  </>
}

const MOTIVOS_UNION = {
  'producto-sin-nicho-vinculado': 'Producto sin nicho vinculado',
  'sin-captura-zyte-anterior': 'Falta una captura de la competencia anterior a la semana',
  'captura-zyte-fuera-de-fecha': 'La captura de la competencia tiene más de 14 días',
  'sin-serie-demanda-anterior': 'Falta historial de búsquedas anterior a la semana',
  'serie-demanda-posterior': 'Las búsquedas se recuperaron después de la semana',
  'demanda-sin-meses-recientes': 'El historial de búsquedas no llega a meses recientes',
  'demanda-con-huecos': 'Faltan meses en el historial de búsquedas',
  'pocos-productos-zyte': 'Menos de 10 productos comparables en el nicho',
  'atributos-invalidos': 'Fecha o precio incompleto',
  'contexto-incompleto': 'Datos del nicho incompletos',
}

function Seccion({ titulo, bajada, children }) {
  return <section className="apr-seccion"><div className="apr-seccion-cabeza"><h3>{titulo}</h3>{bajada && <p>{bajada}</p>}</div>{children}</section>
}

export function Aprendizaje() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  // sub-menú de la pestaña: el resumen, y las fuentes que se pueden mirar por dentro
  const [vista, setVista] = useState('resumen')
  const peticion = useRef(null)
  const cargar = useCallback(async () => {
    peticion.current?.abort()
    const controlador = new AbortController()
    peticion.current = controlador
    setCargando(true)
    try {
      const opciones = { signal: controlador.signal }
      const [estado, predicciones] = await Promise.all([api.aprendizaje(opciones), api.aprendizajePronosticosNichos(opciones)])
      if (!controlador.signal.aborted) {
        setDatos({ estado, nichos: predicciones.nichos ?? [] })
        setError(null)
      }
    } catch (err) {
      if (!controlador.signal.aborted) setError(err.message === 'HTTP 404'
        ? 'El servidor todavía no tiene disponible la pantalla de aprendizaje.' : err.message)
    } finally {
      if (!controlador.signal.aborted) setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const intervalo = setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 60_000)
    return () => { clearInterval(intervalo); peticion.current?.abort() }
  }, [cargar])

  const e = datos?.estado
  const c = e?.cobertura
  const com = e?.fuentes?.comercial
  const min = e?.minimos ?? { productos: 12, ventanas: 72, nichos: 3, visitasSemana: 30 }
  const modelo = (objetivo) => e?.modelos.find((m) => m.objetivo === objetivo)
  return (
    <main className="apr-pagina">
      <div className="apr-hero">
        <div>
          <span className={`apr-chip ${e?.activo === false ? 'apr-chip-mal' : 'apr-chip-bien'}`}><Activity size={13} aria-hidden="true" />{e?.activo === false ? 'Captura detenida' : 'Capturando datos'}</span>
          <h2>Aprendizaje</h2>
          <p>El sistema guarda cada día de ventas, visitas y publicidad de tus productos, y prueba sus modelos sin tocar las recomendaciones.</p>
        </div>
        <div className="apr-hero-accion">
          <button type="button" className="boton-secundario apr-refrescar" onClick={cargar} disabled={cargando}>
            <RefreshCw size={15} aria-hidden="true" className={cargando ? 'apr-girando' : ''} />{cargando ? 'Actualizando…' : 'Actualizar'}
          </button>
          {e && <small>Actualizado {fmtFecha(e.consultadoEl)}</small>}
        </div>
      </div>
      <nav className="apr-submenu" aria-label="Secciones de aprendizaje">
        {[['resumen', 'Resumen', Activity], ['stock', 'Stock de competidores', PackageX], ['ranking', 'Más vendidos de ML', TrendingUp]].map(([id, nombre, Icono]) => (
          <button key={id} type="button" className={vista === id ? 'activo' : ''} aria-pressed={vista === id} onClick={() => setVista(id)}><Icono size={15} aria-hidden="true" />{nombre}</button>
        ))}
      </nav>
      {vista === 'stock' && <StockCompetidores />}
      {vista === 'ranking' && <MasVendidosMl />}
      {vista === 'resumen' && error && <p className="error-bloque" role="alert">No se pudo actualizar: {error}{datos ? ' Se muestra la última consulta.' : ''}</p>}
      {vista === 'resumen' && !datos && !error && <Cargando texto="Consultando los datos del aprendizaje…" />}
      {vista === 'resumen' && e && <>
        <Seccion titulo="Lo que se está guardando" bajada="Cuatro fuentes, todos los días. Lo que no se guarda hoy no se recupera después.">
          <div className="apr-fuentes">
            <Fuente Icono={ShoppingBag} titulo="Ventas y visitas" valor={fmtNum(com.libro?.unidades)} unidad=" unidades" estado={com.libro?.dias ? 'bien' : 'espera'}
              detalle={com.libro?.dias ? `${fmtNum(com.libro.productos)} productos · ${fmtNum(com.libro.dias)} días desde ${fecha(com.libro.desde)} · ${fmtNum(com.libro.visitas)} visitas` : 'Se llena con el próximo scan de tus productos'}>
              <Chispa puntos={com.libro?.serie} campo="unidades" etiqueta="Unidades vendidas por día" />
            </Fuente>
            <Fuente Icono={Megaphone} titulo="Publicidad" valor={com.publicidad?.dias ? fmtPrecio(com.publicidad.costo) : '—'} unidad={com.publicidad?.dias ? ' de gasto' : ''} estado={com.publicidad?.dias ? 'bien' : 'espera'}
              detalle={com.publicidad?.dias ? `${fmtNum(com.publicidad.dias)} días desde ${fecha(com.publicidad.desde)} · ${fmtNum(com.publicidad.clicks)} clics · ${fmtNum(com.publicidad.unidadesAds)} ventas por anuncio` : 'Mercado Libre la borra a los 90 días: se empieza a guardar en el próximo scan'}>
              <Chispa puntos={com.publicidad?.serie} campo="costo" clase="apr-chispa-ads" etiqueta="Gasto en publicidad por día" />
            </Fuente>
            <Fuente Icono={Search} titulo="Búsquedas en Google" valor={c.nichos ? `${fmtNum(c.nichos.conSerie)}` : fmtNum(c.keywords)} unidad={c.nichos ? ` de ${fmtNum(c.nichos.activos)} nichos` : ' búsquedas'}
              estado={!c.nichos ? 'bien' : c.nichos.conSerie >= c.nichos.activos * 0.9 ? 'bien' : 'espera'}
              detalle={`Cuatro años de historia mes a mes por nicho · ${fmtNum(c.keywords)} palabras contando variantes · última lectura ${fecha(e.fuentes.demanda.ultimaCapturaEl)}${c.nichos && c.nichos.conSerie < c.nichos.activos ? ' · los que faltan se piden en el próximo entrenamiento' : ''}`}>
              <div className="apr-medidor"><span style={{ width: `${c.nichos?.activos ? (c.nichos.conSerie / c.nichos.activos) * 100 : 100}%` }} /></div>
            </Fuente>
            <Fuente Icono={Store} titulo="Competencia por nicho" valor={fmtNum(e.integracion?.nichosCapturados)} unidad=" nichos" estado={e.integracion?.nichosCapturados ? 'bien' : 'espera'}
              detalle={`Precios, Full y reseñas del top de cada nicho · ${fmtNum((e.integracion?.nichos ?? []).filter((n) => n.reciente).length)} con lectura de los últimos 14 días`}>
              <div className="apr-medidor"><span style={{ width: `${e.integracion?.nichos?.length ? ((e.integracion.nichos.filter((n) => n.reciente).length) / e.integracion.nichos.length) * 100 : 0}%` }} /></div>
            </Fuente>
          </div>
        </Seccion>

        <Seccion titulo="Cuánto falta para que aprenda de tus ventas" bajada={`Una semana cuenta cuando el producto tuvo stock los siete días y al menos ${min.visitasSemana} visitas. Cada producto nuevo suma.`}>
          <div className="apr-avances">
            <Avance etiqueta="Productos con semanas válidas" valor={c.productos} meta={min.productos} ayuda={`Tienes ${fmtNum(com.libro?.productos ?? 0)} publicados; hoy califican ${fmtNum(c.productos)}.`} />
            <Avance etiqueta="Semanas válidas sin repetir" valor={c.ventanasIndependientes} meta={min.ventanas} ayuda={`${fmtNum(com.semanasGuardadas)} semanas guardadas en total, contando las que se solapan.`} />
            <Avance etiqueta="Nichos con las tres fuentes unidas" valor={e.integracion?.nichosUnidos} meta={min.nichos} ayuda="Ventas propias + búsquedas + competencia del mismo nicho y la misma fecha." />
          </div>
        </Seccion>

        <Seccion titulo="Los modelos" bajada="Cada uno se prueba contra una regla simple. Si no le gana, no se usa.">
          <div className="apr-modelos">
            <Modelo modelo={modelo('busquedas-google')} Icono={Search} titulo="Demanda por temporada" pregunta="¿Cuánto se va a buscar este producto en 3 a 5 meses?">
              <p className="apr-nota">Necesita al menos tres búsquedas con dos años de historia.</p>
            </Modelo>
            <Modelo modelo={modelo('unidades-por-visita')} Icono={ShoppingBag} titulo="Ventas por visita" pregunta="¿Cuánto vende un producto según su categoría, precio y envío?">
              <Avance etiqueta="Productos" valor={c.productos} meta={min.productos} />
              <Avance etiqueta="Semanas" valor={c.ventanasIndependientes} meta={min.ventanas} />
            </Modelo>
            <Modelo modelo={modelo('unidades-por-visita-contexto')} Icono={Link2} titulo="Ventas con contexto del nicho" pregunta="¿Y si además sabe cuánto se busca y quién compite?">
              <Avance etiqueta="Semanas con las tres fuentes" valor={e.integracion?.ventanasUnidas} meta={min.ventanas} />
              <Avance etiqueta="Nichos" valor={e.integracion?.nichosUnidos} meta={min.nichos} />
            </Modelo>
          </div>
        </Seccion>

        <Seccion titulo="Tus productos, día por día" bajada="Todo lo que cada publicación vendió y recibió de visitas desde que existe, y si su semana actual sirve para aprender.">
          <Productos libro={com.libro} diagnostico={com.diagnostico} minimoVisitas={min.visitasSemana} />
        </Seccion>

        <Seccion titulo="Búsquedas esperadas por nicho" bajada="Un renglón por cada nicho del tablero, con la palabra que de verdad se le mide. Los próximos tres meses, comparados con los mismos meses del año pasado.">
          <Pronosticos nichos={datos.nichos} modeloGana={(() => { const ev = modelo('busquedas-google')?.evaluacion; return !!ev?.superaReferencias })()} />
        </Seccion>

        <details className="apr-plegable apr-tecnico">
          <summary><ChevronDown size={15} aria-hidden="true" />Detalle técnico: nichos capturados y reglas</summary>
          {!!Object.keys(e.integracion?.omitidas ?? {}).length && <ul className="apr-lista">{Object.entries(e.integracion.omitidas).map(([motivo, n]) =>
            <li key={motivo}><strong>{fmtNum(n)}</strong> semanas sin unir — {MOTIVOS_UNION[motivo] ?? 'evidencia incompleta'}</li>)}</ul>}
          {!!e.integracion?.nichos?.length && <div className="tabla-envoltura apr-tabla apr-tabla-corta"><table>
            <thead><tr><th scope="col">Nicho</th><th scope="col">Búsqueda medida</th><th scope="col">Última lectura</th><th scope="col" className="num">Productos</th></tr></thead>
            <tbody>{e.integracion.nichos.map((n) => <tr key={n.nichoId}>
              <td className="celda-titulo">{n.keyword}</td><td>{n.keywordDemanda}</td>
              <td>{fmtFecha(n.capturadoEl)}{!n.reciente && <span className="apr-chip apr-chip-aviso apr-chip-mini">antigua</span>}</td>
              <td className="num">{fmtNum(n.productos)}</td>
            </tr>)}</tbody>
          </table></div>}
          <ul className="apr-lista">
            <li>Una semana vale si hubo stock los siete días, no cambió el tipo de envío y el precio no varió más de 15%.</li>
            <li>Cero ventas con visitas es un dato válido. Sin medición no es cero.</li>
            <li>No usa tu costo de compra ni calcula ganancia: aprende de ventas, visitas y precio de venta.</li>
            <li>Los modelos con más de 90 días dejan de pronosticar hasta reentrenarse (lunes 10:30).</li>
          </ul>
        </details>
      </>}
    </main>
  )
}
