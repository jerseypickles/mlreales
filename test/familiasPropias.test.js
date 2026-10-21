import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorFamilia,
  resumenFamilia,
  ordenarEntradas,
  etiquetaVariantes,
} from '../frontend/src/lib/familiasPropias.js'
import { familiaDeItem } from '../src/services/propios.js'
import { filasCartera, compararCartera } from '../src/services/cartera.js'

// Mis productos el 21-oct-2026: la manguera de 15 m y la de 30 m en tres
// colores cada una (una publicación por color en ML), más un set de brochas
const M15 = { id: '5975822076196498', nombre: 'Manguera Retráctil Expandible Jardín 15 M Con Pistola' }
const M30 = { id: '3598115575837009', nombre: 'Manguera Retráctil Expandible Jardín 30 M Con Pistola' }
const propio = (id, familia, variante, { creadoEl = '2026-10-21T12:00:00Z', precio = 13990, visitas = 0, stock = 33, ...extra } = {}) => ({
  _id: id,
  sku: `MLC${id}`,
  titulo: familia ? `${familia.nombre} ${variante}` : `Brochas Maquillaje ${id}`,
  imagen: `https://img/${id}.jpg`,
  url: `https://ml/${id}`,
  familiaMl: familia ? { id: familia.id, nombre: familia.nombre, variante, porColor: true } : null,
  creadoEl,
  mediciones: [{ precio, precioEfectivo: precio, visitas, stock, numReviews: 0 }],
  ...extra,
})

const rojo15 = propio('r15', M15, 'Rojo', { creadoEl: '2026-10-21T02:05:00Z', stock: 100 })
const verde15 = propio('v15', M15, 'Verde', { creadoEl: '2026-10-21T14:20:00Z' })
const azul15 = propio('a15', M15, 'Azul', { creadoEl: '2026-10-21T14:21:00Z' })
const rojo30 = propio('r30', M30, 'Rojo', { creadoEl: '2026-10-21T18:53:10Z', precio: 19890, stock: 17 })
const verde30 = propio('v30', M30, 'Verde', { creadoEl: '2026-10-21T18:53:20Z', precio: 19890, stock: 17 })
const azul30 = propio('a30', M30, 'Azul', { creadoEl: '2026-10-21T18:53:31Z', precio: 19890, stock: 16 })
const brochas = propio('b8', null, null, { creadoEl: '2026-07-20T12:00:00Z', precio: 4490, visitas: 180 })

test('agruparPorFamilia: seis publicaciones de mangueras son dos productos; la primera publicada da la cara', () => {
  // la API las entrega de la más nueva a la más vieja
  const entradas = agruparPorFamilia([azul30, verde30, rojo30, azul15, verde15, rojo15, brochas])
  assert.equal(entradas.length, 3)
  const m30 = entradas.find((e) => e.clave === `familia:${M30.id}`)
  assert.equal(m30.p._id, 'r30', 'la roja se publicó primero')
  assert.deepEqual(m30.variantes.map((v) => v._id), ['r30', 'v30', 'a30'])
  assert.equal(m30.titulo, M30.nombre)
  assert.equal(m30.m.stock, 50)
  const suelto = entradas.find((e) => e.clave === 'b8')
  assert.equal(suelto.variantes, null)
  assert.equal(suelto.titulo, 'Brochas Maquillaje b8')
})

test('agruparPorFamilia: un color solo, o sin familia, sigue siendo su propia tarjeta', () => {
  const entradas = agruparPorFamilia([rojo30, { ...brochas, familiaMl: null }])
  assert.equal(entradas.length, 2)
  assert.ok(entradas.every((e) => e.variantes === null))
})

