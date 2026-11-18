import { useEffect, useState } from 'react'
import { ImagePlus, ScanSearch, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { achicarImagen } from '../lib/imagen.js'
import { Cargando } from './ui.jsx'
import { Aviso, Campo, Campos, CampoFoto, Etiqueta, FichaFoto, Fichas, Nota, Subtitulo } from './sistema.jsx'
import { QuienVendeLoMismo } from './QuienVendeLoMismo.jsx'
import { fmtNum, fmtPrecio, fmtFechaCorta } from '../lib/formato.js'

// REVISAR UN PRODUCTO ANTES DE TRAERLO (18-nov-2026). Lectura del importador de lo que no se le vendió de su
// primera importación: «fallamos por traer lo mismo que los demás, sobre todo en diseño y watts», y lo que sacó en
// limpio: «vale más traer un producto diferente a la competencia que traer el mismo y competir por precio».
// «Quién vende lo mismo» ya lo mostraba, pero después de publicar. Acá se pregunta antes de comprar: sube la foto
// que le manda el proveedor, dice qué es y a cuánto piensa venderlo, y la misma lectura de fotos la compara con la
// búsqueda del nicho. La respuesta cuenta (cuántos venden ese mismo producto, a cuánto, cuánto llevan vendido, qué
// da la búsqueda por esa plata); si conviene traerlo lo decide él.
//
// Arriba el formulario, después una ficha por producto revisado en esta búsqueda y, abajo, la revisión del que
// está abierto: es la pantalla de «Quién vende lo mismo» con las palabras de un producto que todavía no se compra.

// lo que dice la etiqueta de cada ficha: el caso en pocas palabras (el color solo lo repite)
const CASO = {
  'sin-leer': () => ['neutra', 'falta mirar las fotos'],
  'lo-venden': (r) => ['atencion', `${r.mismos.n === 1 ? '1 vende' : `${fmtNum(r.mismos.n)} venden`} este mismo`],
  'otra-medida': () => ['atencion', 'lo venden en otra medida'],
  parecidos: () => ['bien', 'nadie vende este mismo'],
  'nada-parecido': () => ['neutra', 'no se parece a nada de la búsqueda'],
}
const imagenDe = (archivos) => [...(archivos ?? [])].find((x) => String(x.type ?? '').startsWith('image/'))

export function RevisarProducto({ nichoId, keyword }) {
  const [lista, setLista] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const [recien, setRecien] = useState(null)
  const [error, setError] = useState(null)
  const [foto, setFoto] = useState(null)
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [unidades, setUnidades] = useState('1')
  const [costo, setCosto] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    setLista(null)
    setAbierto(null)
    setRecien(null)
    setError(null)
    api.candidatosDeNicho(nichoId)
      .then((r) => { if (vivo) { setLista(r.candidatos); setAbierto(r.candidatos[0]?.id ?? null) } })
      .catch((e) => vivo && setError(e.message))
    return () => {
      vivo = false
    }
  }, [nichoId])

  async function elegirFoto(archivo) {
    setError(null)
    try {
      setFoto(await achicarImagen(archivo))
    } catch (e) {
      setError(e.message)
    }
  }

  async function revisar(ev) {
    ev.preventDefault()
    if (!foto) return setError('Falta la foto del producto.')
    setGuardando(true)
    setError(null)
    try {
      const { candidato } = await api.crearCandidato({ nichoId, descripcion, foto, precioClp: precio || null, unidades: unidades || 1, costoUnitarioClp: costo || null })
      setLista((l) => [candidato, ...(l ?? [])])
      setAbierto(candidato.id)
      setRecien(candidato.id)
      setFoto(null)
      setDescripcion('')
      setPrecio('')
      setUnidades('1')
      setCosto('')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(c) {
    if (!window.confirm(`¿Borrar la revisión de «${c.descripcion}»? Se borra también lo que confirmaste en ella.`)) return
    try {
      await api.borrarCandidato(c.id)
      setLista((l) => (l ?? []).filter((x) => x.id !== c.id))
      if (abierto === c.id) setAbierto(null)
    } catch (e) {
      setError(e.message)
    }
  }

  // lo que cambia dentro de la revisión (confirmar una publicación, cambiar el precio) se refleja en su ficha
  const alCambiar = (v) => {
    if (!v?.candidato) return
    setLista((l) => (l ?? []).map((x) => (x.id === v.candidato.id ? { ...x, ...v.candidato, revision: v.revision ?? x.revision } : x)))
  }
  const elAbierto = (lista ?? []).find((x) => x.id === abierto) ?? null

  return (
    <div className="s-revisar">
      <Nota>
        Antes de comprar, sube la foto del producto que te ofrece el proveedor. La comparo con las publicaciones de “{keyword}” y te digo si ya venden
        ese mismo producto, a cuánto, cuánto llevan vendido y qué da la búsqueda por la plata a la que piensas venderlo. No dice si conviene traerlo: eso lo decides tú.
      </Nota>
      <form className="s-revisar-form" onSubmit={revisar} onPaste={(e) => { const a = imagenDe(e.clipboardData?.files); if (a) { e.preventDefault(); elegirFoto(a) } }}>
        <CampoFoto foto={foto} onArchivo={elegirFoto} Icono={ImagePlus} texto="Foto del producto" ayuda="elige el archivo, arrástralo encima o pégalo con Ctrl+V" deshabilitado={guardando} />
        <Campos>
          <Campo ancho etiqueta="Qué es" ayuda="con su medida si la tiene (watts, piezas, metros): es lo que se compara">
            <input type="text" value={descripcion} maxLength={140} placeholder="por ejemplo: lámpara de mesa 300 w con sensor" onChange={(e) => setDescripcion(e.target.value)} />
          </Campo>
          <Campo etiqueta="A cuánto piensas venderlo" ayuda="el precio de la publicación">
            <input type="number" inputMode="numeric" min="1" step="1" value={precio} placeholder="15990" onChange={(e) => setPrecio(e.target.value)} />
          </Campo>
          <Campo etiqueta="Unidades que traería" ayuda="2 si piensas vender un pack de dos">
            <input type="number" inputMode="numeric" min="1" max="500" step="1" value={unidades} onChange={(e) => setUnidades(e.target.value)} />
          </Campo>
          <Campo etiqueta="Costo puesto en Chile" ayuda="por unidad; si todavía no lo sabes, déjalo vacío">
            <input type="number" inputMode="numeric" min="0" step="1" value={costo} placeholder="7000" onChange={(e) => setCosto(e.target.value)} />
          </Campo>
        </Campos>
        <div className="s-revisar-pie">
          <button type="submit" className="boton-primario" disabled={guardando || !foto || descripcion.trim().length < 3}>
            <ScanSearch size={16} aria-hidden="true" /> {guardando ? 'guardando…' : 'Revisar contra la búsqueda'}
          </button>
          <span>Mirar las fotos de la búsqueda tarda cerca de un minuto y cuesta unos centavos de dólar, que quedan anotados en el gasto del mes.</span>
        </div>
      </form>
      {error ? <Aviso tono="problema">{error}</Aviso> : null}
      {lista == null && !error ? <Cargando texto="buscando lo que ya revisaste en esta búsqueda…" /> : null}

      {lista?.length ? (
        <>
          <Subtitulo titulo="Lo que ya revisaste en esta búsqueda" cuenta={lista.length} />
          <Fichas>
            {lista.map((c) => {
              const [tono, texto] = (CASO[c.revision?.estado] ?? CASO['sin-leer'])(c.revision)
              const m = c.revision?.mismos
              return (
                <FichaFoto key={c.id} tono={abierto === c.id ? 'destacada' : undefined} foto={c.foto} titulo={c.descripcion}
                  principal={c.precioClp ? fmtPrecio(c.precioClp) : 'sin precio'} secundario={c.precioClp ? (c.unidades > 1 ? `por ${fmtNum(c.unidades)} unidades` : 'el precio que piensas') : null}
                  detalle={m ? `Desde ${fmtPrecio(m.masBaratoUnidad)} la unidad${m.vendidos > 0 ? ` · llevan al menos ${fmtNum(m.vendidos)} vendidos` : ''}.` : null}
                  etiquetas={<><Etiqueta tono={tono}>{texto}</Etiqueta><Etiqueta>subido el {fmtFechaCorta(c.creadoEl)}</Etiqueta></>}>
                  <button type="button" className="boton-secundario boton-chico" disabled={abierto === c.id} onClick={() => setAbierto(c.id)}>{abierto === c.id ? 'abierta abajo' : 'ver la revisión'}</button>
                  <button type="button" className="boton-plano boton-chico" onClick={() => borrar(c)}><Trash2 size={14} aria-hidden="true" /> borrar</button>
                </FichaFoto>
              )
            })}
          </Fichas>
        </>
      ) : null}

      {elAbierto ? (
        <>
          <Subtitulo titulo={`La revisión de «${elAbierto.descripcion}»`} />
          <QuienVendeLoMismo key={elAbierto.id} propioId={elAbierto.id} leerAlAbrir={recien === elAbierto.id} alCambiar={alCambiar} />
        </>
      ) : null}
    </div>
  )
}
