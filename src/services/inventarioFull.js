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
// OJO CON LA PÁGINA LLENA. El libro se pide paginado: si vinieron tantas
// operaciones como el límite, hay más atrás y la más vieja que tenemos NO es la
// primera. Tomarla igual fue un error real medido el 28-ago-2026: el saca
// puntos, con 17 ventas en 30 días, daba "vendiendo desde el 26-ago" y su
// velocidad salía 1,83/día en vez de 0,57 — más del triple. Y de ahí el panel
// pedía reponer 72 unidades.
//
// Sin certeza se devuelve null, y quien llama usa la ventana completa: subestima
// un producto nuevo, pero no infla uno viejo. En reposición, pedir de más cuesta
// capital inmovilizado y pedir de menos cuesta una venta — el error barato es
// hacia abajo.
export function primeraEntrada(movimientos = [], { paginaLlena = false } = {}) {
  if (paginaLlena) return null
  const entradas = movimientos.filter((m) => m.tipo === 'entrada' && m.fecha)
  if (!entradas.length) return null
  return new Date(Math.min(...entradas.map((m) => m.fecha.getTime())))
}

// EL LIBRO NO ES EL NACIMIENTO (medido el 1-sep-2026).
//
// `primeraEntrada` buscaba el primer inbound en el libro de movimientos para
// saber desde cuándo se vende. Pero el libro de ML RETIENE ~14 DÍAS: los ocho
// productos arrancaban el 18-ago, y el Set 8, con 113 ventas en 30 días,
// mostraba 81 operaciones desde el 22. Así que "la primera entrada del libro"
// era el último REABASTECIMIENTO: el Set 18 entró a Full el 15-ago y el libro
// decía "entrada 23-ago" con ventas anteriores en el mismo libro. Cuando esa
// lectura funcionaba, la velocidad salía al doble (lanzador: 0,83/día contra
// 0,44). Y cuando no —el endpoint devuelve 429 "over quota" tras seis
// llamadas seguidas, y el panel recargaba cada 30 s con ocho llamadas por
// carga— caía en silencio a la ventana completa. El mismo producto daba un
// número distinto en cada recarga.
//
// Ahora "desde cuándo se vende" sale de la PRIMERA VENTA REAL (VentaMl, que
// guarda 90 días de órdenes) y del primer día con stock conocido, y el libro
// no se consulta en la pantalla. Lo que sigue es puro.

// Día calendario en hora de Chile ("YYYY-MM-DD"): las ventas y el stock se
// agrupan por el día del importador, no por el de UTC.
export function diaChile(fecha = new Date()) {
  return new Date(fecha).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
}

function sumarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// UN QUIEBRE NO ES UNA CAÍDA DE DEMANDA.
//
// El Set 9 vendió 30 unidades en 16 días y se quedó sin stock el 17-ago. Dos
// semanas después el panel decía 0,7/día —30 dividido por 30 y amortiguado
// por "semana en cero"— y el 16-sep iba a decir "sin ventas, enviar 0". Justo
// el producto que más hay que reponer es el que pierde la señal.
//
// Días sin stock dentro de la ventana, para restarlos del denominador:
//   - día conocido (serie diaria del scan): cuenta la fracción de mediciones
//     sin stock, así el día en que se agotó a las 23:00 pesa casi nada;
//   - día desconocido con stock actual 0 y posterior a la última venta: sin
//     stock, porque la última unidad se fue en esa venta;
//   - día desconocido en cualquier otro caso: con stock (estaba vendiendo).
// Los días anteriores a `desdeEl` no cuentan: ya los recorta `diasVendibles`.
export function diasSinStockEnVentana({
  ventanaDias,
  stockPorDia = new Map(),
  stockActual = null,
  ultimaVenta = null,
  desdeEl = null,
  hoy = new Date(),
}) {
  const hoyDia = diaChile(hoy)
  const desdeDia = desdeEl ? diaChile(desdeEl) : null
  const ultimaDia = ultimaVenta ? diaChile(ultimaVenta) : null
  let sinStock = 0
  for (let i = 0; i < ventanaDias; i++) {
    const dia = sumarDias(hoyDia, -i)
    if (desdeDia && dia < desdeDia) continue
    const conocido = stockPorDia.get(dia)
    if (conocido && conocido.mediciones > 0) {
      sinStock += 1 - conocido.conStock / conocido.mediciones
    } else if (stockActual === 0 && ultimaDia && dia > ultimaDia) {
      sinStock += 1
    }
  }
  return Math.round(sinStock * 10) / 10
}

