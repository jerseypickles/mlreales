import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, RefreshCw, Search, ShoppingBag, Info, Link2 } from 'lucide-react'
import { api } from '../api.js'
import { Cargando, StatTile } from './ui.jsx'
import { fmtFecha, fmtNum, fmtPrecio } from '../lib/formato.js'

const decimal = (valor, digitos = 2) => Number.isFinite(valor)
  ? valor.toLocaleString('es-CL', { maximumFractionDigits: digitos }) : '—'
const mes = (periodo) => /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? '')
  ? new Date(`${periodo}-15T12:00:00Z`).toLocaleDateString('es-CL', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
const fecha = (valor) => valor ? new Date(valor).toLocaleDateString('es-CL', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago',
}) : '—'

function EstadoModelo({ modelo, titulo, descripcion, Icono, children }) {
  const entrenado = modelo?.estado === 'sombra'
  const estado = !modelo ? 'Sin entrenamiento registrado'
    : !entrenado ? 'Datos insuficientes'
      : !modelo.vigente ? 'Entrenamiento vencido' : 'Entrenado · en observación'
  const e = modelo?.evaluacion
  const demanda = modelo?.objetivo === 'busquedas-google'
  const combinado = modelo?.objetivo === 'unidades-por-visita-contexto'
  const referencias = [e?.referenciaEstacional, e?.referenciaPersistencia].filter(Number.isFinite)
  const referencia = demanda ? (referencias.length ? Math.min(...referencias) : null) : e?.referencia
  const mejora = Number.isFinite(e?.maeLog) && Number.isFinite(referencia) && referencia > 0
    ? (1 - e.maeLog / referencia) * 100 : null
  return (
    <article className="ml-modelo">
      <div className="ml-modelo-titulo"><Icono size={20} aria-hidden="true" /><h3>{titulo}</h3></div>
      <p className="ml-descripcion">{descripcion}</p>
      <span className={`ml-etiqueta ${entrenado && modelo.vigente ? 'ml-azul' : ''}`}>{estado}</span>
      <div className="ml-modelo-datos">{children}</div>
      {modelo && <p className="ml-meta">Registro de entrenamiento: {fmtFecha(modelo.creadoEl)}</p>}
      {!entrenado && <p className="ml-aclaracion">Se necesita suficiente historial para separar los datos de entrenamiento de los de prueba. Todavía no hay una evaluación disponible.</p>}
      {entrenado && !modelo.vigente && <p className="ml-aclaracion">Esta versión tiene más de 90 días o una fecha inválida. Necesita un entrenamiento vigente para emitir nuevas estimaciones.</p>}
      {e && <details className="ml-detalle">
        <summary>Evaluación del modelo</summary>
        <p>{demanda ? 'Prueba histórica con meses posteriores a los usados para entrenar.'
          : 'Prueba con productos reservados y fechas posteriores al entrenamiento.'}</p>
        <dl className="ml-metricas">
          <div><dt>Error del modelo</dt><dd>{decimal(e.maeLog, 4)}</dd></div>
          <div><dt>Error de referencia</dt><dd>{decimal(referencia, 4)}</dd></div>
        </dl>
        {mejora !== null && <p>{decimal(Math.abs(mejora), 1)}% {mejora >= 0 ? 'menos' : 'más'} error que la referencia en esta prueba.</p>}
        <p className="ml-meta">Error absoluto medio en escala logarítmica; menor es mejor. No es un porcentaje de acierto. La referencia {demanda
          ? 'es la mejor entre repetir el año anterior y mantener el último valor.' : combinado
            ? 'es la mejor entre el promedio y el modelo de ventas sin datos del nicho, evaluados con los mismos productos y fechas.'
            : 'es el promedio del entrenamiento, equilibrado por producto.'}</p>
        {combinado && <p className="ml-meta">Error sin contexto del nicho: {decimal(e.referenciaSinContexto, 4)}. Así se mide si añadir Zyte y DataForSEO aporta información. La prueba reserva productos, no nichos completos.</p>}
        <p className="ml-meta">Estos resultados no activan cambios en las recomendaciones.</p>
      </details>}
    </article>
  )
}

