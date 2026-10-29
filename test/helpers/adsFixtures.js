// Escenario sintético de una campaña individual; no representa una cuenta real.
export function casoAjusteAds() {
  const eco = { costo: 2000, envio: 500, comisionPct: 10, cargoFijo: 0, esTecho: false }
  const antes = { estado: 'active', presupuestoDiario: 1000, roasObjetivo: 3, estrategia: 'manual', anuncios: [{ itemId: 'A', estado: 'active' }] }
  const rec = { itemId: 'A', dia: '2025-01-09', calculadoEl: '2025-01-09T16:00:00Z', accion: 'subir',
    budgetDiario: 1500, campanaId: 1, configuracion: antes, metricas: { economia: eco } }
  const cambio = { clave: 'ajuste-a', campanaId: 1, observadoEl: '2025-01-10T16:00:00Z', ultimaVistaEl: '2025-01-30T16:00:00Z',
    anteriorVistaEl: '2025-01-10T15:00:00Z', anteriorDesde: '2024-12-01T16:00:00Z', antes,
    despues: { ...antes, presupuestoDiario: 1500 } }
  const dias = Array.from({ length: 30 }, (_, i) => ({ dia: `2025-01-${String(i + 1).padStart(2, '0')}`,
    unidades: i < 10 ? 1 : 2, ingresosClp: i < 10 ? 10000 : 20000, gasto: i < 10 ? 1000 : 1500,
    stockFraccion: 1, precio: 10000, adsMedido: true, evento: false, promo: null, cambioLogistica: false }))
  return { eco, antes, rec, cambio, dias, hoy: '2025-01-31' }
}
