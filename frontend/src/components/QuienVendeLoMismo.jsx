import { useEffect, useState } from 'react'
import { Check, X, RotateCcw, ScanSearch } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { Aviso, Cifra, Cifras, Etiqueta, FichaFoto, Fichas, CampoNumero, Subtitulo, Nota } from './sistema.jsx'
import { MiniSerie } from './graficos.jsx'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// QUIÉN VENDE LO MISMO (17-nov-2026). Pedido del importador: «no va a servir
// solo el título, tiene que leer la imagen del producto competidor… y nosotros
// en el frontend indicaremos si es lo mismo». La foto es lo que se mira: el
// sistema pone arriba las publicaciones que por la foto parecen el mismo
// producto y el dueño confirma con un clic. Con los confirmados se compara el
// precio POR UNIDAD (un pack de 2 no se compara con un suelto) y lo que
// quedaría por venta igualando ese precio.

const SIN_DATOS = {
  'sin-nicho': 'Este producto no tiene nicho asignado: sin su búsqueda no hay con quién compararlo.',
  'sin-scan': 'El nicho todavía no tiene un scan con publicaciones.',
}
const PRIMERAS = 12

const presentacion = (x) => (x.unidades > 1 ? `pack de ${fmtNum(x.unidades)} a ${fmtPrecio(x.precio)}` : 'se vende suelto')
const contraTi = (pct) =>
  pct == null ? null
    : pct < 0 ? <Etiqueta tono="problema">{Math.abs(pct)}% más barato que tú</Etiqueta>
      : pct > 0 ? <Etiqueta tono="bien">{pct}% más caro que tú</Etiqueta>
        : <Etiqueta>mismo precio que tú</Etiqueta>
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
  const marcar = (c, relacion) => correr(c.sku, () => api.marcarIgual(propioId, { sku: c.sku, relacion, ...(relacion === 'igual' ? { unidades: unidades[c.sku] ?? c.unidades ?? 1 } : {}) }))

  if (error && !v) return <p className="vacio">{error}</p>
  if (!v) return <Cargando texto="leyendo el último scan del nicho…" />
  if (v.estado !== 'ok') return <p className="vacio">{SIN_DATOS[v.estado] ?? v.estado}</p>

  const r = v.resumen ?? {}
  const eco = v.economia
  const igualando = queda(eco?.alMasBarato, eco?.conCosto)
  const hoy = queda(eco?.hoy, eco?.conCosto)
  // a la vista, los que por la foto parecen el mismo (vienen primero); los parecidos y el resto, detrás del botón
  const parecenIgual = v.candidatos.filter((c) => c.sugerencia?.relacion === 'igual').length
  const visibles = todas ? v.candidatos : v.candidatos.slice(0, Math.max(PRIMERAS, parecenIgual))
  const mirando = ocupado === 'fotos'

  return (
    <div>
      <Aviso tono={r.masBaratos > 0 ? 'atencion' : v.iguales.length ? 'bien' : 'neutra'} Icono={ScanSearch}>{r.frase}</Aviso>

      {v.iguales.length ? (
        <Cifras>
          <Cifra etiqueta="Tu precio por unidad" valor={fmtPrecio(v.propio.precioUnidad)} detalle={v.propio.unidades > 1 ? `tu publicación trae ${fmtNum(v.propio.unidades)} a ${fmtPrecio(v.propio.precio)}` : 'tu publicación trae 1 unidad'} />
          {r.masBarato ? <Cifra etiqueta="El más barato cobra" valor={fmtPrecio(r.masBarato.precioUnidad)} tono={r.masBaratos > 0 ? 'problema' : undefined} detalle={`por unidad · ${presentacion(r.masBarato)}`} /> : null}
          {r.medianaUnidad ? <Cifra etiqueta="La mitad cobra menos de" valor={fmtPrecio(r.medianaUnidad)} detalle="por unidad, entre los que venden lo mismo" /> : null}
          {igualando ? <Cifra etiqueta="Si igualas al más barato" valor={igualando.valor} tono={igualando.tono} detalle={`${igualando.detalle}${hoy ? ` · hoy ${hoy.valor}` : ''}`} /> : hoy ? <Cifra etiqueta="A tu precio de hoy" valor={hoy.valor} tono={hoy.tono} detalle={hoy.detalle} /> : null}
        </Cifras>
      ) : null}

      <Subtitulo titulo="Venden lo mismo" cuenta={v.iguales.length}>
        <span>precios del scan del {fmtFechaCorta(v.fechaScan)} en “{v.keyword}”</span>
      </Subtitulo>
      <Fichas>
        <FichaFoto tono="destacada" foto={v.propio.imagen} principal={fmtPrecio(v.propio.precioUnidad)} secundario="por unidad · el tuyo" titulo={v.propio.titulo}>
          <CampoNumero antes="tu publicación trae" despues={v.propio.unidades === 1 ? 'unidad' : 'unidades'} valor={v.propio.unidades} deshabilitado={!!ocupado}
            onCambiar={(n) => correr('propio', () => api.marcarIgual(propioId, { unidadesPropias: n }))} />
        </FichaFoto>
        {v.iguales.map((x) => (
          <FichaFoto key={x.sku} foto={x.imagen} enlace={x.url} titulo={x.titulo} principal={fmtPrecio(x.precioUnidad)} secundario={`por unidad · ${presentacion(x)}`}
            etiquetas={<>{contraTi(x.diferenciaPct)}{senales(x)}{x.enUltimoScan ? null : <Etiqueta tono="atencion">no salió en el último scan</Etiqueta>}</>}
            grafico={x.historia?.length > 1 ? <MiniSerie titulo="su precio en cada scan" puntos={x.historia.map((h) => ({ valor: h.precio }))} formato={fmtPrecio} alto={56} /> : null}>
            <CampoNumero antes="trae" valor={x.unidades} deshabilitado={!!ocupado} onCambiar={(n) => correr(x.sku, () => api.marcarIgual(propioId, { sku: x.sku, relacion: 'igual', unidades: n }))} />
            <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(x, null)}>
              <RotateCcw size={14} aria-hidden="true" /> no es el mismo
            </button>
          </FichaFoto>
        ))}
      </Fichas>
      {!v.iguales.length ? <Nota>Mira las fotos de abajo y marca las que son tu mismo producto, aunque cambie el color o vengan en pack. Con eso se compara el precio por unidad.</Nota> : null}

      <Subtitulo titulo="Por revisar" cuenta={v.candidatos.length}>
        {v.fotos.sinRevisar > 0 ? (
          <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => correr('fotos', () => api.sugerirIguales(propioId))}>
            <ScanSearch size={14} aria-hidden="true" /> {mirando ? 'mirando las fotos… tarda cerca de un minuto' : `buscar por foto (${fmtNum(v.fotos.sinRevisar)} sin mirar)`}
          </button>
        ) : <span>todas las fotos de este scan ya se miraron</span>}
      </Subtitulo>
      {lectura ? <Nota>Miré {fmtNum(lectura.revisadas)} fotos: {fmtNum(lectura.parecen)} parecen el mismo producto o uno parecido y quedaron arriba. Tú confirmas.</Nota> : null}
      {error ? <p className="vacio">{error}</p> : null}
      <Fichas>
        {visibles.map((c) => (
          <FichaFoto key={c.sku} foto={c.imagen} enlace={c.url} titulo={c.titulo} principal={fmtPrecio(c.precio)} secundario={c.unidades > 1 ? `${fmtPrecio(c.precioUnidad)} por unidad` : null}
            detalle={c.sugerencia?.motivo ?? null}
            etiquetas={<>{c.sugerencia?.relacion === 'igual' ? <Etiqueta tono="destacada">por la foto parece el mismo</Etiqueta> : c.sugerencia?.relacion === 'parecido' ? <Etiqueta tono="atencion">por la foto es parecido</Etiqueta> : null}{senales(c)}</>}>
            <CampoNumero antes="trae" valor={unidades[c.sku] ?? c.unidades} deshabilitado={!!ocupado} onCambiar={(n) => setUnidades((u) => ({ ...u, [c.sku]: n }))} />
            <button type="button" className="boton-primario boton-chico" disabled={!!ocupado} onClick={() => marcar(c, 'igual')}>
              <Check size={14} aria-hidden="true" /> es el mismo
            </button>
            <button type="button" className="boton-secundario boton-chico" disabled={!!ocupado} onClick={() => marcar(c, 'distinto')}>
              <X size={14} aria-hidden="true" /> no es
            </button>
          </FichaFoto>
        ))}
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
