// Economía al precio vigente: misma comisión y envío para catálogo y publicidad.
const cacheTipo = new Map()
const TTL_TIPO_MS = 6 * 3600e3
async function tipoPublicacionDe(propio) {
  const guardado = propio.envioMl?.tipoPublicacion
  if (guardado) return guardado
  const id = propio.itemIdMl ?? propio.sku
  const hit = cacheTipo.get(id)
  if (hit && Date.now() - hit.el < TTL_TIPO_MS) return hit.valor
  const { itemOficialSeguro } = await import('./meli.js')
  const valor = (await itemOficialSeguro(id))?.listing_type_id ?? null
  cacheTipo.set(id, { valor, el: Date.now() })
  return valor
}

const LOGISTICAS_MERCADO_ENVIOS = new Set(['fulfillment', 'cross_docking', 'drop_off', 'xd_drop_off'])

export async function economiaUnidad(propio, medido = null, { precio = null } = {}) {
  const ultima = (propio.mediciones ?? []).at(-1) ?? null
  const precioClp = precio ?? propio.promoMl?.activa?.precio ?? ultima?.precioEfectivo ?? ultima?.precio ?? null
  if (!Number.isFinite(precioClp) || precioClp <= 0) return null

  const { comisionMlExacta } = await import('./comisionesMl.js')
  const { costoEnvioFull, dimensionesDeItem, DIMENSIONES_POR_DEFECTO } = await import('./envioFull.js')

  const tipoPublicacion = await tipoPublicacionDe(propio).catch(() => null)
  const com = await comisionMlExacta({ precioClp, categoriaId: propio.categoriaMl, tipoPublicacion }).catch(() => null)
  const comisionClp = Number.isFinite(com?.pct)
    ? Math.round((com.pct / 100) * precioClp + (com.cargoFijoClp ?? 0))
    : null

  const esFull = propio.envioMl?.logistica === 'fulfillment'
  const porMercadoEnvios = LOGISTICAS_MERCADO_ENVIOS.has(propio.envioMl?.logistica)
  const declaradas = dimensionesDeItem({ shipping: { dimensions: propio.envioMl?.dimensiones ?? null } })
  const env = porMercadoEnvios
    ? await costoEnvioFull({
        precioClp,
        dimensiones: declaradas ?? DIMENSIONES_POR_DEFECTO,
        tipoPublicacion: tipoPublicacion ?? 'gold_pro',
      }).catch(() => null)
    : null
  const delTarifario = Number.isFinite(env?.clp) ? Math.round(env.clp) : null

  const envioMedidoClp =
    Number.isFinite(medido?.envioClp) && medido.envioClp > 0 && medido.unidades > 0
      ? Math.round(medido.envioClp / medido.unidades)
      : null
  const envioClp = envioMedidoClp ?? delTarifario

  if (comisionClp === null && envioClp === null) return null
  const mlTotalClp = (comisionClp ?? 0) + (envioClp ?? 0)
  const quedaParaProductoClp = precioClp - mlTotalClp
  const costoClp = Number.isFinite(propio.costoUnitarioClp) ? propio.costoUnitarioClp : null
  const gananciaClp = costoClp === null ? null : quedaParaProductoClp - costoClp

  return {
    precioClp,
    comisionClp,
    comisionPct: Number.isFinite(com?.pct) ? com.pct : null,
    envioClp,
    envioBase: envioMedidoClp != null ? 'facturado' : 'tarifario',
    envioTarifarioClp: delTarifario,
    envioBaseClp: envioMedidoClp != null ? medido.base ?? null : null,
    envioPctOrdenesSobreBase: envioMedidoClp != null ? medido.pctOrdenesSobreBase ?? null : null,
    envioSupuesto: envioMedidoClp == null && porMercadoEnvios && !declaradas,
    esFull,
    mlTotalClp,
    mlPct: Math.round((mlTotalClp / precioClp) * 1000) / 10,
    quedaParaProductoClp,
    costoClp,
    gananciaClp,
    gananciaPct: gananciaClp === null ? null : Math.round((gananciaClp / precioClp) * 1000) / 10,
    faltaEnvio: porMercadoEnvios && envioClp === null,
  }
}
