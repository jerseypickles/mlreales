// Las fotos de Mercado Libre vienen en variantes por sufijo: -O = 500 px (la que
// guardan los scans, 18-42 KB), -V = 250 px, -I = 90 px (1,7 KB; con 2X_, 180 px
// y 4,4 KB). Pintar la -O en un cuadro de 44 px obligaba al navegador a bajar y
// DECODIFICAR un bitmap de 500×500 por foto: con ~370 fotos en "Competidores por
// nicho" eran ~11 MB y la vista se arrastraba. Las miniaturas piden la -I a 2X,
// que alcanza hasta ~90 px en pantalla retina.
const ML = /^(https?:\/\/http2\.mlstatic\.com\/D_(?:N?Q_)?NP_)(?:2X_)?(.+)-[A-Z]\.(?:webp|jpe?g|png)(\?.*)?$/i

export function miniatura(url, lado = 40) {
  if (typeof url !== 'string' || !url) return null
  const segura = url.replace(/^http:/, 'https:')
  const m = ML.exec(segura)
  if (!m) return segura
  // hasta ~90 px alcanza la -I a 2X (180 px); más grande, la -V (250 px, ~10 KB)
  return lado > 90 ? `${m[1]}${m[2]}-V.webp${m[3] ?? ''}` : `${m[1]}2X_${m[2]}-I.webp${m[3] ?? ''}`
}
