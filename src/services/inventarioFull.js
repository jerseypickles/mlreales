import { meliGet } from './meli.js'

// EL STOCK DE VERDAD, QUE NO ES EL DEL ITEM.
//
// Hasta el 28-ago-2026 el sistema leía `available_quantity` del item y lo
// trataba como stock en bodega. No lo es. Medido ese día sobre las Brochas
// Set 18: el item declaraba 20 y la bodega de Full tenía 9. El libro de
// movimientos lo confirma —entraron 20, se vendieron 11, quedan 9— así que la
// cobertura que mostraba el panel estaba al doble de la real.
//
// Un forecast de reposición construido sobre el número equivocado es peor que
// no tener forecast: te deja tranquilo mientras te quiebras.
//
// Acá se lee lo que ML tiene de verdad, por dos rutas complementarias:
//
//   /inventories/{id}/stock/fulfillment
//       total, disponible y NO disponible con su motivo. Ahí apareció una
//       unidad marcada `lost` que nadie había reclamado.
//
//   /stock/fulfillment/operations/search?inventory_id&seller_id
//       el libro entero: INBOUND_RECEPTION, SALE_CONFIRMATION, ADJUSTMENT,
//       cada uno con su delta y el saldo resultante. De acá sale además
//       DESDE CUÁNDO se vende, que es lo que arregla el cálculo de velocidad.

// Estado del inventario de un SKU en la bodega de ML.
export async function stockFull(inventoryId) {
  if (!inventoryId) return null
  const r = await meliGet(`/inventories/${inventoryId}/stock/fulfillment`)
  return {
    inventoryId,
    total: r?.total ?? 0,
    disponible: r?.available_quantity ?? 0,
    noDisponible: r?.not_available_quantity ?? 0,
    // por qué hay unidades retenidas: `lost`, `damaged`, etc. Cada una es
    // plata que se puede reclamar, y nadie la mira si no aparece en pantalla.
    motivos: (r?.not_available_detail ?? []).map((d) => ({
      motivo: d.status ?? d.type ?? 'desconocido',
      unidades: d.quantity ?? 0,
    })),
    leidoEl: new Date(),
  }
}

const TIPOS = {
  INBOUND_RECEPTION: 'entrada',
  SALE_CONFIRMATION: 'venta',
  ADJUSTMENT: 'ajuste',
}

// El libro de movimientos, normalizado y del más nuevo al más viejo.
export async function movimientosFull(inventoryId, sellerId, { limite = 50 } = {}) {
  if (!inventoryId || !sellerId) return []
  const r = await meliGet(
    `/stock/fulfillment/operations/search?inventory_id=${inventoryId}&seller_id=${sellerId}&limit=${limite}`,
  )
  return (r?.results ?? []).map((o) => ({
    fecha: o.date_created ? new Date(o.date_created) : null,
    tipo: TIPOS[o.type] ?? String(o.type ?? '').toLowerCase(),
    tipoMl: o.type,
    // delta de la operación: negativo en ventas, positivo en entradas
    delta: o.detail?.available_quantity ?? 0,
    saldo: o.result?.total ?? null,
    // el inbound al que pertenece, para poder agrupar un envío partido en
    // varias recepciones (el del 23-ago llegó como 4 + 5 + 1)
    inboundId: (o.external_references ?? []).find((x) => x.type === 'inbound_id')?.value ?? null,
  }))
}

// DESDE CUÁNDO SE PUEDE VENDER, que no es lo mismo que desde cuándo existe.
//
// `ventasPorItem` usa una ventana fija de 30 días hacia atrás. Para un producto
// que lleva 13 días en bodega eso divide sus ventas por 30 y muestra un tercio
// de su velocidad real — justo el error que hace que un producto que se está
// vendiendo bien parezca que no hay que reponerlo.
export function primeraEntrada(movimientos = []) {
  const entradas = movimientos.filter((m) => m.tipo === 'entrada' && m.fecha)
  if (!entradas.length) return null
  return new Date(Math.min(...entradas.map((m) => m.fecha.getTime())))
}

// Pura. La velocidad honesta: unidades por día sobre los días que el producto
// ESTUVO disponible, no sobre la ventana del reporte.
export function velocidadDiaria({ unidades, ventanaDias, desdeEl, hoy = new Date() }) {
  if (!Number.isFinite(unidades) || unidades <= 0) return 0
  let dias = ventanaDias
  if (desdeEl instanceof Date && !Number.isNaN(desdeEl.getTime())) {
    const vividos = (hoy.getTime() - desdeEl.getTime()) / 86_400_000
    // si lleva menos tiempo que la ventana, manda el tiempo vivido
    if (vividos > 0 && vividos < ventanaDias) dias = vividos
  }
  // piso de 1 día: con 3 ventas en 6 horas la velocidad no es 12/día
  return unidades / Math.max(1, dias)
}

// Pura. Cuántos días aguanta el stock actual, y qué hay que mandar para llegar
// a la cobertura objetivo.
export function coberturaYReposicion({ stock, velocidadDia, enCamino = 0, objetivoDias = 45 }) {
  const v = Number.isFinite(velocidadDia) ? velocidadDia : 0
  const s = Number.isFinite(stock) ? stock : 0
  const cam = Number.isFinite(enCamino) ? enCamino : 0
  // lo que va en camino cuenta: gritar quiebre con un inbound ya despachado es
  // exactamente el error que este módulo existe para no cometer
  const efectivo = s + cam
  return {
    stock: s,
    enCamino: cam,
    velocidadDia: Math.round(v * 100) / 100,
    diasCobertura: v > 0 ? Math.round(efectivo / v) : null,
    // sin ventas no hay cobertura que calcular, pero tampoco urgencia
    necesarioParaObjetivo: v > 0 ? Math.ceil(v * objetivoDias) : 0,
    aEnviar: v > 0 ? Math.max(0, Math.ceil(v * objetivoDias) - efectivo) : 0,
    objetivoDias,
  }
}

// Semáforo, con los cortes puestos donde importan para importación desde China
// (lead time ~60 días) y para reposición desde bodega propia (días).
export function urgencia(diasCobertura) {
  if (diasCobertura == null) return 'sin_ventas'
  if (diasCobertura <= 0) return 'quebrado'
  if (diasCobertura <= 14) return 'critico'
  if (diasCobertura <= 45) return 'reponer'
  return 'holgado'
}
