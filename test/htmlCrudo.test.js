import test from 'node:test'
import assert from 'node:assert/strict'
import { resumirExtraccion } from '../src/services/htmlCrudo.js'

// El resumen es la primera pregunta cuando algo se rompe: ¿cambió ML o
// cambiamos nosotros? Guardar el HTML sin lo que el parser sacó ese día deja la
// mitad de la respuesta afuera.
//
// El caso que lo motiva: el 29-ago-2026 `conVendedor` habría pasado de 38 a 0
// entre dos corridas del mismo nicho, con el mismo HTML de origen. Eso apunta
// al parser. Si además hubiera cambiado `chars`, apuntaría a ML.
test('el resumen cuenta lo que el parser sacó, campo por campo', () => {
  const r = resumirExtraccion([
    { nuevoPrecio: 1000, Vendedor: 'CasaTua', cantidadVendida: 100, catalogId: 'MLC1', esAnuncio: false },
    { nuevoPrecio: 2000, Vendedor: null, cantidadVendida: null, catalogId: null, esAnuncio: true },
    { nuevoPrecio: null, Vendedor: 'Haiton', cantidadVendida: 25, catalogId: 'MLC2', esAnuncio: false },
  ])
  assert.deepEqual(r, {
    items: 3,
    conPrecio: 2,
    conVendedor: 2,
    conVendidos: 2,
    conCatalogId: 2,
    anuncios: 1,
  })
})

// Un precio de 0 es un dato (producto gratis no existe en ML, pero si llegara
// hay que verlo); un null es la ausencia. No se pueden confundir al contar.
test('el cero cuenta como dato, el null no', () => {
  const r = resumirExtraccion([{ nuevoPrecio: 0, cantidadVendida: 0 }])
  assert.equal(r.conPrecio, 1)
  assert.equal(r.conVendidos, 1)
  assert.equal(r.conVendedor, 0)
})

test('sin items el resumen es todo cero, no explota', () => {
  assert.equal(resumirExtraccion([]).items, 0)
  assert.equal(resumirExtraccion().items, 0)
})