test('resumenFamilia: suma ventas y visitas, recalcula la conversión y nombra el color que se quiebra antes', () => {
  const r = resumenFamilia([
    { ...rojo15, ventas7d: { unidades: 2 }, ventas30d: { unidades: 5, ingresosClp: 69950 }, mediciones: [{ precio: 13990, visitas: 40, stock: 90 }], reposicion: { urgencia: 'holgado', diasCobertura: 60, aEnviar: 0 } },
    { ...verde15, mediciones: [{ precio: 13990, visitas: 10, stock: 3 }], reposicion: { urgencia: 'critico', diasCobertura: 4, aEnviar: 20 } },
    { ...azul15, ventas7d: { unidades: 1 }, ventas30d: { unidades: 1, ingresosClp: 13990 }, mediciones: [{ precio: 14990, visitas: 10, stock: 30 }], reposicion: { urgencia: 'reponer', diasCobertura: 12, aEnviar: 10 } },
  ])
  assert.equal(r.ventas7, 3)
  assert.equal(r.visitas7, 60)
  assert.equal(r.conversion7d, 5)
  assert.equal(r.stock, 123)
  assert.equal(r.aEnviar, 30)
  assert.equal(r.reposicion.urgencia, 'critico')
  assert.equal(r.reposicion.variante, 'Verde')
  assert.equal(r.reposicion.todas, false)
  assert.deepEqual([r.precio, r.precioHasta], [13990, 14990], 'colores a distinto precio: rango')
  assert.deepEqual(r.ventas30d, { unidades: 6, ingresosClp: 83940 })
})

test('resumenFamilia: el margen se suma solo si todos los colores que vendieron tienen costo', () => {
  const conCosto = (p, margenClp) => ({ ...p, ventas30d: { unidades: 1, ingresosClp: 13990 }, margen30d: { margenClp, costoClp: 6772, base: 'cargos reales de ML' } })
  const sinCosto = { ...azul15, ventas30d: { unidades: 1, ingresosClp: 13990 }, margen30d: null }
  assert.equal(resumenFamilia([conCosto(rojo15, 3500), sinCosto]).margen30d, null, 'una suma parcial no es el margen del producto')
  const r = resumenFamilia([conCosto(rojo15, 3500), conCosto(verde15, 3400), azul15])
  assert.equal(r.margen30d.margenClp, 6900)
  assert.equal(r.margen30d.base, 'cargos reales de ML')
})

test('resumenFamilia: si todos los colores están igual, el sello no nombra uno', () => {
  const quebrado = { urgencia: 'quebrado', diasCobertura: 0, aEnviar: 0 }
  const r = resumenFamilia([rojo30, verde30].map((p) => ({ ...p, estadoMl: 'paused', reposicion: quebrado })))
  assert.equal(r.reposicion.todas, true)
  assert.equal(r.pausada, true)
})

test('ordenarEntradas: un producto con colores se ordena por el color que se quiebra antes', () => {
  const entradas = agruparPorFamilia([
    { ...brochas, reposicion: { urgencia: 'reponer', diasCobertura: 10 } },
    { ...rojo15, reposicion: { urgencia: 'holgado', diasCobertura: 80 } },
    { ...verde15, reposicion: { urgencia: 'critico', diasCobertura: 5 } },
  ])
  assert.deepEqual(ordenarEntradas(entradas, 'urgencia').map((e) => e.clave), [`familia:${M15.id}`, 'b8'])
  assert.deepEqual(ordenarEntradas(entradas, 'alfabetico').map((e) => e.clave), ['b8', `familia:${M15.id}`])
})

test('etiquetaVariantes: colores cuando cambia el color; variantes si no', () => {
  assert.equal(etiquetaVariantes([rojo30, verde30, azul30]), '3 colores')
  assert.equal(etiquetaVariantes([rojo30, verde30], { conArticulo: true }), 'los 2 colores')
  const talla = (p) => ({ ...p, familiaMl: { ...p.familiaMl, porColor: false } })
  assert.equal(etiquetaVariantes([talla(rojo30), talla(verde30)], { conArticulo: true }), 'las 2 variantes')
})