// Serie diaria de stock a partir de lo que el scan guarda (`stockDiario`, un
// registro por día) más las mediciones sueltas de los últimos días, que cubren
// lo que la serie diaria aún no tiene.
export function stockPorDiaDe({ stockDiario = [], mediciones = [] } = {}) {
  const porDia = new Map()
  for (const d of stockDiario) {
    if (d?.dia && Number.isFinite(d.mediciones)) porDia.set(d.dia, { mediciones: d.mediciones, conStock: d.conStock ?? 0 })
  }
  const sueltas = new Map()
  for (const x of mediciones) {
    if (!x?.fecha || !Number.isFinite(x.stock)) continue
    const dia = diaChile(x.fecha)
    if (porDia.has(dia)) continue // la serie diaria ya tiene el día entero
    const acc = sueltas.get(dia) ?? { mediciones: 0, conStock: 0 }
    acc.mediciones++
    if (x.stock > 0) acc.conStock++
    sueltas.set(dia, acc)
  }
  for (const [dia, acc] of sueltas) porDia.set(dia, acc)
  return porDia
}

// El primer día con stock conocido: para un producto que entró a bodega y
// tardó en vender, el nacimiento es la entrada, no la primera venta.
export function primerDiaConStock(stockPorDia) {
  const dias = [...stockPorDia].filter(([, v]) => v.conStock > 0).map(([d]) => d)
  return dias.length ? new Date(`${dias.sort()[0]}T12:00:00Z`) : null
}

// Pura. Días en que el producto ESTUVO a la venta dentro de la ventana: desde
// que nació (si es más nuevo que la ventana) y sin los días quebrado.
export function diasVendibles({ ventanaDias, desdeEl, diasSinStock = 0, hoy = new Date() }) {
  let dias = ventanaDias
  if (desdeEl instanceof Date && !Number.isNaN(desdeEl.getTime())) {
    const vividos = (hoy.getTime() - desdeEl.getTime()) / 86_400_000
    // si lleva menos tiempo que la ventana, manda el tiempo vivido
    if (vividos > 0 && vividos < ventanaDias) dias = vividos
  }
  return Math.max(0, dias - (Number.isFinite(diasSinStock) ? diasSinStock : 0))
}

// Pura. La velocidad honesta: unidades por día sobre los días que el producto
// ESTUVO disponible, no sobre la ventana del reporte. Devuelve null cuando no
// estuvo a la venta ni un día: eso es "no se sabe", que no es lo mismo que cero.
export function velocidadDiaria({ unidades, ventanaDias, desdeEl, diasSinStock = 0, hoy = new Date() }) {
  const dias = diasVendibles({ ventanaDias, desdeEl, diasSinStock, hoy })
  if (dias <= 0) return null
  if (!Number.isFinite(unidades) || unidades <= 0) return 0
  // piso de 1 día: con 3 ventas en 6 horas la velocidad no es 12/día
  return unidades / Math.max(1, dias)
}

// LA VELOCIDAD NO PUEDE SALTAR CON UNA VENTA.
//
// La primera versión CONMUTABA de ventana: si había ventas en 7 días usaba esa,
// si no la de 30. Con 5-7 ventas por semana eso es inestable de raíz — una sola
// venta que entra o sale mueve el número entre 20% y 100%, y al llegar a cero
// salta de ventana entera. El importador lo cazó mirando la pantalla: "he visto
// un producto moverse 4 veces en un rango de tiempo la cantidad a enviar".
//
// Un forecast que cambia cuatro veces al día no se usa: no se sabe cuál de los
// cuatro obedecer.
//
// Ahora se MEZCLAN. La de 7 días aporta reacción y la de 30 estabilidad, con el
// peso en la segunda. Y cuando la semana viene en cero no se ignora la historia:
// se amortigua, porque un producto que vendió 30 en un mes y 0 esta semana está
// bajando, no muerto. Salvo que la semana en cero sea por FALTA DE STOCK: ahí
// no hay señal que amortiguar, manda el mes.
const PESO_7D = 0.4
const AMORTIGUA_SEMANA_MUERTA = 0.7

export function velocidadPonderada({
  unidades7,
  unidades30,
  desdeEl,
  diasSinStock7 = 0,
  diasSinStock30 = 0,
  hoy = new Date(),
}) {
  const r7 = velocidadDiaria({ unidades: unidades7, ventanaDias: 7, desdeEl, diasSinStock: diasSinStock7, hoy })
  const r30 = velocidadDiaria({ unidades: unidades30, ventanaDias: 30, desdeEl, diasSinStock: diasSinStock30, hoy })
  if (r30 == null) return r7 ?? 0
  if (r7 == null) return r30
  if (!r30) return r7
  if (!r7) return r30 * AMORTIGUA_SEMANA_MUERTA
  return r7 * PESO_7D + r30 * (1 - PESO_7D)
}

