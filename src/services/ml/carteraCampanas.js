import { publicacionVigente } from '../../../frontend/src/lib/catalogoPropios.js'
import { normalizarStockPropio } from '../stockPropio.js'

const ARRANQUE = new Set(['arrancar', 'arrancar-con-cuidado'])
const SUMA = (xs) => xs.length && xs.every(Number.isFinite) ? xs.reduce((a, b) => a + b, 0) : null
const MAX = (xs) => xs.length && xs.every(Number.isFinite) ? Math.max(...xs) : null

// El stock limita la recomendación aunque Product Ads todavía muestre el anuncio activo.
export function disponibilidadPublicidad(propio, anuncio, { ahora = new Date(), dias = [] } = {}) {
  const p = normalizarStockPropio(propio)
  const ultima = p.mediciones?.at(-1)
  const fecha = p.ultimoScanEl ?? ultima?.fecha ?? null
  const stock = p.envioMl?.logistica === 'fulfillment' ? p.inventarioFull?.disponible : ultima?.stock
  const stockConocido = Number.isFinite(stock) ? stock : null
  const edad = fecha ? +ahora - +new Date(fecha) : Infinity
  const ultimos = dias.slice(-7)
  const ritmo = ultimos.length ? ultimos.reduce((s, d) => s + (d.unidades ?? 0), 0) / ultimos.length : null
  const cobertura = stockConocido != null && ritmo > 0 ? Math.round(stockConocido / ritmo * 10) / 10 : null
  let estado = 'disponible', motivo = 'Con stock para anunciar'
  if (!publicacionVigente(p)) { estado = 'finalizada'; motivo = 'Publicación finalizada' }
  else if (stockConocido === 0) { estado = 'sin-stock'; motivo = 'Sin stock disponible' }
  else if (p.estadoMl && p.estadoMl !== 'active') { estado = 'pausada'; motivo = 'Publicación pausada o no disponible' }
  else if (['hold', 'delegated', 'revoked'].includes(anuncio?.estado)) { estado = 'retenida'; motivo = 'ML mantiene el anuncio detenido o sin gestión disponible; revisar su estado' }
  else if (stockConocido == null || !p.estadoMl || !Number.isFinite(edad) || edad > 48 * 3600e3) { estado = 'sin-dato'; motivo = 'Falta una lectura reciente del stock y estado' }
  return { estado, motivo, stock: stockConocido, fecha, diasCobertura: cobertura, disponible: estado === 'disponible', logistica: p.envioMl?.logistica ?? null }
}

export function protegerPlanPublicidad(plan, propio, anuncio, campana, opciones = {}) {
  const disponibilidad = disponibilidadPublicidad(propio, anuncio, opciones)
  const salida = { ...plan, disponibilidad, foto: propio.imagen ?? anuncio?.foto ?? null,
    familia: propio.familiaMl ?? null, nichoId: propio.nichoId ? String(propio.nichoId) : null,
    estadoAnuncio: anuncio?.estado ?? null, campanaId: anuncio?.estado === 'idle' ? null : anuncio?.campanaId ?? null,
    estadoCampana: anuncio?.estado === 'idle' ? null : campana?.estado ?? null }
  if (!disponibilidad.disponible) {
    return { ...salida, pendiente: false, accion: disponibilidad.estado === 'sin-stock' ? 'sin-stock' : 'no-disponible', budgetDiario: 0,
      texto: `${disponibilidad.motivo}. Revisa disponibilidad antes de destinar presupuesto; se conserva su historial.` }
  }
  const enMarcha = anuncio?.estado === 'active' && campana?.estado === 'active'
  if (!plan.economia || plan.economia.esTecho || plan.economia.incompleta || plan.economia.envioSupuesto) {
    return { ...salida, pendiente: false, accion: 'completar-economia', budgetDiario: enMarcha ? campana.presupuestoDiario ?? null : null,
      metricas: plan.metricas ? { ...plan.metricas, resultado7: null, resultado30: null, budgetOptimoAprendido: null } : undefined,
      texto: 'Completa costo, comisión y envío para calcular cuánto puede pagar por una venta. No se propone iniciar ni aumentar presupuesto con esos datos pendientes.' }
  }
  // La ventana inicial necesita existencias. La cobertura es una estimación con ventas recientes.
  if (enMarcha && disponibilidad.diasCobertura != null && disponibilidad.diasCobertura < 14 && plan.accion === 'subir') {
    return { ...salida, accion: 'reponer-stock', budgetDiario: campana.presupuestoDiario ?? null,
      texto: `Stock para aproximadamente ${disponibilidad.diasCobertura} días al ritmo reciente. Revisa reposición antes de aumentar el presupuesto.` }
  }
  return salida
}

