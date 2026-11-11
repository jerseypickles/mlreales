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