const MOTIVOS_UNION = {
  'producto-sin-nicho-vinculado': 'Producto sin un nicho vinculado al registrar sus ventas',
  'sin-captura-zyte-anterior': 'Falta una captura de Zyte anterior a la semana',
  'captura-zyte-fuera-de-fecha': 'La captura de Zyte no cumple las fechas o tiene más de 14 días',
  'sin-serie-demanda-anterior': 'Falta historial de búsquedas disponible antes de la semana',
  'serie-demanda-posterior': 'Las búsquedas se recuperaron después de comenzar la semana',
  'demanda-sin-meses-recientes': 'El historial de búsquedas no llega a meses recientes',
  'demanda-con-huecos': 'Faltan meses continuos en el historial de búsquedas',
  'pocos-productos-zyte': 'Menos de 10 productos comparables con precio en Zyte',
  'atributos-invalidos': 'Fecha o precio de venta incompleto',
  'contexto-incompleto': 'Datos del nicho incompletos',
}

function IntegracionFuentes({ datos }) {
  if (!datos) return null
  return <section className="ml-seccion" aria-labelledby="ml-union">
    <div className="ml-seccion-titulo"><h3 id="ml-union">Tres fuentes, un mismo nicho</h3><span className="ml-etiqueta">Zyte + DataForSEO + tu cuenta de ML</span></div>
    <p className="ml-descripcion">Cada semana de ventas se cruza con las búsquedas y la competencia que ya se habían medido antes de comenzar esa semana. Los listados y las fichas de Zyte conservan su propia fecha.</p>
    <div className="tiles">
      <StatTile label="Nichos capturados con Zyte" value={fmtNum(datos.nichosCapturados)} detalle="Listado y detalle del mismo scan no se cuentan dos veces" />
      <StatTile label="Semanas con las tres fuentes" value={fmtNum(datos.ventanasUnidas)} detalle={`De ${fmtNum(datos.ventanasCandidatas)} semanas comerciales válidas`} />
      <StatTile label="Productos con contexto" value={fmtNum(datos.productosUnidos)} detalle={`En ${fmtNum(datos.nichosUnidos)} nichos vinculados`} />
    </div>
    {!datos.nichos.length ? <p className="ml-vacio">Todavía no hay capturas de Zyte guardadas para esta integración. Se conservarán en las próximas pasadas del scraper.</p> : <div className="tabla-envoltura ml-tabla"><table>
      <thead><tr><th scope="col">Nicho</th><th scope="col">Búsqueda vinculada</th><th scope="col">Última captura Zyte</th><th scope="col" className="num">Productos capturados</th><th scope="col" className="num">Semanas unidas</th></tr></thead>
      <tbody>{datos.nichos.map((n) => <tr key={n.nichoId}>
        <td className="celda-titulo">{n.keyword}</td><td>{n.keywordDemanda}</td>
        <td>{fmtFecha(n.capturadoEl)}<small className="ml-subdato">{n.fase === 'detalle' ? 'Con detalle de fichas' : 'Listado'}{!n.reciente ? ' · necesita un scan reciente' : ''}</small></td>
        <td className="num">{fmtNum(n.productos)}</td><td className="num">{fmtNum(n.ventanasUnidas)}</td>
      </tr>)}</tbody>
    </table></div>}
    {!!Object.keys(datos.omitidas).length && <details className="ml-detalle" open>
      <summary>Semanas que todavía no se pueden unir</summary>
      <ul>{Object.entries(datos.omitidas).map(([motivo, cantidad]) => <li key={motivo}>{MOTIVOS_UNION[motivo] ?? 'Evidencia incompleta'}: <strong>{fmtNum(cantidad)}</strong></li>)}</ul>
    </details>}
    <p className="ml-meta">Hasta 100 nichos. El modelo utiliza hasta 30 productos únicos con precio por captura y excluye la publicación propia cuando se identifica. Full y reseñas se acompañan de su cobertura: un campo ausente no se interpreta como cero.</p>
    <p className="ml-meta">Las reseñas son contadores públicos de publicación o catálogo; los avisos de vendidos se conservan para auditoría y no entrenan como ventas exactas. Recuperar datos hoy no los convierte en información disponible en una fecha pasada.</p>
  </section>
}

