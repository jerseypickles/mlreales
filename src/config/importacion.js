// Parámetros del modelo de costos de importación China → Chile y venta vía ML Full.
// TODOS son estimaciones editables: ajustar con cotizaciones reales (freight forwarder,
// tarifario ML de la categoría, tarifa Full vigente). Cada request puede sobreescribirlos.
export const importacion = {
  tipoCambioUsdClp: 950,

  flete: {
    // tarifa all-in del forwarder comprando EXW: retiro en fábrica +
    // consolidación + LCL China → San Antonio, aprox
    maritimoUsdPorM3: 180,
    aereoUsdPorKg: 6.5,
    seguroPctExw: 0.5, // % sobre valor EXW
  },

  aduana: {
    arancelPct: 0, // 0% con certificado de origen TLC China-Chile; 6% ad valorem sin él
    ivaPct: 19, // sobre CIF + arancel; es crédito fiscal si vendes con boleta/factura
    despachoUsd: 250, // agente de aduana + gastos fijos, por embarque completo
  },

  mercadoLibre: {
    comisionPct: 16, // típico 13-19% según categoría; ver tarifario de la categoría
    cargoFijoBajoUmbralClp: 700, // cargo fijo ML para publicaciones bajo el umbral
    umbralCargoFijoClp: 9990,
    fullPorUnidadClp: 1200, // almacenaje + picking Full por unidad, aprox tamaño pequeño
  },
}
