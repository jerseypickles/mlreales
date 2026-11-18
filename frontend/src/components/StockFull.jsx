import { useState } from 'react'
import { ExternalLink, Truck, X } from 'lucide-react'
import { Etiqueta, Subtitulo, Nota, Filas, Fila, Dato, Nivel } from './sistema.jsx'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// EL STOCK DE CADA COLOR, EN COLUMNAS (18-nov-2026). Pedido del importador mirando la tarjeta abierta: «cuando un
// producto tiene variante es complicado ver, como también cuando no tiene». Cada color llevaba dos renglones de
// texto corrido (los días para quebrarse, lo que hay en bodega, la venta por día con su fórmula entre paréntesis,
// los días sin stock descontados) y no había cómo comparar uno con otro. Ahora es una fila por color con las mismas columnas: cuánto vendió, cuánto hay
// en Full y para cuántos días alcanza (con su barra), qué va en camino y qué hacer. Un producto sin colores usa la
// misma tabla con una sola fila.
//
// Y EL ENVÍO A FULL SE ANOTA EN UN PASO. Ese mismo día preguntó si el envío se podía detectar solo. Medido contra la
// cuenta: Mercado Libre no entrega los envíos que van en camino; solo se ve cuando la bodega recibe. Por eso «anotar
// un envío» abre un casillero por color, ya con lo sugerido, y se guarda todo de una vez (antes era un botón «ya lo
// envié» por color). Lo que Full recibe lo descuenta el servidor solo y acá se dice («llegaron tantas tal día»).

const OBJETIVO_DIAS = 45 // los días de stock que se quieren tener en Full (inventarioFull.coberturaYReposicion)
const dias = (n) => `${fmtNum(n)} ${n === 1 ? 'día' : 'días'}`
const decimal = (n) => String(n).replace('.', ',')
// lo que alcanza SOLO lo que ya está en la bodega (lo que va en camino todavía no se puede vender)
const diasConStock = (r) => r.diasConStock ?? (!(r.enCamino > 0) ? r.diasCobertura : r.velocidadDia > 0 ? Math.round(r.stock / r.velocidadDia) : null)
const tonoDias = (d) => (d == null ? 'neutra' : d <= 14 ? 'problema' : d <= OBJETIVO_DIAS ? 'atencion' : 'bien')
const hace = (dia) => Math.round((Date.now() - +new Date(`${dia}T12:00:00Z`)) / 86400e3)
// por qué Mercado Libre tiene unidades retenidas en la bodega, en palabras (los nombres vienen de su API)
const MOTIVO = { lost: 'perdidas', damaged: 'dañadas', internalProcess: 'en un proceso interno', internal_process: 'en un proceso interno', transfer: 'en traslado entre bodegas', withdrawal: 'en retiro',
  not_supported: 'no admitidas', noFiscalCoverage: 'sin respaldo tributario', no_fiscal_coverage: 'sin respaldo tributario' }

// Qué hacer con el stock de una publicación, en palabras; el tono solo lo repite. `decidir` es lo que el dueño puede
// decir ahí mismo sobre reponerla ({ texto, decision }): «sin stock» no es una sola cosa (inventarioFull.alertaDeStock).
export function queHacer(r) {
  if (!r) return null
  // se acabó y no viene más: no pide nada. Si fue por el tiempo sin stock, el dueño puede decir que sí lo repone
  if (r.urgencia === 'agotado') return {
    tono: 'neutra', texto: 'agotado',
    detalle: r.decision === 'no' ? 'dijiste que no se repone: ya no avisa' : `${r.diasSinStock ? `${dias(r.diasSinStock)} sin stock y ` : ''}nada en camino: dejó de avisar`,
    decidir: { texto: 'sí lo voy a reponer', decision: 'si' },
  }
  if (r.urgencia === 'liquidando') return { tono: 'neutra', texto: 'se liquida', detalle: 'dijiste que no se repone: no avisa cuando se acabe', decidir: { texto: 'volver a avisar', decision: null } }
  if (r.urgencia === 'sin_ventas') return { tono: 'neutra', texto: 'sin ventas', detalle: 'no hay ventas para calcular cuánto mandar' }
  const noSeRepone = { texto: 'no se repone', decision: 'no' }
  // sin stock, pero con un envío anotado: se espera
  if (!(r.stock > 0) && r.enCamino > 0) return { tono: 'atencion', texto: 'esperando el envío', detalle: `sin stock hasta que Full reciba ${r.enCamino === 1 ? 'la que va' : `las ${fmtNum(r.enCamino)} que van`} en camino` }
  const conCamino = r.enCamino > 0 ? ' con lo que va en camino' : ''
  if (r.aEnviar > 0) {
    const grave = r.urgencia === 'quebrado' || r.urgencia === 'critico'
    return {
      tono: grave ? 'problema' : 'atencion', texto: `manda ${fmtNum(r.aEnviar)}${r.enCamino > 0 ? ' más' : ''}`,
      detalle: r.urgencia === 'quebrado' ? `está sin stock${r.diasSinStock ? ` hace ${dias(r.diasSinStock)}` : ''}` : `alcanza para ${dias(r.diasCobertura)}${conCamino}; la idea es tener ${OBJETIVO_DIAS}`,
      decidir: noSeRepone,
    }
  }
  return { tono: 'bien', texto: 'bien por ahora', detalle: r.diasCobertura != null ? `alcanza para ${dias(r.diasCobertura)}${conCamino}` : null }
}

