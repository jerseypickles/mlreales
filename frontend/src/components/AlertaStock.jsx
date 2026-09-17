import { useEffect, useState } from 'react'
import { ArrowRight, ChevronDown, PackageX } from 'lucide-react'
import { Miniatura } from './ui.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// ALERTA TEMPRANA DE STOCK EN FULL, visible en toda la app. El importador tenía
// tres productos quebrados hace una semana y el forecast lo sabía, pero estaba
// escondido dentro de cada producto. Acá se avisa ANTES, con la fecha límite
// para despachar, y a los que ya quebraron se les pone precio por día.
//
// Vive en TODAS las vistas, así que plegada es una sola línea: píldoras de
// estado y las fotos con un anillo de color. El detalle se abre a pedido.
const NIVELES = { quebrado: 'rojo', enviar_ya: 'ambar', preparar: 'azul' }
const HORIZONTE = 30

const dia = (f) => new Date(f).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '')
const esHoyOAntes = (f) => new Date(f).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0)
const corto = (t) => (t ?? '').split(/\s+/).slice(0, 4).join(' ')

// 30 días hacia adelante: lo relleno es el stock que queda, la marca es el plazo
// del envío a Full. Si el relleno no pasa la marca, lo que despaches llega tarde.
function Pista({ p, plazo }) {
  if (p.nivel === 'quebrado') return <span className="as-pista as-pista-vacia" role="img" aria-label="Sin stock" />
  const pct = Math.max(2, Math.min(100, (p.diasCobertura / HORIZONTE) * 100))
  return (
    <span className="as-pista" role="img" aria-label={`${p.diasCobertura} días de stock; un envío a Full tarda ${plazo}`}>
      <i className={`as-${NIVELES[p.nivel]}`} style={{ width: `${pct}%` }} />
      <b style={{ left: `${(plazo / HORIZONTE) * 100}%` }} title={`Un envío a Full tarda ~${plazo} días`} />
    </span>
  )
}

function Fila({ p, plazo }) {
  const color = NIVELES[p.nivel]
  const quebrado = p.nivel === 'quebrado'
  return (
    <li className="as-fila">
      <span className={`as-foto as-anillo-${color}`}>{p.imagen ? <Miniatura src={p.imagen} lado={40} /> : <PackageX size={16} aria-hidden="true" />}</span>
      <span className="as-nombre"><strong title={p.titulo}>{p.titulo}</strong>
        <small>{quebrado ? (p.sinStockDesde ? `sin stock desde el ${dia(`${p.sinStockDesde}T12:00:00Z`)}` : 'sin stock') : `${fmtNum(p.stock)} u en Full · vende ${String(p.velocidadDia).replace('.', ',')} al día`}{p.enCamino ? ` · ${fmtNum(p.enCamino)} u en camino` : ''}</small></span>
      <Pista p={p} plazo={plazo} />
      <span className="as-estado">
        <strong className={`as-texto-${color}`}>{quebrado ? `${p.diasQuebrado ?? '—'} ${p.diasQuebrado === 1 ? 'día' : 'días'} sin stock` : `Quedan ${p.diasCobertura} ${p.diasCobertura === 1 ? 'día' : 'días'}`}</strong>
        <small>{quebrado ? (p.perdidaDiaClp ? `se van ${fmtPrecio(p.perdidaDiaClp)} al día` : 'ya perdió su ritmo de venta')
          : esHoyOAntes(p.despacharAntesDel) ? 'despacha hoy' : `despacha antes del ${dia(p.despacharAntesDel)}`}</small>
      </span>
      <span className="as-enviar">{p.aEnviar ? <><small>enviar</small><strong>{fmtNum(p.aEnviar)} u</strong></> : null}</span>
    </li>
  )
}

export function AlertaStock({ datos, alAbrir }) {
  const [abierta, setAbierta] = useState(() => { try { return localStorage.getItem('alerta-stock-abierta') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('alerta-stock-abierta', abierta ? '1' : '0') } catch { /* sin almacenamiento */ } }, [abierta])
  const avisos = (datos?.productos ?? []).filter((p) => NIVELES[p.nivel])
  if (!avisos.length) return null
  const r = datos.resumen
  return (
    <section className="as" aria-label="Stock en Full">
      <div className="as-barra">
        <button type="button" className="as-alternar" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
          <span className="as-rotulo">Stock en Full</span>
          {r.quebrados ? <span className="as-pildora as-pildora-rojo"><b>{r.quebrados}</b> sin stock{r.perdidaDiaClp ? <em>{fmtPrecio(r.perdidaDiaClp)}/día</em> : null}</span> : null}
          {r.enviarYa ? <span className="as-pildora as-pildora-ambar"><b>{r.enviarYa}</b> despacha ya</span> : null}
          {r.preparar ? <span className="as-pildora as-pildora-azul"><b>{r.preparar}</b> por preparar</span> : null}
          <span className="as-fotos" aria-hidden="true">{avisos.slice(0, 8).map((p) => (
            <span key={p.id} className={`as-foto as-foto-chica as-anillo-${NIVELES[p.nivel]}`} title={`${corto(p.titulo)}: ${p.nivel === 'quebrado' ? 'sin stock' : `quedan ${p.diasCobertura} días`}`}>
              {p.imagen ? <Miniatura src={p.imagen} lado={26} /> : null}</span>))}</span>
          <ChevronDown className="as-flecha" size={16} aria-hidden="true" />
        </button>
        <button type="button" className="as-ir" onClick={alAbrir}>Mis productos<ArrowRight size={14} aria-hidden="true" /></button>
      </div>
      {abierta ? (
        <>
          <ul className="as-lista">{avisos.map((p) => <Fila key={p.id} p={p} plazo={datos.plazoEnvioFullDias} />)}</ul>
          <p className="as-pie"><span className="as-pie-marca" />plazo de un envío a Full (~{datos.plazoEnvioFullDias} días): si la barra no llega a la marca, lo que despaches llega con la bodega vacía</p>
        </>
      ) : null}
    </section>
  )
}
