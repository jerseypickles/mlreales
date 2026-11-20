// LAS PIEZAS DEL SISTEMA DE DISEÑO (11-nov-2026).
//
// Pedido del importador: «todo está desordenado, falta darle un diseño completo
// a todo, no solo una interfaz sino todo global». Medido ese día en styles.css:
// decenas de tamaños de letra, más de cien colores escritos a mano y una familia
// de estilos distinta por pantalla; cada vista armaba su propia cabecera, sus
// pestañas y sus etiquetas.
//
// Estas son las piezas que se repiten. Toda pantalla se arma con ellas, en este
// orden: cabecera (título + una línea que dice para qué sirve), hasta cuatro
// cifras de resumen, pestañas para cambiar de contenido, selector para filtrar y
// tarjetas. Sus estilos viven al final de styles.css, bajo «sistema», con el
// prefijo `s-`. Lo que una pantalla necesite y no esté acá se agrega acá, no en
// la pantalla.

import { useState } from 'react'

// Cabecera de página. `children` son las acciones de la derecha (buscador, un
// solo botón principal, estado).
export function EncabezadoPagina({ titulo, bajada, children }) {
  return (
    <div className="s-cabecera">
      <div className="s-cabecera-texto">
        <h1>{titulo}</h1>
        {bajada ? <p>{bajada}</p> : null}
      </div>
      {children ? <div className="s-cabecera-acciones">{children}</div> : null}
    </div>
  )
}

// Pestañas subrayadas: cambian de contenido dentro de la pantalla.
// opciones: [{ id, titulo, cuenta?, tono? }] · tono 'problema' pinta la cuenta en rojo
export function Pestanas({ opciones, actual, onCambiar, etiqueta }) {
  return (
    <div className="s-pestanas" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={actual === o.id} className={`s-pestana${actual === o.id ? ' activa' : ''}`} onClick={() => onCambiar(o.id)}>
          {o.titulo}
          {o.cuenta != null ? <span className={`s-cuenta${o.tono ? ` s-${o.tono}` : ''}`}>{o.cuenta}</span> : null}
        </button>
      ))}
    </div>
  )
}

// Selector segmentado: filtra lo que ya se está viendo.
export function Selector({ opciones, actual, onCambiar, etiqueta }) {
  return (
    <div className="s-selector" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={actual === o.id} className={actual === o.id ? 'activa' : ''} onClick={() => onCambiar(o.id)}>
          {o.titulo}
          {o.cuenta != null ? <span className="s-cuenta">{o.cuenta}</span> : null}
        </button>
      ))}
    </div>
  )
}

// Una cifra de resumen: qué mide, el número y de dónde sale o contra qué se compara. `children` es lo que cambia
// con esa cifra cuando es una opción entre varias (etiquetas y una lectura en palabras): va debajo, separado.
export function Cifra({ etiqueta, valor, detalle, tono, title, children }) {
  return (
    <div className="s-cifra" title={title}>
      <span className="s-cifra-etiqueta">{etiqueta}</span>
      <strong className={tono ? `s-${tono}` : undefined}>{valor}</strong>
      {detalle ? <span className="s-cifra-detalle">{detalle}</span> : null}
      {children ? <div className="s-cifra-extra">{children}</div> : null}
    </div>
  )
}

// La fila de cifras de una pantalla (hasta cuatro).
export function Cifras({ children }) {
  return <div className="s-cifras">{children}</div>
}

// Etiqueta de estado. Cinco tonos y nada más: neutra, bien, atencion, problema, destacada.
export function Etiqueta({ tono = 'neutra', children, title }) {
  return <span className={`s-etiqueta s-etiqueta-${tono}`} title={title}>{children}</span>
}

// Aviso de una línea: qué pasa y, al lado, qué hacer. `accion` es un botón o enlace.
export function Aviso({ tono = 'atencion', Icono, titulo, children, accion }) {
  return (
    <div className={`s-aviso s-aviso-${tono}`} role="status">
      {Icono ? <Icono size={18} aria-hidden="true" /> : null}
      <span className="s-aviso-texto">{titulo ? <strong>{titulo} </strong> : null}{children}</span>
      {accion ?? null}
    </div>
  )
}