// El stock del producto entero en una línea, para la cifra de arriba de la tarjeta. `filas`: las mismas de <StockFull>.
export function resumenStock(filas) {
  const conRepo = filas.filter((f) => f.p.reposicion)
  const valor = fmtNum(filas.reduce((s, f) => s + (f.p.reposicion?.stock ?? f.m.stock ?? 0), 0))
  if (!conRepo.length) return { valor, detalle: 'en tu bodega' }
  const enCamino = conRepo.reduce((s, f) => s + (f.p.reposicion.enCamino ?? 0), 0)
  const camino = enCamino > 0 ? ` · ${fmtNum(enCamino)} en camino` : ''
  const agotados = conRepo.filter((f) => f.p.reposicion.urgencia === 'agotado')
  if (agotados.length === filas.length) return { valor, detalle: 'agotado, sin reposición' }
  const sinStock = conRepo.filter((f) => !(f.p.reposicion.stock > 0) && f.p.reposicion.urgencia !== 'agotado')
  const conDias = conRepo.map((f) => ({ f, d: diasConStock(f.p.reposicion) })).filter((x) => x.d != null).sort((x, y) => x.d - y.d)
  if (sinStock.length) {
    const cuantos = filas.length === 1 ? 'sin stock' : sinStock.length === filas.length ? `los ${fmtNum(filas.length)} sin stock` : `${fmtNum(sinStock.length)} de ${fmtNum(filas.length)} sin stock`
    return { valor, tono: 'problema', detalle: `${cuantos}${camino}` }
  }
  if (!conDias.length) return { valor, detalle: `sin ventas para calcular cuánto dura${camino}` }
  const { f, d } = conDias[0]
  return { valor, tono: tonoDias(d) === 'problema' ? 'problema' : undefined, detalle: `${filas.length > 1 ? `${f.nombre} alcanza` : 'alcanza'} para ${dias(d)}${camino}` }
}

function EnFull({ r }) {
  const d = diasConStock(r)
  const sinStock = !(r.stock > 0)
  return (
    <Dato valor={fmtNum(r.stock)} tono={sinStock ? 'problema' : undefined}
      detalle={<>
        {sinStock ? 'sin stock en Full' : d != null ? `alcanza para ${dias(d)}` : 'sin ventas para calcular cuánto dura'}
        {r.velocidadDia > 0 ? <><br />vende {decimal(r.velocidadDia)} al día{r.diasSinStock30 >= 1 ? `, sin contar ${dias(Math.round(r.diasSinStock30))} sin stock` : ''}</> : null}
        {r.retenido > 0 ? <><br />{fmtNum(r.retenido)} {r.retenido === 1 ? 'retenida' : 'retenidas'} por Mercado Libre{r.motivosRetenido?.length ? ` (${r.motivosRetenido.map((x) => MOTIVO[x.motivo] ?? x.motivo).join(', ')})` : ''}</> : null}
        {r.descuadreItem ? <><br />la publicación declara {fmtNum(Math.abs(r.descuadreItem))} {r.descuadreItem > 0 ? 'más' : 'menos'} que la bodega</> : null}
      </>}>
      {d != null && !sinStock ? <Nivel fraccion={d / OBJETIVO_DIAS} extra={r.enCamino > 0 && r.velocidadDia > 0 ? r.enCamino / r.velocidadDia / OBJETIVO_DIAS : 0} tono={tonoDias(d)}
        title={`La barra llena son ${OBJETIVO_DIAS} días de stock${r.enCamino > 0 ? '; lo rayado es lo que va en camino' : ''}`} /> : null}
    </Dato>
  )
}

