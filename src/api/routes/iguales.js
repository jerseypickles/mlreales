import { Router } from 'express'

// QUIÉN VENDE LO MISMO (services/iguales.js). Va en su propia ruta y no bajo
// /api/propios a propósito: las respuestas guardadas de Mis productos y del
// plan de campañas se invalidan con cualquier escritura en /api/propios, y
// marcar una publicación como «es el mismo» no cambia ninguna de las dos. El
// dueño marca veinte seguidas; cada una habría mandado a rearmar todo.
const router = Router()
// los errores con `status` (dato inválido, presupuesto agotado) responden con su código; el resto, al manejador general
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => (e?.status ? res.status(e.status).json({ error: e.message }) : next(e)))
// El `:id` es una publicación propia o un producto que todavía no se compra (services/revisionCompra.js): para
// todo lo de acá son lo mismo, una foto que se compara con el último scan de su nicho.
const propioDe = async (req, res) => {
  const { propioDe: buscar } = await import('../../services/revisionCompra.js')
  const propio = await buscar(req.params.id).catch(() => null)
  if (!propio) res.status(404).json({ error: 'producto no encontrado' })
  return propio
}

// el precio de cada publicación propia contra los que venden lo mismo, en una línea por producto (lo usa
// Publicidad). Va antes de `/:id`: si no, «resumen» se leería como el id de un producto
router.get(
  '/resumen',
  manejar(async (_req, res) => {
    const { posicionesDePrecio } = await import('../../services/iguales.js')
    res.json({ productos: await posicionesDePrecio() })
  }),
)

// REVISAR UN PRODUCTO ANTES DE TRAERLO. Van antes de `/:id` por lo mismo que «resumen».
// los productos por revisar de un nicho, cada uno con su foto y la lectura de su revisión
router.get(
  '/candidatos',
  manejar(async (req, res) => {
    const { candidatosDeNicho } = await import('../../services/revisionCompra.js')
    res.json({ candidatos: await candidatosDeNicho(req.query.nichoId) })
  }),
)
// { nichoId, descripcion, foto (imagen en data URL), precioClp?, unidades?, costoUnitarioClp? }. Solo lo guarda: las
// fotos de la búsqueda se miran después, con `POST /:id/sugerir`, igual que para una publicación propia
router.post(
  '/candidatos',
  manejar(async (req, res) => {
    const { crearCandidato, candidatoParaLista } = await import('../../services/revisionCompra.js')
    res.status(201).json({ candidato: candidatoParaLista(await crearCandidato(req.body ?? {})) })
  }),
)
// { descripcion?, precioClp?, unidades?, costoUnitarioClp? } y devuelve la vista con el cambio
router.patch(
  '/candidatos/:id',
  manejar(async (req, res) => {
    const { cambiarCandidato, propioDeCandidato, vistaDe } = await import('../../services/revisionCompra.js')
    res.json(await vistaDe(propioDeCandidato(await cambiarCandidato(req.params.id, req.body ?? {}))))
  }),
)
router.delete(
  '/candidatos/:id',
  manejar(async (req, res) => {
    const { borrarCandidato } = await import('../../services/revisionCompra.js')
    await borrarCandidato(req.params.id)
    res.json({ ok: true })
  }),
)

// la vista: los confirmados con su precio por unidad, lo que falta revisar y lo descartado
router.get(
  '/:id',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { vistaDe } = await import('../../services/revisionCompra.js')
    res.json(await vistaDe(propio))
  }),
)

// { sku, relacion: 'igual' | 'otra-medida' | 'distinto' | null, unidades } marca una publicación ajena;
// { lote: 'igual' | 'otra-medida' } confirma de una vez todo lo que la lectura propone con esa relación;
// { unidadesPropias } dice cuántas unidades trae la publicación propia
router.patch(
  '/:id',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { marcarIgual, marcarLote } = await import('../../services/iguales.js')
    const { fijarUnidades, vistaDe } = await import('../../services/revisionCompra.js')
    const b = req.body ?? {}
    if (b.unidadesPropias != null) await fijarUnidades(propio, Number(b.unidadesPropias))
    if (b.lote) await marcarLote(propio, b.lote)
    if (b.sku) await marcarIgual(propio, { sku: b.sku, relacion: b.relacion ?? null, unidades: b.unidades != null ? Number(b.unidades) : null })
    res.json(await vistaDe(await propioDe(req, res)))
  }),
)

// mira las fotos de lo que falta revisar y deja sugerencias (no marca nada)
router.post(
  '/:id/sugerir',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { sugerirIguales } = await import('../../services/iguales.js')
    const { vistaDe } = await import('../../services/revisionCompra.js')
    const lectura = await sugerirIguales(propio)
    res.json({ ...(await vistaDe(propio)), lectura })
  }),
)

// trae ahora los más vendidos de la categoría y marca de la publicación (cuesta una página de listado; una vez al día)
// y devuelve la vista con esas publicaciones sumadas a lo que falta revisar
router.post(
  '/:id/ranking',
  manejar(async (req, res) => {
    const propio = await propioDe(req, res)
    if (!propio) return
    const { traerRankingDe } = await import('../../services/rankingPropio.js')
    const { vistaDe } = await import('../../services/revisionCompra.js')
    const lecturaRanking = await traerRankingDe(propio)
    // se vuelve a leer la publicación: la marca pudo quedar anotada recién
    res.json({ ...(await vistaDe(await propioDe(req, res))), lecturaRanking })
  }),
)

export default router
