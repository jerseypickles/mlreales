// LA DEMANDA DE ML MEDIDA CON TUS PROPIOS ANUNCIOS (8-oct-2026).
//
// El importador: "que aprenda de las métricas de las campañas, sobre todo las
// impresiones y el PPC, así no todo depende de los datos de Google y tenemos
// nuestra info". Las impresiones de un anuncio son cuánta gente buscó ese
// producto DENTRO de ML y se le mostró; el costo por clic, cuántos vendedores
// pujan por ese mismo comprador. Es la única fuente propia de demanda en ML con
// historia (AdsDiaMl se guarda para siempre desde el 17-sep, ~90 días atrás).
//
// La trampa: las impresiones también bajan si se baja el presupuesto o se sube
// el ROAS objetivo. Por eso cada semana se marca si estuvo LIMITADA por la
// campaña (gastó ≥90% del presupuesto) o si la configuración cambió en la
// semana; esas no cuentan como demanda. El presupuesto de cada día viene de
// CampanaDiaMl, que se registra desde el 8-oct: antes de eso, "sin dato".
//
// En sombra: mide, contrasta con Google y aprende cuánto confiar en Google por
// nicho. No decide nada todavía.

const DIA = 86400e3
export const LIMITADA_SI_GASTA = 0.9 // del presupuesto diario
export const MIN_IMPRESIONES_SEMANA = 3000
export const MIN_MESES_CONTRASTE = 4

const lunesDe = (dia) => { const t = new Date(`${dia}T12:00:00Z`); return new Date(+t - ((t.getUTCDay() + 6) % 7) * DIA).toISOString().slice(0, 10) }
const ctrDe = (c, p) => (p > 0 ? Math.round((c / p) * 10000) / 100 : null)

// Pura. Semanas de un nicho. `filas`: AdsDiaMl de sus productos; `campanaDia`:
// Map `${campanaId}|${dia}` → { presupuestoDiario, roasObjetivo };
// `gastoCampanaDia`: Map `${campanaId}|${dia}` → gasto total de la campaña ese día.
export function semanasDelNicho(filas, campanaDia = new Map(), gastoCampanaDia = new Map(), diasEvento = new Set()) {
  const sem = new Map()
  for (const f of filas) {
    const k = lunesDe(f.dia)
    const s = sem.get(k) ?? { semana: k, dias: new Set(), prints: 0, clicks: 0, gasto: 0, printsLimitados: 0, printsConDato: 0, printsEvento: 0, roas: new Set(), presupuestos: new Set() }
    s.dias.add(f.dia); s.prints += f.prints ?? 0; s.clicks += f.clicks ?? 0; s.gasto += f.costo ?? 0
    if (diasEvento.has(f.dia)) s.printsEvento += f.prints ?? 0
    const conf = f.campanaId != null ? campanaDia.get(`${f.campanaId}|${f.dia}`) : null
    if (conf?.presupuestoDiario) {
      s.printsConDato += f.prints ?? 0
      const gastoC = gastoCampanaDia.get(`${f.campanaId}|${f.dia}`) ?? 0
      if (gastoC >= conf.presupuestoDiario * LIMITADA_SI_GASTA) s.printsLimitados += f.prints ?? 0
      if (conf.roasObjetivo != null) s.roas.add(conf.roasObjetivo)
      s.presupuestos.add(conf.presupuestoDiario)
    }
    sem.set(k, s)
  }
  return [...sem.values()].sort((a, b) => a.semana.localeCompare(b.semana)).map((s) => {
    const dias = s.dias.size
    const conDato = s.printsConDato >= s.prints * 0.5 && s.prints > 0
    const limitada = conDato && s.printsLimitados >= s.prints * 0.5
    const cambioConfig = s.roas.size > 1 || s.presupuestos.size > 1
    // lectura de la semana como DEMANDA: limpia, limitada por la campaña, con
    // cambio de configuración, o sin dato de la campaña (antes del 8-oct)
    // una semana con evento comercial (CyberDay…) no es demanda normal
    const evento = s.printsEvento >= s.prints * 0.3 && s.prints > 0
    const lectura = s.prints < MIN_IMPRESIONES_SEMANA ? 'poca-muestra' : evento ? 'evento' : !conDato ? 'sin-dato-campana' : limitada ? 'limitada' : cambioConfig ? 'cambio-config' : 'limpia'
    return { semana: s.semana, dias, impresiones: s.prints, impresionesDia: Math.round(s.prints / Math.max(1, dias)), clicks: s.clicks,
      ctr: ctrDe(s.clicks, s.prints), cpc: s.clicks ? Math.round(s.gasto / s.clicks) : null, gasto: Math.round(s.gasto), lectura }
  })
}

// Pura. Correlación de orden (Spearman) entre dos series del mismo largo.
export function spearman(a, b) {
  const rango = (xs) => { const o = xs.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(xs.length); o.forEach(([, i], k) => { r[i] = k }); return r }
  if (a.length < 3) return null
  const ra = rango(a), rb = rango(b), n = a.length
  const ma = (n - 1) / 2
  let c = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - ma); va += (ra[i] - ma) ** 2; vb += (rb[i] - ma) ** 2 }
  return va && vb ? Math.round((c / Math.sqrt(va * vb)) * 100) / 100 : null
}

