import { Reporte } from '../models/Reporte.js'
import { LecturaStock } from '../models/SeguimientoStock.js'

// ¿SE ESTÁ MIDIENDO? (20-nov-2026).
//
// Entre el 18 y el 20-nov ningún scan leyó reseñas y el seguimiento de stock no leyó nada: el proveedor cambió un
// indicador y el lector de fichas las descartaba todas (ver detalleMl.confiable). Nada falló con error: los scans
// terminaban, los reportes se guardaban «sin puntaje» y la mesa seguía mostrando la venta de antes como si fuera de
// hoy. Pasaron dos días hasta que alguien lo vio, y fue de casualidad.
//
// Esto no arregla nada: mira lo último que se midió y, si lleva varias mediciones seguidas en blanco, lo dice. La
// pantalla de Oportunidades lo muestra arriba de todo, porque un dato viejo que parece nuevo es peor que un error.

const HORA = 3600e3
const DIA = 86400e3

// Un scan recién hecho todavía puede estar leyendo sus fichas (el job de fichas corre después del listado y hace
// una segunda vuelta): no cuenta hasta pasado este rato.
export const GRACIA_HORAS = 2
// Un scan suelto sin reseñas es un bloqueo de Mercado Libre de cualquier día; varios seguidos ya no es mala suerte.
export const SCANS_SEGUIDOS = 3
// El seguimiento de stock lee por pasadas (todas las lecturas de una pasada llevan la misma fecha): una pasada en
// blanco puede ser un bloqueo; dos seguidas, no.
export const PASADAS_SEGUIDAS = 2

// Pura. scans: [{ fecha, conResenas }] del más nuevo al más viejo. Cuenta los scans seguidos sin reseñas partiendo
// del más nuevo (sin contar los que todavía están en su rato de gracia) y dice cuál fue el último que sí midió.
export function rachaDeScans(scans, { ahora = new Date(), graciaHoras = GRACIA_HORAS } = {}) {
  const maduros = (scans ?? []).filter((s) => s?.fecha && +new Date(s.fecha) <= +ahora - graciaHoras * HORA)
  let seguidos = 0
  for (const s of maduros) { if (s.conResenas) break; seguidos++ }
  const bueno = maduros.find((s) => s.conResenas)
  return {
    seguidos,
    mirados: maduros.length,
    desde: seguidos ? new Date(maduros[seguidos - 1].fecha) : null,
    ultimoBueno: bueno ? new Date(bueno.fecha) : null,
    problema: seguidos >= SCANS_SEGUIDOS,
  }
}

// Pura. lecturas: [{ fecha, ok }] en cualquier orden. Las agrupa en pasadas y cuenta las pasadas seguidas, desde la
// más nueva, en que no se leyó ninguna publicación. Una pasada de una sola lectura no dice nada y no cuenta.
export function rachaDeStock(lecturas) {
  const porPasada = new Map()
  for (const l of lecturas ?? []) {
    if (!l?.fecha) continue
    const k = +new Date(l.fecha)
    const p = porPasada.get(k) ?? { fecha: new Date(k), lecturas: 0, buenas: 0 }
    p.lecturas++
    if (l.ok !== false) p.buenas++
    porPasada.set(k, p)
  }
  const pasadas = [...porPasada.values()].filter((p) => p.lecturas >= 2).sort((a, b) => b.fecha - a.fecha)
  let seguidas = 0, fallidas = 0
  for (const p of pasadas) { if (p.buenas > 0) break; seguidas++; fallidas += p.lecturas }
  return {
    seguidas,
    fallidas,
    miradas: pasadas.length,
    desde: seguidas ? pasadas[seguidas - 1].fecha : null,
    ultimaBuena: pasadas.find((p) => p.buenas > 0)?.fecha ?? null,
    problema: seguidas >= PASADAS_SEGUIDAS,
  }
}

// Lo que la pantalla necesita: los problemas de medición vigentes, con sus hechos (la pantalla pone las palabras).
// Son dos consultas chicas sobre lo de los últimos días; no se guarda en caché para que el aviso sea de ahora.
export async function saludMedicion({ ahora = new Date(), dias = 14 } = {}) {
  const desde = new Date(+ahora - dias * DIA)
  const [reportes, lecturas] = await Promise.all([
    Reporte.find({ fecha: { $gte: desde } }).sort({ fecha: -1 }).select('fecha metricas.demanda.coberturaReviews.itemsConDato').lean(),
    LecturaStock.find({ fecha: { $gte: new Date(+ahora - 4 * DIA) } }).select('fecha ok').lean(),
  ])
  const scans = rachaDeScans(reportes.map((r) => ({ fecha: r.fecha, conResenas: (r.metricas?.demanda?.coberturaReviews?.itemsConDato ?? 0) > 0 })), { ahora })
  const stock = rachaDeStock(lecturas)
  const problemas = []
  if (scans.problema) problemas.push({ id: 'scans-sin-resenas', seguidos: scans.seguidos, desde: scans.desde, ultimoBueno: scans.ultimoBueno, diasMirados: dias })
  if (stock.problema) problemas.push({ id: 'stock-sin-lecturas', pasadas: stock.seguidas, lecturas: stock.fallidas, desde: stock.desde, ultimaBuena: stock.ultimaBuena })
  return { revisadoEl: ahora, problemas, scans, stock }
}