// el item de la manguera roja de 30 m tal como lo entrega la API
const ITEM = {
  id: 'MLC2360267971',
  title: 'Manguera Retráctil Expandible Jardín 30 M Con Pistola Rojo',
  family_name: 'Manguera Retráctil Expandible Jardín 30 M Con Pistola',
  user_product_id: 'MLCU5598692087',
  attributes: [{ id: 'COLOR', value_name: 'Rojo' }, { id: 'LENGTH', value_name: '30 m' }],
}

test('familiaDeItem: la familia sale del producto de usuario; la variante es lo que el título agrega', async () => {
  const pedidos = []
  const pedir = async (ruta) => (pedidos.push(ruta), { family_id: 3598115575837009 })
  const f = await familiaDeItem(ITEM, null, { pedir })
  assert.deepEqual(pedidos, ['/user-products/MLCU5598692087'])
  assert.equal(f.id, '3598115575837009')
  assert.equal(f.nombre, ITEM.family_name)
  assert.equal(f.variante, 'Rojo')
  assert.equal(f.porColor, true)
  assert.ok(f.fecha instanceof Date)
})

test('familiaDeItem: guardada para el mismo producto no vuelve a preguntar, salvo en la pasada completa', async () => {
  let llamadas = 0
  const pedir = async () => (llamadas++, { family_id: 111 })
  const guardada = { id: '3598115575837009', nombre: ITEM.family_name, userProductId: ITEM.user_product_id, variante: 'Rojo', fecha: new Date('2026-10-21') }
  assert.equal((await familiaDeItem(ITEM, guardada, { pedir })).id, '3598115575837009')
  assert.equal(llamadas, 0)
  // ML la movió de familia (le pasó a la verde y la azul de 15 m): la pasada completa lo ve
  assert.equal((await familiaDeItem(ITEM, guardada, { pedir, refrescar: true })).id, '111')
  assert.equal(llamadas, 1)
})

test('familiaDeItem: si ML no responde se queda la guardada; sin producto de usuario no hay familia nueva', async () => {
  const falla = async () => {
    throw new Error('429')
  }
  const guardada = { id: '3598115575837009', nombre: ITEM.family_name, userProductId: ITEM.user_product_id, variante: 'Rojo', fecha: null }
  assert.equal((await familiaDeItem(ITEM, guardada, { pedir: falla, refrescar: true })).id, '3598115575837009')
  assert.equal(await familiaDeItem(ITEM, null, { pedir: falla }), null)
  assert.equal(await familiaDeItem({ id: 'MLC1', title: 'x' }, guardada, { pedir: falla }), guardada)
})

test('familiaDeItem: si el título no empieza con el nombre de la familia, la variante es el color', async () => {
  const f = await familiaDeItem({ ...ITEM, title: 'Manguera Mágica 30 M Roja' }, null, { pedir: async () => ({ family_id: 1 }) })
  assert.equal(f.variante, 'Rojo')
})

test('filasCartera: los colores de una familia son una fila; la conversión sale de los totales', () => {
  const v = (p, visitas, unidades) => ({ ...p, mediciones: [{ visitas, precioEfectivo: 13990 }], ventas7d: { unidades }, conversion7d: unidades && visitas ? Math.round((unidades / visitas) * 1000) / 10 : null })
  const filas = filasCartera([v(azul15, 30, 0), v(verde15, 20, 1), v(rojo15, 50, 4), v(rojo30, 40, 1), v(verde30, 10, 0), v(brochas, 180, 9)])
  assert.equal(filas.length, 3)
  const f15 = filas.find((f) => f.titulo === M15.nombre)
  assert.deepEqual([f15.sku, f15.visitas7d, f15.ventas7d, f15.conversion7d], ['MLCr15', 100, 5, 5])
  const f30 = filas.find((f) => f.titulo === M30.nombre)
  assert.deepEqual([f30.visitas7d, f30.ventas7d, f30.conversion7d], [50, 1, 2])
  // un producto con tres colores y nada más no es una cartera que comparar
  assert.equal(compararCartera(filasCartera([v(azul15, 30, 0), v(verde15, 20, 1), v(rojo15, 50, 4)])), null)
})
