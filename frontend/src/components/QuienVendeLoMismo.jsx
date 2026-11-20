import { useEffect, useRef, useState } from 'react'
import { Check, X, RotateCcw, ScanSearch, Ruler, Clock, Trophy } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { Aviso, Cifra, Cifras, Etiqueta, FichaFoto, Fichas, CampoNumero, Subtitulo, Nota, Acciones, ReglaPrecios, Filas, Fila, Dato, Nivel } from './sistema.jsx'
import { MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// QUIÉN VENDE LO MISMO (17-nov-2026). Pedido del importador: «no va a servir
// solo el título, tiene que leer la imagen del producto competidor… y nosotros
// en el frontend indicaremos si es lo mismo». La foto es lo que se mira: el
// sistema pone arriba las publicaciones que por la foto parecen el mismo
// producto y el dueño confirma con un clic. Con los confirmados se compara el
// precio POR UNIDAD (un pack de 2 no se compara con un suelto).
//
// Y la medida, que pidió al usarlo ese mismo día: «el de nosotros es 90x60…
// los de abajo pueden ser igual pero el tamaño es diferente». El mismo producto
// en otra medida (otro tamaño, largo, potencia o número de piezas) va aparte:
// no entra a la comparación directa y, cuando se puede, su precio se lleva a la
// medida propia.
//
// SI HACES UN DESCUENTO (18-nov-2026). Saber que hay más baratos no alcanza para decidir un descuento: hay que ver
// a qué precio se queda dónde y cuánto deja cada venta ahí. Los escalones son los precios en que la publicación
// cambia de lugar entre los que venden lo mismo (la mitad, los tres más baratos, el más barato), cada uno con lo que
// queda por venta y cuánto más habría que vender para juntar la misma plata. No recomienda ninguno: el importador elige.

//
// QUÉ DA LA BÚSQUEDA POR ESA PLATA y ANTES DE COMPRAR (18-nov-2026). Lectura del importador de lo que no se le
// vendió: «fallamos por traer lo mismo que los demás, sobre todo en diseño y watts». Dos cosas nuevas en esta misma
// pantalla: (1) para cualquier producto con medida en el título, cuántas publicaciones dan más medida por la misma
// plata; (2) la pantalla sirve igual para un producto que todavía no se compra (RevisarProducto.jsx sube la foto
// del proveedor): la vista trae `candidato` y `revision`, y cambian las palabras («el precio que piensas»).

// las palabras que cambian entre una publicación propia y un producto que todavía no se compra
const TEXTOS = {
  propio: { precioUnidad: 'Tu precio por unidad', trae: (u, p) => (u > 1 ? `tu publicación trae ${fmtNum(u)} a ${fmtPrecio(p)}` : 'tu publicación trae 1 unidad'), aTuPrecio: 'A tu precio de hoy',
    marca: 'tú hoy', bajo: 'bajo tu precio de hoy', elTuyo: 'el tuyo', queHoy: 'que hoy', loDeHoy: 'lo de hoy', escalones: 'Si haces un descuento' },
  candidato: { precioUnidad: 'El precio que piensas, por unidad', trae: (u, p) => (u > 1 ? `la publicación traería ${fmtNum(u)} a ${fmtPrecio(p)}` : 'la publicación traería 1 unidad'), aTuPrecio: 'Al precio que piensas',
    marca: 'el precio que piensas', bajo: 'bajo el precio que piensas', elTuyo: 'el que piensas traer', queHoy: 'que al precio que piensas', loDeHoy: 'lo que venderías a ese precio', escalones: 'A qué precio quedarías dónde' },
}
// la lectura de la revisión de un producto por comprar: el título dice el caso, el color solo lo repite
const REVISION = {
  'sin-leer': ['neutra', 'Falta mirar las fotos.'], 'lo-venden': ['atencion', 'Ya lo venden.'], 'otra-medida': ['atencion', 'Lo venden en otra medida.'],
  parecidos: ['bien', 'Nadie vende este mismo.'], 'nada-parecido': ['neutra', 'No se parece a nada de la búsqueda.'],
}
// nadie vende el mismo, pero lo muy parecido cobra menos que el precio pensado: no es para verde
const casoRevision = (rev) => (rev.estado === 'parecidos' && rev.parecidos?.masBaratos > 0 ? ['atencion', 'Nadie vende este mismo, pero hay parecidos más baratos.'] : REVISION[rev.estado] ?? ['neutra', null])

const SIN_DATOS = {
  'sin-nicho': 'Este producto no tiene nicho asignado: sin su búsqueda no hay con quién compararlo.',
  'sin-scan': 'El nicho todavía no tiene un scan con publicaciones.',
}
const PRIMERAS = 12
const ESCALON = { mediana: 'Para quedar en la mitad', 'tres-mas-baratos': 'Para quedar entre los 3 más baratos', 'mas-barato': 'Para igualar al más barato' }
const ESCALON_CORTO = { mediana: 'en la mitad', 'tres-mas-baratos': 'entre los 3 más baratos', 'mas-barato': 'igualando al más barato' }
const ordinal = (n) => `${fmtNum(n)}.º`
const veces = (n) => `${String(n).replace('.', ',')} ${n === 1 ? 'vez' : 'veces'}`
// lo que cambia por venta en un escalón, en palabras
const lecturaEscalon = (e, conCosto, t = TEXTOS.propio) => {
  if (e.pierde) return 'A ese precio cada venta deja pérdida.'
  const partes = []
  if (Number.isFinite(e.diferencia) && e.diferencia < 0) partes.push(`Son ${fmtPrecio(-e.diferencia)} menos por venta ${t.queHoy}.`)
  if (Number.isFinite(e.diferencia) && e.diferencia > 0) partes.push(`Son ${fmtPrecio(e.diferencia)} más por venta ${t.queHoy}: a ese precio Mercado Libre te cobra menos.`)
  if (e.veces > 1) partes.push(`Para juntar la misma plata tendrías que vender ${veces(e.veces)} ${t.loDeHoy}.`)
  if (!conCosto && Number.isFinite(e.quedaSinCosto)) partes.push('Falta cargar el costo del producto para saber cuánto ganas ahí.')
  return partes.join(' ')
}

const presentacion = (x) => (x.unidades > 1 ? `pack de ${fmtNum(x.unidades)} a ${fmtPrecio(x.precio)}` : 'se vende suelto')
const contraTi = (pct, llevado = false) =>
  pct == null ? null
    : pct < 0 ? <Etiqueta tono="problema">{Math.abs(pct)}% más barato que tú{llevado ? ', llevado a tu medida' : ''}</Etiqueta>
      : pct > 0 ? <Etiqueta tono="bien">{pct}% más caro que tú{llevado ? ', llevado a tu medida' : ''}</Etiqueta>
        : <Etiqueta>mismo precio que tú</Etiqueta>
// la medida de la publicación contra la propia: el texto dice las dos cosas, el color solo lo repite
const etiquetaMedida = (m) =>
  !m?.texto ? null
    : m.estado === 'igual' ? <Etiqueta tono="bien">{m.texto}, tu misma medida</Etiqueta>
      : m.estado === 'distinta' ? <Etiqueta tono="atencion">{m.texto}, otra medida</Etiqueta>
        : <Etiqueta>{m.texto}</Etiqueta>
const senales = (x) => (
  <>
    {x.esFull ? <Etiqueta tono="destacada">Full</Etiqueta> : null}
    {x.esTiendaOficial ? <Etiqueta>tienda oficial</Etiqueta> : null}
    {x.vendidos ? <Etiqueta>+{fmtNum(x.vendidos)} vendidos</Etiqueta> : null}
    {x.puestoRanking ? <Etiqueta tono="destacada">{ordinal(x.puestoRanking)} más vendido de tu categoría</Etiqueta> : null}
    {x.posicion ? <Etiqueta>puesto {x.posicion} en la búsqueda</Etiqueta> : null}
  </>
)
// los más vendidos de la categoría y marca de la publicación propia: qué se leyó y qué sumó a lo que trae la búsqueda
const textoRanking = (r, keyword) => {
  if (!r.leidoEl) return 'Mercado Libre publica los más vendidos de la categoría y marca de tu publicación. Ahí suelen estar los que venden tu mismo producto aunque no salgan en esta búsqueda.'
  if (!r.vigente) return `La última lectura es del ${fmtFechaCorta(r.leidoEl)} y ya no se usa para comparar: actualízala.`
  const sumo = r.sumadas > 0 ? `${fmtNum(r.sumadas)} no ${r.sumadas === 1 ? 'sale' : 'salen'} en la búsqueda “${keyword}” y ${r.sumadas === 1 ? 'quedó' : 'quedaron'} abajo, primero las de tu medida` : 'todas salen también en la búsqueda'
  return `Más vendidos de tu categoría, leídos el ${fmtFechaCorta(r.leidoEl)}: ${fmtNum(r.publicaciones)} publicaciones; ${sumo}.${r.propioPuesto ? ` La tuya va ${ordinal(r.propioPuesto)}.` : ''}`
}
// lo que queda por venta a un precio: con el costo cargado es plata limpia; sin él, lo que queda para pagar el producto
const queda = (e, conCosto) => {
  if (!e) return null
  const v = conCosto ? e.queda : e.quedaSinCosto
  if (!Number.isFinite(v)) return null
  return { valor: v < 0 ? `pierdes ${fmtPrecio(-v)}` : `te quedan ${fmtPrecio(v)}`, tono: v < 0 ? 'problema' : 'bien', detalle: `por venta a ${fmtPrecio(e.precio)}${conCosto ? ', antes de publicidad' : ', para pagar el producto'}` }
}

// lo que da la búsqueda por esa plata, en la medida del producto (watts, piezas, metros…)
const COLUMNAS_MEDIDA = [{ id: 'medida', titulo: 'Medida', ancha: true }, { id: 'cuantas', titulo: 'Publicaciones' }, { id: 'precio', titulo: 'Por unidad, la mitad cobra menos de' }, { id: 'vendidos', titulo: 'Llevan vendido' }]
function PorLaPlata({ m, fecha }) {
  if (!m?.conMedida) return null
  const tope = Math.max(...m.grupos.map((g) => g.n), 1)
  return (
    <>
      <Subtitulo titulo="Qué da la búsqueda por esa plata">
        <span>{fmtNum(m.conMedida)} {m.conMedida === 1 ? 'publicación trae' : 'publicaciones traen'} {m.enTitulo ?? `su ${m.nombre}`} en el título · scan del {fmtFechaCorta(fecha)}</span>
      </Subtitulo>
      <Aviso tono={m.masPorMenos.n > 0 ? 'atencion' : 'neutra'} Icono={Ruler}>{m.frase}</Aviso>
      <Filas columnas={COLUMNAS_MEDIDA}>
        {m.grupos.map((g) => (
          <Fila key={g.texto} columnas={COLUMNAS_MEDIDA} tono={g.esLaMia ? 'destacada' : undefined} celdas={{
            medida: <Dato valor={g.texto}>{g.esLaMia ? <Etiqueta tono="destacada">esta medida</Etiqueta> : null}</Dato>,
            cuantas: <Dato valor={fmtNum(g.n)}><Nivel fraccion={g.n / tope} tono={g.esLaMia ? 'destacada' : 'neutra'} /></Dato>,
            precio: <Dato valor={g.medianaUnidad != null ? fmtPrecio(g.medianaUnidad) : '—'} detalle={g.n > 1 ? `desde ${fmtPrecio(g.masBaratoUnidad)}` : g.n === 1 ? null : 'nadie la ofrece'} />,
            vendidos: <Dato valor={g.vendidos > 0 ? `+${fmtNum(g.vendidos)}` : '—'} detalle={g.vendidos > 0 ? 'entre todas' : null} />,
          }} />
        ))}
      </Filas>
      {m.masPorMenos.ejemplos.length ? (
        <>
          <Nota>Las que dan más {m.nombre} por la misma plata o menos, primero las que más han vendido:</Nota>
          <Fichas>
            {m.masPorMenos.ejemplos.map((x) => (
              <FichaFoto key={x.sku} foto={x.imagen} enlace={x.url} titulo={x.titulo} principal={fmtPrecio(x.precioUnidad)} secundario="por unidad"
                etiquetas={<><Etiqueta tono="atencion">{x.medida}</Etiqueta>{x.vendidos ? <Etiqueta>+{fmtNum(x.vendidos)} vendidos</Etiqueta> : null}</>} />
            ))}
          </Fichas>
        </>
      ) : null}
    </>
  )
}

// `propioId`: una publicación propia o un producto que todavía no se compra. `leerAlAbrir`: mira las fotos apenas
// carga si nunca se han mirado (recién subido). `alCambiar(vista)`: avisa cada vista nueva a quien lo contiene.
export function QuienVendeLoMismo({ propioId, leerAlAbrir = false, alCambiar = null }) {
  const [v, setVista] = useState(null)
  const yaLeyo = useRef(false)
  const setV = (x) => { setVista(x); if (x) alCambiar?.(x) }
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [unidades, setUnidades] = useState({})
  const [todas, setTodas] = useState(false)
  const [verIguales, setVerIguales] = useState(false)
  const [pedido, setPedido] = useState(false)
  const [lectura, setLectura] = useState(null)

  useEffect(() => {
    let vivo = true
    setV(null)
    api.igualesPropio(propioId).then((x) => vivo && setV(x)).catch((e) => vivo && setError(e.message))
    return () => {
      vivo = false
    }
  }, [propioId])

  async function correr(clave, pedido) {
    setOcupado(clave)
    setError(null)
    try {
      const x = await pedido()
      setV(x)
      if (x.lectura) setLectura(x.lectura)
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(null)
    }
  }
  const marcar = (c, relacion) => correr(c.sku, () => api.marcarIgual(propioId, { sku: c.sku, relacion, ...(relacion === 'igual' || relacion === 'otra-medida' ? { unidades: unidades[c.sku] ?? c.unidades ?? 1 } : {}) }))
  // un producto recién subido: las fotos de la búsqueda se miran solas, una vez
  useEffect(() => {
    if (!leerAlAbrir || yaLeyo.current || v?.estado !== 'ok' || v.fotos.revisadas > 0 || !v.fotos.sinRevisar) return
    yaLeyo.current = true
    correr('fotos', () => api.sugerirIguales(propioId))
  }, [v, leerAlAbrir])

  if (error && !v) return <p className="vacio">{error}</p>
  if (!v) return <Cargando texto="leyendo el último scan del nicho…" />
  if (v.estado !== 'ok') return <p className="vacio">{SIN_DATOS[v.estado] ?? v.estado}</p>

  const r = v.resumen ?? {}
  const cand = v.candidato ?? null
  const rev = v.revision ?? null
  const t = TEXTOS[cand ? 'candidato' : 'propio']
  const eco = v.economia
  const otras = v.otraMedida ?? []
  const hoy = queda(eco?.hoy, eco?.conCosto)
  // a la vista, las primeras: vienen ordenadas con lo que parece el mismo en la medida propia arriba. En un nicho parejo
  // pueden ser decenas; el resto queda detrás del botón y los grupos se confirman de una vez
  const visibles = todas ? v.candidatos : v.candidatos.slice(0, PRIMERAS)
  const enLote = (relacion) => correr(`lote-${relacion}`, () => api.marcarIgual(propioId, { lote: relacion }))
  const mirando = ocupado === 'fotos'
  // ya se miraron las fotos y ninguna es el mismo producto: lo que queda es mostrar lo que más se le parece
  const ningunaIgual = v.ningunaIgual ?? (!v.iguales.length && !otras.length && v.fotos.revisadas > 0 && v.fotos.sinRevisar === 0 && !v.fotos.parecenIgual && !v.fotos.parecenOtraMedida)
  const escalones = eco?.escalones ?? []
  const enScan = v.iguales.filter((x) => x.enUltimoScan)
  // la ficha de un confirmado: `otra` = el mismo producto en otra medida (su precio se muestra llevado a la propia)
  const confirmado = (x, otra) => (
    <FichaFoto key={x.sku} foto={x.imagen} enlace={x.url} titulo={x.titulo} principal={fmtPrecio(x.precioUnidad)} secundario={`por unidad · ${presentacion(x)}`}
      detalle={otra ? (x.precioUnidadEnMiMedida != null ? `Llevado a tu medida${v.propio.medida ? ` (${v.propio.medida})` : ''} serían ${fmtPrecio(x.precioUnidadEnMiMedida)} por unidad.` : 'En otra medida el precio no se puede llevar a la tuya: va solo como referencia.') : null}
      etiquetas={<>{etiquetaMedida(x.medida)}{otra && x.precioUnidadEnMiMedida == null ? null : contraTi(x.diferenciaPct, otra)}{senales(x)}{x.enUltimoScan ? null : <Etiqueta tono="atencion">no salió en el último scan</Etiqueta>}</>}
      grafico={x.historia?.length > 1 ? <MiniSerie titulo="su precio en cada scan" puntos={x.historia.map((h) => ({ valor: h.precio }))} formato={fmtPrecio} alto={56} /> : null}>
      <CampoNumero antes="trae" valor={x.unidades} deshabilitado={!!ocupado} onCambiar={(n) => correr(x.sku, () => api.marcarIgual(propioId, { sku: x.sku, relacion: otra ? 'otra-medida' : 'igual', unidades: n }))} />
      <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(x, otra ? 'igual' : 'otra-medida')}>
        <Ruler size={14} aria-hidden="true" /> {otra ? 'es tu misma medida' : 'es otra medida'}
      </button>
      <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(x, null)}>
        <RotateCcw size={14} aria-hidden="true" /> no es el mismo
      </button>
    </FichaFoto>
  )

  return (
    <div>
      {v.scan?.dias > 14 ? (
        <Aviso tono="atencion" Icono={Clock}
          accion={v.scan.pausado ? null : (
            <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado || pedido} onClick={() => api.escanear(v.scan.nichoId).then(() => setPedido(true)).catch((e) => setError(e.message))}>
              {pedido ? 'pedido: tarda entre 10 minutos y una hora' : 'medir de nuevo'}
            </button>
          )}>
          Esta búsqueda se midió por última vez el {fmtFechaCorta(v.fechaScan)}, hace {fmtNum(v.scan.dias)} días: las publicaciones y los precios pueden haber cambiado.
          {v.scan.pausado ? ' El nicho está pausado, por eso no se ha vuelto a medir; se reactiva en Nichos.' : ''}
        </Aviso>
      ) : null}
      {rev ? (
        <Aviso tono={casoRevision(rev)[0]} Icono={ScanSearch} titulo={mirando ? 'Mirando las fotos…' : casoRevision(rev)[1]}>
          {mirando ? `Estoy comparando tu foto con las ${fmtNum(rev.total)} publicaciones de la búsqueda. Tarda uno o dos minutos.` : rev.frase}
        </Aviso>
      ) : null}
      {rev?.mismos ? (
        <Cifras>
          <Cifra etiqueta="Venden este mismo producto" valor={`${fmtNum(rev.mismos.n)} de ${fmtNum(rev.total)}`}
            detalle={rev.mismos.sinConfirmar ? `publicaciones de la búsqueda · ${fmtNum(rev.mismos.sinConfirmar)} según la foto, falta que ${rev.mismos.sinConfirmar === 1 ? 'la' : 'las'} confirmes` : 'publicaciones de la búsqueda, confirmadas por ti'} />
          <Cifra etiqueta="La más barata cobra" valor={fmtPrecio(rev.mismos.masBaratoUnidad)} tono={rev.mismos.masBaratos > 0 ? 'problema' : undefined} detalle={`por unidad · la mitad cobra menos de ${fmtPrecio(rev.mismos.medianaUnidad)}`} />
          <Cifra etiqueta="Llevan vendido" valor={rev.mismos.vendidos > 0 ? `+${fmtNum(rev.mismos.vendidos)}` : 'sin dato'} detalle="unidades entre todas desde que se publicaron (el piso que muestra Mercado Libre)" />
          {v.propio.precioUnidad ? (
            <Cifra etiqueta={t.aTuPrecio} valor={hoy ? hoy.valor : `quedarías ${ordinal(rev.mismos.masBaratos + 1)} de ${fmtNum(rev.mismos.n + 1)}`} tono={hoy?.tono}
              detalle={hoy ? `${hoy.detalle}${eco?.aproximada ? ' (cuenta aproximada)' : ''} · quedarías ${ordinal(rev.mismos.masBaratos + 1)} de ${fmtNum(rev.mismos.n + 1)} por precio` : 'por precio, del más barato al más caro'} />
          ) : null}
        </Cifras>
      ) : null}
      {rev ? null : <Aviso tono={r.masBaratos > 0 ? 'atencion' : v.iguales.length ? 'bien' : 'neutra'} Icono={ScanSearch}>
        {ningunaIgual ? `Por la foto, ninguna publicación es tu mismo producto.${v.fotos.parecidas ? ' Abajo van primero las que más se le parecen; sus precios sirven de referencia, no son tu mismo producto.' : ''}` : r.frase}
        {otras.length ? ` Hay ${otras.length === 1 ? 'otra publicación' : `otras ${fmtNum(otras.length)}`} del mismo producto en otra medida: ${otras.length === 1 ? 'va' : 'van'} aparte, más abajo.` : ''}
      </Aviso>}

      {ningunaIgual && v.parecidos ? (
        <Cifras>
          <Cifra etiqueta={t.precioUnidad} valor={fmtPrecio(v.propio.precioUnidad)} detalle={t.trae(v.propio.unidades, v.propio.precio)} />
          <Cifra etiqueta="La más barata de las parecidas" valor={fmtPrecio(v.parecidos.masBaratoUnidad)} tono={v.parecidos.masBaratos > 0 ? 'problema' : undefined} detalle={`por unidad, entre las ${fmtNum(v.parecidos.n)} que más se parecen`} />
          <Cifra etiqueta="La mitad de las parecidas cobra menos de" valor={fmtPrecio(v.parecidos.medianaUnidad)} detalle={v.parecidos.masBaratos != null ? `${fmtNum(v.parecidos.masBaratos)} de ${fmtNum(v.parecidos.n)} cobran menos que tú` : 'por unidad'} />
        </Cifras>
      ) : null}

      {v.iguales.length && !rev ? (
        <Cifras>
          <Cifra etiqueta={t.precioUnidad} valor={fmtPrecio(v.propio.precioUnidad)} detalle={t.trae(v.propio.unidades, v.propio.precio)} />
          {r.masBarato ? <Cifra etiqueta="El más barato cobra" valor={fmtPrecio(r.masBarato.precioUnidad)} tono={r.masBaratos > 0 ? 'problema' : undefined} detalle={`por unidad · ${presentacion(r.masBarato)}`} /> : null}
          {r.medianaUnidad ? <Cifra etiqueta="La mitad cobra menos de" valor={fmtPrecio(r.medianaUnidad)} detalle="por unidad, entre los que venden lo mismo en tu medida" /> : null}
          {hoy ? <Cifra etiqueta={t.aTuPrecio} valor={hoy.valor} tono={hoy.tono} detalle={`${hoy.detalle}${r.lugar ? ` · quedas ${ordinal(r.lugar)} de ${fmtNum(r.de)} por precio` : ''}`} /> : null}
        </Cifras>
      ) : null}

      {enScan.length && v.propio.precioUnidad ? (
        <>
          <Subtitulo titulo={t.escalones}><span>a qué precio cambias de lugar y cuánto deja cada venta ahí</span></Subtitulo>
          <ReglaPrecios titulo="Lo que cobra por unidad cada uno que vende lo mismo" fuente={`${fmtNum(enScan.length)} ${enScan.length === 1 ? 'publicación' : 'publicaciones'} · scan del ${fmtFechaCorta(v.fechaScan)}`}
            puntos={enScan.map((x) => x.precioUnidad)} formato={fmtPrecio}
            marcas={[
              { id: 'hoy', valor: v.propio.precioUnidad, titulo: `${t.marca}${r.lugar ? `: ${ordinal(r.lugar)} de ${fmtNum(r.de)}` : ''}`, tono: 'destacada' },
              ...escalones.map((e) => ({ id: e.meta, valor: e.precioUnidad, titulo: `${ESCALON_CORTO[e.meta]}: ${ordinal(e.lugar)} de ${fmtNum(e.de)}`, tono: e.pierde ? 'problema' : e.pierde === false ? 'bien' : 'neutra' })),
            ]}>
            Cada rayita es una publicación que vende lo mismo{v.propio.medida ? ' en tu medida' : ''}. Mientras más a la izquierda, más barata.
          </ReglaPrecios>
          {escalones.length ? (
            <Cifras>
              {escalones.map((e) => {
                const q = queda(e, eco.conCosto)
                return (
                  <Cifra key={e.meta} etiqueta={ESCALON[e.meta]} valor={fmtPrecio(e.precio)}
                    detalle={`o menos · ${fmtNum(e.descuentoPct)}% ${t.bajo}${v.propio.unidades > 1 ? ` · ${fmtPrecio(e.precioUnidad)} por unidad` : ''}`}>
                    <Etiqueta tono="destacada">quedarías {ordinal(e.lugar)} de {fmtNum(e.de)}</Etiqueta>
                    {q ? <Etiqueta tono={eco.conCosto ? q.tono : 'neutra'}>{q.valor} por venta{eco.conCosto ? '' : ', para pagar el producto'}</Etiqueta> : null}
                    {lecturaEscalon(e, eco.conCosto, t) ? <p>{lecturaEscalon(e, eco.conCosto, t)}</p> : null}
                  </Cifra>
                )
              })}
            </Cifras>
          ) : <Nota>{r.masBaratos === 0 ? 'Nadie cobra menos que tú por unidad: no hay descuento que te mueva de lugar.' : `${t.aTuPrecio}, un descuento chico no cambia tu lugar.`}</Nota>}
          {escalones.length ? <Nota>Son cuentas para decidir, no una recomendación. Lo que queda es después de la comisión y el envío de Mercado Libre{eco?.conCosto ? ' y del costo del producto' : ''}, antes de publicidad.{eco?.aproximada ? ' Como el producto todavía no existe en Mercado Libre, la comisión y el envío son los medidos en tus ventas: es una aproximación.' : ''}</Nota> : null}
        </>
      ) : null}

      {rev?.mismos && !enScan.length ? <Nota>Confirma abajo las que son el mismo producto y vas a ver a qué precio quedarías dónde y cuánto quedaría por venta.</Nota> : null}
      <PorLaPlata m={v.porLaPlata} fecha={v.fechaScan} />

      <Subtitulo titulo={v.propio.medida ? `Venden lo mismo, en tu medida (${v.propio.medida})` : 'Venden lo mismo'} cuenta={v.iguales.length}>
        <span>precios del scan del {fmtFechaCorta(v.fechaScan)} en “{v.keyword}”{v.ranking?.vigente ? ` y de los más vendidos de tu categoría, leídos el ${fmtFechaCorta(v.ranking.leidoEl)}` : ''}</span>
      </Subtitulo>
      <Fichas>
        <FichaFoto tono="destacada" foto={v.propio.imagen} principal={v.propio.precioUnidad ? fmtPrecio(v.propio.precioUnidad) : 'sin precio'} secundario={`por unidad · ${t.elTuyo}`} titulo={v.propio.titulo}
          etiquetas={v.propio.medida ? <Etiqueta tono="destacada">{v.propio.medida}</Etiqueta> : null}>
          <CampoNumero antes="trae" despues={v.propio.unidades === 1 ? 'unidad' : 'unidades'} valor={v.propio.unidades} deshabilitado={!!ocupado}
            onCambiar={(n) => correr('propio', () => api.marcarIgual(propioId, { unidadesPropias: n }))} />
          {cand ? (
            <>
              <CampoNumero largo antes="piensas venderlo a $" valor={cand.precioClp ?? undefined} min={1} max={50000000} deshabilitado={!!ocupado}
                onCambiar={(n) => correr('propio', () => api.cambiarCandidato(propioId, { precioClp: n }))} />
              <CampoNumero largo antes="te costaría $" despues="por unidad, puesto en Chile" valor={cand.costoUnitarioClp ?? undefined} min={0} max={50000000} deshabilitado={!!ocupado}
                onCambiar={(n) => correr('propio', () => api.cambiarCandidato(propioId, { costoUnitarioClp: n }))} />
            </>
          ) : null}
        </FichaFoto>
        {(verIguales ? v.iguales : v.iguales.slice(0, PRIMERAS - 1)).map((x) => confirmado(x, false))}
      </Fichas>
      {!verIguales && v.iguales.length > PRIMERAS - 1 ? (
        <Nota centrada><button type="button" className="boton-secundario boton-chico" onClick={() => setVerIguales(true)}>ver las otras {fmtNum(v.iguales.length - (PRIMERAS - 1))}, de más barata a más cara</button></Nota>
      ) : null}
      {!v.iguales.length ? <Nota>Mira las fotos de abajo y marca las que son tu mismo producto, aunque cambie el color o vengan en pack. Si es el mismo pero en otro tamaño, largo o potencia, márcalo como «otra medida»: va aparte y no ensucia la comparación.</Nota> : null}

      {otras.length ? (
        <details className="gama-mas">
          <summary>
            El mismo producto en otra medida ({fmtNum(otras.length)}): no entran a la comparación de arriba
            {otras[0]?.precioUnidadEnMiMedida != null ? ` · la más barata, llevada a tu medida, serían ${fmtPrecio(otras[0].precioUnidadEnMiMedida)} por unidad` : ''}
          </summary>
          <Fichas>{otras.map((x) => confirmado(x, true))}</Fichas>
        </details>
      ) : null}

      <Subtitulo titulo={ningunaIgual && v.fotos.parecidas ? 'Lo más parecido al tuyo, de más a menos' : 'Por revisar'} cuenta={v.candidatos.length}>
        {v.fotos.sinRevisar > 0 ? (
          <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => correr('fotos', () => api.sugerirIguales(propioId))}>
            <ScanSearch size={14} aria-hidden="true" /> {mirando ? 'mirando las fotos… tarda uno o dos minutos' : `buscar por foto (${fmtNum(v.fotos.sinRevisar)} sin mirar)`}
          </button>
        ) : <span>todas las fotos de este scan ya se miraron</span>}
      </Subtitulo>
      {v.ranking ? (
        <Acciones>
          <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => correr('ranking', () => api.traerRankingIguales(propioId))}>
            <Trophy size={14} aria-hidden="true" /> {ocupado === 'ranking' ? 'leyendo los más vendidos… tarda cerca de un minuto' : v.ranking.leidoEl ? 'actualizar los más vendidos de tu categoría' : 'traer los más vendidos de tu categoría'}
          </button>
          <span>{textoRanking(v.ranking, v.keyword)}</span>
        </Acciones>
      ) : null}
      {lectura ? <Nota>Miré {fmtNum(lectura.revisadas)} fotos: {fmtNum(lectura.parecen)} parecen el mismo producto o uno parecido y quedaron arriba, primero las de tu medida. Tú confirmas.</Nota> : null}
      {error ? <p className="vacio">{error}</p> : null}
      {v.fotos.parecenIgual > 0 || v.fotos.parecenOtraMedida > 0 ? (
        <Acciones>
          {v.fotos.parecenIgual > 0 ? (
            <button type="button" className="boton-primario boton-chico" disabled={!!ocupado} onClick={() => enLote('igual')}>
              <Check size={14} aria-hidden="true" /> confirmar {v.fotos.parecenIgual === 1 ? 'la que parece' : `las ${fmtNum(v.fotos.parecenIgual)} que parecen`} el mismo{v.propio.medida ? ' en tu medida' : ''}
            </button>
          ) : null}
          {v.fotos.parecenOtraMedida > 0 ? (
            <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => enLote('otra-medida')}>
              <Ruler size={14} aria-hidden="true" /> confirmar {v.fotos.parecenOtraMedida === 1 ? 'la' : `las ${fmtNum(v.fotos.parecenOtraMedida)}`} de otra medida
            </button>
          ) : null}
          <span>Después puedes sacar una por una las que no correspondan.</span>
        </Acciones>
      ) : null}
      <Fichas>
        {visibles.map((c) => {
          // lo que se propone: «otra medida» si la foto o el título dicen que el tamaño es distinto
          const otra = c.sugerencia?.relacion === 'otra-medida' || c.medida?.estado === 'distinta'
          return (
            <FichaFoto key={c.sku} foto={c.imagen} enlace={c.url} titulo={c.titulo} principal={fmtPrecio(c.precio)} secundario={c.unidades > 1 ? `${fmtPrecio(c.precioUnidad)} por unidad` : null}
              detalle={c.sugerencia?.motivo ?? null}
              etiquetas={<>
                {c.sugerencia?.relacion === 'igual' ? <Etiqueta tono="destacada">por la foto parece el mismo</Etiqueta> : c.sugerencia?.relacion === 'otra-medida' ? <Etiqueta tono="destacada">por la foto es el mismo en otra medida</Etiqueta>
                  : c.sugerencia?.relacion === 'parecido' ? <Etiqueta tono={c.sugerencia.parecido >= 70 ? 'destacada' : 'neutra'}>por la foto, {c.sugerencia.enPalabras ?? 'parecido al tuyo'}</Etiqueta> : null}
                {etiquetaMedida(c.medida)}{senales(c)}
              </>}>
              <CampoNumero antes="trae" valor={unidades[c.sku] ?? c.unidades} deshabilitado={!!ocupado} onCambiar={(n) => setUnidades((u) => ({ ...u, [c.sku]: n }))} />
              <button type="button" className={`${otra ? 'boton-secundario' : 'boton-primario'} boton-chico`} disabled={!!ocupado} onClick={() => marcar(c, 'igual')}>
                <Check size={14} aria-hidden="true" /> es el mismo
              </button>
              <button type="button" className={`${otra ? 'boton-primario' : 'boton-secundario'} boton-chico`} disabled={!!ocupado} onClick={() => marcar(c, 'otra-medida')}>
                <Ruler size={14} aria-hidden="true" /> el mismo, otra medida
              </button>
              <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(c, 'distinto')}>
                <X size={14} aria-hidden="true" /> no es
              </button>
            </FichaFoto>
          )
        })}
      </Fichas>
      {v.candidatos.length > visibles.length ? (
        <Nota centrada><button type="button" className="boton-secundario boton-chico" onClick={() => setTodas(true)}>ver las otras {fmtNum(v.candidatos.length - visibles.length)} publicaciones de la búsqueda</button></Nota>
      ) : null}

      {v.descartados.length ? (
        <details className="gama-mas">
          <summary>Marcadas como «no es» ({v.descartados.length})</summary>
          <Fichas>
            {v.descartados.map((c) => (
              <FichaFoto key={c.sku} foto={c.imagen} enlace={c.url} titulo={c.titulo} principal={fmtPrecio(c.precio)}>
                <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(c, null)}>
                  <RotateCcw size={14} aria-hidden="true" /> volver a revisar
                </button>
              </FichaFoto>
            ))}
          </Fichas>
        </details>
      ) : null}
    </div>
  )
}