// Redondeo grueso de la recomendación. "Enviar 34" y "enviar 36" son la misma
// decisión, pero en pantalla parecen dos números distintos y hacen dudar de
// todo el cálculo. Se redondea al 5 más cercano, y de 100 para arriba al 10:
// nadie despacha una caja con precisión unitaria.
export function redondearEnvio(n) {
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n < 10) return Math.ceil(n)
  const paso = n >= 100 ? 10 : 5
  return Math.round(n / paso) * paso
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
    // lo que aguanta SOLO lo que ya está en la bodega: lo que va en camino no
    // se puede vender hasta que llega, y en pantalla se dicen las dos cosas
    diasConStock: v > 0 ? Math.round(s / v) : null,
    // sin ventas no hay cobertura que calcular, pero tampoco urgencia
    necesarioParaObjetivo: v > 0 ? Math.ceil(v * objetivoDias) : 0,
    // redondeado: un envío no se despacha con precisión unitaria, y las
    // diferencias de dos o tres unidades solo hacen dudar del número
    aEnviar: v > 0 ? redondearEnvio(Math.ceil(v * objetivoDias) - efectivo) : 0,
    objetivoDias,
  }
}

// LO QUE LA BODEGA RECIBE SE VE SOLO (18-nov-2026).
//
// Pedido del dueño: «ya hicimos otra colecta de Full pero no está siendo
// detectado solo; no sé si eso se puede detectar en la API». Medido ese día
// contra la cuenta: Mercado Libre no entrega los envíos a Full que van en
// camino (la documentación solo trae el stock de la bodega y sus movimientos, y
// cualquier ruta de envíos entrantes responde 403). Lo que sí se ve es la
// llegada: el total de la bodega sube. El libro de movimientos lo diría con más
// detalle, pero tiene una cuota que se agota sola (ese día respondió 429 al
// primer pedido), así que la llegada se lee del total, que no falla.
//
// Pura. Compara el total de la bodega con el de la lectura anterior:
//  · lo anotado como «en camino» se descuenta con lo que llegó;
//  · la entrada queda guardada (`entradas`: [{ dia, unidades }], las últimas
//    cinco), para decir en pantalla «Full recibió N el día D» sin que nadie lo
//    anote. Una subida de una sola unidad sin envío anotado no se guarda: casi
//    siempre es una devolución. Lo que llega el mismo día se suma (un envío
//    entra en varias recepciones).
// Las ventas del rato entre dos lecturas achican un poco lo recibido: el error
// va hacia abajo, que en reposición es el barato.
export function recepcionEnBodega({ totalPrevio, total, enCamino = null, entradas = [], hoy = new Date() } = {}) {
  const sinCambio = { recibido: 0, entrada: false, enCamino, entradas: entradas ?? [] }
  if (!Number.isFinite(totalPrevio) || !Number.isFinite(total) || total <= totalPrevio) return sinCambio
  const recibido = total - totalPrevio
  const anotado = Number.isFinite(enCamino?.unidades) && enCamino.unidades > 0
  const dia = diaChile(hoy)
  // copia en objetos simples: lo guardado llega como subdocumentos y no se pueden esparcir
  const previas = (entradas ?? []).map((e) => ({ dia: e.dia, unidades: e.unidades }))
  let nuevas = previas
  if (previas.some((e) => e.dia === dia)) nuevas = previas.map((e) => (e.dia === dia ? { dia, unidades: e.unidades + recibido } : e))
  else if (anotado || recibido >= 2) nuevas = [...previas, { dia, unidades: recibido }].slice(-5)
  const restante = anotado ? enCamino.unidades - recibido : 0
  // `entrada`: quedó guardada como un envío que llegó (no una devolución suelta)
  return { recibido, entrada: nuevas !== previas, enCamino: anotado ? (restante > 0 ? { ...enCamino, unidades: restante } : null) : enCamino, entradas: nuevas }
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

// ALERTA TEMPRANA DE STOCK. El importador, 17-sep-2026, mirando tres productos
// quebrados hace más de una semana: "no representa mucho si no está detectando
// temprano mis productos". El forecast existía, pero escondido dentro de cada
// producto: nadie avisaba ANTES. Un quiebre cuesta dos veces — la venta que no
// ocurre y la semana que la máquina de aprendizaje ya no puede usar.
//
// Lo que importa no es "quedan N días" sino la FECHA LÍMITE para despachar: un
// envío a Full tarda en quedar disponible (preparar, colecta, recepción), así
// que el último día útil es la fecha de quiebre menos ese plazo.
export const PLAZO_ENVIO_FULL_DIAS = 7
const MARGEN_DIAS = 3

//
// AGOTADO NO ES LO MISMO QUE SIN STOCK (18-nov-2026). Pedido del dueño mirando la franja: «debería ser inteligente
// y muestra lo que ya se fue hace harto, que no llega stock». Medido ese día: la mayoría de las publicaciones que
// la franja daba por «sin stock» llevaba semanas o meses así y sin nada en camino (productos que se liquidaron y no
// se reponen), y eran justo las que salían primero, con una plata perdida por día que ya no era real. Lo que
// Mercado Libre declara en la bodega propia (`selling_address`) no sirve para saberlo: sigue mostrando el stock
// inicial de productos agotados hace meses. Por eso se distinguen tres casos de «no hay stock»:
//   · 'quebrado'   se acabó hace poco y nadie anotó un envío: hay que mandar;
//   · 'en_camino'  se acabó, pero ya hay un envío anotado: se espera, no se grita;
//   · 'agotado'    se acabó y no viene más (sinReposicion): deja de ser una alerta.

// Pura. Desde cuándo y cuántos días lleva sin stock: el último día en que alguna medición lo vio con stock.
export function sinStockDesde(stockPorDia = new Map(), hoy = new Date()) {
  const desde = [...stockPorDia].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([, v]) => v.conStock > 0).at(-1)?.[0] ?? null
  return { desde, dias: desde ? Math.max(1, Math.round((+new Date(`${diaChile(hoy)}T12:00:00Z`) - +new Date(`${desde}T12:00:00Z`)) / 86_400_000)) : null }
}

