// Las fotos de Mercado Libre vienen en variantes por sufijo: -O = 500 px (la que
// guardan los scans, 18-42 KB), -V = 250 px, -I = 90 px (1,7 KB; con 2X_, 180 px
// y 4,4 KB). Pintar la -O en un cuadro de 44 px obligaba al navegador a bajar y
// DECODIFICAR un bitmap de 500×500 por foto: con ~370 fotos en "Competidores por
// nicho" eran ~11 MB y la vista se arrastraba. Las miniaturas piden la -I a 2X,
// que alcanza hasta ~90 px en pantalla retina.
const ML = /^(https?:\/\/http2\.mlstatic\.com\/D_(?:N?Q_)?NP_)(?:2X_)?(.+)-[A-Z]\.(?:webp|jpe?g|png)(\?.*)?$/i

export function miniatura(url) {
  if (typeof url !== 'string' || !url) return null
  const segura = url.replace(/^http:/, 'https:')
  const m = ML.exec(segura)
  return m ? `${m[1]}2X_${m[2]}-I.webp${m[3] ?? ''}` : segura
}
