import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Boxes, Check, FlaskConical, Layers, Search, Wallet } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'
import { serieGrupoPublicidad } from '../lib/seriePublicidad.js'

const pesos = (v) => Number.isFinite(v) ? fmtPrecio(Math.round(v)) : '—'
const veces = (v) => Number.isFinite(v) ? `${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })}x` : '—'
const fecha = (v) => v ? new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : 'sin fecha'
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function Fotos({ productos }) {
  return <div className="pub-mesa-fotos">{productos.slice(0, 3).map(p => p.foto
    ? <img key={p.itemId} src={p.foto} alt="" loading="lazy" />
    : <span key={p.itemId}><Boxes aria-hidden="true" /></span>)}</div>
}

function MiniEvolucion({ serie, titulo }) {
  const w = 260, h = 52, max = Math.max(1, ...serie.map(d => d.gasto))
  if (!serie.some(d => d.gasto > 0)) return <div className="pub-mesa-sin-serie">Sin gasto publicitario registrado</div>
  return <svg className="pub-mesa-serie" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${titulo}: gasto por día en las últimas ${serie.length} fechas registradas`}>
    {serie.map((d, i) => <rect key={d.dia} x={i * w / serie.length} y={h - d.gasto / max * (h - 4)} width={Math.max(1, w / serie.length - 3)} height={d.gasto / max * (h - 4)} rx="2"><title>{d.dia}: {pesos(d.gasto)} · {d.unidadesAds} ventas atribuidas</title></rect>)}
  </svg>
}


function Seguimiento({ g, serie, onProducto }) {
  const diarios = serieGrupoPublicidad(g, serie?.porProducto)
  const tot = diarios.reduce((a, d) => ({ gasto: a.gasto + d.gasto, ventas: a.ventas + d.unidadesAds, clicks: a.clicks + d.clicks, resultado: a.resultado + d.resultado, completo: a.completo && d.costoCompleto }), { gasto: 0, ventas: 0, clicks: 0, resultado: 0, completo: true })
  const conGasto = diarios.some(d => d.gasto > 0)
  const seleccion = g.miembros.find(p => p.campanaId) ?? g.miembros[0]
  const estado = seleccion.disponibilidad?.disponible ? seleccion.estadoCampana === 'active' ? 'En campaña' : seleccion.campanaId ? 'Campaña pausada' : 'Sin campaña' : seleccion.disponibilidad?.motivo
  return <article className="pub-mesa-producto">
    <header><Fotos productos={g.miembros} /><div><h4>{g.titulo}</h4><span>{g.miembros.length > 1 ? `${g.miembros.length} variantes · ` : ''}{estado}</span></div></header>
    <MiniEvolucion serie={diarios} titulo={g.titulo} />
    <dl className="pub-mesa-cifras"><div><dt>Gasto · 14 días</dt><dd>{conGasto ? pesos(tot.gasto) : '—'}</dd></div><div><dt>Ventas por ads</dt><dd>{conGasto ? tot.ventas : '—'}</dd></div><div><dt>Costo por venta</dt><dd>{tot.ventas ? pesos(tot.gasto / tot.ventas) : '—'}</dd></div></dl>
    <p className="pub-mesa-nota">{!serie ? 'Historial diario por cargar; no se puede evaluar todavía.' : conGasto ? tot.completo ? `Resultado estimado: ${pesos(tot.resultado)} tras costo, comisión, envío y ads.` : 'Falta completar costos para saber cuánto dejó.' : 'El seguimiento comienza cuando haya datos de anuncios.'}</p>
    <p className="pub-mesa-decision">{seleccion.texto}</p>
    <button className="pub-mesa-enlace" onClick={() => onProducto(seleccion.itemId)}>Ver evolución y variantes <ArrowRight size={15} /></button>
  </article>
}

function Propuesta({ p, productos, onProducto, seleccionada, onSeleccionar }) {
  const [detalle, setDetalle] = useState(false)
  const miembros = p.itemIds.map(id => productos.get(id)).filter(Boolean)
  const nombre = p.tipo === 'nicho' ? miembros.map(x => x.familia?.nombre ?? x.titulo).filter((x, i, a) => a.indexOf(x) === i).join(' + ') : p.titulo
  return <article className={`pub-propuesta${seleccionada ? ' seleccionada' : ''}`}>
    <header><Fotos productos={miembros} /><label className="pub-propuesta-elegir"><input type="checkbox" checked={seleccionada} onChange={onSeleccionar} /><span>{seleccionada ? 'En simulación' : 'Simular inicio'}</span></label></header>
    <span className="pub-mesa-etiqueta"><Layers size={13} />{p.tipo === 'variantes' ? 'Variantes juntas' : p.tipo === 'nicho' ? 'Prueba por nicho' : 'Campaña propia'}</span>
    <h4>{nombre}</h4>
    <dl className="pub-mesa-cifras"><div><dt>Comenzar con</dt><dd>{pesos(p.presupuestoDiario)}<small>/día</small></dd></div><div><dt>ROAS objetivo</dt><dd>{veces(p.roasObjetivo)}</dd></div><div><dt>Plan · 14 días</dt><dd>{pesos(p.presupuesto14Dias)}</dd></div></dl>
    <p>{p.motivo}</p>
    <div className="pub-propuesta-pie"><span>{miembros.length} publicaciones · {miembros.every(x => Number.isFinite(x.disponibilidad?.stock)) ? miembros.reduce((a, x) => a + x.disponibilidad.stock, 0) : '—'} u disponibles</span><button aria-expanded={detalle} onClick={() => setDetalle(!detalle)}>{detalle ? 'Ocultar detalle' : 'Ver composición'}</button></div>
    {detalle ? <div className="pub-propuesta-detalle"><p>{p.revision}</p><p>El monto de 14 días es una planificación de gasto; el cobro real depende de la entrega de ML.</p>
      {miembros.map(x => <button key={x.itemId} onClick={() => onProducto(x.itemId)}><span>{x.titulo}</span><small>{pesos(x.economia?.deja)} disponibles por venta antes de ads · {x.economia?.envioBase === 'facturado' ? 'envío medido' : 'envío estimado'}{x.economia?.envioSupuesto ? ' con caja supuesta' : ''}</small><ArrowRight size={14} /></button>)}
      {p.excluidos.length ? <p>{p.excluidos.length} variantes quedan fuera por disponibilidad.</p> : null}
    </div> : null}
  </article>
}

export default function MesaPublicidad({ plan, serie, error, cargando, onReintentar, onProducto, onCampanas }) {
  const [vista, setVista] = useState('arranque')
  const [busqueda, setBusqueda] = useState('')
  const [elegidas, setElegidas] = useState([])
  const c = plan?.cartera
  const productos = useMemo(() => new Map((plan?.productos ?? []).map(p => [p.itemId, p])), [plan])
  const propuestas = c?.propuestas ?? []
  const elegidasVigentes = propuestas.filter(p => elegidas.includes(p.id))
  const presupuesto = elegidasVigentes.reduce((a, p) => a + p.presupuestoDiario, 0)
  if (!c) return <section className="pub-mesa-carga" role="status"><FlaskConical /><h3>{cargando ? 'Calculando el plan de tu catálogo…' : 'El plan de publicidad no está disponible'}</h3><p>{error ?? plan?.motivo ?? 'Se revisan stock, economía y campañas antes de proponer el inicio.'}</p>{!cargando ? <button onClick={onReintentar}>Volver a consultar</button> : null}</section>
  const filtro = normalizar(busqueda)
  const propuestos = propuestas.filter(p => normalizar(p.itemIds.map(id => productos.get(id)?.titulo).join(' ')).includes(filtro))
  const grupos = c.grupos.filter(g => normalizar([g.titulo, ...g.miembros.map(p => `${p.titulo} ${p.itemId}`)].join(' ')).includes(filtro))
  return <div className="pub-mesa">
    {error ? <p className="ads-error-suave">No se pudo renovar el plan: {error}. Última lectura: {fecha(c.calculadoEl)}.</p> : null}
    <div className="pub-mesa-resumen">
      <button onClick={onCampanas}><AlertTriangle /><span>Pendientes de publicidad<strong>{c.alertas.length}</strong><small>stock, estado o costos pendientes</small></span></button>
      <button onClick={() => setVista('arranque')} aria-pressed={vista === 'arranque'}><FlaskConical /><span>Propuestas de inicio<strong>{propuestas.length}</strong><small>{c.resumen.productos} productos evaluados</small></span></button>
      <button onClick={() => setVista('seguimiento')} aria-pressed={vista === 'seguimiento'}><Boxes /><span>Seguir el resultado<strong>{c.grupos.filter(g => g.campañas.length).length}</strong><small>productos con campaña asignada</small></span></button>
    </div>
    {c.alertas.length ? <section className="pub-mesa-alertas"><header><h3><AlertTriangle size={17} />Revisar antes de aumentar</h3><button onClick={onCampanas}>Ver campañas <ArrowRight size={15} /></button></header>{c.alertas.slice(0, 3).map((a, i) => <div key={`${a.tipo}-${i}`}><strong>{a.titulo}</strong><p>{a.texto}</p></div>)}{c.alertas.length > 3 ? <small>Hay {c.alertas.length - 3} avisos más en campañas.</small> : null}</section> : null}
    <div className="pub-mesa-herramientas"><div className="segmentado" role="group" aria-label="Plan de publicidad"><button className={vista === 'arranque' ? 'activo' : ''} onClick={() => setVista('arranque')}>Con cuánto comenzar</button><button className={vista === 'seguimiento' ? 'activo' : ''} onClick={() => setVista('seguimiento')}>Cómo van los productos</button></div><label><Search size={17} /><span className="sr-solo">Buscar en publicidad</span><input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto o variante…" /></label></div>
    {vista === 'arranque' ? <>
      <div className="pub-mesa-intro"><div><h3>Comienza con una prueba medible</h3><p>Presupuesto por campaña compartida. Revisión a los 7 y 14 días, con resultado por producto y variante.</p></div><span>Propuesta · sin aplicar a ML</span></div>
      <div className="pub-mesa-grilla">{propuestos.map(p => <Propuesta key={p.id} p={p} productos={productos} onProducto={onProducto} seleccionada={elegidas.includes(p.id)} onSeleccionar={() => setElegidas(xs => xs.includes(p.id) ? xs.filter(x => x !== p.id) : [...xs, p.id])} />)}</div>
      {!propuestos.length ? <p className="pub-mesa-vacio">{busqueda ? 'No hay propuestas con esa búsqueda.' : 'No hay propuestas de inicio con los datos y stock disponibles. Revisa cada producto en seguimiento.'}</p> : null}
      <section className="pub-mesa-simulacion"><Wallet /><div><strong>{elegidasVigentes.length} {elegidasVigentes.length === 1 ? 'propuesta seleccionada' : 'propuestas seleccionadas'}</strong><span>La selección solo simula el gasto.</span></div><div><strong>{pesos(presupuesto)} / día</strong><span>{pesos(presupuesto * 14)} planificados en 14 días</span></div>{elegidas.length ? <button onClick={() => setElegidas([])}>Limpiar</button> : null}</section>
      <details className="pub-mesa-criterio"><summary><Layers size={16} />Cómo decide agrupar</summary><p>Los colores de una familia oficial comparten la propuesta inicial. Productos distintos solo se proponen juntos si tienen nicho, etapa de arranque, precio y objetivo de rentabilidad comparables. Los productos ya en campaña conservan su seguimiento.</p><p>{c.criterio.mismoNichoProbado ? 'Hay observaciones para comparar campañas por nicho.' : 'Todavía falta muestra para afirmar que agrupar por nicho rinde más: es una hipótesis que se debe medir.'} La prueba muestra el gasto y las ventas por publicación para detectar si una absorbe el presupuesto.</p></details>
    </> : <><div className="pub-mesa-intro"><div><h3>Resultado y siguiente decisión</h3><p>Últimas 14 fechas registradas. El detalle conserva el historial y la medición de cada variante.</p></div><span>{grupos.length} productos</span></div><div className="pub-mesa-grilla">{grupos.map(g => <Seguimiento key={g.id} g={g} serie={serie} onProducto={onProducto} />)}</div>{!grupos.length ? <p className="pub-mesa-vacio">No hay productos con esa búsqueda.</p> : null}</>}
    <small className="pub-mesa-fecha"><Check size={13} /> Plan leído {fecha(c.calculadoEl)} · stock según la última medición de cada publicación</small>
  </div>
}
