import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
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
function Campanas({ campanas, dias }) {
  const vivas = campanas.filter((c) => c.estado === 'active')
  const pausadas = campanas.filter((c) => c.estado !== 'active')
  const tarjeta = (c) => {
    const m = c.metricas ?? {}
    const objetivo = c.roasObjetivo ?? (c.acosObjetivo ? 100 / c.acosObjetivo : null)
    const real = m.cost > 0 ? m.total_amount / m.cost : null
    const gastoDia = m.cost ? m.cost / dias : 0
    const usoPct = c.presupuestoDiario ? Math.round((gastoDia / c.presupuestoDiario) * 100) : null
    const cumple = real != null && objetivo != null ? real >= objetivo : null
    return (
      <article className={`ads-camp${c.estado !== 'active' ? ' ads-camp-off' : ''}`} key={c.id}>
        <header>
          <strong>{c.nombre}</strong>
          {c.estado !== 'active' ? <span className="ads-estado">pausada</span> : null}
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
          <span>
            {fmtPrecio(Math.round(gastoDia))}/día de {fmtPrecio(c.presupuestoDiario)}
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
            anuncio destruye margen. Sale del precio real, la comisión exacta de su categoría y la tarifa Full
            escalonada, todo consultado en vivo.
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

export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)
  const [cargando, setCargando] = useState(false)
  // el reloj del "hace X": su único trabajo es forzar el repintado, no se lee
  const [, setTic] = useState(0)

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

      <Campanas campanas={datos.campanas ?? []} dias={dias} />
      <Productos economia={datos.economia} campanas={datos.campanas} />
    </main>
  )
}