// Tarjeta base: borde, esquinas y aire iguales en toda la app.
export function Tarjeta({ as: Como = 'section', className = '', children, ...resto }) {
  return <Como className={`s-tarjeta${className ? ` ${className}` : ''}`} {...resto}>{children}</Como>
}

// Barra partida: de un total, cuánto es cada parte (fracciones de 0 a 1). La leyenda
// repite cada parte con su número, así el color nunca es lo único que informa.
// `children` es la lectura de una línea que va debajo.
// La leyenda es la que explica: una línea por parte, con su número primero y su nombre en palabras completas
// (un color solo no dice nada). `formato` escribe el número (por defecto, porcentaje); `ayuda` es la explicación
// larga de una parte, al pasar el cursor.
// partes: [{ id, titulo, valor, tono, ayuda? }] · tonos: bien, atencion, problema, destacada, neutra
export function BarraPartes({ titulo, fuente, partes, formato = (v) => `${Math.round(v * 100)}%`, children }) {
  return (
    <div className="s-partes">
      {titulo ? <div className="s-partes-cabeza"><span>{titulo}</span>{fuente ? <small>{fuente}</small> : null}</div> : null}
      <div className="s-partes-barra" role="img" aria-label={partes.map((x) => `${formato(x.valor)} ${x.titulo}`).join(', ')}>
        {partes.filter((x) => x.valor > 0).map((x) => <i key={x.id} className={`s-partes-${x.tono ?? 'neutra'}`} style={{ flexGrow: x.valor }} />)}
      </div>
      <ul className="s-partes-leyenda">
        {partes.map((x) => <li key={x.id} title={x.ayuda}><i className={`s-partes-${x.tono ?? 'neutra'}`} aria-hidden="true" /><b>{formato(x.valor)}</b><span>{x.titulo}</span></li>)}
      </ul>
      {children ? <p className="s-partes-lectura">{children}</p> : null}
    </div>
  )
}

// Regla de precios: dónde cae un precio entre los de otros. Cada precio ajeno es una rayita sobre la línea y las
// marcas (el propio de hoy, los que se están mirando) van encima, más altas y con su color. La leyenda repite cada
// marca con su número y su nombre: la posición en la línea nunca es lo único que informa. Los precios más altos (uno
// de cada diez) se juntan en el borde derecho, para que uno solo no aplaste a todos los demás contra la izquierda.
// puntos: [número] · marcas: [{ id, valor, titulo, tono? }] · tonos: destacada, bien, atencion, problema, neutra
// `children` es la lectura de una línea que va debajo.
export function ReglaPrecios({ titulo, fuente, puntos = [], marcas = [], formato = (v) => String(v), children }) {
  const precios = puntos.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  const visibles = marcas.filter((m) => Number.isFinite(m.valor) && m.valor > 0)
  if (!precios.length && !visibles.length) return null
  const valores = visibles.map((m) => m.valor)
  const desde = Math.min(precios[0] ?? Infinity, ...valores)
  const hasta = Math.max(precios.length ? precios[Math.floor((precios.length - 1) * 0.9)] : 0, ...valores, desde + 1)
  const x = (v) => `${Math.min(100, Math.max(0, ((v - desde) / (hasta - desde)) * 100))}%`
  const fuera = precios.filter((p) => p > hasta).length
  return (
    <div className="s-regla">
      {titulo ? <div className="s-partes-cabeza"><span>{titulo}</span>{fuente ? <small>{fuente}</small> : null}</div> : null}
      <div className="s-regla-pista" role="img" aria-label={[`${precios.length} precios, de ${formato(desde)} a ${formato(hasta)}`, ...visibles.map((m) => `${formato(m.valor)} ${m.titulo}`)].join(', ')}>
        {precios.map((p, i) => <i key={i} style={{ left: x(p) }} />)}
        {visibles.map((m) => <b key={m.id} className={`s-partes-${m.tono ?? 'destacada'}`} style={{ left: x(m.valor) }} />)}
      </div>
      <div className="s-regla-extremos"><span>{formato(desde)}</span><span>{formato(hasta)}{fuera ? ' o más' : ''}</span></div>
      <ul className="s-partes-leyenda">
        {visibles.map((m) => <li key={m.id}><i className={`s-partes-${m.tono ?? 'destacada'}`} aria-hidden="true" /><b>{formato(m.valor)}</b><span>{m.titulo}</span></li>)}
      </ul>
      {children ? <p className="s-partes-lectura">{children}</p> : null}
    </div>
  )
}

