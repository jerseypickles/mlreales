// Parámetros del modelo de costos de importación China → Chile y venta vía ML Full.
// TODOS son estimaciones editables: ajustar con cotizaciones reales (freight forwarder,
// tarifario ML de la categoría, tarifa Full vigente). Cada request puede sobreescribirlos.
export const importacion = {
  tipoCambioUsdClp: 950,

  flete: {
    // El importador trae CONTENEDOR COMPLETO SURTIDO: el costo del contenedor
    // es fijo y se prorratea por m³ entre todo lo que viene adentro. Tarifa
    // efectiva ≈ costo all-in del contenedor ÷ m³ útiles (ej: US$3.600 / 60 m³
    // = 60). Ajustable sin deploy con FLETE_M3_USD; si algún embarque va LCL
    // suelto, la tarifa real es ~180.
    maritimoUsdPorM3: Number(process.env.FLETE_M3_USD) || 60,
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
