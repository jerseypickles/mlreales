import { useEffect, useState } from 'react'
import { BarraPartes, Nota } from './sistema.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// A DÓNDE VA CADA VENTA (18-nov-2026; antes «Por cada venta», una lista de restas). Es la pregunta que el importador
// hace de verdad: «¿en cuánto me tiene que llegar para que esto valga la pena?». Ahora es una barra: del precio que
// paga el cliente, cuánto se lleva la comisión, cuánto el envío, cuánto el producto y cuánto queda. Sin el costo
// cargado se muestra igual lo que queda para pagarlo: sirve para decidir la compra.
// Debajo, lo que Mercado Libre cobró de verdad en 30 días, por bolsillo (antes estaba escondido en un texto flotante).
// `aplicaA`: en un producto con colores, el precio y el costo que se escriben acá van a todas sus publicaciones.

// lo que queda por venta, en una línea (también es el resumen de la sección cuando está cerrada)
export function resumenPlata(e) {
  if (!e) return null
  if (e.gananciaClp == null) return { tono: 'aviso', texto: `falta el costo: quedan ${fmtPrecio(e.quedaParaProductoClp)} por venta para pagar el producto` }
  return e.gananciaClp < 0
    ? { tono: 'aviso', texto: `pierdes ${fmtPrecio(-e.gananciaClp)} en cada venta a ${fmtPrecio(e.precioClp)}` }
    : { tono: 'neutro', texto: `te quedan ${fmtPrecio(e.gananciaClp)} de cada venta a ${fmtPrecio(e.precioClp)}` }
}

const envioDe = (e) => {
  if (!(e.esFull || e.envioClp != null || e.faltaEnvio)) return null
  const facturado = e.envioBase === 'facturado'
  return {
    titulo: `envío${e.esFull ? ' de Full' : ''}${facturado ? ', promedio de lo que te facturaron' : e.envioSupuesto ? ', estimado con una caja tipo' : ', estimado del tarifario'}`,
    ayuda: facturado
      ? `Promedio por unidad de lo que Mercado Libre facturó de envío en 60 días.${e.envioBaseClp != null ? ` La mayoría de las órdenes paga ${fmtPrecio(e.envioBaseClp)}; ${e.envioPctOrdenesSobreBase ?? 0}% paga más del doble.` : ''}${e.envioTarifarioClp != null ? ` El tarifario estimaba ${fmtPrecio(e.envioTarifarioClp)}.` : ''}`
      : 'Todavía no hay envíos facturados de este producto: es lo que dice el tarifario de Mercado Libre.',
  }
}

