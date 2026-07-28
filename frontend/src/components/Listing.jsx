import { useState } from 'react'
import { api } from '../api.js'
import { Badge } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

export function BotonCopiar({ texto, etiqueta = 'Copiar' }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1600)
    } catch {
      /* clipboard bloqueado: nada que hacer */
    }
  }
  return (
    <button type="button" className="copiar" onClick={copiar}>
      {copiado ? 'Copiado ✓' : etiqueta}
    </button>
  )
}

export function Listing({ nichoId, listingInicial }) {
  const [listing, setListing] = useState(listingInicial ?? null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState(null)

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const { listing: nuevo } = await api.generarListing(nichoId)
      setListing(nuevo)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerando(false)
    }
  }

  if (!listing) {
    return (
      <div className="analisis-vacio">
        <p className="vacio">
          Genera el borrador del listing con IA: 3 títulos de máximo 60 caracteres armados con las
          búsquedas reales y el vocabulario de los que ya rankean, ficha técnica, descripción lista
          para pegar, plan de fotos y checklist de publicación.
        </p>
        <button className="boton-primario" onClick={generar} disabled={generando}>
          {generando ? 'Generando… (30-90 s)' : 'Generar listing'}
        </button>
        {error ? <p className="error-bloque">{error}</p> : null}
      </div>
    )
  }

  const fichaTexto = (listing.atributos ?? []).map((a) => `${a.nombre}: ${a.valor}`).join('\n')

  return (
    <div className="listing">
      <div className="analisis-encabezado">
        <div className="analisis-veredicto">
          <Badge tipo="oficial">BORRADOR DE LISTING</Badge>
          <span className="analisis-confianza">generado {fmtFecha(listing.generadoEl)}</span>
        </div>
        <button className="boton-secundario" onClick={generar} disabled={generando}>
          {generando ? 'Generando…' : 'Regenerar'}
        </button>
      </div>
      {error ? <p className="error-bloque">{error}</p> : null}

      <section>
        <h3>Títulos (elige uno, máx. 60 caracteres)</h3>
        <div className="listing-titulos">
          {(listing.titulos ?? []).map((t, i) => (
            <div className="listing-titulo" key={i}>
              <span className="listing-titulo-texto">{t}</span>
              <span className={t.length > 60 ? 'contador excedido' : 'contador'}>{t.length}/60</span>
              <BotonCopiar texto={t} />
            </div>
          ))}
        </div>
      </section>

      <div className="decision-datos listing-datos">
        <div>
          <span className="dato-label">Categoría sugerida</span>
          <span className="tile-texto">{listing.categoriaSugerida}</span>
        </div>
        <div>
          <span className="dato-label">Precio de publicación</span>
          <span className="dato-valor">{fmtPrecio(listing.precioVentaClp)}</span>
        </div>
        <div>
          <span className="dato-label">Tipo de publicación</span>
          <span className="tile-texto sin-corte">{listing.tipoPublicacion?.tipo === 'premium' ? 'Premium' : 'Clásica'}</span>
        </div>
      </div>
      {listing.tipoPublicacion?.razon ? <p className="vacio listing-razon">{listing.tipoPublicacion.razon}</p> : null}

      <section className="fila-2col">
        <div>
          <div className="listing-seccion-encabezado">
            <h3>Ficha técnica</h3>
            <BotonCopiar texto={fichaTexto} etiqueta="Copiar ficha" />
          </div>
          <div className="tabla-envoltura">
            <table>
              <tbody>
                {(listing.atributos ?? []).map((a) => (
                  <tr key={a.nombre}>
                    <td className="celda-secundaria sin-corte">{a.nombre}</td>
                    <td>{a.valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section>
            <h3>Keywords secundarias (van en la descripción)</h3>
            <div className="chips listing-chips">
              {(listing.keywordsSecundarias ?? []).map((k) => (
                <span className="chip" key={k}>
                  {k}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div>
          <div className="listing-seccion-encabezado">
            <h3>Descripción</h3>
            <BotonCopiar texto={listing.descripcion ?? ''} etiqueta="Copiar descripción" />
          </div>
          <pre className="listing-descripcion">{listing.descripcion}</pre>
        </div>
      </section>

      <section className="fila-2col">
        <div>
          <h3>Bullets destacados</h3>
          <ul className="lista-riesgos">
            {(listing.bullets ?? []).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Plan de fotos (en orden)</h3>
          <ol className="lista-riesgos">
            {(listing.fotos ?? []).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </div>
      </section>

      <section>
        <h3>Checklist antes de publicar</h3>
        <ul className="lista-riesgos">
          {(listing.checklist ?? []).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
