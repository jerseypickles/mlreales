import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { Lightbulb, TrendingUp, TrendingDown, Minus, Clock, ArrowLeftRight, Wrench } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'

// PUBLICIDAD, LEÍDA EN PLATA.
//
// El panel de ML compara el gasto contra la VENTA y de ahí saca ACOS y ROAS.
// Ese número no dice si ganas: lo que decide es la CONTRIBUCIÓN (precio −
// comisión − envío Full), que ML no conoce. Por eso su recomendador sugiere
// subir el presupuesto a $18.297 para traer 28 ventas, que al ticket medio de
// $3.726 son $7.026 de publicidad por cada venta: ROAS marginal 0,53x.
//
// Este tab responde otra pregunta: cuánta contribución generó cada anuncio y
// cuánto costó. Y como el costo de la mercadería no está cargado, todo lo que
// se muestra es el TECHO — el resultado real es peor, nunca mejor.
//
// Los SELLOS son los de ML (más vendido, mayor ingreso, más visto) porque son
// el idioma con el que el importador ya lee su panel. La diferencia es que acá
// cada sello convive con el resultado en plata, que es lo que ML no muestra:
// un producto puede ser el más visto y estar perdiendo margen en cada venta.

const fmtX = (v) => (Number.isFinite(v) ? `${Math.round(v * 100) / 100}x` : '—')
const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—')
const fmtMiles = (v) => (Number.isFinite(v) ? v.toLocaleString('es-CL') : '—')

const VEREDICTOS = {
  escalar: { clase: 'ad-bien', texto: 'rinde' },
  justo: { clase: 'ad-justo', texto: 'al filo' },
  pierde: { clase: 'ad-mal', texto: 'pierde' },
  'sin-ventas': { clase: 'ad-mal', texto: 'gasta sin vender' },
  'sin-economia': { clase: 'ad-neutro', texto: 'sin precio' },
  'sin-datos': { clase: 'ad-neutro', texto: 'sin datos' },
}

// Los sellos se calculan sobre lo que se está mirando, no son absolutos: "más
// vendido" quiere decir el más vendido DE ESTA ventana. Por eso se recalculan
// al cambiar de período en vez de guardarse.
function sellosDe(filas) {
  const porSello = new Map()
  const lider = (fn, minimo = 0) => {
    let mejor = null
    for (const f of filas) {
      const v = fn(f)
      if (!Number.isFinite(v) || v <= minimo) continue
      if (!mejor || v > fn(mejor)) mejor = f
    }
    return mejor?.id ?? null
  }
  const marcar = (id, sello) => {
    if (!id) return
    porSello.set(id, [...(porSello.get(id) ?? []), sello])
  }
  marcar(lider((f) => f.unidades), { texto: 'más vendido', clase: 'sello-vendido' })
  marcar(lider((f) => f.venta), { texto: 'mayor ingreso', clase: 'sello-ingreso' })
  marcar(lider((f) => f.impresiones), { texto: 'más visto', clase: 'sello-visto' })
  marcar(lider((f) => (f.unidades > 0 ? f.roasReal : null)), { texto: 'mejor retorno', clase: 'sello-retorno' })
  const hace30 = Date.now() - 30 * 86400e3
  for (const f of filas) {
    if (f.creadoEl && new Date(f.creadoEl).getTime() > hace30) {
      marcar(f.id, { texto: 'nuevo', clase: 'sello-nuevo' })
    }
    if (f.gasto > 0 && !f.unidades) marcar(f.id, { texto: 'no vende', clase: 'sello-alerta' })
  }
  return porSello
}

function Cifra({ etiqueta, valor, ayuda, tono }) {
  return (
    <div className={`ads-cifra${tono ? ` ads-cifra-${tono}` : ''}`} title={ayuda}>
      <span>{etiqueta}</span>
      <strong>{valor}</strong>
    </div>
  )
}

// Las tres campañas como diales, que es lo único que se puede mover: ML no
// expone puja por producto, solo presupuesto y ROAS objetivo POR CAMPAÑA. Por
// eso separar productos en campañas distintas es la única forma de tratarlos
// distinto, y por eso esta tarjeta muestra objetivo y real uno al lado del otro.
const ACCION = {
  'subir-presupuesto': { txt: 'subir presupuesto', clase: 'acc-sube' },
  'bajar-presupuesto': { txt: 'bajar presupuesto', clase: 'acc-baja' },
  'subir-objetivo': { txt: 'subir objetivo', clase: 'acc-baja' },
  'bajar-objetivo': { txt: 'bajar objetivo', clase: 'acc-sube' },
  mantener: { txt: 'mantener', clase: 'acc-neutra' },
  cerrar: { txt: 'cerrar', clase: 'acc-baja' },
  'mover-productos': { txt: 'mover productos', clase: 'acc-mover' },
  'arreglar-listing': { txt: 'arreglar listing', clase: 'acc-listing' },
}