export function PlataVenta({ p, m, aplicaA = null, onGuardarCosto, onCambiarPrecio }) {
  const e = p.economiaUnidad
  const [costo, setCosto] = useState(p.costoUnitarioClp ?? '')
  const [guardando, setGuardando] = useState(false)
  const [editandoPrecio, setEditandoPrecio] = useState(false)
  const [precio, setPrecio] = useState('')
  const [aplicando, setAplicando] = useState(false)
  useEffect(() => { setCosto(p.costoUnitarioClp ?? '') }, [p.costoUnitarioClp])
  if (!e) return <Nota>Todavía no hay precio medido para calcular lo que deja cada venta.</Nota>

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true)
    try { await onGuardarCosto(p, costo === '' ? null : Number(costo)) } finally { setGuardando(false) }
  }
  async function aplicarPrecio(ev) {
    ev.preventDefault()
    setAplicando(true)
    try { await onCambiarPrecio(p, Number(precio)); setEditandoPrecio(false) } finally { setAplicando(false) }
  }

  const g = e.gananciaClp
  const envio = envioDe(e)
  const partes = [
    { id: 'comision', titulo: `comisión de Mercado Libre${e.comisionPct ? ` (${String(e.comisionPct).replace('.', ',')}%)` : ''}`, valor: e.comisionClp ?? 0, tono: 'atencion' },
    ...(envio ? [{ id: 'envio', titulo: envio.titulo, valor: e.envioClp ?? 0, tono: 'destacada', ayuda: envio.ayuda }] : []),
    ...(g != null ? [{ id: 'costo', titulo: 'costo del producto puesto en bodega', valor: e.costoClp ?? 0, tono: 'neutra' }] : []),
    ...(g == null ? [{ id: 'queda', titulo: 'queda para pagar el producto y ganar', valor: Math.max(0, e.quedaParaProductoClp ?? 0), tono: 'bien' }]
      : g > 0 ? [{ id: 'queda', titulo: `te queda${e.gananciaPct != null ? ` (${String(e.gananciaPct).replace('.', ',')}% del precio)` : ''}`, valor: g, tono: 'bien' }] : []),
  ]
  const c = m?.cargosMl30d
  const cobros = c ? [
    ['comision', 'comisión', c.comisionClp, 'atencion'], ['envio', 'envío', c.envioClp, 'destacada'], ['ads', 'publicidad', c.adsClp, 'problema'],
    ['colecta', 'colecta', c.colectaClp, 'neutra'], ['almacenaje', 'almacenaje en Full', c.almacenajeClp, 'neutra'], ['otros', 'otros cobros', c.otrosClp, 'neutra'],
  ].filter(([, , v]) => v > 0).map(([id, titulo, valor, tono]) => ({ id, titulo, valor, tono })) : []
  const ingresos = m?.ventas30d?.ingresosClp

  return (
    <div className="s-plata" onClick={(ev) => ev.stopPropagation()}>
      <BarraPartes titulo={`A dónde va cada venta de ${fmtPrecio(e.precioClp)}`} fuente={aplicaA ? `precio y costo valen para ${aplicaA}` : null} partes={partes} formato={fmtPrecio}>
        {g == null
          ? `Falta el costo. Sobre ${fmtPrecio(e.quedaParaProductoClp)} puesto en bodega, cada venta pierde plata.`
          : g < 0 ? `Pierdes ${fmtPrecio(-g)} en cada venta, antes de publicidad.`
            : `Te quedan ${fmtPrecio(g)} por venta, antes de publicidad.`}
        {envio ? '' : ' El envío no está incluido: no va por Mercado Envíos.'}
      </BarraPartes>

      <div className="s-plata-campos">
        <form onSubmit={guardar}>
          <label htmlFor={`costo-${p._id}`}>Costo puesto en bodega</label>
          <input id={`costo-${p._id}`} type="number" min="0" step="1" placeholder="producto + flete + internación" value={costo} onChange={(ev) => setCosto(ev.target.value)} />
          <button type="submit" className="boton-secundario boton-chico" disabled={guardando}>{guardando ? 'guardando…' : 'guardar'}</button>
        </form>
        {editandoPrecio ? (
          <form onSubmit={aplicarPrecio}>
            <label htmlFor={`precio-${p._id}`}>Precio nuevo</label>
            <input id={`precio-${p._id}`} type="number" min="1" step="1" autoFocus value={precio} onChange={(ev) => setPrecio(ev.target.value)} placeholder={String(e.precioClp)} />
            <button type="submit" className="boton-secundario boton-chico" disabled={aplicando || !precio}>{aplicando ? 'aplicando…' : 'aplicar en Mercado Libre'}</button>
            <button type="button" className="boton-plano boton-chico" onClick={() => setEditandoPrecio(false)}>cancelar</button>
          </form>
        ) : (
          <div>
            <span>Precio en Mercado Libre</span>
            <b>{fmtPrecio(e.precioClp)}</b>
            <button type="button" className="boton-secundario boton-chico" onClick={() => { setPrecio(String(e.precioClp)); setEditandoPrecio(true) }}>cambiar</button>
          </div>
        )}
      </div>
      {p.costoOrigen === 'cotizacion' ? <Nota>El costo está copiado de la cotización del nicho: confírmalo o corrígelo con el real puesto en bodega.</Nota> : null}

      {cobros.length ? (
        <BarraPartes titulo={`Lo que te cobró Mercado Libre en 30 días: ${fmtPrecio(c.totalClp)}`} fuente={c.lineas ? `${fmtNum(c.lineas)} ${c.lineas === 1 ? 'cobro facturado' : 'cobros facturados'}` : null} partes={cobros} formato={fmtPrecio}>
          {ingresos > 0 ? `Es el ${Math.round((c.totalClp / ingresos) * 100)}% de los ${fmtPrecio(ingresos)} que vendiste en esos días.` : 'Sale del detalle de facturación de Mercado Libre, que se lee una vez al día.'}
        </BarraPartes>
      ) : null}
    </div>
  )
}
