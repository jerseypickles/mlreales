import { Cifra, Cifras, Etiqueta, Nivel, Nota, Preguntas, Subtitulo, Tarjeta } from './sistema.jsx'
import { fmtNum } from '../lib/formato.js'

// LAS TRES SEÑALES DE UN NICHO Y EL VEREDICTO POR LO MEDIDO (20-nov-2026). El importador: «tenemos 3 cosas: Google,
// la búsqueda en ML y ahora la venta; se supone que hay veredicto que dar». Antes cada dato iba suelto en una lista
// y el veredicto lo escribía la IA. Acá las tres se leen igual (cuánto, contra los demás nichos, hacia dónde va y
// qué tan firme es el dato), debajo va la lectura que sale de las tres y después las tres preguntas del veredicto,
// cada una con su respuesta. Todo viene calculado del servidor (services/senalesNicho.js): acá solo se dice.

const coma = (n, decimales = 1) => Number(n).toFixed(decimales).replace('.', ',')
const NIVEL = { alto: ['Alta', 'bien'], medio: ['Media', 'neutra'], bajo: ['Baja', 'atencion'] }
const DEMANDA = { fuerte: ['Demanda fuerte', 'bien'], media: ['Demanda media', 'neutra'], debil: ['Demanda baja', 'atencion'], 'casi-nula': ['Casi no se vende', 'problema'], 'sin-medir': ['Sin venta medida', 'neutra'] }
export const VEREDICTO_MEDIDO = {
  entrar: ['Entrar', 'bien'],
  entrar_con_condiciones: ['Entrar con condiciones', 'atencion'],
  no_entrar: ['No entrar', 'problema'],
  'falta-medir': ['Falta medir', 'neutra'],
}
const ANALISTA = { entrar: 'entrar', entrar_con_condiciones: 'entrar con condiciones', no_entrar: 'no entrar' }
const RESPUESTA = { bien: 'Sí', atencion: 'Con cuidado', problema: 'No', 'sin-dato': 'Sin medir' }
const GRUPO = { crecen: 'entre las que más crecen en ventas', buscadas: 'entre las más buscadas', suben: 'entre las que suben en búsquedas', 'en-la-lista': 'en las tendencias' }

function lugarEnPalabras(lugar) {
  if (!Number.isFinite(lugar)) return null
  return `más que ${lugar} de cada 100 nichos`
}

function EtiquetaNivel({ s }) {
  const n = NIVEL[s?.nivel]
  if (!n) return null
  return <Etiqueta tono={n[1]}>{n[0]}{Number.isFinite(s.lugar) ? ` · ${lugarEnPalabras(s.lugar)}` : ''}</Etiqueta>
}

function Venta({ v }) {
  const medida = v?.valor != null
  return (
    <Cifra
      etiqueta="Venta en Mercado Libre"
      valor={medida ? coma(v.valor) : '—'}
      detalle={medida ? `reseñas nuevas por día en las publicaciones del nicho (${v.scans} ${v.scans === 1 ? 'medición' : 'mediciones'} en 45 días)` : `todavía sin venta medida (${v?.scans ?? 0} de 2 mediciones)`}
    >
      {medida ? <Nivel fraccion={(v.lugar ?? 0) / 100} tono={NIVEL[v.nivel]?.[1] ?? 'neutra'} /> : null}
      <EtiquetaNivel s={v} />
      {v?.tendencia === 'sube' ? <Etiqueta tono="bien">Viene subiendo</Etiqueta> : null}
      {v?.tendencia === 'baja' ? <Etiqueta tono="atencion">Viene bajando</Etiqueta> : null}
      {v?.tendencia === 'estable' ? <Etiqueta>Pareja entre mediciones</Etiqueta> : null}
      {v?.temporada === 'baja' ? <Etiqueta>En su temporada baja</Etiqueta> : null}
      {v?.temporada === 'fuera' ? <Etiqueta tono="atencion">Fuera de temporada</Etiqueta> : null}
      <p>
        {!medida ? 'Hacen falta dos mediciones para decir cuánto se vende.'
          : v.confianza === 'alta' ? 'Dato firme: es lo que mejor anticipa lo que el nicho vende después.'
          : 'Dato con pocas mediciones: sirve, pero todavía puede moverse.'}
      </p>
    </Cifra>
  )
}

