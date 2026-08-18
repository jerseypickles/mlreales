import { Router } from 'express'
import mongoose from 'mongoose'
import { config } from '../../config/env.js'
import { ProductoPropio } from '../../models/ProductoPropio.js'
import { Nicho } from '../../models/Nicho.js'
import { Snapshot } from '../../models/Snapshot.js'
import { extraerSkuDeUrl, posicionesRecientes } from '../../services/propios.js'
import { ventasPorItem } from '../../services/ventasMl.js'
import { llmDisponible } from '../../services/llm.js'
import { presupuesto } from '../../services/gastos.js'
import { obtenerColas } from '../../jobs/queues.js'

const router = Router()
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Qué pasa con UNA venta al precio de HOY: precio − lo que cobra ML − costo.
// Deliberadamente NO usa los cargos facturados: esos son de ventas pasadas y si
// el precio cambió (las brochas subieron de $1.795 a $2.890 el 9-ago) dividir
// cargos viejos por unidades viejas infla la ganancia. Los cargos reales
// responden "cuánto gané"; esto responde "cuánto gano por cada venta ahora".
// El tipo de publicación decide la comisión (gold_pro/Premium 17% vs
// gold_special/Clásica 13%): cobrar la equivocada se come 4 puntos del precio.
// El scan lo guarda, pero hasta que corra se pregunta una vez y se cachea —
// esta ruta la refresca el dashboard cada 30 s y no puede pagar una llamada
// por producto por refresco.
const cacheTipo = new Map()
const TTL_TIPO_MS = 6 * 3600e3
async function tipoPublicacionDe(propio) {
  const guardado = propio.envioMl?.tipoPublicacion
  if (guardado) return guardado
  const id = propio.itemIdMl ?? propio.sku
  const hit = cacheTipo.get(id)
  if (hit && Date.now() - hit.el < TTL_TIPO_MS) return hit.valor
  const { itemOficialSeguro } = await import('../../services/meli.js')
  const valor = (await itemOficialSeguro(id))?.listing_type_id ?? null
  cacheTipo.set(id, { valor, el: Date.now() })
  return valor
}

async function economiaUnidad(propio) {
  const ultima = (propio.mediciones ?? []).at(-1) ?? null
  const precioClp = propio.promoMl?.activa?.precio ?? ultima?.precioEfectivo ?? ultima?.precio ?? null
  if (!Number.isFinite(precioClp) || precioClp <= 0) return null

  const { comisionMlExacta } = await import('../../services/comisionesMl.js')
  const { costoEnvioFull, dimensionesDeItem, DIMENSIONES_POR_DEFECTO } = await import('../../services/envioFull.js')

  const tipoPublicacion = await tipoPublicacionDe(propio).catch(() => null)
  const com = await comisionMlExacta({ precioClp, categoriaId: propio.categoriaMl, tipoPublicacion }).catch(() => null)
  const comisionClp = Number.isFinite(com?.pct)
    ? Math.round((com.pct / 100) * precioClp + (com.cargoFijoClp ?? 0))
    : null

  // solo Full paga el cargo por envío de ML; colecta/Flex se despachan distinto
  const esFull = propio.envioMl?.logistica === 'fulfillment'
  const declaradas = dimensionesDeItem({ shipping: { dimensions: propio.envioMl?.dimensiones ?? null } })
  const env = esFull
    ? await costoEnvioFull({
        precioClp,
        dimensiones: declaradas ?? DIMENSIONES_POR_DEFECTO,
        tipoPublicacion: tipoPublicacion ?? 'gold_pro',
      }).catch(() => null)
    : null
  const envioClp = Number.isFinite(env?.clp) ? Math.round(env.clp) : null

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
    // sin dimensiones declaradas la tarifa sale de una caja chica supuesta: el
    // tramo de precio manda, pero conviene decirlo en pantalla
    envioSupuesto: esFull && !declaradas,
    esFull,
    mlTotalClp,
    mlPct: Math.round((mlTotalClp / precioClp) * 1000) / 10,
    quedaParaProductoClp,
    costoClp,
    gananciaClp,
    gananciaPct: gananciaClp === null ? null : Math.round((gananciaClp / precioClp) * 1000) / 10,
    faltaEnvio: esFull && envioClp === null,
  }
}

