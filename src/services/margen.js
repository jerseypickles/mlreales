import { importacion } from '../config/importacion.js'

const redondear = (n) => (Number.isFinite(n) ? Math.round(n) : null)
const pct = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null)

// Fusión superficial de overrides sobre los parámetros por defecto.
function parametrosCon(overrides = {}) {
  return {
    tipoCambioUsdClp: overrides.tipoCambioUsdClp ?? importacion.tipoCambioUsdClp,
    flete: { ...importacion.flete, ...overrides.flete },
    aduana: { ...importacion.aduana, ...overrides.aduana },
    mercadoLibre: { ...importacion.mercadoLibre, ...overrides.mercadoLibre },
  }
}

// Unit economics de importar y vender por ML Full.
// Los costos se tratan a valores netos (el IVA de importación y de comisiones es
// crédito fiscal para un vendedor formal); la caja necesaria sí incluye IVA.
export function calcularMargen(entrada) {
  const {
    costoFobUsd, // por unidad
    unidades,
    precioVentaClp, // precio de venta bruto (como se publica en ML)
    pesoKg = 0,
    volumenM3 = 0,
    modoFlete = 'maritimo', // 'maritimo' | 'aereo'
    parametros: overrides,
  } = entrada

  if (!Number.isFinite(costoFobUsd) || costoFobUsd <= 0) throw new Error('costoFobUsd requerido (> 0)')
  if (!Number.isFinite(unidades) || unidades < 1) throw new Error('unidades requeridas (>= 1)')
  if (!Number.isFinite(precioVentaClp) || precioVentaClp <= 0) throw new Error('precioVentaClp requerido (> 0)')
  if (modoFlete === 'maritimo' && !(volumenM3 > 0)) throw new Error('volumenM3 requerido para flete marítimo (por unidad)')
  if (modoFlete === 'aereo' && !(pesoKg > 0)) throw new Error('pesoKg requerido para flete aéreo (por unidad)')

  const p = parametrosCon(overrides)
  const tc = p.tipoCambioUsdClp
  const factorIva = 1 + p.aduana.ivaPct / 100

  // --- costos de importación por unidad (CLP, netos de IVA) ---
  const fobClp = costoFobUsd * tc
  const fleteUsd = modoFlete === 'aereo' ? pesoKg * p.flete.aereoUsdPorKg : volumenM3 * p.flete.maritimoUsdPorM3
  const fleteClp = fleteUsd * tc
  const seguroClp = fobClp * (p.flete.seguroPctFob / 100)
  const cifClp = fobClp + fleteClp + seguroClp
  const arancelClp = cifClp * (p.aduana.arancelPct / 100)
  const despachoClp = (p.aduana.despachoUsd * tc) / unidades
  const landedNetoClp = cifClp + arancelClp + despachoClp

  // IVA de importación: crédito fiscal, pero hay que financiarlo
  const ivaImportacionClp = (cifClp + arancelClp) * (p.aduana.ivaPct / 100)

  // --- costos de venta por unidad (netos) ---
  const comisionBrutaClp =
    precioVentaClp * (p.mercadoLibre.comisionPct / 100) +
    (precioVentaClp < p.mercadoLibre.umbralCargoFijoClp ? p.mercadoLibre.cargoFijoBajoUmbralClp : 0)
  const comisionNetaClp = comisionBrutaClp / factorIva
  const fullNetoClp = p.mercadoLibre.fullPorUnidadClp / factorIva

  // --- resultado por unidad ---
  const ingresoNetoClp = precioVentaClp / factorIva
  const margenClp = ingresoNetoClp - landedNetoClp - comisionNetaClp - fullNetoClp
  const margenPctSobreVenta = (margenClp / ingresoNetoClp) * 100
  const roiPct = (margenClp / landedNetoClp) * 100

  // --- totales del embarque ---
  const inversionCajaClp = (landedNetoClp + ivaImportacionClp) * unidades
  const margenTotalClp = margenClp * unidades

  return {
    supuestos: {
      tipoCambioUsdClp: tc,
      modoFlete,
      arancelPct: p.aduana.arancelPct,
      ivaPct: p.aduana.ivaPct,
      comisionMlPct: p.mercadoLibre.comisionPct,
      fullPorUnidadClp: p.mercadoLibre.fullPorUnidadClp,
      nota: 'costos a valores netos; IVA de importación es crédito fiscal pero se financia',
    },
    porUnidad: {
      precioVentaClp: redondear(precioVentaClp),
      ingresoNetoClp: redondear(ingresoNetoClp),
      fobClp: redondear(fobClp),
      fleteClp: redondear(fleteClp),
      seguroClp: redondear(seguroClp),
      arancelClp: redondear(arancelClp),
      despachoClp: redondear(despachoClp),
      landedNetoClp: redondear(landedNetoClp),
      ivaImportacionClp: redondear(ivaImportacionClp),
      comisionMlClp: redondear(comisionNetaClp),
      fullClp: redondear(fullNetoClp),
      margenClp: redondear(margenClp),
    },
    resultado: {
      margenPctSobreVenta: pct(margenPctSobreVenta),
      roiPct: pct(roiPct),
      viable: margenClp > 0,
      unidades,
      margenTotalClp: redondear(margenTotalClp),
      inversionCajaClp: redondear(inversionCajaClp),
    },
  }
}
