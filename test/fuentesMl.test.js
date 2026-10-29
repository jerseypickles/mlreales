import test from 'node:test'
import assert from 'node:assert/strict'
import { frescuraFuente } from '../src/services/ml/fuentes.js'

test('la frescura depende de datos persistidos y distingue ausencia, atraso y fecha futura', () => {
  const opciones = { ahora: new Date('2025-02-20T12:00:00Z'), maxDias: 7 }
  assert.equal(frescuraFuente('2025-02-19T12:00:00Z', opciones).estado, 'al-dia')
  assert.equal(frescuraFuente('2025-02-01T12:00:00Z', opciones).estado, 'atrasada')
  assert.equal(frescuraFuente('2025-02-01T12:00:00Z', opciones).diasSinDatos, 19)
  for (const fecha of [null, 'inválida', '2025-02-21']) assert.equal(frescuraFuente(fecha, opciones).estado, 'sin-datos')
})
