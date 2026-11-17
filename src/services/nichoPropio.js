import { ProductoPropio } from '../models/ProductoPropio.js'
import { FILTRO_VIGENTES } from '../../frontend/src/lib/catalogoPropios.js'

// ¿EL DUEÑO VENDE EN ESTE NICHO? (17-nov-2026)
//
// Un nicho con veredicto «no entrar» se pausa solo y deja de medirse: es la
// regla para no gastar scans en algo que no conviene importar. Pero el veredicto
// habla de importar MÁS, no de lo que ya está publicado. Medido ese día: un
// producto propio con stock tenía su nicho pausado hacía casi dos meses, y todo
// lo que se le mostraba al dueño de su competencia (su gama, quién vende lo
// mismo) salía de ese último scan. Reactivarlo a mano no bastaba: el análisis
// siguiente lo volvía a pausar.
//
// Donde hay una publicación propia vigente, la búsqueda se sigue midiendo. Va al
// ritmo semanal de cualquier nicho ya medido, que es lo que pidió el dueño: «los
// vendemos, no es necesario un scan diario, es mejor algo semanal no más».
export async function seVendeEn(nichoId) {
  if (!nichoId) return false
  return !!(await ProductoPropio.exists({ nichoId, estado: 'activo', ...FILTRO_VIGENTES }))
}
