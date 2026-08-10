import { config } from '../config/env.js'
import { ProductoPropio } from '../models/ProductoPropio.js'
import { Nicho } from '../models/Nicho.js'
import { Snapshot } from '../models/Snapshot.js'
import { gastoDelMes } from './gastos.js'
import { llmDisponible } from './llm.js'

// Optimizador automático de Mis productos: lo que hasta ahora se apretaba a
// mano cada semana. Cablea los propios sin nicho, re-audita los que quedaron
// viejos o cuyo listing cambió (título editado en Seller Central ⇒ la auditoría
// anterior habla de otro título) y revisa la ficha de los que nunca la vieron.
// Todo bajo el techo de presupuesto: si no hay plata, no gasta.

const DIAS_REAUDITORIA = Number(process.env.OPTIMIZADOR_DIAS) || 7

// ¿Por qué este producto necesita una pasada del optimizador ahora?
export function motivoDeAuditar(propio, { dias = DIAS_REAUDITORIA, ahora = new Date() } = {}) {
  const a = propio.auditoria
  if (!a || a.estado === 'error') return 'sin auditoría previa'
  if (a.estado === 'generando') return null // ya hay una en curso
  const titulo = propio.titulo ?? null
  if (titulo && a.miPublicacion?.titulo && titulo !== a.miPublicacion.titulo) {
    return 'el título de la publicación cambió desde la última auditoría'
  }
  const edadDias = a.generadoEl ? (ahora - new Date(a.generadoEl)) / 86400e3 : Infinity
  if (edadDias >= dias) return `la auditoría tiene ${Math.floor(edadDias)} días`
  return null
}

export async function optimizarPropios({ encolarAuditoria, motivo = 'programado' } = {}) {
  if (!llmDisponible()) return { omitido: true, motivo: 'IA no configurada' }
  const gastado = await gastoDelMes()
  if (gastado >= config.presupuestoUsdMes) {
    return { omitido: true, motivo: `presupuesto mensual agotado (US$ ${gastado.toFixed(2)})` }
  }

  const acciones = { cableados: 0, auditorias: 0, fichas: 0, saltados: [] }

  // 1. cablear los que no tienen nicho (barato: una llamada para todos)
  if (await ProductoPropio.exists({ estado: 'activo', nichoId: null })) {
    const { cablearPropiosAuto } = await import('./cableador.js')
    const r = await cablearPropiosAuto()
    acciones.cableados = (r.resultados ?? []).filter((x) => ['rankea', 'existente', 'creado'].includes(x.accion)).length
  }

  // 2. auditar lo que lo necesite (el nicho debe tener scan: sin listado no hay
  //    contra quién comparar — los nichos recién creados esperan a su primer scan)
  const propios = await ProductoPropio.find({ estado: 'activo', nichoId: { $ne: null } })
  for (const propio of propios) {
    const razon = motivoDeAuditar(propio)
    if (!razon) continue
    if ((await gastoDelMes()) >= config.presupuestoUsdMes) {
      acciones.saltados.push({ sku: propio.sku, motivo: 'presupuesto agotado' })
      continue
    }
    const nicho = await Nicho.findById(propio.nichoId).select('keyword').lean()
    if (!nicho || !(await Snapshot.exists({ keyword: nicho.keyword }))) {
      acciones.saltados.push({ sku: propio.sku, motivo: 'el nicho aún no tiene scan' })
      continue
    }
    propio.auditoria = { ...(propio.auditoria ?? {}), estado: 'generando', solicitadaEl: new Date(), motivo: razon }
    propio.markModified('auditoria')
    await propio.save()
    await encolarAuditoria(propio)
    acciones.auditorias++
  }

  return { motivo, ...acciones }
}

// Revisión de ficha de los que nunca la tuvieron. Va aparte de la auditoría
// porque es más barata y no depende del nicho.
export async function revisarFichasPendientes() {
  if (!llmDisponible()) return { omitido: true, motivo: 'IA no configurada' }
  const propios = await ProductoPropio.find({ estado: 'activo' })
  let revisadas = 0
  for (const propio of propios) {
    if (propio.auditoria?.ficha) continue
    if ((await gastoDelMes()) >= config.presupuestoUsdMes) break
    try {
      const { revisarFicha } = await import('./ficha.js')
      await revisarFicha(propio)
      revisadas++
    } catch (err) {
      console.warn(`[optimizador] ficha de ${propio.sku} falló: ${err.message}`)
    }
  }
  return { revisadas }
}