function BusquedaMl({ b }) {
  const escrito = { alto: 'La gente la escribe', medio: 'Se escribe a medias', bajo: 'Se escribe poco', nulo: 'Nadie la escribe', 'otra-frase': 'Se busca con otra frase' }[b?.nivel]
  const tono = { alto: 'bien', medio: 'neutra', bajo: 'atencion', nulo: 'problema', 'otra-frase': 'atencion' }[b?.nivel] ?? 'neutra'
  const t = b?.enTendencias
  return (
    <Cifra
      etiqueta="Búsqueda en Mercado Libre"
      valor={b?.posicion ? `${b.posicion}.º de ${b.deCuantas ?? '?'}` : '—'}
      detalle={b?.posicion ? `lugar entre las sugerencias al escribir «${b.prefijo}» en el buscador` : b?.nivel ? 'no sale entre las sugerencias del buscador' : 'todavía sin medir'}
    >
      {escrito ? <Etiqueta tono={tono}>{escrito}</Etiqueta> : null}
      {t ? <Etiqueta tono="bien">{`${GRUPO[t.grupo] ?? 'en las tendencias'} de ${t.categoria}`.replace(/^./, (c) => c.toUpperCase())}{t.de > 1 ? ` · ${t.semanas} de ${t.de} semanas` : ''}</Etiqueta> : null}
      {!t && b?.tendenciasMedidas ? <Etiqueta>Fuera de las tendencias semanales</Etiqueta> : null}
      <p>
        {b?.tendenciasMedidas ? 'Las tendencias son las listas semanales que publica Mercado Libre; acá cuentan las de categorías grandes.' : 'Las tendencias de las categorías grandes se están empezando a medir.'}
        {' '}El buscador dice si la frase se escribe, no cuánta gente: solo, es un dato flojo.
      </p>
    </Cifra>
  )
}

function Google({ g }) {
  const pct = g?.variacionPct
  return (
    <Cifra
      etiqueta="Búsqueda en Google"
      valor={g?.valor != null ? fmtNum(g.valor) : '—'}
      detalle={g?.valor != null ? `búsquedas al mes en Chile${g.medidaCon ? `, medidas con «${g.medidaCon}»` : ''}` : 'sin medición de Google'}
    >
      {g?.valor != null ? <Nivel fraccion={(g.lugar ?? 0) / 100} tono={NIVEL[g.nivel]?.[1] ?? 'neutra'} /> : null}
      <EtiquetaNivel s={g} />
      {g?.tendencia && Number.isFinite(pct) ? (
        <Etiqueta
          tono={g.tendencia === 'sube' ? 'bien' : g.tendencia === 'baja' ? 'atencion' : 'neutra'}
          title={g.contraMercado ? 'Últimos 12 meses contra los 12 anteriores, descontado lo que se movieron todas las búsquedas juntas.' : 'Últimos 12 meses contra los 12 anteriores.'}
        >
          {g.tendencia === 'sube' ? 'Crece' : g.tendencia === 'baja' ? 'Cae' : 'Pareja'} contra el año pasado ({pct > 0 ? '+' : ''}{coma(pct, 0)}%)
        </Etiqueta>
      ) : null}
      <p>Mide el interés en todo Chile, no lo que se compra en Mercado Libre: explica la demanda y la temporada, pero no decide.</p>
    </Cifra>
  )
}

export function SenalesNicho({ o }) {
  const s = o?.senales, d = o?.demanda, v = o?.veredictoMedido
  if (!s || !d) return null
  const [nombreDemanda, tonoDemanda] = DEMANDA[d.nivel] ?? DEMANDA['sin-medir']
  const [nombreVeredicto, tonoVeredicto] = VEREDICTO_MEDIDO[v?.veredicto] ?? VEREDICTO_MEDIDO['falta-medir']
  const analista = ANALISTA[o.veredicto]
  const distinto = v && analista && v.veredicto !== o.veredicto
  return (
    <Tarjeta className="s-senales">
      <Subtitulo titulo="¿Hay demanda?"><Etiqueta tono={tonoDemanda}>{nombreDemanda}</Etiqueta></Subtitulo>
      <p className="s-senales-lectura">{d.frase}</p>
      <Cifras>
        <Venta v={s.ventaMl} />
        <BusquedaMl b={s.busquedaMl} />
        <Google g={s.google} />
      </Cifras>
      <Nota>
        «Alta», «media» y «baja» son los tercios entre los nichos de la mesa, no una vara fija. La demanda se lee por la venta medida en
        Mercado Libre; las búsquedas la explican, o la reemplazan mientras todavía no hay venta medida.
      </Nota>
      {v ? (
        <>
          <Subtitulo titulo="Veredicto por lo medido"><Etiqueta tono={tonoVeredicto}>{nombreVeredicto}</Etiqueta></Subtitulo>
          <p className="s-senales-lectura">{v.porQue}</p>
          <Preguntas items={v.pasos.map((p) => ({ id: p.id, pregunta: p.pregunta, respuesta: RESPUESTA[p.estado] ?? 'Sin medir', tono: p.estado === 'sin-dato' ? 'neutra' : p.estado, frase: p.frase }))} />
          <Nota>
            {distinto
              ? `El analista (la IA) había escrito «${analista}». Manda lo medido: su texto sirve para entender el producto y qué traer, no para decidir si hay demanda.`
              : 'Este veredicto sale de reglas sobre lo medido. El analista (la IA) explica el nicho y propone qué producto traer; no decide.'}
          </Nota>
        </>
      ) : null}
    </Tarjeta>
  )
}

// La etiqueta corta del veredicto medido, para la fila de la mesa y la cabecera del panel.
export function EtiquetaVeredicto({ o }) {
  const v = o?.veredictoMedido
  const par = VEREDICTO_MEDIDO[v?.veredicto]
  if (!par) return null
  return <Etiqueta tono={par[1]} title={`Veredicto por lo medido. ${v.porQue}`}>{par[0]}</Etiqueta>
}
