import test from 'node:test'
import assert from 'node:assert/strict'
import { presionPublicitaria } from '../src/services/metricas.js'
import { aItemBusqueda } from '../src/services/listadoMl.js'

test('presión publicitaria: parte del top que paga, anunciantes y anuncios puros', () => {
  const productos = new Map([
    ['A', { vendedor: 'tienda1', esTiendaOficial: true }],
    ['B', { vendedor: 'tienda2' }],
    ['C', { vendedor: 'tienda3' }],
    ['D', { vendedor: 'tienda2' }],
  ])
  const snaps = [
    { sku: 'A', pagaPublicidad: true, esAnuncio: false },
    { sku: 'B', pagaPublicidad: false, esAnuncio: false },
    { sku: 'C', pagaPublicidad: false, esAnuncio: false },
    { sku: 'D', pagaPublicidad: true, esAnuncio: true },
  ]
  const top = snaps.filter((s) => !s.esAnuncio)
  const p = presionPublicitaria(snaps, top, productos)
  assert.equal(p.pctTopPaga, 33, '1 de los 3 orgánicos además paga')
  assert.equal(p.anunciantes, 2)
  assert.equal(p.anunciantesOficiales, 1)
  assert.equal(p.anunciosPuros, 1)
})

test('presión publicitaria: scans sin el dato no inventan un número', () => {
  assert.equal(presionPublicitaria([{ sku: 'A', pagaPublicidad: null }], [], new Map()), null)
  assert.equal(presionPublicitaria([], [], new Map()), null)
})

test('listado: paga publicidad aunque además rankee orgánico', () => {
  const tarjeta = { metadata: { id: 'MLC1' } }
  assert.equal(aItemBusqueda(tarjeta, { tienePad: true, tieneOrganico: true }).pagaPublicidad, true)
  assert.equal(aItemBusqueda(tarjeta, { tienePad: true, tieneOrganico: true }).esAnuncio, false)
  assert.equal(aItemBusqueda(tarjeta, { tienePad: false, tieneOrganico: true }).pagaPublicidad, false)
  assert.equal(aItemBusqueda(tarjeta, null).pagaPublicidad, null)
})