// Registrar un producto propio por URL de ML y medirlo al tiro
router.post(
  '/',
  manejar(async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    const sku = extraerSkuDeUrl(url)
    if (!sku) {
      return res.status(400).json({ error: 'URL de Mercado Libre inválida: no se encontró el ID del producto (MLC…)' })
    }
    const existente = await ProductoPropio.findOne({ sku })
    if (existente) return res.status(409).json({ error: 'ese producto ya está registrado', propio: existente })

    const propio = await ProductoPropio.create({ sku, url })
    const job = await obtenerColas().propios.add('medir', {}, { jobId: `propios-alta-${Date.now()}` })
    res.status(201).json({ propio, scanJobId: job.id })
  }),
)

// Lista con serie de mediciones, posición orgánica, ventas reales (orders),
// conversión visitas→ventas, margen real 30d y calibración del factor
router.get(
  '/',
  manejar(async (_req, res) => {
    const propios = await ProductoPropio.find().sort({ creadoEl: -1 }).lean()
    const posiciones = await posicionesRecientes(propios.map((p) => p.sku))
    const ventas = await ventasPorItem({ dias: 30 }).catch(() => new Map())
    const ventas7 = await ventasPorItem({ dias: 7 }).catch(() => new Map())
    const { evaluarImpacto } = await import('../../services/impacto.js')
    const { comisionMlExacta } = await import('../../services/comisionesMl.js')
    const { calibracionFactor } = await import('../../services/calibracion.js')
    const { VentaMl } = await import('../../models/VentaMl.js')
    // lo que ML cobra DE VERDAD por cada venta (comisión + envío + ads), leído
    // del detalle de facturación y cableado por item
    const { cargosPorItem, cargosSinItem } = await import('../../services/cargosMl.js')
    const cargos = await cargosPorItem({ dias: 30 }).catch(() => new Map())

    const lista = []
    for (const p of propios) {
      const v30 = ventas.get(p.itemIdMl ?? p.sku) ?? null
      const v7 = ventas7.get(p.itemIdMl ?? p.sku) ?? null
      const ultima = (p.mediciones ?? []).at(-1) ?? null
      // ambas ventanas son de 7 días: conversión honesta visitas→ventas
      const visitas7 = Number.isFinite(ultima?.visitas) ? ultima.visitas : null
      const conversion7d =
        v7?.unidades && visitas7 > 0 ? Math.min(100, Math.round((v7.unidades / visitas7) * 1000) / 10) : null

      // margen real 30d: ingresos − lo que cobra ML − costo puesto en bodega.
      // Si hay cargos REALES facturados se usan esos; si no, se cae a la
      // comisión del tarifario (que ignora el cargo por envío y por eso
      // sobrestimaba el margen en productos de ticket bajo).
      const cargosItem = cargos.get(p.itemIdMl ?? p.sku) ?? null
      let margen30d = null
      if (v30?.unidades > 0 && p.costoUnitarioClp != null) {
        const costoClp = Math.round(p.costoUnitarioClp * v30.unidades)
        if (cargosItem) {
          margen30d = {
            margenClp: v30.ingresosClp - cargosItem.totalClp - costoClp,
            cargosMlClp: cargosItem.totalClp,
            comisionClp: cargosItem.comisionClp,
            envioClp: cargosItem.envioClp,
            adsClp: cargosItem.adsClp,
            costoClp,
            base: 'cargos reales de ML',
          }
        } else if (p.categoriaMl) {
          const com = await comisionMlExacta({
            precioClp: v30.ingresosClp / v30.unidades,
            categoriaId: p.categoriaMl,
          }).catch(() => null)
          if (Number.isFinite(com?.pct)) {
            const comisionClp = Math.round((com.pct / 100) * v30.ingresosClp + (com.cargoFijoClp ?? 0) * v30.unidades)
            margen30d = {
              margenClp: v30.ingresosClp - comisionClp - costoClp,
              comisionClp,
              costoClp,
              base: 'comisión estimada del tarifario (sin cargo por envío)',
            }
          }
        }
      }

      lista.push({
        ...p,
        posicionReciente: posiciones.get(p.sku) ?? null,
        ventas30d: v30,
        ventas7d: v7,
        conversion7d,
        margen30d,
        cargosMl30d: cargosItem,
        economiaUnidad: await economiaUnidad(p).catch(() => null),
        impacto: evaluarImpacto(p),
      })
    }

    // surtido que falta, por nicho (una vez por nicho, no por producto)
    try {
      const { surtidoQueFalta } = await import('../../services/surtido.js')
      const porNicho = new Map()
      for (const p of propios) {
        if (!p.nichoId) continue
        const k = String(p.nichoId)
        porNicho.set(k, [...(porNicho.get(k) ?? []), p])
      }
      const surtidos = new Map()
      for (const [nichoId, hermanos] of porNicho) {
        const s = await surtidoQueFalta(nichoId, hermanos).catch(() => null)
        if (s) surtidos.set(nichoId, s)
      }
      for (const p of lista) {
        if (p.nichoId) p.surtido = surtidos.get(String(p.nichoId)) ?? null
      }
    } catch (err) {
      console.warn(`[propios] surtido no disponible: ${err.message}`)
    }

    // comparador de cartera: con 2+ productos propios en un nicho, tus SKUs son
    // un A/B natural — qué convierte mejor, qué trae más tráfico y qué copiar
    const carteras = {}
    try {
      const { compararCartera } = await import('../../services/cartera.js')
      const { Reporte } = await import('../../models/Reporte.js')
      const porNicho = new Map()
      for (const p of lista) {
        if (!p.nichoId) continue
        const k = String(p.nichoId)
        porNicho.set(k, [...(porNicho.get(k) ?? []), p])
      }
      for (const [nichoId, hermanos] of porNicho) {
        if (hermanos.length < 2) continue
        const nicho = await Nicho.findById(nichoId).select('keyword').lean()
        const rep = await Reporte.findOne({ nichoId }).sort({ fecha: -1 }).select('metricas.demanda').lean()
        const c = compararCartera(
          hermanos.map((p) => ({
            sku: p.sku,
            titulo: p.titulo,
            visitas7d: (p.mediciones ?? []).at(-1)?.visitas,
            ventas7d: p.ventas7d?.unidades ?? 0,
            conversion7d: p.conversion7d,
            precioEfectivo: (p.mediciones ?? []).at(-1)?.precioEfectivo,
            esFull: p.envioMl?.logistica === 'fulfillment',
          })),
          { demandaNichoDia: rep?.metricas?.demanda?.resenasNuevasPorDia ?? null },
        )
        if (c) {
          // POR NICHO: lo que ML cobró de verdad por los productos cableados acá
          const delNicho = hermanos.reduce(
            (acc, p) => {
              const g = p.cargosMl30d
              if (!g) return acc
              acc.comisionClp += g.comisionClp
              acc.envioClp += g.envioClp
              acc.adsClp += g.adsClp
              acc.totalClp += g.totalClp
              return acc
            },
            { comisionClp: 0, envioClp: 0, adsClp: 0, totalClp: 0 },
          )
          const ingresos30d = hermanos.reduce((s, p) => s + (p.ventas30d?.ingresosClp ?? 0), 0)
          carteras[nichoId] = {
            keyword: nicho?.keyword ?? null,
            ...c,
            cargosMl30d: delNicho.totalClp ? { ...delNicho, ingresos30d } : null,
          }
          // el hecho "este nicho vende" pasa a la memoria de largo plazo,
          // anclado a su categoría de ML (idempotente: actualiza la evidencia)
          if (c.ventasDia > 0 && nicho) {
            const { registrarNichoQueVende } = await import('../../services/aprendizajes.js')
            await registrarNichoQueVende({
              nicho,
              ventasDia: c.ventasDia,
              sharePct: c.sharePct,
              conversion: c.productos[0]?.conversion ?? null,
              precio: c.productos[0]?.precio ?? null,
            }).catch(() => null)
          }
        }
      }
    } catch (err) {
      console.warn(`[propios] comparador de cartera no disponible: ${err.message}`)
    }

    const todasLasVentas = await VentaMl.find().lean().catch(() => [])
    res.json({
      propios: lista,
      carteras,
      // cargos que no cuelgan de una venta (Product Ads, cargos de cuenta): no
      // se pueden imputar a un producto pero se pagan igual
      cargosSinImputar: await cargosSinItem({ dias: 30 }).catch(() => []),
      calibracion: calibracionFactor(propios, todasLasVentas),
    })
  }),
)