// filas: [{ p, nombre, m }] — una por publicación (los colores de la familia, o el producto solo con `nombre` null).
// onGuardarEnvio([{ p, unidades }]) guarda lo que va en camino de cada una (unidades null lo borra).
export function StockFull({ filas, mostrarPrecio = false, onAbrir, onGuardarEnvio, onDecidir }) {
  const [anotando, setAnotando] = useState(false)
  const [cantidades, setCantidades] = useState({})
  const [guardando, setGuardando] = useState(false)
  const conColores = filas.length > 1 || filas[0]?.nombre != null
  const conFull = filas.some((f) => f.p.reposicion)

  const partir = () => {
    // cada casillero parte con lo sugerido; lo que no se mandó se deja en blanco
    setCantidades(Object.fromEntries(filas.filter((f) => f.p.reposicion?.aEnviar > 0).map((f) => [f.p._id, String(f.p.reposicion.aEnviar)])))
    setAnotando(true)
  }
  const envios = filas.map((f) => ({ p: f.p, mando: Number(cantidades[f.p._id]) })).filter((x) => Number.isInteger(x.mando) && x.mando > 0)
  async function guardar() {
    setGuardando(true)
    try {
      // lo de este envío se suma a lo que ya iba en camino
      await onGuardarEnvio(envios.map(({ p, mando }) => ({ p, unidades: (p.reposicion?.enCamino ?? 0) + mando })))
      setAnotando(false)
    } finally {
      setGuardando(false)
    }
  }
  async function quitar(p) {
    setGuardando(true)
    try { await onGuardarEnvio([{ p, unidades: null }]) } finally { setGuardando(false) }
  }
  async function decidir(p, decision) {
    setGuardando(true)
    try { await onDecidir(p, decision) } finally { setGuardando(false) }
  }

  const columnas = [
    ...(conColores ? [{ id: 'quien', titulo: filas.every((f) => f.p.familiaMl?.porColor) ? 'Color' : 'Variante', ancho: 'minmax(140px, 1.1fr)', ancha: true }] : []),
    { id: 'vendio', titulo: 'Vendió en 7 días' },
    { id: 'full', titulo: conFull ? 'En Full' : 'Stock', ancho: 'minmax(0, 1.3fr)' },
    ...(conFull ? [{ id: 'camino', titulo: anotando ? 'Mandaste ahora' : 'En camino' }, { id: 'hacer', titulo: 'Qué hacer', ancho: 'minmax(0, 1.2fr)' }] : []),
  ]
  const porReponer = filas.filter((f) => f.p.reposicion?.aEnviar > 0).length

  return (
    <div onClick={(ev) => ev.stopPropagation()}>
      <Subtitulo titulo={conFull ? (conColores ? 'Stock en Full, por color' : 'Stock en Full') : 'Stock'}>
        {conFull && porReponer && !anotando ? <Etiqueta tono="atencion">{conColores ? `${fmtNum(porReponer)} de ${fmtNum(filas.length)} por reponer` : 'por reponer'}</Etiqueta> : null}
        {conFull && onGuardarEnvio ? (
          anotando ? (
            <>
              <button type="button" className="boton-primario boton-chico" disabled={guardando || !envios.length} onClick={guardar}>{guardando ? 'guardando…' : 'guardar envío'}</button>
              <button type="button" className="boton-secundario boton-chico" disabled={guardando} onClick={() => setAnotando(false)}>cancelar</button>
            </>
          ) : (
            <button type="button" className="boton-secundario boton-chico" onClick={partir}><Truck size={14} aria-hidden="true" /> anotar un envío a Full</button>
          )
        ) : null}
      </Subtitulo>
      <Filas columnas={columnas}>
        {filas.map(({ p, nombre, m }) => {
          const r = p.reposicion
          const hacer = queHacer(r)
          const llego = r?.ultimaEntrada && hace(r.ultimaEntrada.dia) <= 14 ? r.ultimaEntrada : null
          return (
            <Fila key={p._id} columnas={columnas} tono={hacer && hacer.tono !== 'neutra' ? hacer.tono : undefined} celdas={{
              quien: (
                <div className="s-fila-quien">
                  <button type="button" onClick={() => onAbrir?.(p)} aria-label={`Ver la historia de ${nombre}`}>{p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <span className="s-fila-sin-foto" />}</button>
                  <div>
                    <span><strong>{nombre}</strong> <a href={p.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${nombre} en Mercado Libre`} title="Abrir en Mercado Libre"><ExternalLink size={14} aria-hidden="true" /></a></span>
                    {m.pausada ? <Etiqueta tono="atencion">pausada</Etiqueta> : null}
                  </div>
                </div>
              ),
              vendio: <Dato valor={fmtNum(m.ventas7 ?? 0)} detalle={`${fmtNum(m.visitas7 ?? 0)} ${m.visitas7 === 1 ? 'visita' : 'visitas'}${m.conversion7d != null ? ` · compran ${decimal(m.conversion7d)} de cada 100` : ''}${mostrarPrecio && m.precio != null ? ` · ${fmtPrecio(m.precio)}` : ''}`} />,
              full: r ? <EnFull r={r} /> : <Dato valor={fmtNum(m.stock)} detalle={p.envioMl?.logistica === 'fulfillment' ? 'en Full' : 'en tu bodega'} />,
              camino: !r ? null : anotando ? (
                <label className="s-campo-numero">
                  <input type="number" inputMode="numeric" min="0" max="5000" step="1" value={cantidades[p._id] ?? ''} disabled={guardando} aria-label={`Unidades que mandaste${nombre ? ` de ${nombre}` : ''}`}
                    onChange={(ev) => setCantidades((c) => ({ ...c, [p._id]: ev.target.value }))} />
                  <span>{r.enCamino > 0 ? `más las ${fmtNum(r.enCamino)} que ya iban` : 'unidades'}</span>
                </label>
              ) : r.enCamino > 0 ? (
                <Dato valor={fmtNum(r.enCamino)} detalle={<>{r.enCaminoDesde ? `anotado el ${fmtFechaCorta(r.enCaminoDesde)}` : 'anotado'}{llego ? <><br />ya llegaron {fmtNum(llego.unidades)} el {fmtFechaCorta(`${llego.dia}T12:00:00Z`)}</> : null}</>}>
                  <button type="button" className="boton-plano boton-chico" disabled={guardando} onClick={() => quitar(p)} title="Se descuenta solo cuando Full lo recibe; esto lo borra a mano"><X size={12} aria-hidden="true" /> quitar</button>
                </Dato>
              ) : llego ? (
                <Dato detalle={`Full lo recibió el ${fmtFechaCorta(`${llego.dia}T12:00:00Z`)}`}><Etiqueta tono="bien">llegaron {fmtNum(llego.unidades)}</Etiqueta></Dato>
              ) : <Dato detalle="nada anotado" />,
              hacer: hacer ? (
                <Dato detalle={hacer.detalle}>
                  <Etiqueta tono={hacer.tono}>{hacer.texto}</Etiqueta>
                  {hacer.decidir && onDecidir && !anotando ? <button type="button" className="boton-plano boton-chico" disabled={guardando} onClick={() => decidir(p, hacer.decidir.decision)}>{hacer.decidir.texto}</button> : null}
                </Dato>
              ) : null,
            }} />
          )
        })}
      </Filas>
      {conFull ? (
        <Nota>
          {anotando
            ? 'Escribe cuántas unidades mandaste de cada uno y deja en blanco lo que no enviaste. Cuenta como stock que viene y deja de pedirte reponer.'
            : 'Mercado Libre no informa los envíos que van en camino: se anotan acá. Lo que Full recibe se ve solo y se descuenta. Lo que lleva dos semanas sin stock y sin nada en camino deja de avisar.'}
        </Nota>
      ) : null}
    </div>
  )
}
