import { useState } from 'react'
import { api } from '../api.js'

// LA FAMILIA DE BÚSQUEDA, dentro del nicho.
//
// El scorecard describe el listado que devuelve ESTA búsqueda. Si la keyword
// no es la que la gente escribe, todo lo demás mide otro escaparate. Acá se ve
// la familia completa —lo que ML sugiere alrededor del producto, en orden de
// volumen— para elegir la palabra clara mirando, no adivinando; y los nichos
// del tablero que miden este mismo mercado, para poder limpiarlos sin salir.

const NIVELES = {
  alto: { texto: 'búsqueda alta', clase: 'nb-alto' },
  medio: { texto: 'búsqueda media', clase: 'nb-medio' },
  bajo: { texto: 'cola larga', clase: 'nb-bajo' },
  renombrar: { texto: 'keyword mal escrita', clase: 'nb-renombrar' },
  nulo: { texto: 'nadie la busca', clase: 'nb-nulo' },
}

function FilaFamilia({ b, keyword, onMedir, midiendo }) {
  const esLaDelNicho = b.q === keyword
  return (
    <li className={esLaDelNicho ? 'fam-busqueda es-esta' : 'fam-busqueda'}>
      <span className="fam-pos">#{b.posicion}</span>
      <span className="fam-q">{b.q}</span>
      {esLaDelNicho ? (
        <span className="fam-marca">← la de este nicho</span>
      ) : (
        <button className="fam-medir" disabled={midiendo} onClick={() => onMedir(b.q)}>
          medir esta
        </button>
      )}
    </li>
  )
}

export function Busqueda({ keyword, nivelBusqueda, familia, onNichoCreado, onAbrirNicho }) {
  const [midiendo, setMidiendo] = useState(null)
  const [error, setError] = useState(null)

  if (!nivelBusqueda?.nivel) {
    return (
      <section className="busqueda-panel">
        <h3>Familia de búsqueda</h3>
        <p className="vacio">
          Todavía sin medir. El sistema pregunta al autocompletado de Mercado Libre si la gente escribe esta
          keyword; corre solo cada mañana, o puedes lanzarlo desde el botón del panel de nichos.
        </p>
      </section>
    )
  }

  const info = NIVELES[nivelBusqueda.nivel] ?? NIVELES.medio

  async function medir(kw) {
    setMidiendo(kw)
    setError(null)
    try {
      const { nicho } = await api.crearNicho(kw)
      onNichoCreado?.()
      onAbrirNicho?.(nicho._id)
    } catch (err) {
      setError(/ya existe/i.test(err.message) ? `"${kw}" ya está en el tablero` : err.message)
    } finally {
      setMidiendo(null)
    }
  }

  return (
    <section className="busqueda-panel">
      <div className="busqueda-cab">
        <h3>Familia de búsqueda</h3>
        <span className={`chip-busqueda ${info.clase}`}>{info.texto}</span>
      </div>
      <p className="busqueda-explica">{nivelBusqueda.explicacion}</p>

      {nivelBusqueda.nivel === 'renombrar' && nivelBusqueda.keywordSugerida ? (
        <div className="busqueda-arreglo">
          <span>
            Esta keyword no existe en el autocompletado. La búsqueda real del producto es{' '}
            <strong>{nivelBusqueda.keywordSugerida}</strong>.
          </span>
          <button
            className="boton-secundario boton-chico"
            disabled={midiendo === nivelBusqueda.keywordSugerida}
            onClick={() => medir(nivelBusqueda.keywordSugerida)}
          >
            {midiendo === nivelBusqueda.keywordSugerida ? 'Creando…' : 'Medir la búsqueda real →'}
          </button>
        </div>
      ) : null}

      {error ? <p className="error-inline">{error}</p> : null}

      {nivelBusqueda.familia?.length ? (
        <>
          <p className="dato-label">
            Lo que la gente escribe con “{nivelBusqueda.cabeza ?? nivelBusqueda.prefijo}”, por volumen
          </p>
          <p className="fam-aviso">
            Ojo: es todo lo que empieza con esa palabra, no productos equivalentes. Bajo “quitasol” conviven
            la sombrilla de playa y el parasol de auto — mira cuál de estas líneas es realmente tu producto
            antes de medir una.
          </p>
          <ul className="fam-lista">
            {nivelBusqueda.familia.map((b) => (
              <FilaFamilia
                key={b.q}
                b={b}
                keyword={keyword}
                onMedir={medir}
                midiendo={Boolean(midiendo)}
              />
            ))}
          </ul>
          <p className="nota">
            El orden ES el dato: el autocompletado lista por volumen real de búsquedas. La de más arriba es la
            puerta más grande del producto.
          </p>
        </>
      ) : null}

      {familia?.miembros?.length > 1 ? (
        <>
          <p className="dato-label">
            Nichos del tablero que miden este mismo mercado{' '}
            {familia.esLider ? '(este lidera)' : `(lidera “${familia.lider}”)`}
          </p>
          <ul className="fam-nichos">
            {familia.miembros.map((m) => (
              <li key={m.keyword} className={m.esEste ? 'es-esta' : undefined}>
                <button
                  className="enlace-boton"
                  onClick={() => m.id && !m.esEste && onAbrirNicho?.(m.id)}
                  disabled={m.esEste || !m.id}
                >
                  {m.keyword}
                </button>
                {m.nivel ? (
                  <span className={`chip-busqueda ${NIVELES[m.nivel]?.clase ?? ''}`} title={m.explicacion ?? ''}>
                    {NIVELES[m.nivel]?.texto ?? m.nivel}
                  </span>
                ) : (
                  <span className="fam-sinmedir">sin medir</span>
                )}
                <span className="fam-meta">
                  score {m.score ?? '—'}
                  {m.estado === 'pausado' ? ' · pausado' : ''}
                  {m.solapePct != null ? ` · ${m.solapePct}% del top compartido` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="nota">
            Miden lo mismo y se pagan por separado. Conviene dejar vivo el de la búsqueda más clara y pausar
            los demás — pausar es reversible y conserva todo el historial.
          </p>
        </>
      ) : null}
    </section>
  )
}