// Resumen para el chip del topbar: ventas de hoy (hora Chile) y de la semana
router.get(
  '/ventas-resumen',
  manejar(async (_req, res) => {
    const { VentaMl } = await import('../../models/VentaMl.js')
    const { diaChile } = await import('../../services/tendencias.js')
    const desde = new Date(Date.now() - 7 * 86400e3)
    const ventas = await VentaMl.find({ fecha: { $gte: desde } }).lean()
    const hoy = diaChile()
    const sumar = (lista) => ({
      unidades: lista.reduce((s, v) => s + (v.items ?? []).reduce((a, i) => a + (i.cantidad ?? 0), 0), 0),
      ingresosClp: lista.reduce((s, v) => s + (v.totalClp ?? 0), 0),
    })
    res.json({ hoy: sumar(ventas.filter((v) => diaChile(v.fecha) === hoy)), semana: sumar(ventas) })
  }),
)

// Medir todos ahora
router.post(
  '/scan',
  manejar(async (_req, res) => {
    const job = await obtenerColas().propios.add('medir', {}, { jobId: `propios-manual-${Date.now()}` })
    res.status(202).json({ scanJobId: job.id })
  }),
)

// Pasada completa del optimizador ahora (lo mismo que corre solo cada martes)
router.post(
  '/optimizar',
  manejar(async (_req, res) => {
    const job = await obtenerColas().propios.add(
      'optimizar',
      { motivo: 'manual' },
      { jobId: `optimizar-${Date.now()}` },
    )
    res.status(202).json({ jobId: job.id })
  }),
)