function HistorialNichos({ series, total }) {
  return (
    <details className="ml-detalle ml-historial">
      <summary>Ver historial de nichos · {fmtNum(total)} búsquedas</summary>
      {!series.length ? <p className="ml-vacio">Todavía no hay capturas de búsquedas para el aprendizaje.</p> : <>
        <p className="ml-meta">Hasta 100 búsquedas de Google en Chile. Tener 24 meses continuos permite calcular variables; no garantiza que alcance para entrenar.</p>
        <div className="tabla-envoltura"><table>
          <thead><tr><th scope="col">Búsqueda</th><th scope="col">Historial guardado</th><th scope="col">Continuidad reciente</th><th scope="col">Última captura</th></tr></thead>
          <tbody>{series.map((s) => <tr key={s.keyword}>
            <td className="celda-titulo">{s.keyword}</td>
            <td>{mes(s.desde)} – {mes(s.hasta)}<small className="ml-subdato">{fmtNum(s.meses)} meses disponibles</small></td>
            <td>{s.continua24Meses ? '24 meses continuos' : 'Historial corto o con huecos'}
              {!s.reciente && <small className="ml-subdato ml-aviso">Falta una medición reciente</small>}</td>
            <td>{fecha(s.capturadoEl)}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </details>
  )
}

function ProductosObservados({ perfiles, diagnostico }) {
  return (
    <section className="ml-seccion" aria-labelledby="ml-productos">
      <div className="ml-seccion-titulo"><h3 id="ml-productos">Productos con datos observados</h3><span className="ml-etiqueta">Semanas cerradas en 90 días</span></div>
      <p className="ml-descripcion">Hasta 20 productos, ordenados por unidades vendidas en semanas válidas. Incluye stock anterior aunque su costo de compra sea desconocido.</p>
      {!perfiles.length ? <p className="ml-vacio">Todavía no hay semanas completas que cumplan los criterios. Esto no significa que tus productos no estén vendiendo.</p> : <div className="tabla-envoltura ml-tabla">
        <table><thead><tr>
          <th scope="col">Producto</th><th scope="col">Período observado</th><th scope="col" className="num">Semanas</th>
          <th scope="col" className="num">Visitas</th><th scope="col" className="num">Unidades</th><th scope="col" className="num">Unid. / 100 visitas</th>
        </tr></thead><tbody>{perfiles.map((p) => <tr key={p.itemId}>
          <td className="celda-titulo ml-producto-nombre">{p.titulo || p.itemId}<small className="ml-subdato">{p.itemId} · último precio de venta {fmtPrecio(p.precio)}</small></td>
          <td>{fecha(p.desde)}<small className="ml-subdato">a {fecha(p.hasta)}</small></td>
          <td className="num">{fmtNum(p.ventanasSinSolapar)}</td><td className="num">{fmtNum(p.visitas)}</td>
          <td className="num">{fmtNum(p.unidades)}</td><td className="num">{decimal(p.unidadesPor100Visitas)}</td>
        </tr>)}</tbody></table>
      </div>}
      {diagnostico?.length > 0 && <details className="ml-detalle" open={!perfiles.length}>
        <summary>Qué le falta hoy a cada producto</summary>
        <ul>{diagnostico.map((d) => <li key={d.itemId}><strong>{d.titulo || d.itemId}</strong>: {d.admisible
          ? (d.visitas >= 30 ? 'semana admisible' : `semana guardada, con ${fmtNum(d.visitas)} visitas (se entrena desde 30)`)
          : d.motivo}</li>)}</ul>
      </details>}
      <p className="ml-meta">Se suman semanas de siete días sin solaparlas; puede haber huecos entre ellas. Unidades por 100 visitas describe lo observado, no la probabilidad de compra ni la ganancia.</p>
      <details className="ml-detalle">
        <summary>Criterios para admitir una semana</summary>
        <ul>
          <li>Órdenes pagadas sincronizadas y visitas con las mismas fechas de inicio y fin.</li>
          <li>Al menos 30 visitas y registros de stock disponible cada día de la ventana.</li>
          <li>Sin cambio de logística dentro de la ventana. El precio es el promedio de la semana; si varió más de 15% (una promoción grande) la semana se guarda pero no se usa para entrenar.</li>
          <li>Cero ventas es un resultado válido cuando existen visitas y mediciones completas.</li>
        </ul>
        <p className="ml-meta">El stock se comprueba en las mediciones disponibles; no es una garantía de disponibilidad entre mediciones.</p>
      </details>
    </section>
  )
}

function Pronosticos({ pronosticos }) {
  return (
    <section className="ml-seccion" aria-labelledby="ml-pronosticos">
      <div className="ml-seccion-titulo"><h3 id="ml-pronosticos">Predicciones y resultados</h3><span className="ml-etiqueta">Búsquedas de Google · Chile</span></div>
      <p className="ml-descripcion">Últimos 100 pronósticos guardados antes del mes previsto. El resultado se añade cuando llega una medición posterior.</p>
      {!pronosticos.length ? <p className="ml-vacio">Aún no hay predicciones registradas. Aparecerán al disponer de un modelo entrenado y series recientes con suficiente historial.</p> : <div className="tabla-envoltura ml-tabla">
        <table><thead><tr>
          <th scope="col">Nicho y emisión</th><th scope="col">Mes previsto</th><th scope="col" className="num">Predicción</th>
          <th scope="col" className="num">Año anterior</th><th scope="col" className="num">Observado</th><th scope="col">Resultado</th>
        </tr></thead><tbody>{pronosticos.map((p) => {
          const evaluada = Number.isFinite(p.evaluacion?.real)
          const e = p.evaluacion
          const comparables = evaluada && Number.isFinite(e.errorAbsoluto) && Number.isFinite(e.errorReferencia)
          const resultado = !comparables ? 'Pendiente de medición' : e.errorAbsoluto < e.errorReferencia
            ? 'Menor error que año anterior' : e.errorAbsoluto > e.errorReferencia ? 'Mayor error que año anterior' : 'Mismo error que año anterior'
          return <tr key={p._id}>
            <td className="celda-titulo">{p.keyword}<small className="ml-subdato">Emitido {fecha(p.emitidoEl)}</small></td>
            <td>{mes(p.periodo)}</td><td className="num">{fmtNum(p.datos?.estimado)}</td>
            <td className="num">{fmtNum(p.datos?.referencia)}</td><td className="num">{evaluada ? fmtNum(e.real) : '—'}</td>
            <td><span className="ml-resultado">{resultado}</span>{evaluada && <small className="ml-subdato">Medido {fecha(e.medidoEl)}</small>}</td>
          </tr>
        })}</tbody></table>
      </div>}
      <p className="ml-meta">Son búsquedas estimadas, no ventas de Mercado Libre. Una predicción aislada no demuestra que el modelo mejore. Varias versiones pueden pronosticar el mismo mes.</p>
    </section>
  )
}

export function Aprendizaje() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const peticion = useRef(null)
  const cargar = useCallback(async () => {
    peticion.current?.abort()
    const controlador = new AbortController()
    peticion.current = controlador
    setCargando(true)
    try {
      const opciones = { signal: controlador.signal }
      const [estado, productos, predicciones] = await Promise.all([
        api.aprendizaje(opciones), api.aprendizajePerfiles(opciones), api.aprendizajePronosticos(opciones),
      ])
      if (!controlador.signal.aborted) {
        setDatos({ estado, perfiles: productos.perfiles, pronosticos: predicciones.pronosticos })
        setError(null)
      }
    } catch (err) {
      if (!controlador.signal.aborted) setError(err.message === 'HTTP 404'
        ? 'El servidor todavía no tiene disponible la pantalla de aprendizaje. Falta desplegar la versión del backend que la acompaña.' : err.message)
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
  return (
    <main className="ml-pagina">
      <div className="reporte-encabezado ml-encabezado">
        <div><div className="ml-kicker"><Eye size={16} aria-hidden="true" /> Seguimiento del aprendizaje</div>
          <h2>Lo que el sistema está aprendiendo</h2>
          <p className="reporte-fecha">Datos observados, historial y resultados de los modelos.</p>
        </div>
        <button type="button" className="boton-secundario ml-refrescar" onClick={cargar} disabled={cargando}>
          <RefreshCw size={15} aria-hidden="true" />{cargando ? 'Consultando…' : 'Actualizar vista'}
        </button>
      </div>
      {error && <p className="error-bloque" role="alert">No se pudo actualizar: {error}{datos ? ' Se conserva la última consulta; estos datos pueden estar desactualizados.' : ''}</p>}
      {!datos && !error && <Cargando texto="Consultando los datos del aprendizaje…" />}
      {e && <>
        <div className="ml-observacion" role="status">
          <Eye size={22} aria-hidden="true" /><div><strong>{e.activo ? 'Modo observación habilitado' : 'Captura y entrenamiento desactivados'}</strong>
            <p>{e.activo ? 'Los modelos reúnen evidencia y se evalúan en paralelo. Las recomendaciones siguen con su funcionamiento actual.'
              : 'Puedes consultar el historial guardado. No se están programando nuevos entrenamientos de ML.'}</p>
          </div>
        </div>
        <p className="ml-meta ml-consulta">Consultado {fmtFecha(e.consultadoEl)} · La vista se actualiza cada minuto mientras está abierta.</p>
        <div className="tiles ml-resumen">
          <StatTile label="Búsquedas con historial" value={fmtNum(c.keywords)} detalle={`${fmtNum(c.con24Meses)} con 24 meses continuos al final de la serie`} />
          <StatTile label="Productos con datos válidos" value={fmtNum(c.productos)} detalle={`${fmtNum(c.ventanasIndependientes)} semanas sin solapar, cerradas en los últimos 2 años`} />
          <StatTile label="Días de venta en el libro" value={fmtNum(e.fuentes.comercial.libro?.dias)} detalle={e.fuentes.comercial.libro?.dias
            ? `${fmtNum(e.fuentes.comercial.libro.productos)} productos desde ${fecha(e.fuentes.comercial.libro.desde)} · ${fmtNum(e.fuentes.comercial.libro.unidades)} unidades y ${fmtNum(e.fuentes.comercial.libro.visitas)} visitas`
            : 'Se llena con el próximo scan de tus productos'} />
          <StatTile label="Predicciones guardadas" value={fmtNum(c.predicciones)} detalle="Estimaciones de búsquedas para meses futuros" />
          <StatTile label="Predicciones contrastadas" value={fmtNum(c.evaluadas)} detalle="Con una medición posterior; no equivale a aciertos" />
        </div>
        <section className="ml-alcance" aria-label="Cómo se utiliza el stock">
          <Info size={20} aria-hidden="true" /><div><strong>Ventas observadas, con el costo de compra fuera del aprendizaje</strong>
            <p>El stock antiguo aporta ventas, visitas y precio de venta cuando hay mediciones completas. No se deducen márgenes ni rentabilidad de un costo desconocido.</p>
            <p>Los productos en camino aportarán resultados comerciales cuando estén a la venta y reúnan mediciones válidas.</p>
          </div>
        </section>
        <div className="ml-modelos">
          <EstadoModelo modelo={e.modelos.find((m) => m.objetivo === 'busquedas-google')} titulo="Demanda por temporada" Icono={Search}
            descripcion="Aprende cómo cambian las búsquedas entre años y anticipa los próximos meses.">
            <p><strong>Fuente:</strong> historial de Google Ads, obtenido con DataForSEO.</p>
            <p><strong>Última captura:</strong> {e.fuentes.demanda.ultimaCapturaEl ? fmtFecha(e.fuentes.demanda.ultimaCapturaEl) : 'Aún sin capturas'}</p>
            <p><strong>Variables:</strong> crecimiento reciente, comparación anual y estacionalidad.</p>
          </EstadoModelo>
          <EstadoModelo modelo={e.modelos.find((m) => m.objetivo === 'unidades-por-visita')} titulo="Ventas y visitas" Icono={ShoppingBag}
            descripcion="Aprende la relación entre unidades vendidas y visitas según categoría, precio de venta y logística.">
            <p><strong>Fuente:</strong> órdenes pagadas y visitas de tu cuenta de Mercado Libre.</p>
            <p><strong>Última semana válida:</strong> {e.fuentes.comercial.ultimaVentanaEl ? fecha(e.fuentes.comercial.ultimaVentanaEl) : 'Aún sin semanas válidas'}</p>
            <p><strong>Alcance:</strong> comportamiento comercial observado, sin costos de compra.</p>
          </EstadoModelo>
          <EstadoModelo modelo={e.modelos.find((m) => m.objetivo === 'unidades-por-visita-contexto')} titulo="Ventas con contexto del nicho" Icono={Link2}
            descripcion="Aprende de tus ventas junto con las búsquedas de DataForSEO y los productos que Zyte observa en ese nicho.">
            <p><strong>Fuentes:</strong> las tres, vinculadas por nicho y fecha.</p>
            <p><strong>Variables añadidas:</strong> demanda, temporada, precio relativo, Full, catálogo y reseñas públicas.</p>
            <p><strong>Evaluación:</strong> compara con el modelo de ventas sin contexto del nicho.</p>
          </EstadoModelo>
        </div>
        <IntegracionFuentes datos={e.integracion} />
        <HistorialNichos series={e.series} total={c.keywords} />
        <ProductosObservados perfiles={datos.perfiles} diagnostico={e.fuentes.comercial.diagnostico} />
        <Pronosticos pronosticos={datos.pronosticos} />
      </>}
    </main>
  )
}
