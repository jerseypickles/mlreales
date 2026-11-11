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

// Una cifra de resumen: qué mide, el número y de dónde sale o contra qué se compara.
export function Cifra({ etiqueta, valor, detalle, tono, title }) {
  return (
    <div className="s-cifra" title={title}>
      <span className="s-cifra-etiqueta">{etiqueta}</span>
      <strong className={tono ? `s-${tono}` : undefined}>{valor}</strong>
      {detalle ? <span className="s-cifra-detalle">{detalle}</span> : null}
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