// Lista de pendientes: qué falta, uno por línea, con cuánto lleva si se puede medir.
// `resumen` va a la derecha del título (una etiqueta, una cifra); `children` es la nota del pie.
// items: [{ id, Icono?, titulo, detalle?, avance? (0 a 1) }]
export function Pendientes({ titulo, resumen, items, children }) {
  return (
    <div className="s-pendientes">
      <div className="s-pendientes-cabeza"><span>{titulo}</span>{resumen ?? null}</div>
      {items.length ? (
        <ul>
          {items.map(({ id, Icono, titulo: nombre, detalle, avance }) => (
            <li key={id}>
              {Icono ? <Icono size={16} aria-hidden="true" /> : null}
              <span className="s-pendientes-texto"><strong>{nombre}</strong>{detalle ? <small>{detalle}</small> : null}</span>
              {Number.isFinite(avance) && avance > 0 ? (
                <span className="s-pendientes-avance" title={`Lleva ${Math.round(avance * 100)}%`}><i><i style={{ width: `${Math.round(avance * 100)}%` }} /></i><b>{Math.round(avance * 100)}%</b></span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {children ? <p className="s-pendientes-pie">{children}</p> : null}
    </div>
  )
}

// Preguntas con su respuesta: una decisión partida en las preguntas que la arman, cada una con lo que salió (una
// etiqueta de dos o tres palabras) y la frase que lo explica. El tono repite lo que dice la etiqueta.
// items: [{ id, pregunta, respuesta, tono, frase }] · tonos: bien, atencion, problema, neutra
export function Preguntas({ items }) {
  return (
    <ul className="s-preguntas">
      {items.map(({ id, pregunta, respuesta, tono = 'neutra', frase }) => (
        <li key={id} className={`s-pregunta s-pregunta-${tono}`}>
          <span className="s-pregunta-cabeza"><strong>{pregunta}</strong><Etiqueta tono={tono}>{respuesta}</Etiqueta></span>
          {frase ? <span className="s-pregunta-frase">{frase}</span> : null}
        </li>
      ))}
    </ul>
  )
}

// Título de un bloque dentro de una tarjeta o sección, con su cuenta y, a la derecha, una acción o una nota.
export function Subtitulo({ titulo, cuenta, children }) {
  return (
    <div className="s-subtitulo">
      <h3>{titulo}{cuenta != null ? <span className="s-cuenta">{cuenta}</span> : null}</h3>
      {children ? <div className="s-subtitulo-lado">{children}</div> : null}
    </div>
  )
}

// La grilla de fichas con foto.
export function Fichas({ children }) {
  return <div className="s-fichas">{children}</div>
}

// Ficha con foto: una publicación para mirarla y decidir algo. La foto manda —el producto se reconoce por ella—;
// al lado van el dato principal (y uno secundario), el título y una línea de detalle. Abajo, a todo el ancho de la
// ficha, las etiquetas, su serie en el tiempo (`grafico`) y las acciones (`children`): al lado de la foto se apilaban
// de a una por línea y la ficha quedaba el doble de alta. `tono` 'destacada' marca la propia.
export function FichaFoto({ foto, enlace, titulo, principal, secundario, detalle, etiquetas, grafico, tono, children }) {
  const imagen = foto ? <img src={foto} alt="" loading="lazy" width="96" height="96" /> : null
  return (
    <div className={`s-ficha${tono ? ` s-ficha-${tono}` : ''}`}>
      <div className="s-ficha-cabeza">
        {enlace ? <a className="s-ficha-foto" href={enlace} target="_blank" rel="noreferrer" title="Abrir la publicación">{imagen}</a> : <span className="s-ficha-foto">{imagen}</span>}
        <div className="s-ficha-datos">
          <div className="s-ficha-precio"><strong>{principal}</strong>{secundario ? <span>{secundario}</span> : null}</div>
          {titulo ? <p className="s-ficha-titulo" title={titulo}>{titulo}</p> : null}
          {detalle ? <p className="s-ficha-detalle">{detalle}</p> : null}
        </div>
      </div>
      {etiquetas ? <div className="s-ficha-etiquetas">{etiquetas}</div> : null}
      {grafico ? <div className="s-ficha-grafico">{grafico}</div> : null}
      {children ? <div className="s-ficha-acciones">{children}</div> : null}
    </div>
  )
}

// Un número corto que se escribe en la misma línea: «trae [2] unidades». Avisa el valor al salir del campo o con Enter;
// un campo vacío no avisa nada. `largo` deja espacio para una cifra de plata.
export function CampoNumero({ antes, despues, valor, onCambiar, min = 1, max = 500, deshabilitado = false, largo = false }) {
  return (
    <label className={`s-campo-numero${largo ? ' s-campo-numero-largo' : ''}`}>
      {antes ? <span>{antes}</span> : null}
      <input type="number" inputMode="numeric" min={min} max={max} defaultValue={valor} key={valor} disabled={deshabilitado}
        onBlur={(e) => { if (e.target.value === '') return; const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max && n !== valor) onCambiar(n) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      {despues ? <span>{despues}</span> : null}
    </label>
  )
}

// Un campo de formulario: su nombre arriba, el control y, si hace falta, una ayuda corta debajo. `ancho` lo deja
// ocupar la fila entera. Varios juntos van dentro de <Campos>.
export function Campo({ etiqueta, ayuda, ancho = false, children }) {
  return (
    <label className={`s-campo${ancho ? ' s-campo-ancho' : ''}`}>
      <span>{etiqueta}</span>
      {children}
      {ayuda ? <small>{ayuda}</small> : null}
    </label>
  )
}
export function Campos({ children }) {
  return <div className="s-campos">{children}</div>
}

// Campo para una foto: se elige el archivo, se arrastra encima o se pega con Ctrl+V. `foto` es la imagen ya
// elegida (una dirección o un data URL) y se muestra en chico; `onArchivo` recibe el archivo tal como viene, para
// que la pantalla lo achique antes de subirlo.
export function CampoFoto({ foto, onArchivo, Icono, texto = 'Elegir una foto', ayuda, deshabilitado = false }) {
  const [encima, setEncima] = useState(false)
  const tomar = (archivos) => { const a = [...(archivos ?? [])].find((x) => String(x.type ?? '').startsWith('image/')); if (a && !deshabilitado) onArchivo(a) }
  return (
    <label className={`s-campo-foto${encima ? ' s-campo-foto-encima' : ''}`} tabIndex={0}
      onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); tomar(e.dataTransfer.files) }} onPaste={(e) => tomar(e.clipboardData?.files)}>
      <input type="file" accept="image/*" disabled={deshabilitado} onChange={(e) => { tomar(e.target.files); e.target.value = '' }} />
      <span className="s-campo-foto-imagen">{foto ? <img src={foto} alt="" /> : Icono ? <Icono size={24} aria-hidden="true" /> : null}</span>
      <span className="s-campo-foto-texto"><strong>{foto ? 'Cambiar la foto' : texto}</strong>{ayuda ? <small>{ayuda}</small> : null}</span>
    </label>
  )
}

// Antes y después de un cambio, en plata: dos barras que salen de un mismo cero (a la derecha lo que dejó, a la
// izquierda lo que perdió), cada una con su número. El color repite el signo, no lo reemplaza.
export function AntesDespues({ antes, despues, formato = (v) => String(v), etiquetas = ['antes', 'después'] }) {
  const tope = Math.max(Math.abs(antes ?? 0), Math.abs(despues ?? 0), 1)
  const fila = (nombre, v) => (
    <div className="s-ad-fila">
      <span>{nombre}</span>
      <span className="s-ad-barra" aria-hidden="true">{Number.isFinite(v) ? <i className={v < 0 ? 's-ad-menos' : 's-ad-mas'} style={{ width: `${(Math.abs(v) / tope) * 50}%`, [v < 0 ? 'right' : 'left']: '50%' }} /> : null}</span>
      <b className={Number.isFinite(v) && v < 0 ? 's-problema' : undefined}>{Number.isFinite(v) ? formato(v) : '—'}</b>
    </div>
  )
  return <div className="s-ad">{fila(etiquetas[0], antes)}{fila(etiquetas[1], despues)}</div>
}

// Una línea de ayuda o de lectura bajo un bloque. `centrada` para el pie con un botón.
export function Nota({ children, centrada = false }) {
  return <p className={`s-nota${centrada ? ' s-nota-centrada' : ''}`}>{children}</p>
}

// Una fila de acciones sobre un bloque (confirmar varias cosas de una vez), con una aclaración corta al lado.
export function Acciones({ children }) {
  return <div className="s-acciones">{children}</div>
}

// Nivel: cuánto hay de algo contra un tope (los días que alcanza el stock contra los que se quieren tener). La
// barra dice el tamaño de un vistazo; el número y la frase van al lado. `extra` es lo que se suma más claro (lo
// que viene en camino). `tono` repite lo que ya dice el texto: bien, atencion, problema, destacada, neutra.
export function Nivel({ fraccion, extra = 0, tono = 'neutra', title }) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraccion) ? fraccion : 0))
  const x = Math.min(1 - f, Math.max(0, Number.isFinite(extra) ? extra : 0))
  return (
    <span className="s-nivel" title={title} aria-hidden="true">
      {f > 0 ? <i className={`s-partes-${tono}`} style={{ width: `${f * 100}%` }} /> : null}
      {x > 0 ? <i className="s-nivel-extra" style={{ width: `${x * 100}%` }} /> : null}
    </span>
  )
}

// Un dato dentro de una fila o de una tarjeta chica: el número (o la palabra) y, debajo, de dónde sale o qué
// significa. `children` va entre los dos (una barra, una etiqueta).
export function Dato({ valor, detalle, tono, children }) {
  return (
    <div className="s-dato">
      {valor != null ? <strong className={tono ? `s-${tono}` : undefined}>{valor}</strong> : null}
      {children}
      {detalle ? <small>{detalle}</small> : null}
    </div>
  )
}

// Filas para comparar varias cosas del mismo tipo (los colores de un producto) en columnas alineadas: arriba los
// nombres de las columnas, una fila por cosa. En pantallas angostas cada fila se vuelve una tarjeta y cada dato
// lleva el nombre de su columna encima. `tono` marca el borde de la fila; lo que dice lo dice el texto de adentro.
// columnas: [{ id, titulo, ancho?, ancha? }] · <Fila celdas={{ [id]: contenido }} /> · `ancha`: en angosto ocupa
// la fila entera y va sin su nombre encima (la columna que dice de qué cosa es la fila)
export function Filas({ columnas, children }) {
  return (
    <div className="s-filas" style={{ '--s-filas-columnas': columnas.map((c) => c.ancho ?? 'minmax(0, 1fr)').join(' ') }} role="table">
      <div className="s-filas-cabeza" role="row">{columnas.map((c) => <span key={c.id} role="columnheader">{c.titulo}</span>)}</div>
      {children}
    </div>
  )
}
export function Fila({ columnas, celdas, tono }) {
  return (
    <div className={`s-fila${tono ? ` s-fila-${tono}` : ''}`} role="row">
      {columnas.map((c) => <div key={c.id} className={`s-fila-celda${c.ancha ? ' s-fila-celda-ancha' : ''}`} role="cell" data-titulo={c.titulo}>{celdas[c.id] ?? null}</div>)}
    </div>
  )
}