// Cableado automático de todos los propios sin nicho: por ranking en listados
// trackeados (gratis) o derivando la búsqueda del título con IA; si el nicho
// no existe, se crea y se encola su primer scan
router.post(
  '/auto-cablear',
  manejar(async (_req, res) => {
    const { cablearPropiosAuto } = await import('../../services/cableador.js')
    res.json(await cablearPropiosAuto())
  }),
)

// Cablear (o descablear con null) el nicho contra el que se audita el producto
router.patch(
  '/:id',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if ('nichoId' in (req.body ?? {})) {
      const nichoId = req.body.nichoId
      if (nichoId === null || nichoId === '') {
        propio.nichoId = null
      } else {
        if (!mongoose.isValidObjectId(nichoId) || !(await Nicho.exists({ _id: nichoId }))) {
          return res.status(400).json({ error: 'nichoId inválido: ese nicho no existe' })
        }
        propio.nichoId = nichoId
      }
      await propio.save()
    }
    if ('costoUnitarioClp' in (req.body ?? {})) {
      const costo = req.body.costoUnitarioClp
      if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
        return res.status(400).json({ error: 'costoUnitarioClp debe ser un número ≥ 0 (o null para borrarlo)' })
      }
      propio.costoUnitarioClp = costo
      await propio.save()
    }
    res.json({ propio })
  }),
)

// Auditoría de listing: mi título/descripción/fotos vs los ganadores del nicho
router.post(
  '/:id/auditar',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if (!propio.nichoId) {
      return res.status(409).json({ error: 'cablea primero un nicho al producto (selector en la fila)' })
    }
    if (!llmDisponible()) {
      return res.status(503).json({ error: 'IA no configurada (falta ANTHROPIC_API_KEY)' })
    }
    const nicho = await Nicho.findById(propio.nichoId).lean()
    if (!nicho) return res.status(409).json({ error: 'el nicho cableado ya no existe; elige otro' })
    if (!(await Snapshot.exists({ keyword: nicho.keyword }))) {
      return res.status(409).json({ error: `el nicho "${nicho.keyword}" no tiene scans todavía; corre un scan primero` })
    }
    // la auditoría gasta actor + IA: mira el techo de scraping, que además del
    // contador interno consulta el saldo real del ciclo de Apify
    const { scraping } = await presupuesto()
    if (scraping.agotado) {
      return res.status(409).json({ error: `${scraping.motivo}: la auditoría gasta actor + IA` })
    }
    // una auditoría "generando" por más de 30 min es un job perdido (deploy en
    // el medio): no debe bloquear el relanzamiento para siempre
    const enCurso =
      propio.auditoria?.estado === 'generando' &&
      propio.auditoria.solicitadaEl &&
      Date.now() - new Date(propio.auditoria.solicitadaEl).getTime() < 30 * 60e3
    if (enCurso) {
      return res.status(409).json({ error: 'ya hay una auditoría en curso para este producto' })
    }
    propio.auditoria = { estado: 'generando', solicitadaEl: new Date() }
    propio.markModified('auditoria')
    await propio.save()
    const job = await obtenerColas().propios.add(
      'auditar',
      { propioId: String(propio._id) },
      { jobId: `auditar-${propio._id}-${Date.now()}` },
    )
    res.status(202).json({ auditoriaJobId: job.id })
  }),
)

