import { importacion } from '../config/importacion.js'

const redondear = (n) => (Number.isFinite(n) ? Math.round(n) : null)
// overrides viejos pueden traer seguroPctFob: mismo significado, nombre anterior
const seguroPct = (p) => p.flete.seguroPctExw ?? p.flete.seguroPctFob ?? 0
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

// Invierte el modelo: dado un precio de venta y un margen objetivo, ¿cuál es el
// EXW máximo (USD/unidad) que se puede pagar en China? Precio ex-fábrica: el
// retiro, consolidación y flete van en la tarifa del forwarder (flete.*).
// Misma matemática que calcularMargen, despejando el EXW.
export function exwMaximoUsd(entrada) {
  const {
    precioVentaClp,
    margenObjetivoPct = 25,
    unidades = 500,
    volumenM3 = 0.003,
    pesoKg = 0.5,
    modoFlete = 'maritimo',
    parametros: overrides,
  } = entrada

  if (!Number.isFinite(precioVentaClp) || precioVentaClp <= 0) throw new Error('precioVentaClp requerido (> 0)')

  const p = {
    tipoCambioUsdClp: overrides?.tipoCambioUsdClp ?? importacion.tipoCambioUsdClp,
    flete: { ...importacion.flete, ...overrides?.flete },
    aduana: { ...importacion.aduana, ...overrides?.aduana },
    mercadoLibre: { ...importacion.mercadoLibre, ...overrides?.mercadoLibre },
  }
  const tc = p.tipoCambioUsdClp
  const factorIva = 1 + p.aduana.ivaPct / 100

  const ingresoNetoClp = precioVentaClp / factorIva
  const comisionBrutaClp =
    precioVentaClp * (p.mercadoLibre.comisionPct / 100) +
    (precioVentaClp < p.mercadoLibre.umbralCargoFijoClp ? p.mercadoLibre.cargoFijoBajoUmbralClp : 0)
  const comisionNetaClp = comisionBrutaClp / factorIva
  const fullNetoClp = p.mercadoLibre.fullPorUnidadClp / factorIva
  const despachoClp = (p.aduana.despachoUsd * tc) / unidades
  const fleteUsd = modoFlete === 'aereo' ? pesoKg * p.flete.aereoUsdPorKg : volumenM3 * p.flete.maritimoUsdPorM3
  const fleteClp = fleteUsd * tc

  // margen = ingresoNeto - landed - comision - full, con landed = cif(1+arancel) + despacho
  // y cif = exw*tc*(1+seguro) + flete → despejar exw
  const restanteClp = ingresoNetoClp * (1 - margenObjetivoPct / 100) - comisionNetaClp - fullNetoClp - despachoClp
  const cifMaxClp = restanteClp / (1 + p.aduana.arancelPct / 100)
  const exwMax = (cifMaxClp - fleteClp) / (tc * (1 + seguroPct(p) / 100))

  return exwMax > 0 ? Math.round(exwMax * 100) / 100 : null
}

// Unit economics de importar y vender por ML Full.
// Los costos se tratan a valores netos (el IVA de importación y de comisiones es
// crédito fiscal para un vendedor formal); la caja necesaria sí incluye IVA.
export function calcularMargen(entrada) {
  const {
    costoExwUsd, // por unidad, precio ex-fábrica (costoFobUsd se acepta como alias viejo)
    costoFobUsd,
    unidades,
    precioVentaClp, // precio de venta bruto (como se publica en ML)
    pesoKg = 0,
    volumenM3 = 0,
    modoFlete = 'maritimo', // 'maritimo' | 'aereo'
    parametros: overrides,
  } = entrada

  const costoUnitarioUsd = costoExwUsd ?? costoFobUsd
  if (!Number.isFinite(costoUnitarioUsd) || costoUnitarioUsd <= 0) throw new Error('costoExwUsd requerido (> 0)')
  if (!Number.isFinite(unidades) || unidades < 1) throw new Error('unidades requeridas (>= 1)')
  if (!Number.isFinite(precioVentaClp) || precioVentaClp <= 0) throw new Error('precioVentaClp requerido (> 0)')
  if (modoFlete === 'maritimo' && !(volumenM3 > 0)) throw new Error('volumenM3 requerido para flete marítimo (por unidad)')
  if (modoFlete === 'aereo' && !(pesoKg > 0)) throw new Error('pesoKg requerido para flete aéreo (por unidad)')

  const p = parametrosCon(overrides)
  const tc = p.tipoCambioUsdClp
  const factorIva = 1 + p.aduana.ivaPct / 100

  // --- costos de importación por unidad (CLP, netos de IVA) ---
  const exwClp = costoUnitarioUsd * tc
  const fleteUsd = modoFlete === 'aereo' ? pesoKg * p.flete.aereoUsdPorKg : volumenM3 * p.flete.maritimoUsdPorM3
  const fleteClp = fleteUsd * tc
  const seguroClp = exwClp * (seguroPct(p) / 100)
  const cifClp = exwClp + fleteClp + seguroClp
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
      exwClp: redondear(exwClp),
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
