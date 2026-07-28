import test from 'node:test'
import assert from 'node:assert/strict'
import { motivoDeAuditar } from '../src/services/optimizador.js'

const ahora = new Date('2026-08-01T12:00:00Z')
const hace = (dias) => new Date(ahora.getTime() - dias * 86400e3)

test('motivoDeAuditar: sin auditoría previa o con la anterior fallida', () => {
  assert.match(motivoDeAuditar({ titulo: 'x' }, { ahora }), /sin auditoría/)
  assert.match(motivoDeAuditar({ titulo: 'x', auditoria: { estado: 'error' } }, { ahora }), /sin auditoría/)
})

test('motivoDeAuditar: no toca una auditoría en curso ni una fresca', () => {
  assert.equal(motivoDeAuditar({ auditoria: { estado: 'generando' } }, { ahora }), null)
  const fresca = { titulo: 'Igual', auditoria: { estado: 'ok', generadoEl: hace(2), miPublicacion: { titulo: 'Igual' } } }
  assert.equal(motivoDeAuditar(fresca, { ahora }), null)
})

test('motivoDeAuditar: el título editado a mano gatilla la re-auditoría al tiro', () => {
  const cambiado = {
    titulo: 'Pistola Juguete Dardos Tiro Al Blanco Diana Negro',
    auditoria: { estado: 'ok', generadoEl: hace(1), miPublicacion: { titulo: 'Set Tiro Al Blanco Juguete Negro' } },
  }
  assert.match(motivoDeAuditar(cambiado, { ahora }), /título .* cambió/)
})

test('motivoDeAuditar: una auditoría vieja se rehace por edad', () => {
  const vieja = { titulo: 'Igual', auditoria: { estado: 'ok', generadoEl: hace(9), miPublicacion: { titulo: 'Igual' } } }
  assert.match(motivoDeAuditar(vieja, { ahora }), /9 días/)
  // con umbral más largo, todavía no toca
  assert.equal(motivoDeAuditar(vieja, { ahora, dias: 30 }), null)
})