// El ICONO de la acción: el importador lee la tarjeta de un vistazo y tiene que
// saber si hay algo que hacer sin leer el párrafo.
const ICONO_ACCION = {
  'subir-presupuesto': TrendingUp,
  'bajar-objetivo': TrendingUp, // objetivo más bajo = gasta más = empuja
  'bajar-presupuesto': TrendingDown,
  'subir-objetivo': TrendingDown,
  cerrar: TrendingDown,
  mantener: Minus,
  'mover-productos': ArrowLeftRight,
  // el problema no está en la puja: ML lo muestra y la gente no hace clic
  'arreglar-listing': Wrench,
}

// La sugerencia vive DENTRO de la tarjeta de su campaña: es sobre esos diales y
// no sobre otra cosa, así que separarla en un bloque aparte obligaba a cruzar
// nombres con la vista. Acá se lee el dial y su consejo en el mismo lugar.
function SugerenciaCampana({ reco }) {
  if (!reco) return null
  const a = ACCION[reco.accion] ?? ACCION.mantener
  const Icono = ICONO_ACCION[reco.accion] ?? Minus
  const esperar = reco.accion === 'mantener' && reco.confianza === 'baja'
  return (
    <details className={`camp-sug camp-sug-${a.clase}`} open>
      <summary>
        {esperar ? <Clock aria-hidden="true" /> : <Icono aria-hidden="true" />}
        <span className="camp-sug-txt">{a.txt}</span>
        {reco.presupuestoSugerido ? (
          <b>{fmtPrecio(reco.presupuestoActual)} → {fmtPrecio(reco.presupuestoSugerido)}</b>
        ) : null}
        {reco.roasObjetivoSugerido ? <b>{reco.roasObjetivoActual}x → {reco.roasObjetivoSugerido}x</b> : null}
      </summary>
      <div>
        {reco.productosAMover?.length ? (
          <ul className="camp-mover">
            {reco.productosAMover.map((m) => (
              <li key={m.itemId} className={m.direccion === 'entra' ? 'mov-entra' : 'mov-sale'}>
                <b>{m.direccion === 'entra' ? '← entra' : '→ sale'}</b> {m.titulo ?? m.itemId}
                <span>{m.motivo}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p>{reco.porque}</p>
        {reco.queEsperar ? <p className="camp-sug-esperar"><b>A revisar:</b> {reco.queEsperar}</p> : null}
        <span className="camp-sug-conf">confianza {reco.confianza}</span>
      </div>
    </details>
  )
}

function Campanas({ campanas, dias, recomendaciones }) {
  // UNA CAMPAÑA PUEDE TENER VARIAS RECOMENDACIONES y son de distinta naturaleza:
  // el dial es una cosa y arreglar un listing es otra. Esto era un Map por
  // campanaId, así que la segunda pisaba a la primera y la Campaña 1 mostraba
  // "arreglar listing" habiendo también un "subir objetivo a 2,8x" que se perdía.
  const porCampana = new Map()
  for (const r of recomendaciones ?? []) {
    porCampana.set(r.campanaId, [...(porCampana.get(r.campanaId) ?? []), r])
  }
  const vivas = campanas.filter((c) => c.estado === 'active')
  const pausadas = campanas.filter((c) => c.estado !== 'active')
  const tarjeta = (c) => {
    const m = c.metricas ?? {}
    const objetivo = c.roasObjetivo ?? (c.acosObjetivo ? 100 / c.acosObjetivo : null)
    const real = m.cost > 0 ? m.total_amount / m.cost : null
    // el divisor son los días que la campaña VIVIÓ, no los de la ventana. Con el
    // selector en 30d y una campaña de 4 días, dividir por 30 la mostraba a un
    // séptimo de lo que gasta: Campaña 2 aparecía con $281/día cuando gastaba
    // $1.901 y su barra parecía vacía teniendo el presupuesto casi lleno.
    const diasReales = c.diasConDatos ?? dias
    const gastoDia = m.cost ? m.cost / diasReales : 0
    const usoPct = c.presupuestoDiario ? Math.round((gastoDia / c.presupuestoDiario) * 100) : null
    const cumple = real != null && objetivo != null ? real >= objetivo : null
    return (
      <article className={`ads-camp${c.estado !== 'active' ? ' ads-camp-off' : ''}`} key={c.id}>
        <header>
          <strong>{c.nombre}</strong>
          {c.estado !== 'active' ? <span className="ads-estado">pausada</span> : null}
          {porCampana.has(c.id) ? (
            <span
              className="camp-tiene-sug"
              title={`${porCampana.get(c.id).length} sugerencia(s) para esta campaña`}
            >
              <Lightbulb aria-hidden="true" />
              {porCampana.get(c.id).length > 1 ? <b>{porCampana.get(c.id).length}</b> : null}
            </span>
          ) : null}
        </header>
        <div className="ads-camp-roas">
          <div title="El dial que le pediste a ML. Más alto = más exigente = gasta menos.">
            <span>objetivo</span>
            <b>{fmtX(objetivo)}</b>
          </div>
          <div title="Lo que efectivamente devolvió cada peso. Si supera al objetivo, le sobra margen.">
            <span>real</span>
            <b className={cumple === false ? 'res-mal' : cumple ? 'res-bien' : ''}>{fmtX(real)}</b>
          </div>
        </div>
        <div className="ads-camp-pie">
          <span
            title={`Promedio de los ${diasReales} día(s) que la campaña lleva viva, no de la ventana de ${dias} días. El presupuesto es un tope DIARIO, así que compararlo contra el promedio de una ventana larga no dice si hoy se topó.`}
          >
            {fmtPrecio(Math.round(gastoDia))}/día de {fmtPrecio(c.presupuestoDiario)}
            <em> · promedio de {diasReales}d</em>
          </span>
          {usoPct != null ? (
            <div
              className="ads-barra"
              title={
                usoPct >= 100
                  ? 'Gasta por sobre el tope: con estrategia de rentabilidad ML lo supera cuando encuentra conversiones que cumplen el objetivo.'
                  : 'Si no llega al tope, el limitante no es la plata sino el objetivo de ROAS.'
              }
            >
              <span className={usoPct >= 100 ? 'ads-barra-full' : ''} style={{ width: `${Math.min(100, usoPct)}%` }} />
            </div>
          ) : null}
        </div>
        {(porCampana.get(c.id) ?? []).map((reco, i) => (
          <SugerenciaCampana key={`${reco.accion}-${i}`} reco={reco} />
        ))}
      </article>
    )
  }
  return (
    <section className="ads-camps">
      {vivas.map(tarjeta)}
      {pausadas.map(tarjeta)}
    </section>
  )
}

// Un producto por fila, con su foto y sus sellos a la izquierda y la plata a la
// derecha. El orden es por RESULTADO (contribución menos gasto), no por gasto
// ni por ingreso: es la única columna que dice si el anuncio te dejó algo.
function Productos({ economia, campanas }) {
  const filas = Object.entries(economia ?? {})
    .map(([id, e]) => ({ id, ...e }))
    .filter((f) => f.gasto > 0 || f.unidades > 0)
    .sort((a, b) => (b.resultado ?? -1e9) - (a.resultado ?? -1e9))
  if (!filas.length) return null

  const sellos = sellosDe(filas)
  const nombreCampana = new Map((campanas ?? []).map((c) => [c.id, c.nombre]))

  return (
    <section className="ads-productos">
      <div className="ads-seccion-cabeza">
        <h3>Producto por producto</h3>
        <p>
          Ordenados por <strong>resultado</strong>: la contribución que generaron menos lo que costaron. Los
          sellos son los de ML; la columna de resultado es la que ML no muestra.
        </p>
      </div>

      <ul className="ads-lista">
        {filas.map((f) => {
          const v = VEREDICTOS[f.veredicto?.estado] ?? VEREDICTOS['sin-datos']
          const ctr = f.impresiones ? (f.clicks / f.impresiones) * 100 : null
          const conv = f.clicks ? (f.unidades / f.clicks) * 100 : null
          const misSellos = sellos.get(f.id) ?? []
          return (
            <li key={f.id} className={f.resultado < 0 ? 'ads-fila ads-fila-mal' : 'ads-fila'}>
              {f.foto ? (
                <img className="ads-foto" src={f.foto} alt="" loading="lazy" width="52" height="52" />
              ) : (
                <span className="ads-foto ads-foto-vacia" aria-hidden="true" />
              )}

              <div className="ads-ficha">
                {f.permalink ? (
                  <a className="ads-nombre" href={f.permalink} target="_blank" rel="noreferrer">
                    {f.titulo ?? f.id}
                  </a>
                ) : (
                  <span className="ads-nombre">{f.titulo ?? f.id}</span>
                )}
                <div className="ads-sellos">
                  {misSellos.map((s) => (
                    <span key={s.texto} className={`ads-sello ${s.clase}`}>
                      {s.texto}
                    </span>
                  ))}
                  {f.campanaId && nombreCampana.has(f.campanaId) ? (
                    <span className="ads-sello sello-campana">{nombreCampana.get(f.campanaId)}</span>
                  ) : null}
                  {f.estado === 'hold' ? (
                    <span className="ads-sello sello-alerta" title="ML lo tiene detenido: pausado o sin stock">
                      detenido
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="ads-embudo" title="Cuántos lo vieron, cuántos entraron y cuántos compraron">
                <b>{fmtMiles(f.impresiones)}</b>
                <span>vistas</span>
                <b>{fmtMiles(f.clicks)}</b>
                <span>clics · {fmtPct(ctr)}</span>
                <b>{f.unidades || '—'}</b>
                <span>ventas{conv != null ? ` · ${fmtPct(conv)}` : ''}</span>
              </div>

              <div className="ads-plata">
                <div>
                  <span>facturó</span>
                  <b>{fmtPrecio(f.venta)}</b>
                </div>
                <div>
                  <span>gastó</span>
                  <b>{fmtPrecio(f.gasto)}</b>
                </div>
                <div title={f.roas ? `Su equilibrio es ${fmtX(f.roas)}: bajo eso destruye margen` : ''}>
                  <span>ROAS</span>
                  <b>
                    {fmtX(f.roasReal)}
                    {f.roas ? <em> / {fmtX(f.roas)}</em> : null}
                  </b>
                </div>
                <div className="ads-resultado">
                  <span>resultado</span>
                  <b className={f.resultado > 0 ? 'res-bien' : f.resultado < 0 ? 'res-mal' : ''}>
                    {f.resultado != null ? `${f.resultado > 0 ? '+' : ''}${fmtPrecio(f.resultado)}` : '—'}
                  </b>
                </div>
                {f.costoMaximoParaPagar != null ? (
                  <div className="ads-techo" title={`Cada venta deja ${fmtPrecio(f.contribucion + (f.costoUnitario ?? 0))} después de comisión y envío (${f.envioBase === 'facturado' ? 'envío facturado' : 'tarifa'} ${fmtPrecio(f.envio)}), y conseguirla por anuncio costó ${fmtPrecio(f.costoPorVentaAds)}. Si el producto puesto en bodega cuesta más que esto, cada venta por anuncio pierde plata.`}>
                    <span>el producto puede costar hasta</span>
                    <b className={f.costoMaximoParaPagar <= 0 ? 'res-mal' : ''}>{f.costoMaximoParaPagar <= 0 ? 'pierde igual' : fmtPrecio(f.costoMaximoParaPagar)}</b>
                  </div>
                ) : null}
                <span className={`ad-veredicto ${v.clase}`} title={f.veredicto?.texto}>
                  {v.texto}
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <details className="ads-detalle">
        <summary>Cómo se calcula el resultado y por qué es un techo</summary>
        <div>
          <p>
            El <strong>equilibrio</strong> (el segundo número de la columna ROAS) es el retorno bajo el cual ese
            anuncio destruye margen. Sale del precio cobrado, la comisión exacta de su categoría y el envío Full
            que ML facturó de verdad por ese producto (cobro por cobro con su orden); sin facturación, la tarifa.
          </p>
          <p>
            El <strong>resultado</strong> es la contribución generada menos el gasto — lo más cerca de la ganancia
            que se puede calcular <strong>sin el costo de la mercadería</strong>, que sigue sin cargarse. Por eso
            es el techo: el resultado real es peor, nunca mejor.
          </p>
        </div>
      </details>
    </section>
  )
}

// Cuánto hace que se leyó, en palabras. Con tres campañas gastando a la vez, lo
// que importa no es que el número sea de este segundo sino saber de cuándo es.
function haceCuanto(iso) {
  if (!iso) return null
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seg < 45) return 'recién'
  if (seg < 90) return 'hace 1 min'
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`
  return `hace ${Math.round(seg / 3600)} h`
}


// El encabezado del análisis: el titular y lo que hay que saber del proceso.
// Las recomendaciones YA NO viven acá — bajaron a la tarjeta de su campaña,
// porque son sobre esos diales y leerlas lejos obligaba a cruzar nombres.
function OpinionAds({ dato, corriendo, err, onAnalizar }) {
  if (!dato && !corriendo) {
    return (
      <section className="ads-opinion ads-opinion-vacia">
        <div>
          <strong>Sin análisis todavía</strong>
          <p>El analista opina sobre presupuesto y objetivo de ROAS — los dos únicos diales que ML deja mover. La sugerencia aparece dentro de cada campaña.</p>
        </div>
        <button type="button" className="boton-secundario" onClick={onAnalizar}>Analizar ahora</button>
        {err ? <p className="ads-error-suave">{err}</p> : null}
      </section>
    )
  }
  return (
    <section className="ads-opinion">
      <header>
        <div>
          <span className="ads-opinion-chip"><Lightbulb aria-hidden="true" /> análisis</span>
          <strong>{corriendo ? 'Analizando…' : dato?.titular}</strong>
        </div>
        <button type="button" className="ads-refrescar" onClick={onAnalizar} disabled={corriendo}>
          {corriendo ? 'analizando…' : 'volver a analizar'}
        </button>
      </header>

      {dato?.revisionAnterior ? (
        <details className="ads-detalle">
          <summary>Qué pasó con su consejo anterior</summary>
          <div><p>{dato.revisionAnterior}</p></div>
        </details>
      ) : null}

      {dato?.preguntas?.length ? (
        <details className="ads-detalle">
          <summary>{dato.preguntas.length} pregunta(s) para ti</summary>
          <div>{dato.preguntas.map((p, i) => <p key={i}>· {p}</p>)}</div>
        </details>
      ) : null}

      {dato?.fecha ? (
        <p className="ads-opinion-pie">
          {new Date(dato.fecha).toLocaleString('es-CL')} · {dato.modelo} · los cambios se aplican en el panel de ML
        </p>
      ) : null}
    </section>
  )
}

// EL PLAN DEL LEARNING MACHINE (src/services/ml/planCampanas.js): "comienza
// con esto y vamos analizando". Arranque para lo que no se anuncia, revisión
// contra la plata para lo que sí, y el marcador de cuánto dejó la publicidad.
const ACCIONES = {
  arrancar: { t: 'arrancar', c: 'bien' }, 'arrancar-con-cuidado': { t: 'arrancar con cuidado', c: 'medio' },
  organico: { t: 'vender orgánico', c: 'mal' }, 'no-anunciar': { t: 'no anunciar', c: 'mal' },
  esperar: { t: 'esperar', c: 'neutro' }, mantener: { t: 'mantener', c: 'bien' }, subir: { t: 'subir budget', c: 'bien' },
  'subir-roas': { t: 'subir ROAS objetivo', c: 'medio' }, bajar: { t: 'bajar budget', c: 'medio' }, apagar: { t: 'apagar', c: 'mal' },
  apagada: { t: 'apagada', c: 'neutro' }, 'sin-economia': { t: 'sin precio', c: 'neutro' },
}
const FASES = { arranque: 'antes de anunciar', 'semana-1': 'semana 1 de prueba', 'semana-2': 'semana 2 de prueba', ajuste: 'semana 3: ajuste', regular: 'en régimen', apagada: 'sin anuncio' }

function PlanLearningMachine({ fotos }) {
  const [d, setD] = useState(null)
  useEffect(() => { api.aprendizajeCampanas().then(setD).catch(() => setD(null)) }, [])
  if (!d?.productos?.length) return null
  const semanas = (d.marcador ?? []).slice(-8)
  const escala = Math.max(1, ...semanas.map((s) => Math.abs(s.resultado)))
  const orden = ['bajar', 'apagar', 'subir-roas', 'subir', 'arrancar', 'arrancar-con-cuidado', 'esperar', 'mantener', 'organico', 'no-anunciar', 'apagada', 'sin-economia']
  const productos = [...d.productos].sort((a, b) => orden.indexOf(a.accion) - orden.indexOf(b.accion))
  return (
    <section className="ads-plan">
      <div className="ads-seccion-cabeza">
        <h3>Plan del learning machine</h3>
        <p>
          Recomendaciones, no órdenes: arranca con esto y cada día lo revisa contra la <strong>plata que dejó</strong> (lo que dejan las ventas por anuncio menos lo que costó
          conseguirlas). La prueba de cada producto nuevo son 2 semanas con dos niveles de budget, para aprender cuál deja más.
          {d.sinCosto ? <> <strong>{d.sinCosto} sin costo cargado</strong>: su plata es antes de pagar el producto.</> : null}
        </p>
      </div>
      {d.reglas ? (
        <p className="ads-reglas">
          <strong>Regla aprendida:</strong>{' '}
          {d.reglas.estado === 'aprendido'
            ? <>subir el budget deja más plata cuando el ROAS supera <b>{String(d.reglas.umbral).replace('.', ',')}×</b> el empate (lo aprendido, {String(d.reglas.aprendido).replace('.', ',')}×, pesa {Math.round(d.reglas.peso * 100)}% con {d.reglas.n} cambios de gasto medidos; el resto es la regla inicial de 1,3×).</>
            : <>todavía usa la regla inicial (subir sobre 1,3× el empate): {d.reglas.estado === 'pocos-casos' ? `lleva ${d.reglas.n} cambios de gasto medidos y necesita 12` : 'los cambios de gasto medidos todavía no muestran un corte claro'}.</>}
          {d.evaluacion?.evaluadas ? <> <strong>Sus recomendaciones:</strong> {d.evaluacion.seguidas} seguidas, {d.evaluacion.tasaAcierto ?? '—'}% dejaron más plata{d.evaluacion.tasaSinSeguir != null ? ` (las no seguidas: ${d.evaluacion.tasaSinSeguir}%)` : ''}.</> : <> Sus recomendaciones se empiezan a evaluar 7 días después de hacerlas.</>}
        </p>
      ) : null}
      {semanas.length ? (
        <div className="ads-marcador" title="Por semana: lo que dejaron las ventas por anuncio menos el gasto">
          {semanas.map((s) => (
            <div key={s.semana} className={s.resultado >= 0 ? 'gana' : 'pierde'}>
              <i style={{ height: `${Math.max(4, (Math.abs(s.resultado) / escala) * 56)}px` }} />
              <b>{s.resultado >= 0 ? '+' : '−'}{fmtPrecio(Math.abs(s.resultado))}</b>
              <span>sem. {s.semana.slice(8, 10)}/{s.semana.slice(5, 7)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="ads-plan-lista">
        {productos.map((x) => {
          const a = ACCIONES[x.accion] ?? { t: x.accion, c: 'neutro' }
          return (
            <li key={x.itemId}>
              {fotos.get(x.itemId) ? <img src={fotos.get(x.itemId)} alt="" width="44" height="44" loading="lazy" /> : <span className="ads-foto-vacia" aria-hidden="true" />}
              <div className="ads-plan-ficha">
                <div className="ads-plan-cab">
                  <strong>{x.titulo ?? x.itemId}</strong>
                  <em className={`ads-plan-accion ${a.c}`}>{a.t}</em>
                  <small>{FASES[x.fase] ?? x.fase}</small>
                </div>
                <p>{x.texto}</p>
              </div>
              <dl>
                <div><dt>budget</dt><dd>{x.budgetDiario ? `${fmtPrecio(x.budgetDiario)}/día` : '—'}</dd></div>
                <div><dt>ROAS objetivo</dt><dd>{x.roasObjetivo ? `${String(x.roasObjetivo).replace('.', ',')}x` : '—'}</dd></div>
                {x.metricas?.resultado7 != null ? <div><dt>plata 7 días</dt><dd className={x.metricas.resultado7 >= 0 ? 'res-bien' : 'res-mal'}>{x.metricas.resultado7 >= 0 ? '+' : ''}{fmtPrecio(x.metricas.resultado7)}</dd></div> : null}
              </dl>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// LO QUE EL LEARNING MACHINE APRENDIÓ DE TODA LA HISTORIA DE PUBLICIDAD
// (src/services/ml/publicidad.js → entrenarEfecto): ventas TOTALES contra
// gasto diario, no la atribución de ML. Por producto: cuántas ventas agregó de
// verdad, cuánto cuesta la próxima, y el gasto diario donde deja de pagar.
function AprendidoAds({ fotos }) {
  const [d, setD] = useState(null)
  useEffect(() => { api.aprendizajePublicidad().then(setD).catch(() => setD(null)) }, [])
  const e = d?.ultimo?.efecto
  if (!e?.productos?.length) return null
  const val = e.validacion ?? {}
  const lectura = { soloConGasto: 'días con anuncio encendido', stockConocido: 'días con stock medido', todos: 'toda la historia' }[e.lectura] ?? e.lectura
  const productos = [...e.productos].filter((p) => p.ventasAtribuidasMl > 0 || p.gasto > 0).sort((a, b) => b.gasto - a.gasto)
  const escala = Math.max(1, ...productos.map((p) => Math.max(p.gastoDiarioPromedio, p.presupuestoOptimo)))
  return (
    <section className="ads-aprendido">
      <div className="ads-seccion-cabeza">
        <h3>Lo que aprendió el learning machine</h3>
        <p>
          Entrenado con {e.dias} días ({e.desde} → {e.hasta}), {e.productosEntrenados} productos, ventas <strong>totales</strong> contra gasto diario, con precio,
          promo, stock y la tendencia de cada producto controlados. Lectura: {lectura}.{' '}
          {e.estado === 'aprendido' ? (
            <>Con la publicidad predice <strong>{val.mejoraPct}% mejor</strong> los días que no vio al entrenar ({val.errorConPublicidad} vs {val.errorSinPublicidad} ventas/día de error).</>
          ) : <strong>Todavía no hay un efecto confiable: estos números son orientativos.</strong>}
        </p>
        <p className="ads-aprendido-nota">
          Por cada venta que ML le atribuye al anuncio, la publicidad trajo <strong>{String(e.incrementalidad).replace('.', ',')}</strong> ventas en total
          ({e.ventasIncrementales} contra {e.ventasAtribuidasMl}): la publicidad también empuja lo orgánico.
          {e.robustez?.coinciden ? ' Las tres lecturas del efecto coinciden.' : ' Las lecturas del efecto no coinciden del todo: tomar con cuidado.'}
          {' '}El budget óptimo supone la mercadería gratis mientras no cargues el costo: es un techo.
        </p>
      </div>
      <ul className="ads-aprendido-lista">
        {productos.map((p) => {
          const sobra = p.gastoDiarioPromedio > p.presupuestoOptimo
          return (
            <li key={p.itemId} className={sobra ? 'sobra' : 'falta'}>
              {fotos.get(p.itemId) ? <img src={fotos.get(p.itemId)} alt="" width="44" height="44" loading="lazy" /> : <span className="ads-foto-vacia" aria-hidden="true" />}
              <div className="ads-aprendido-ficha">
                <strong>{p.titulo ?? p.itemId}</strong>
                <span>{String(p.ventasPorDia).replace('.', ',')} ventas/día · deja {p.contribucion != null ? fmtPrecio(p.contribucion) : '—'} por venta antes del costo</span>
                <div className="ads-barra" title="Gasto diario de hoy contra el budget óptimo aprendido">
                  <i className="hoy" style={{ width: `${(p.gastoDiarioPromedio / escala) * 100}%` }} />
                  <i className="optimo" style={{ left: `${(p.presupuestoOptimo / escala) * 100}%` }} />
                </div>
              </div>
              <dl>
                <div><dt>ML atribuye / trajo de verdad</dt><dd>{p.ventasAtribuidasMl} / {Math.round(p.ventasIncrementales)}</dd></div>
                <div title="Gasto total ÷ ventas que la publicidad agregó"><dt>costo real por venta</dt><dd>{p.costoPorVentaIncremental ? fmtPrecio(p.costoPorVentaIncremental) : '—'}</dd></div>
                <div title="Lo que cuesta la PRÓXIMA venta al gasto de hoy: cada peso extra vende menos que el anterior"><dt>la próxima venta cuesta</dt><dd className={p.contribucion != null && p.costoVentaMarginal > p.contribucion ? 'res-mal' : ''}>{p.costoVentaMarginal ? fmtPrecio(p.costoVentaMarginal) : '—'}</dd></div>
                <div><dt>gasto hoy → óptimo</dt><dd><b>{fmtPrecio(p.gastoDiarioPromedio)} → {fmtPrecio(p.presupuestoOptimo)}</b>/día</dd></div>
              </dl>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)
  const [cargando, setCargando] = useState(false)
  const [analisis, setAnalisis] = useState(null)
  const [analizando, setAnalizando] = useState(false)
  const [errAnalisis, setErrAnalisis] = useState(null)
  // el reloj del "hace X": su único trabajo es forzar el repintado, no se lee
  const [, setTic] = useState(0)

  useEffect(() => {
    api.adsAnalisis().then((d) => setAnalisis(d.ultimo)).catch(() => {})
  }, [])

  const pedirAnalisis = useCallback(() => {
    setAnalizando(true)
    setErrAnalisis(null)
    api
      .analizarAds(7)
      .then(setAnalisis)
      .catch((e) => setErrAnalisis(e.message))
      .finally(() => setAnalizando(false))
  }, [])

  // SIN PARPADEO. Antes esto hacía setDatos(null) en cada cambio de período, o
  // sea blanqueaba la pantalla entera y mostraba el spinner para volver a
  // pintar casi lo mismo. Ahora lo viejo se queda a la vista, atenuado, hasta
  // que llega lo nuevo.
  const traer = useCallback(
    (forzar = false) => {
      setCargando(true)
      return api
        .ads(dias, forzar)
        .then((d) => {
          setDatos(d)
          setError(null)
        })
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false))
    },
    [dias],
  )

  useEffect(() => {
    traer()
  }, [traer])

  // refresco solo: el gasto se mueve en minutos, así que 60s alcanza y coincide
  // con la caché del servidor (pedir más seguido devolvería lo mismo)
  useEffect(() => {
    const id = setInterval(() => traer(), 60_000)
    return () => clearInterval(id)
  }, [traer])

  // el reloj del "hace X" corre aunque no se pida nada
  useEffect(() => {
    const id = setInterval(() => setTic((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  if (error && !datos) return <main><p className="error-inline">{error}</p></main>
  if (!datos) return <Cargando texto="Leyendo campañas de Product Ads…" />

  const filas = Object.values(datos.economia ?? {})
  // GASTO Y VENTA SALEN DE LAS CAMPAÑAS, no de sumar productos: la campaña
  // gasta algo que no se atribuye a ningún anuncio puntual ($818 sobre $133.390
  // el 20-ago) y sumar por producto no cuadraba con el panel de ML.
  // La CONTRIBUCIÓN sí es por producto — es lo único que se calcula acá.
  const tot = datos.totales ?? { gasto: 0, venta: 0, unidades: 0 }
  const contribucion = filas.reduce((a, f) => a + (f.contribucionGenerada ?? 0), 0)
  const neto = contribucion - tot.gasto
  const ticket = tot.unidades ? tot.venta / tot.unidades : null

  return (
    <main className={cargando ? 'ads-refrescando' : undefined}>
      <div className="reporte-encabezado">
        <div>
          <h2>Publicidad</h2>
          <p className="reporte-fecha">
            ML mide el gasto contra la venta; acá se mide contra la contribución, que es lo que decide si ganas.
          </p>
          {datos.rango ? (
            <p className="ads-rango" title="Ojo al cuadrar contra el panel de ML: por defecto ML muestra el MES EN CURSO, no una ventana rodante. Fechas en hora de Chile, ambos extremos incluidos.">
              {datos.rango.desde} → {datos.rango.hasta} · {dias} día(s), hora de Chile
            </p>
          ) : null}
        </div>
        <div className="ads-controles">
          <button
            type="button"
            className="ads-refrescar"
            onClick={() => traer(true)}
            disabled={cargando}
            title="Salta la caché de 60 segundos y vuelve a preguntarle a ML"
          >
            <span className={`ads-punto${cargando ? ' ads-punto-vivo' : ''}`} aria-hidden="true" />
            {cargando ? 'actualizando…' : (haceCuanto(datos.refrescoEl) ?? 'actualizar')}
          </button>
          <div className="segmentado">
            {[7, 15, 30, 60].map((d) => (
              <button key={d} className={dias === d ? 'activo' : ''} onClick={() => setDias(d)}>
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? <p className="ads-error-suave">No se pudo actualizar: {error}. Se muestra la última lectura buena.</p> : null}

      <section className="ads-tablero">
        <Cifra etiqueta="facturado" valor={fmtPrecio(Math.round(tot.venta))} ayuda="Venta atribuida a la publicidad en la ventana" />
        <Cifra etiqueta="gastado" valor={fmtPrecio(Math.round(tot.gasto))} ayuda="Lo que ML cobró por los clics" />
        <Cifra etiqueta="ROAS" valor={fmtX(tot.gasto ? tot.venta / tot.gasto : null)} ayuda="Facturado ÷ gastado. Es el promedio, no el margen: las impresiones se compran de la mejor a la peor." />
        <Cifra etiqueta="unidades" valor={fmtMiles(tot.unidades)} ayuda="Unidades vendidas atribuidas a la publicidad" />
        <Cifra etiqueta="ticket medio" valor={ticket ? fmtPrecio(Math.round(ticket)) : '—'} ayuda="Facturado ÷ unidades. Es contra este número que hay que juzgar cuánto pagar por una venta nueva." />
        <Cifra
          etiqueta="resultado"
          valor={`${neto > 0 ? '+' : ''}${fmtPrecio(Math.round(neto))}`}
          tono={neto > 0 ? 'bien' : 'mal'}
          ayuda="Contribución generada menos gasto, antes del costo de la mercadería. Es un techo."
        />
      </section>

      <OpinionAds dato={analisis} corriendo={analizando} err={errAnalisis} onAnalizar={pedirAnalisis} />

      <PlanLearningMachine fotos={new Map(Object.entries(datos.economia ?? {}).map(([id, x]) => [id, x.foto]))} />
      <AprendidoAds fotos={new Map(Object.entries(datos.economia ?? {}).map(([id, x]) => [id, x.foto]))} />
      <Campanas campanas={datos.campanas ?? []} dias={dias} recomendaciones={analisis?.recomendaciones} />
      <Productos economia={datos.economia} campanas={datos.campanas} />
    </main>
  )
}
