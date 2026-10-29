export function serieGrupoPublicidad(grupo, porProducto = {}) {
  const dias = new Map()
  for (const p of grupo.miembros) for (const d of porProducto[p.itemId] ?? []) {
    const a = dias.get(d.dia) ?? { dia: d.dia, gasto: 0, unidadesAds: 0, ventaAds: 0, clicks: 0, resultado: 0, costoCompleto: true }
    a.gasto += d.gasto ?? 0; a.unidadesAds += d.unidadesAds ?? 0; a.ventaAds += d.ventaAds ?? 0; a.clicks += d.clicks ?? 0
    const eco = p.economia
    if ((d.gasto > 0 || d.unidadesAds > 0) && (!eco || eco.esTecho || eco.incompleta)) a.costoCompleto = false
    if (eco) a.resultado += (d.ventaAds ?? 0) * (1 - (eco.comisionPct ?? 0) / 100) - (d.unidadesAds ?? 0) * ((eco.envio ?? 0) + (eco.costo ?? 0) + (eco.cargoFijo ?? 0)) - (d.gasto ?? 0)
    dias.set(d.dia, a)
  }
  return [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)).slice(-14)
}
