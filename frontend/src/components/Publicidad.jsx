import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// PUBLICIDAD, LEÍDA EN PLATA.
//
// El panel de ML compara el gasto contra la VENTA y de ahí saca ACOS y ROAS.
// Ese número no dice si ganas: lo que decide es la CONTRIBUCIÓN (precio −
// comisión − envío Full), que ML no conoce. Por eso su recomendador llegó a
// sugerir bajar el objetivo a 1,8x cuando el equilibrio de cuatro de los seis
// productos está por encima de eso incluso regalando la mercadería.
//
// Este tab responde otra pregunta: cuánta contribución generó cada anuncio y
// cuánto costó. Y como el costo de la mercadería no está cargado, todo lo que
// se muestra es el TECHO — el resultado real es peor, nunca mejor.

const fmtX = (v) => (Number.isFinite(v) ? `${Math.round(v * 100) / 100}x` : '—')
const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—')

const VEREDICTOS = {
  escalar: { clase: 'ad-bien', texto: 'rinde' },
  justo: { clase: 'ad-justo', texto: 'al filo' },
  pierde: { clase: 'ad-mal', texto: 'pierde' },
  'sin-ventas': { clase: 'ad-mal', texto: 'gasta sin vender' },
  'sin-economia': { clase: 'ad-neutro', texto: 'sin precio' },
  'sin-datos': { clase: 'ad-neutro', texto: 'sin datos' },
}

// Un número grande con su etiqueta y, si corresponde, cuánto cambió.
function Cifra({ etiqueta, valor, antes, ayuda, invertido = false, sufijo = '' }) {
  let delta = null
  if (Number.isFinite(antes) && Number.isFinite(valor) && antes !== 0) {
    const pct = Math.round(((valor - antes) / Math.abs(antes)) * 100)
    if (pct !== 0) {
      // en gasto y CPC subir es malo; en unidades y ROAS subir es bueno
      const bueno = invertido ? pct < 0 : pct > 0
      delta = { pct, clase: bueno ? 'delta-sube' : 'delta-baja' }
    }
  }
  return (
    <div className="exp-cifra" title={ayuda}>
      <span className="exp-cifra-etq">{etiqueta}</span>
      <strong>
        {valor ?? '—'}
        {sufijo}
      </strong>
      {delta ? (
        <span className={`exp-delta ${delta.clase}`}>
          {delta.pct > 0 ? '+' : ''}
          {delta.pct}%
        </span>
      ) : Number.isFinite(antes) ? (
        <span className="exp-antes">antes {antes}{sufijo}</span>
      ) : null}
    </div>
  )
}

// EL EXPERIMENTO. Un cambio a la vez, con su antes congelado: el objetivo de
// ROAS es un dial por campaña con varios productos adentro, así que si se mueve
// el dial y a la vez se prenden anuncios, después nadie sabe qué causó qué.
function Experimento({ exp }) {
  if (!exp) return null
  const a = exp.baseline ?? {}
  const b = exp.ahora ?? {}
  const listo = exp.diasCorridos >= a.dias
  // ML paga por clic, así que el gasto responde en horas; las ventas tardan.
  // Antes de un par de días el "después" es ruido y hay que decirlo.
  const temprano = exp.diasCorridos < 2

  return (
    <section className={`experimento${temprano ? ' experimento-temprano' : ''}`}>
      <header>
        <div>
          <span className="exp-chip">experimento en curso</span>
          <h3>
            ROAS objetivo {exp.valorAntes}x → <strong>{exp.valorDespues}x</strong>
          </h3>
        </div>
        <span className="exp-dias">
          día {exp.diasCorridos} de {a.dias ?? 7}
          {listo ? ' · listo para leer' : temprano ? ' · aún es ruido' : ''}
        </span>
      </header>

      <p className="exp-hipotesis">{exp.hipotesis}</p>

      {b.costo ? (
        <div className="exp-cifras">
          <Cifra etiqueta="ROAS real" valor={b.roasReal} antes={a.roasReal} sufijo="x"
            ayuda="Venta atribuida ÷ gasto. Es el resultado, no el objetivo que le pediste a ML." />
          <Cifra etiqueta="gasto/día" valor={Math.round(b.costo / Math.max(1, b.dias))}
            antes={Math.round(a.costo / Math.max(1, a.dias))} invertido
            ayuda="Si el dial gobierna la selectividad, bajarlo tiene que subir esto." />
          <Cifra etiqueta="unidades" valor={b.unidades} antes={a.unidades}
            ayuda="Unidades atribuidas a la publicidad en la ventana" />
          <Cifra etiqueta="CPC" valor={Math.round(b.cpc)} antes={Math.round(a.cpc)} invertido
            ayuda="Costo por clic promedio. ML cobra a segundo precio: pagas lo mínimo para ganarle al siguiente." />
          <Cifra etiqueta="clics" valor={b.clicks} antes={a.clicks}
            ayuda="Más clics con el mismo presupuesto = entraste a más subastas" />
          <Cifra etiqueta="ACOS" valor={Math.round(b.acos)} antes={Math.round(a.acos)} invertido sufijo="%"
            ayuda="Gasto ÷ venta. Ojo: compara contra la venta, no contra tu margen." />
        </div>
      ) : (
        <p className="exp-esperando">
          Todavía sin datos en la ventana nueva. El gasto responde en horas; las ventas tardan unos días.
        </p>
      )}
    </section>
  )
}

