import test from 'node:test'
import assert from 'node:assert/strict'

test('ranking de categoría: qué productos son de la búsqueda del nicho', async () => {
  const { calzaConBusqueda } = await import('../frontend/src/lib/calzaConBusqueda.js')
  assert.equal(calzaConBusqueda('Mesa Plegable Portatil Multifuncional Mesa Auxiliar 60x60cm', 'mesa auxiliar'), true)
  assert.equal(calzaConBusqueda('Mesa Rectangular Plegable 180x74 cm Plástico Blanco', 'mesa auxiliar'), false)
  assert.equal(calzaConBusqueda('2pcs Kit Mesas De Centro 50x50x38', 'mesa de centro'), true, 'plural y palabra corta')
  assert.equal(calzaConBusqueda('Pastillas De Freno Kia Rio 4', 'pastillas freno'), true)
})