function economiasCompatibles(grupos) {
  const miembros = grupos.flatMap(g => g.elegibles)
  const roas = miembros.map(p => p.roasObjetivo)
  const precios = miembros.map(p => p.economia?.precio)
  return roas.every(x => Number.isFinite(x) && x > 0) && precios.every(x => Number.isFinite(x) && x > 0)
    && Math.max(...roas) / Math.min(...roas) <= 1.25 && Math.max(...precios) / Math.min(...precios) <= 1.6
}

// La familia oficial identifica variantes; compartir nicho solo habilita comparar una prueba.
export function carteraCampanas({ productos = [], campanas = [], porItem = {}, formas = null, ahora = new Date() } = {}) {
  const mapa = new Map()
  for (const p of productos) {
    const clave = p.familia?.id ? `familia:${p.familia.id}` : `item:${p.itemId}`
    mapa.set(clave, [...(mapa.get(clave) ?? []), p])
  }
  const grupos = [...mapa].map(([id, miembros]) => {
    const elegibles = miembros.filter(p => p.disponibilidad?.disponible)
    const arranque = elegibles.length > 0 && elegibles.every(p => ARRANQUE.has(p.accion) && !p.campanaId)
    const presupuestoDiario = arranque ? MAX(elegibles.map(p => p.budgetDiario)) : null
    const nichos = [...new Set(miembros.map(p => p.nichoId).filter(Boolean))]
    return { id, titulo: miembros.length > 1 ? miembros[0].familia.nombre ?? miembros[0].titulo : miembros[0].titulo,
      miembros, elegibles, stock: SUMA(miembros.map(p => p.disponibilidad?.stock)),
      nichoId: nichos.length === 1 && miembros.every(p => p.nichoId) ? nichos[0] : null,
      arranque, presupuestoDiario, roasObjetivo: arranque ? MAX(elegibles.map(p => p.roasObjetivo)) : null,
      campañas: [...new Set(miembros.filter(p => p.estadoCampana != null).map(p => p.campanaId).filter(x => x != null))] }
  })

  const disponibles = grupos.filter(g => g.arranque && g.presupuestoDiario > 0)
  const usados = new Set(), propuestas = []
  const permitirNicho = !(formas?.estado === 'aprendido' && formas.solaVsGrupo >= 0.15)
  for (const g of disponibles) {
    if (usados.has(g.id)) continue
    const lote = [g]
    usados.add(g.id)
    if (permitirNicho && g.nichoId) for (const otro of disponibles) {
      if (lote.length >= 3) break
      if (!usados.has(otro.id) && otro.nichoId === g.nichoId && economiasCompatibles([...lote, otro])) {
        lote.push(otro); usados.add(otro.id)
      }
    }
    const incluidos = lote.flatMap(x => x.elegibles)
    const presupuestoDiario = SUMA(lote.map(x => x.presupuestoDiario))
    const tipo = lote.length > 1 ? 'nicho' : g.miembros.length > 1 ? 'variantes' : 'producto'
    propuestas.push({ id: lote.map(x => x.id).sort().join('|'), tipo, grupos: lote.map(x => x.id),
      titulo: lote.length > 1 ? `${lote.length} productos del mismo nicho` : g.titulo,
      itemIds: incluidos.map(p => p.itemId), excluidos: lote.flatMap(x => x.miembros.filter(p => !x.elegibles.includes(p)).map(p => ({ itemId: p.itemId, motivo: p.disponibilidad?.motivo }))),
      presupuestoDiario, presupuesto14Dias: presupuestoDiario * 14,
      roasObjetivo: MAX(incluidos.map(p => p.roasObjetivo)), diasPrueba: 14,
      motivo: tipo === 'nicho'
        ? 'Mismo nicho, etapa de arranque y economía similar. Probar juntos y medir el reparto de gasto por producto; compartir nicho por sí solo no basta.'
        : tipo === 'variantes'
          ? 'Variantes de la misma familia de Mercado Libre: un presupuesto compartido para probar el producto, sin multiplicarlo por color.'
          : 'Prueba propia para medir su costo por venta sin mezclarlo con productos de otra economía.',
      base: tipo === 'nicho' ? 'hipótesis de agrupación' : tipo === 'variantes' ? 'familia oficial' : 'plan de arranque',
      revision: 'Revisar a los 7 días; decidir a los 14 con gasto, ventas, costo por venta, resultado y stock. La segunda semana no sube automáticamente.',
    })
  }

  const porId = new Map(productos.map(p => [p.itemId, p]))
  const estadoCampanas = campanas.map(c => {
    const anuncios = Object.entries(porItem).filter(([, a]) => String(a.campanaId) === String(c.id)).map(([itemId, a]) => {
      const p = porId.get(itemId)
      return { itemId, titulo: p?.titulo ?? a.titulo, foto: p?.foto ?? a.foto, estado: a.estado,
        disponible: Boolean(p?.disponibilidad?.disponible && a.estado === 'active'),
        motivo: p?.disponibilidad?.motivo ?? 'Falta el estado vigente del producto', stock: p?.disponibilidad?.stock ?? null }
    })
    const aptos = anuncios.filter(a => a.disponible).length
    return { ...c, anuncios, aptos, bloqueados: anuncios.length - aptos,
      atencion: c.estado === 'active' && aptos === 0 ? 'sin-productos-disponibles' : c.estado === 'active' && aptos < anuncios.length ? 'parcial' : null }
  })
  const alertas = estadoCampanas.filter(c => c.atencion).map(c => ({ tipo: c.atencion, campanaId: c.id, titulo: c.nombre,
    texto: c.aptos === 0 ? 'Campaña activa sin anuncios disponibles. Propuesta: pausarla hasta revisar stock y estado.' : `${c.bloqueados} anuncios no disponibles. El presupuesto se concentra en ${c.aptos} anuncio${c.aptos === 1 ? '' : 's'}.`,
    itemIds: c.anuncios.filter(a => !a.disponible).map(a => a.itemId) }))
  for (const p of productos.filter(p => ['reponer-stock', 'completar-economia'].includes(p.accion) && p.campanaId && p.estadoCampana === 'active')) {
    alertas.push({ tipo: p.accion, titulo: p.titulo, texto: p.texto, itemIds: [p.itemId], campanaId: p.campanaId })
  }
  return { calculadoEl: new Date(ahora).toISOString(), grupos, propuestas, campanas: estadoCampanas, alertas,
    criterio: { formas: formas?.estado ?? 'sin-muestra', productosComparables: formas?.productosComparables ?? 0,
      mismoNichoProbado: (formas?.porNicho?.['mismo-nicho']?.productos ?? 0) >= 3 && (formas?.porNicho?.mezclado?.productos ?? 0) >= 3 },
    resumen: { productos: grupos.length, publicaciones: productos.length, propuestas: propuestas.length,
      sinStock: grupos.filter(g => g.miembros.every(p => p.disponibilidad?.estado === 'sin-stock')).length,
      presupuestoPropuesto: SUMA(propuestas.map(p => p.presupuestoDiario)) ?? 0 } }
}