// Cada anuncio contra SU propio equilibrio, no contra un ACOS parejo. El
// equilibrio sale del precio real, la comisión exacta de su categoría y la
// tarifa Full escalonada — todo sondeado en vivo, nada estimado.
function TablaAnuncios({ economia }) {
  const filas = Object.entries(economia ?? {})
    .map(([id, e]) => ({ id, ...e }))
    .filter((f) => f.gasto > 0 || f.unidades > 0)
    .sort((a, b) => (b.resultado ?? -1e9) - (a.resultado ?? -1e9))
  if (!filas.length) return null

  const total = filas.reduce(
    (acc, f) => ({
      gasto: acc.gasto + (f.gasto ?? 0),
      contribucion: acc.contribucion + (f.contribucionGenerada ?? 0),
      unidades: acc.unidades + (f.unidades ?? 0),
    }),
    { gasto: 0, contribucion: 0, unidades: 0 },
  )
  const neto = total.contribucion - total.gasto

  return (
    <section className="ads-anuncios">
      <h3>Anuncio por anuncio, en plata</h3>
      <p className="ads-nota">
        El <strong>equilibrio</strong> es el ROAS bajo el cual ese anuncio destruye margen. Sale del precio real
        menos comisión exacta y envío Full — pero <strong>antes del costo de la mercadería</strong>, que no está
        cargado. Es el techo: el resultado real es peor, nunca mejor.
      </p>
      <div className="tabla-envoltura">
        <table className="tabla-ads">
          <thead>
            <tr>
              <th>Anuncio</th>
              <th className="num">precio</th>
              <th className="num">gasto</th>
              <th className="num">unid</th>
              <th className="num">ROAS real</th>
              <th className="num">equilibrio</th>
              <th className="num">contribución</th>
              <th className="num">resultado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const v = VEREDICTOS[f.veredicto?.estado] ?? VEREDICTOS['sin-datos']
              return (
                <tr key={f.id} className={f.resultado < 0 ? 'fila-mal' : undefined}>
                  <td>
                    <span className="ads-titulo">{f.titulo ?? f.id}</span>
                    {f.estado === 'hold' ? <span className="ads-hold" title="ML lo tiene en pausa">hold</span> : null}
                  </td>
                  <td className="num">{f.precio ? fmtPrecio(f.precio) : '—'}</td>
                  <td className="num">{fmtPrecio(f.gasto)}</td>
                  <td className="num">{f.unidades || '—'}</td>
                  <td className="num">{fmtX(f.roasReal)}</td>
                  <td className="num" title={f.contribucion ? `Contribución ${fmtPrecio(f.contribucion)}/u (${fmtPct(f.contribucionPct)} del precio)` : ''}>
                    {fmtX(f.roas)}
                  </td>
                  <td className="num">{f.contribucionGenerada != null ? fmtPrecio(f.contribucionGenerada) : '—'}</td>
                  <td className={`num ${f.resultado > 0 ? 'res-bien' : f.resultado < 0 ? 'res-mal' : ''}`}>
                    {f.resultado != null ? `${f.resultado > 0 ? '+' : ''}${fmtPrecio(f.resultado)}` : '—'}
                  </td>
                  <td>
                    <span className={`ad-veredicto ${v.clase}`} title={f.veredicto?.texto}>{v.texto}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>TOTAL</td>
              <td className="num">{fmtPrecio(total.gasto)}</td>
              <td className="num">{total.unidades}</td>
              <td colSpan={2}></td>
              <td className="num">{fmtPrecio(Math.round(total.contribucion))}</td>
              <td className={`num ${neto > 0 ? 'res-bien' : 'res-mal'}`}>
                {neto > 0 ? '+' : ''}
                {fmtPrecio(Math.round(neto))}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="ads-nota">
        El <strong>resultado</strong> es contribución generada menos gasto. Es lo más cerca de la ganancia que se
        puede calcular sin conocer el costo de la mercadería — y sigue siendo un techo.
      </p>
    </section>
  )
}

function Campanas({ campanas }) {
  return (
    <section className="ads-campanas">
      {campanas.map((c) => {
        const m = c.metricas ?? {}
        const roas = m.cost > 0 ? m.total_amount / m.cost : null
        const gastoDia = m.cost ? Math.round(m.cost / 30) : 0
        const usoPct = c.presupuestoDiario ? Math.min(100, Math.round((gastoDia / c.presupuestoDiario) * 100)) : null
        return (
          <div className={`ads-campana${c.estado !== 'active' ? ' ads-campana-pausada' : ''}`} key={c.id}>
            <header>
              <strong>{c.nombre}</strong>
              <span className={`ads-estado ads-${c.estado}`}>{c.estado}</span>
            </header>
            <div className="ads-dials">
              <span title="El dial que gobierna cuán agresivo puja ML. No es una promesa de resultado.">
                objetivo <strong>{fmtX(c.roasObjetivo ?? (c.acosObjetivo ? 100 / c.acosObjetivo : null))}</strong>
              </span>
              <span title="Lo que efectivamente devolvió cada peso invertido">
                real <strong className={roas && c.roasObjetivo && roas < c.roasObjetivo ? 'res-mal' : ''}>{fmtX(roas)}</strong>
              </span>
              <span title="Presupuesto diario autorizado. Si no se gasta, el limitante no es la plata sino el objetivo.">
                presupuesto <strong>{fmtPrecio(c.presupuestoDiario)}</strong>
              </span>
            </div>
            {usoPct != null ? (
              <div className="ads-uso" title={`Usa ${usoPct}% del presupuesto autorizado`}>
                <span style={{ width: `${usoPct}%` }} />
                <em>{usoPct}% del presupuesto usado</em>
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

export function Publicidad() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [dias, setDias] = useState(30)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    api
      .ads(dias)
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [dias])

  if (error) return <main><p className="error-inline">{error}</p></main>
  if (!datos) return <Cargando texto="Leyendo campañas de Product Ads…" />

  return (
    <main>
      <div className="reporte-encabezado">
        <div>
          <h2>Publicidad · Product Ads</h2>
          <p className="reporte-fecha">
            ML mide el gasto contra la venta; acá se mide contra la contribución, que es lo que decide si ganas.
            La escritura por API está cerrada, así que los cambios se aplican en el panel de ML.
          </p>
        </div>
        <div className="segmentado">
          {[7, 15, 30, 60].map((d) => (
            <button key={d} className={dias === d ? 'activo' : ''} onClick={() => setDias(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <Experimento exp={datos.experimento} />
      <Campanas campanas={datos.campanas ?? []} />
      <TablaAnuncios economia={datos.economia} />
    </main>
  )
}
