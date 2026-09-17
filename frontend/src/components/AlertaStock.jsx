import { useEffect, useState } from 'react'
import { ChevronDown, PackageX, Truck } from 'lucide-react'
import { Miniatura } from './ui.jsx'
import { fmtFechaCorta, fmtNum, fmtPrecio } from '../lib/formato.js'

// ALERTA TEMPRANA DE STOCK EN FULL, visible en toda la app. El importador tenía
// tres productos quebrados hace una semana y el forecast lo sabía, pero estaba
// escondido dentro de cada producto. Acá se avisa ANTES, con la fecha límite
// para despachar, y a los que ya quebraron se les pone precio por día.
const NIVELES = {
  quebrado: { clase: 'as-rojo', titulo: 'Sin stock' },
  enviar_ya: { clase: 'as-ambar', titulo: 'Despacha ya' },
  preparar: { clase: 'as-azul', titulo: 'Prepara el envío' },
}

// cuánto aguanta, dibujado contra 30 días; la marca es el plazo del envío a Full
function Cobertura({ dias, plazo }) {
  const pct = Math.max(3, Math.min(100, (dias / 30) * 100))
  return <span className="as-cobertura" role="img" aria-label={`${dias} días de stock; un envío a Full tarda ${plazo}`}><i style={{ width: `${pct}%` }} /><b style={{ left: `${(plazo / 30) * 100}%` }} /></span>
}

function Tarjeta({ p, plazo }) {
  const n = NIVELES[p.nivel]
  return (
    <li className={`as-tarjeta ${n.clase}`}>
      {p.imagen ? <Miniatura src={p.imagen} lado={44} /> : <span className="mv-sinfoto" aria-hidden="true" />}
      <div className="as-cuerpo">
        <strong title={p.titulo}>{p.titulo}</strong>
        {p.nivel === 'quebrado' ? (
          <>
            <span className="as-dato"><b>{p.diasQuebrado ? `${p.diasQuebrado} ${p.diasQuebrado === 1 ? 'día' : 'días'} sin stock` : 'sin stock'}</b>{p.sinStockDesde ? ` · desde el ${fmtFechaCorta(`${p.sinStockDesde}T12:00:00Z`)}` : ''}</span>
            <span className="as-sub">{p.perdidaDiaClp ? <>se van <b>{fmtPrecio(p.perdidaDiaClp)}</b> al día{p.perdidaAcumuladaClp ? ` · ${fmtPrecio(p.perdidaAcumuladaClp)} ya` : ''}</> : 'tanto tiempo quebrado que ya no tiene ritmo de venta'}
              {p.enCamino ? ` · ${fmtNum(p.enCamino)} u en camino` : p.aEnviar ? ` · enviar ${fmtNum(p.aEnviar)} u` : ''}</span>
          </>
        ) : (
          <>
            <Cobertura dias={p.diasCobertura} plazo={plazo} />
            <span className="as-dato"><b>{p.diasCobertura} días</b> de stock ({fmtNum(p.stock)} u a {String(p.velocidadDia).replace('.', ',')}/día) · se quiebra el {fmtFechaCorta(p.fechaQuiebre)}</span>
            <span className="as-sub"><Truck size={12} aria-hidden="true" />despacha antes del <b>{fmtFechaCorta(p.despacharAntesDel)}</b>{p.aEnviar ? ` · ${fmtNum(p.aEnviar)} u` : ''}</span>
          </>
        )}
      </div>
    </li>
  )
}

export function AlertaStock({ datos, alAbrir }) {
  const [abierta, setAbierta] = useState(() => { try { return localStorage.getItem('alerta-stock-abierta') !== '0' } catch { return true } })
  useEffect(() => { try { localStorage.setItem('alerta-stock-abierta', abierta ? '1' : '0') } catch { /* sin almacenamiento */ } }, [abierta])
  const avisos = (datos?.productos ?? []).filter((p) => NIVELES[p.nivel])
  if (!avisos.length) return null
  const r = datos.resumen
  const peor = r.quebrados ? 'as-rojo' : r.enviarYa ? 'as-ambar' : 'as-azul'
  return (
    <section className={`as ${peor}`} aria-label="Alerta de stock en Full">
      <div className="as-cab">
        <span className="as-icono"><PackageX size={18} aria-hidden="true" /></span>
        <p className="as-titular">
          {r.quebrados ? <><b>{r.quebrados} {r.quebrados === 1 ? 'producto sin stock' : 'productos sin stock'} en Full</b>{r.perdidaDiaClp ? <> · se van <b>{fmtPrecio(r.perdidaDiaClp)} al día</b></> : null}</> : null}
          {r.quebrados && (r.enviarYa || r.preparar) ? ' · ' : ''}
          {r.enviarYa ? <><b>{r.enviarYa}</b> por quebrarse: hay que despachar ya</> : null}
          {r.enviarYa && r.preparar ? ' · ' : ''}
          {r.preparar ? <>{r.preparar} para preparar envío</> : null}
        </p>
        <button type="button" className="as-ir" onClick={alAbrir}>Ver en Mis productos</button>
        <button type="button" className="as-plegar" aria-expanded={abierta} aria-label={abierta ? 'Plegar el detalle' : 'Ver el detalle'} onClick={() => setAbierta((a) => !a)}><ChevronDown size={16} aria-hidden="true" /></button>
      </div>
      {abierta ? <ul className="as-lista">{avisos.map((p) => <Tarjeta key={p.id} p={p} plazo={datos.plazoEnvioFullDias} />)}</ul> : null}
    </section>
  )
}