// Pura. ¿Se acabó y no viene más? Sin stock, sin nada anotado en camino y:
//   · el dueño dijo que no se repone (`decision: 'no'`), o
//   · lleva dos plazos de envío a Full sin stock y nadie dijo que sí se repone (`decision: 'si'`): quien tenía
//     stock para mandar ya lo habría mandado.
export const DIAS_PARA_AGOTADO = 2 * PLAZO_ENVIO_FULL_DIAS
export function sinReposicion({ stock, enCamino = 0, diasSinStock = null, decision = null } = {}) {
  if (stock > 0 || enCamino > 0) return false
  if (decision === 'no') return true
  if (decision === 'si') return false
  return Number.isFinite(diasSinStock) && diasSinStock >= DIAS_PARA_AGOTADO
}

// `decision`: lo que el dueño dijo de reponer este producto ('si', 'no' o null). Con 'no' y stock, se está
// liquidando: no se avisa que se acaba.
export function alertaDeStock({ reposicion, stockPorDia = new Map(), precioClp = null, hoy = new Date(), decision = null } = {}) {
  if (!reposicion) return null
  const { stock, enCamino, velocidadDia, diasCobertura, aEnviar } = reposicion
  const { desde: ultimoConStock, dias: diasSin } = sinStockDesde(stockPorDia, hoy)
  const tuvoStock = ultimoConStock !== null
  let nivel = 'ok'
  if (stock <= 0) {
    if (!(tuvoStock || velocidadDia > 0)) nivel = 'sin_ventas'
    else if (enCamino > 0) nivel = 'en_camino'
    else nivel = sinReposicion({ stock, enCamino, diasSinStock: diasSin, decision }) ? 'agotado' : 'quebrado'
  } else if (decision === 'no') nivel = 'ok'
  else if (diasCobertura == null) nivel = 'sin_ventas'
  else if (diasCobertura <= PLAZO_ENVIO_FULL_DIAS + MARGEN_DIAS) nivel = 'enviar_ya'
  else if (diasCobertura <= 21) nivel = 'preparar'
  const masDias = (n) => new Date(+hoy + n * 86_400_000)
  const fechaQuiebre = stock > 0 && diasCobertura != null ? masDias(diasCobertura) : null
  const sinStock = ['quebrado', 'en_camino', 'agotado'].includes(nivel)
  const diasQuebrado = sinStock ? diasSin : null
  // la plata que se va por día solo es real mientras se pueda reponer: de un agotado ya no se pierde nada nuevo
  const perdidaDiaClp = nivel === 'quebrado' && velocidadDia > 0 && Number.isFinite(precioClp) ? Math.round(velocidadDia * precioClp) : null
  return {
    nivel, stock, enCamino, velocidadDia, diasCobertura, aEnviar, decision,
    fechaQuiebre,
    // pasado este día, lo que se despache llega con la bodega ya vacía
    despacharAntesDel: fechaQuiebre ? masDias(Math.max(0, diasCobertura - PLAZO_ENVIO_FULL_DIAS)) : null,
    sinStockDesde: sinStock ? ultimoConStock : null,
    diasQuebrado,
    perdidaDiaClp,
    perdidaAcumuladaClp: perdidaDiaClp != null && diasQuebrado != null ? perdidaDiaClp * diasQuebrado : null,
  }
}
