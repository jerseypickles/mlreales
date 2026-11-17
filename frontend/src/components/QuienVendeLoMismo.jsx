import { useEffect, useState } from 'react'
import { Check, X, RotateCcw, ScanSearch, Ruler } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { Aviso, Cifra, Cifras, Etiqueta, FichaFoto, Fichas, CampoNumero, Subtitulo, Nota, Acciones } from './sistema.jsx'
import { MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// QUIÉN VENDE LO MISMO (17-nov-2026). Pedido del importador: «no va a servir
// solo el título, tiene que leer la imagen del producto competidor… y nosotros
// en el frontend indicaremos si es lo mismo». La foto es lo que se mira: el
// sistema pone arriba las publicaciones que por la foto parecen el mismo
// producto y el dueño confirma con un clic. Con los confirmados se compara el
// precio POR UNIDAD (un pack de 2 no se compara con un suelto) y lo que
// quedaría por venta igualando ese precio.
//
// Y la medida, que pidió al usarlo ese mismo día: «el de nosotros es 90x60…
// los de abajo pueden ser igual pero el tamaño es diferente». El mismo producto
// en otra medida (otro tamaño, largo, potencia o número de piezas) va aparte:
// no entra a la comparación directa y, cuando se puede, su precio se lleva a la
// medida propia.

const SIN_DATOS = {
  'sin-nicho': 'Este producto no tiene nicho asignado: sin su búsqueda no hay con quién compararlo.',
  'sin-scan': 'El nicho todavía no tiene un scan con publicaciones.',
}
const PRIMERAS = 12

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
    {x.posicion ? <Etiqueta>puesto {x.posicion}</Etiqueta> : null}
  </>
)
// lo que queda por venta a un precio: con el costo cargado es plata limpia; sin él, lo que queda para pagar el producto
const queda = (e, conCosto) => {
  if (!e) return null
  const v = conCosto ? e.queda : e.quedaSinCosto
  if (!Number.isFinite(v)) return null
  return { valor: v < 0 ? `pierdes ${fmtPrecio(-v)}` : `te quedan ${fmtPrecio(v)}`, tono: v < 0 ? 'problema' : 'bien', detalle: `por venta a ${fmtPrecio(e.precio)}${conCosto ? ', antes de publicidad' : ', para pagar el producto'}` }
}

export function QuienVendeLoMismo({ propioId }) {
  const [v, setV] = useState(null)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const [unidades, setUnidades] = useState({})
  const [todas, setTodas] = useState(false)
  const [verIguales, setVerIguales] = useState(false)
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

  if (error && !v) return <p className="vacio">{error}</p>
  if (!v) return <Cargando texto="leyendo el último scan del nicho…" />
  if (v.estado !== 'ok') return <p className="vacio">{SIN_DATOS[v.estado] ?? v.estado}</p>

  const r = v.resumen ?? {}
  const eco = v.economia
  const otras = v.otraMedida ?? []
  const igualando = queda(eco?.alMasBarato, eco?.conCosto)
  const hoy = queda(eco?.hoy, eco?.conCosto)
  // a la vista, las primeras: vienen ordenadas con lo que parece el mismo en la medida propia arriba. En un nicho parejo
  // pueden ser decenas; el resto queda detrás del botón y los grupos se confirman de una vez
  const visibles = todas ? v.candidatos : v.candidatos.slice(0, PRIMERAS)
  const enLote = (relacion) => correr(`lote-${relacion}`, () => api.marcarIgual(propioId, { lote: relacion }))
  const mirando = ocupado === 'fotos'
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
      <Aviso tono={r.masBaratos > 0 ? 'atencion' : v.iguales.length ? 'bien' : 'neutra'} Icono={ScanSearch}>
        {r.frase}{otras.length ? ` Hay ${otras.length === 1 ? 'otra publicación' : `otras ${fmtNum(otras.length)}`} del mismo producto en otra medida: ${otras.length === 1 ? 'va' : 'van'} aparte, más abajo.` : ''}
      </Aviso>

      {v.iguales.length ? (
        <Cifras>
          <Cifra etiqueta="Tu precio por unidad" valor={fmtPrecio(v.propio.precioUnidad)} detalle={v.propio.unidades > 1 ? `tu publicación trae ${fmtNum(v.propio.unidades)} a ${fmtPrecio(v.propio.precio)}` : 'tu publicación trae 1 unidad'} />
          {r.masBarato ? <Cifra etiqueta="El más barato cobra" valor={fmtPrecio(r.masBarato.precioUnidad)} tono={r.masBaratos > 0 ? 'problema' : undefined} detalle={`por unidad · ${presentacion(r.masBarato)}`} /> : null}
          {r.medianaUnidad ? <Cifra etiqueta="La mitad cobra menos de" valor={fmtPrecio(r.medianaUnidad)} detalle="por unidad, entre los que venden lo mismo en tu medida" /> : null}
          {igualando ? <Cifra etiqueta="Si igualas al más barato" valor={igualando.valor} tono={igualando.tono} detalle={`${igualando.detalle}${hoy ? ` · hoy ${hoy.valor}` : ''}`} /> : hoy ? <Cifra etiqueta="A tu precio de hoy" valor={hoy.valor} tono={hoy.tono} detalle={hoy.detalle} /> : null}
        </Cifras>
      ) : null}

      <Subtitulo titulo={v.propio.medida ? `Venden lo mismo, en tu medida (${v.propio.medida})` : 'Venden lo mismo'} cuenta={v.iguales.length}>
        <span>precios del scan del {fmtFechaCorta(v.fechaScan)} en “{v.keyword}”</span>
      </Subtitulo>
      <Fichas>
        <FichaFoto tono="destacada" foto={v.propio.imagen} principal={fmtPrecio(v.propio.precioUnidad)} secundario="por unidad · el tuyo" titulo={v.propio.titulo}
          etiquetas={v.propio.medida ? <Etiqueta tono="destacada">{v.propio.medida}</Etiqueta> : null}>
          <CampoNumero antes="trae" despues={v.propio.unidades === 1 ? 'unidad' : 'unidades'} valor={v.propio.unidades} deshabilitado={!!ocupado}
            onCambiar={(n) => correr('propio', () => api.marcarIgual(propioId, { unidadesPropias: n }))} />
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

      <Subtitulo titulo="Por revisar" cuenta={v.candidatos.length}>
        {v.fotos.sinRevisar > 0 ? (
          <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => correr('fotos', () => api.sugerirIguales(propioId))}>
            <ScanSearch size={14} aria-hidden="true" /> {mirando ? 'mirando las fotos… tarda cerca de un minuto' : `buscar por foto (${fmtNum(v.fotos.sinRevisar)} sin mirar)`}
          </button>
        ) : <span>todas las fotos de este scan ya se miraron</span>}
      </Subtitulo>
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
                {c.sugerencia?.relacion === 'igual' ? <Etiqueta tono="destacada">por la foto parece el mismo</Etiqueta> : c.sugerencia?.relacion === 'otra-medida' ? <Etiqueta tono="destacada">por la foto es el mismo en otra medida</Etiqueta> : c.sugerencia?.relacion === 'parecido' ? <Etiqueta tono="atencion">por la foto es parecido</Etiqueta> : null}
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