// Pura. ¿Las impresiones del nicho siguen a Google mes a mes? Solo con meses
// que tengan semanas que se puedan leer como demanda (no limitadas). Hasta
// juntar MIN_MESES_CONTRASTE meses dice 'pocos-meses'.
export function contrasteConGoogle(semanas, serieGoogle = []) {
  const usables = semanas.filter((s) => ['limpia', 'sin-dato-campana'].includes(s.lectura))
  const porMes = new Map()
  for (const s of usables) {
    const m = s.semana.slice(0, 7)
    const x = porMes.get(m) ?? { imp: 0, dias: 0 }
    x.imp += s.impresiones; x.dias += s.dias
    porMes.set(m, x)
  }
  const google = new Map((serieGoogle ?? []).map((g) => [g.periodo, g.valor]))
  const meses = [...porMes.keys()].filter((m) => Number.isFinite(google.get(m))).sort()
  if (meses.length < MIN_MESES_CONTRASTE) return { estado: 'pocos-meses', meses: meses.length, faltan: MIN_MESES_CONTRASTE - meses.length }
  const imp = meses.map((m) => porMes.get(m).imp / porMes.get(m).dias)
  const g = meses.map((m) => google.get(m))
  const rho = spearman(imp, g)
  return { estado: rho == null ? 'sin-dato' : rho >= 0.5 ? 'google-sirve' : rho <= 0 ? 'google-no-sirve' : 'google-a-medias', meses: meses.length, spearman: rho }
}

export async function demandaPropia({ ahora = new Date() } = {}) {
  const [{ AdsDiaMl }, { CampanaDiaMl }, { ProductoPropio }, { Nicho }, { CurvaEstacional }] = await Promise.all([
    import('../../models/AdsDiaMl.js'), import('../../models/CampanaDiaMl.js'), import('../../models/ProductoPropio.js'),
    import('../../models/Nicho.js'), import('../../models/CurvaEstacional.js'),
  ])
  const propios = (await ProductoPropio.find({ nichoId: { $ne: null } }).select('itemIdMl sku titulo nichoId').lean()).map((p) => ({ ...p, id: p.itemIdMl ?? p.sku }))
  const nichos = new Map((await Nicho.find({ _id: { $in: propios.map((p) => p.nichoId) } }).select('keyword').lean()).map((n) => [String(n._id), n.keyword]))
  const filas = await AdsDiaMl.find({ itemId: { $in: propios.map((p) => p.id) } }).select('itemId dia campanaId prints clicks costo').lean()
  const campanaDia = new Map((await CampanaDiaMl.find({}).select('campanaId dia presupuestoDiario roasObjetivo').lean()).map((c) => [`${c.campanaId}|${c.dia}`, c]))
  const gastoCampanaDia = new Map()
  for (const g of await AdsDiaMl.aggregate([{ $match: { itemId: { $ne: '*' }, campanaId: { $ne: null } } }, { $group: { _id: { c: '$campanaId', d: '$dia' }, gasto: { $sum: '$costo' } } }])) {
    gastoCampanaDia.set(`${g._id.c}|${g._id.d}`, g.gasto)
  }
  const diasEvento = await import('../eventosComerciales.js').then((m) => m.diasDeEvento()).catch(() => new Set())
  const curvas = new Map((await CurvaEstacional.find({ keyword: { $in: [...nichos.values()] } }).select('keyword serieMensual').lean()).map((c) => [c.keyword, c.serieMensual ?? []]))
  const porNicho = new Map()
  for (const p of propios) porNicho.set(String(p.nichoId), [...(porNicho.get(String(p.nichoId)) ?? []), p.id])
  const salida = []
  for (const [nichoId, ids] of porNicho) {
    const susFilas = filas.filter((f) => ids.includes(f.itemId))
    if (!susFilas.length) continue
    const semanas = semanasDelNicho(susFilas, campanaDia, gastoCampanaDia, diasEvento)
    const keyword = nichos.get(nichoId) ?? null
    const limpias = semanas.filter((s) => s.lectura === 'limpia')
    salida.push({ nichoId, keyword, productos: ids.length, semanas: semanas.slice(-16),
      lecturas: semanas.reduce((a, s) => ({ ...a, [s.lectura]: (a[s.lectura] ?? 0) + 1 }), {}),
      impresionesDiaLimpias: limpias.length ? Math.round(limpias.reduce((a, s) => a + s.impresionesDia, 0) / limpias.length) : null,
      contrasteGoogle: contrasteConGoogle(semanas, curvas.get(keyword)) })
  }
  const desdeConfig = (await CampanaDiaMl.findOne().sort({ dia: 1 }).select('dia').lean())?.dia ?? null
  return { modo: 'sombra', calculadoEl: ahora, configCampanasDesde: desdeConfig, nichos: salida.sort((a, b) => b.productos - a.productos) }
}