// Aplicar en ML (API oficial) los arreglos de la auditoría: título y/o descripción
router.post(
  '/:id/aplicar',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    const { titulo, descripcion, atributos } = req.body ?? {}
    if (titulo === undefined && descripcion === undefined && atributos === undefined) {
      return res.status(400).json({ error: 'nada que aplicar: manda titulo, descripcion y/o atributos' })
    }
    const { aplicarCambiosPropio } = await import('../../services/aplicador.js')
    res.json({ resultado: await aplicarCambiosPropio(propio, { titulo, descripcion, atributos }) })
  }),
)

// Traer los documentos tributarios de las ventas. Va aparte del scan diario
// para poder correrlo y diagnosticarlo solo: la pasada completa hace muchas
// cosas antes (actor, cargos con pausas de 13 s) y no deja distinguir lento de
// roto. Responde con el conteo, no encola.
router.post(
  '/boletas',
  manejar(async (req, res) => {
    const { sincronizarBoletas } = await import('../../services/boletasMl.js')
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 60))
    res.json(await sincronizarBoletas({ dias, max: Number(req.query.max) || 200 }))
  }),
)

// Cambiar el precio de venta en Mercado Libre. Escritura sobre el item propio
// (scope Publicación), con el cambio anotado en el historial de precios para
// que la lupa pueda medir su efecto en visitas y ventas.
router.post(
  '/:id/precio',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    const precioClp = Number(req.body?.precioClp)
    const { aplicarPrecioPropio } = await import('../../services/aplicador.js')
    res.json({ resultado: await aplicarPrecioPropio(propio, precioClp) })
  }),
)

// BAJARSE DE UNA PROMOCIÓN. Subir el precio de lista NO desinscribe de las
// campañas: ML solo borra los PRICE_DISCOUNT. El 17-ago, tras subir cuatro
// productos a $3.990, seguían comprometidos a Black Week $2.109 (27-ago) y a
// 9 del 9 $2.751-$2.840 (2-sep) — precios aceptados cuando valían $2.290 y
// $2.990, o sea que el producto habría quedado MÁS barato que antes de subirlo.
router.post(
  '/:id/promocion/salir',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    const { promotionType, promotionId, offerId } = req.body ?? {}
    if (!promotionType) return res.status(400).json({ error: 'promotionType requerido' })
    const idMl = propio.itemIdMl ?? propio.sku
    const params = new URLSearchParams({ promotion_type: promotionType, app_version: 'v2' })
    if (promotionId) params.set('promotion_id', promotionId)
    if (offerId) params.set('offer_id', offerId)
    const { meliDelete } = await import('../../services/meli.js')
    try {
      await meliDelete(`/seller-promotions/items/${idMl}?${params.toString()}`)
      res.json({ ok: true, keyword: propio.titulo, promotionType, promotionId: promotionId ?? null })
    } catch (err) {
      res.status(err.status ?? 502).json({ error: err.message })
    }
  }),
)

// Revisar la ficha técnica (Características) contra la categoría ML y los
// ganadores: propone correcciones aplicables por API
router.post(
  '/:id/ficha',
  manejar(async (req, res) => {
    const propio = await ProductoPropio.findById(req.params.id)
    if (!propio) return res.status(404).json({ error: 'producto propio no encontrado' })
    if (!llmDisponible()) return res.status(503).json({ error: 'IA no configurada (falta ANTHROPIC_API_KEY)' })
    const { revisarFicha } = await import('../../services/ficha.js')
    res.json({ ficha: await revisarFicha(propio) })
  }),
)

router.delete(
  '/:id',
  manejar(async (req, res) => {
    const borrado = await ProductoPropio.findByIdAndDelete(req.params.id)
    if (!borrado) return res.status(404).json({ error: 'producto propio no encontrado' })
    res.json({ eliminado: borrado.sku })
  }),
)

export default router
