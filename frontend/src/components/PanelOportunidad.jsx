import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtNum, fmtPrecio } from '../lib/formato.js'
import { Miniatura } from './ui.jsx'

// LOS TRES GRÁFICOS DE LA DECISIÓN, al abrir una oportunidad.
//
// La carta tenía los datos como una línea de texto y un gráfico del año de 40 px
// donde todas las barras se veían iguales. El importador: "ya estamos teniendo
// mejor data, mejor gráfico para tomar decisión". Cada gráfico contesta una
// pregunta de compra y cruza dos datos que antes vivían separados:
//   · Temporada  → ¿mi stock llega antes del pico?   (curva + ventana + tránsito)
//   · Precio     → ¿dónde cae mi precio en el listado? (rango real + tramo de envío)
//   · Pronóstico → ¿se espera más o menos búsqueda que el año pasado?

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIA = 86400e3
// mismos días que services/calendarioTemporadas.js
const LEAD_MIN = 45, LEAD_MAX = 55, RAMPA = 15

const mesesEntre = (desde, hasta) => {
  const m = new Set()
  if (!/^\d{4}-\d{2}$/.test(desde ?? '') || !/^\d{4}-\d{2}$/.test(hasta ?? '')) return m
  let [a, b] = [desde, hasta].map((p) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5)) - 1)
  for (let i = a; i <= b && i < a + 12; i++) m.add(i % 12)
  return m
}

export function GraficoTemporada({ curva, ventana, hoy = new Date() }) {
  if (!curva?.curva?.length) {
    return <div className="og og-vacio"><h4>Cuándo se busca</h4><p>Todavía sin curva de búsquedas medida para este nicho.</p></div>
  }
  const max = Math.max(...curva.curva) || 1
  const mesHoy = hoy.getMonth()
  const pedir = ventana?.tipo === 'estacional' ? mesesEntre(ventana.desde, ventana.hasta) : new Set()
  const llega = new Set()
  for (let d = LEAD_MIN; d <= LEAD_MAX + RAMPA; d += 5) llega.add(new Date(+hoy + d * DIA).getMonth())
  const esGoogle = curva.fuente === 'google-ads'
  const pico = curva.curva.indexOf(max)
  // ¿el barco lento llega antes del pico? distancia hacia adelante, en meses
  const ultimoMesLlegada = new Date(+hoy + (LEAD_MAX + RAMPA) * DIA).getMonth()
  const llegaAntes = ventana?.tipo !== 'estacional' ? null : (pico - ultimoMesLlegada + 12) % 12 <= 6
  return (
    <div className="og">
      <div className="og-cab">
        <h4>Cuándo se busca, y cuándo llega tu stock</h4>
        <span className="og-cifra">{curva.busquedasMes != null ? `${fmtNum(curva.busquedasMes)} búsq/mes` : ''}</span>
      </div>
      <div className="og-barras" role="img" aria-label={`Búsquedas por mes. Pico en ${MESES[pico]}.`}>
        {curva.curva.map((v, i) => (
          <div key={i} className="og-col" title={`${MESES[i]}: ${esGoogle ? `${fmtNum(v)} búsquedas` : `índice ${v}`}`}>
            <span className="og-valor">{i === pico && esGoogle ? fmtNum(v) : ''}</span>
            <span className={`og-barra${v >= max * 0.8 ? ' og-pico' : ''}${i === mesHoy ? ' og-hoy' : ''}`} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="og-eje">{MESES.map((m, i) => <span key={m} className={i === mesHoy ? 'og-hoy-txt' : ''}>{i === mesHoy ? 'hoy' : m}</span>)}</div>
      {pedir.size ? <div className="og-tira" aria-hidden="true">{MESES.map((m, i) => <span key={m} className={pedir.has(i) ? 'og-t-pedir' : ''} />)}</div> : null}
      <div className="og-tira" aria-hidden="true">{MESES.map((m, i) => <span key={m} className={llega.has(i) ? 'og-t-llega' : ''} />)}</div>
      <p className="og-leyenda">
        <span><i className="og-l og-l-pico" />meses fuertes</span>
        {pedir.size ? <span><i className="og-l og-l-pedir" />ventana para pedir</span> : null}
        <span><i className="og-l og-l-llega" />pidiendo hoy, tu stock vende aquí</span>
      </p>
      <p className="og-lectura">
        {curva.clasificacion === 'estacional'
          ? <>Temporada real: pico en <strong>{curva.nombreMesPico}</strong>, {curva.ratioPico}× el promedio. {llegaAntes === false ? 'Pidiendo hoy el stock llega con el pico ya pasado.' : 'Pidiendo hoy, el stock alcanza a estar vendiendo para el pico.'}</>
          : curva.clasificacion === 'alza-suave'
            ? <>Se busca todo el año, con una leve alza en <strong>{curva.nombreMesPico}</strong> ({curva.ratioPico}×). No hay fecha límite para pedir.</>
            : <>Se busca parejo todo el año: no hay fecha límite para pedir.</>}
        {curva.keywordMedida && curva.keywordMedida !== curva.keyword ? <> Medido como «{curva.keywordMedida}».</> : null}
      </p>
    </div>
  )
}

const TRAMO = { desde: 10_000, hasta: 19_989 }

export function GraficoPrecio({ precios, precioVenta }) {
  if (!precios?.mediana) return <div className="og og-vacio"><h4>Dónde cae tu precio</h4><p>El último scan no dejó rango de precios.</p></div>
  const tope = Math.max(precios.p75 * 1.5, (precioVenta ?? 0) * 1.25, TRAMO.hasta * 1.05)
  const x = (v) => `${Math.min(100, Math.max(0, (v / tope) * 100))}%`
  const ancho = (a, b) => `${Math.max(0, ((Math.min(b, tope) - a) / tope) * 100)}%`
  const dif = precioVenta ? Math.round((precioVenta / precios.mediana - 1) * 100) : null
  const enTramo = precioVenta >= TRAMO.desde && precioVenta <= TRAMO.hasta
  return (
    <div className="og">
      <div className="og-cab"><h4>Dónde cae tu precio en el listado</h4><span className="og-cifra">mediana {fmtPrecio(precios.mediana)}</span></div>
      <div className="og-precio" role="img" aria-label={`La mitad del listado vende entre ${fmtPrecio(precios.p25)} y ${fmtPrecio(precios.p75)}`}>
        <span className="og-p-tramo" style={{ left: x(TRAMO.desde), width: ancho(TRAMO.desde, TRAMO.hasta) }} title="Tramo $10.000–$19.989: donde el envío de Full pesa menos" />
        <span className="og-p-caja" style={{ left: x(precios.p25), width: ancho(precios.p25, precios.p75) }} title={`La mitad del listado: ${fmtPrecio(precios.p25)} a ${fmtPrecio(precios.p75)}`} />
        <span className="og-p-mediana" style={{ left: x(precios.mediana) }} />
        {precioVenta ? <span className="og-p-tuyo" style={{ left: x(precioVenta) }}><b>{fmtPrecio(precioVenta)}</b></span> : null}
      </div>
      <div className="og-p-eje"><span>$0</span><span>{fmtPrecio(Math.round(tope / 2 / 1000) * 1000)}</span><span>{fmtPrecio(Math.round(tope / 1000) * 1000)}</span></div>
      <p className="og-leyenda"><span><i className="og-l og-l-caja" />la mitad del listado</span><span><i className="og-l og-l-tramo" />tramo de envío barato</span><span><i className="og-l og-l-tuyo" />precio sugerido</span></p>
      <p className="og-lectura">
        {precioVenta
          ? <>Vendiendo a <strong>{fmtPrecio(precioVenta)}</strong> quedas {dif === 0 ? 'en la mediana' : <>{Math.abs(dif)}% {dif < 0 ? 'bajo' : 'sobre'} la mediana</>}
            {enTramo ? ', dentro del tramo $10.000–$19.989 donde el envío pesa menos.' : precioVenta < TRAMO.desde ? ', bajo $10.000: el envío fijo y la publicidad se comen el margen.' : ', sobre $19.990: el envío de Full salta a $3.600.'}</>
          : <>La mitad del listado vende entre {fmtPrecio(precios.p25)} y {fmtPrecio(precios.p75)}.</>}
      </p>
    </div>
  )
}

export function GraficoPronostico({ pronostico, modeloGana }) {
  const meses = (pronostico?.meses ?? []).filter((m) => m.referencia > 0).slice(0, 3)
  if (!meses.length) return <div className="og og-vacio"><h4>Los próximos meses</h4><p>Todavía sin pronóstico: aparece con el entrenamiento del lunes.</p></div>
  const max = Math.max(...meses.flatMap((m) => [m.referencia, m.estimado ?? 0])) || 1
  const total = (k) => meses.reduce((a, m) => a + (m[k] ?? 0), 0)
  const cambio = Math.round((total('estimado') / total('referencia') - 1) * 100)
  return (
    <div className="og">
      <div className="og-cab"><h4>Búsquedas de los próximos meses</h4>
        <span className={`og-cifra ${cambio >= 3 ? 'og-sube' : cambio <= -3 ? 'og-baja' : ''}`}>{cambio > 0 ? '+' : ''}{cambio}% vs año pasado</span></div>
      <div className="og-pares" role="img" aria-label="Año pasado contra lo que espera el modelo">
        {meses.map((m) => (
          <div key={m.periodo} className="og-par">
            <div className="og-par-barras">
              <span className="og-par-pasado" style={{ height: `${(m.referencia / max) * 100}%` }} title={`Año pasado: ${fmtNum(m.referencia)}`} />
              <span className="og-par-modelo" style={{ height: `${((m.estimado ?? 0) / max) * 100}%` }} title={`Modelo: ${fmtNum(m.estimado)}`} />
            </div>
            <strong>{MESES[Number(m.periodo.slice(5)) - 1]}</strong>
            <small>{fmtNum(m.referencia)} → {fmtNum(m.estimado)}</small>
          </div>
        ))}
      </div>
      <p className="og-leyenda"><span><i className="og-l og-l-pasado" />año pasado</span><span><i className="og-l og-l-modelo" />lo que espera el modelo</span></p>
      <p className="og-lectura">{modeloGana ? 'El modelo le gana a repetir el año pasado en la prueba.' : 'El modelo todavía se equivoca más que repetir el año pasado: para decidir cantidad, guíate por la barra gris.'}
        {pronostico.keywordMedida && pronostico.keywordMedida !== pronostico.nicho ? <> Medido como «{pronostico.keywordMedida}».</> : null}</p>
    </div>
  )
}

// LOS MÁS VENDIDOS DE LA CATEGORÍA, SEGÚN MERCADO LIBRE. No es una estimación:
// es el ranking que ML publica por su API. Guardado a diario muestra quién entró
// al top y quién viene subiendo — la señal que se adelanta a las reseñas.
export function MasVendidosCategoria({ nicho }) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    let vivo = true
    api.masVendidos(nicho).then((d) => vivo && setDatos(d.categorias?.[0] ?? false)).catch(() => vivo && setDatos(false))
    return () => { vivo = false }
  }, [nicho])
  if (datos === null) return null
  if (!datos) return <div className="og og-mv"><div className="og-cab"><h4>Más vendidos de la categoría, según Mercado Libre</h4></div><p className="og-lectura">Todavía sin ranking guardado para esta categoría: se captura todos los días a las 07:40 desde el 17-sep.</p></div>
  return (
    <div className="og og-mv">
      <div className="og-cab"><h4>Más vendidos de la categoría, según Mercado Libre</h4>
        <span className="og-cifra og-cifra-suave">{datos.comparadoCon ? `hoy contra el ${datos.comparadoCon.slice(8)}/${datos.comparadoCon.slice(5, 7)}` : `día 1 de ${datos.diasGuardados}: mañana se ve quién se movió`}</span></div>
      <ol className="mv-lista">{datos.items.slice(0, 10).map((i) => (
        <li key={i.id} className="mv-fila">
          <span className="mv-pos">{i.posicion}</span>
          {i.imagen ? <Miniatura src={i.imagen} lado={40} /> : <span className="mv-sinfoto" aria-hidden="true" />}
          <span className="mv-titulo">{i.url ? <a href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{i.titulo ?? 'ver en Mercado Libre'}</a> : (i.titulo ?? i.id)}
            {i.precio ? <small>{fmtPrecio(i.precio)}</small> : null}</span>
          <span className="mv-chips">
            {i.nuevo ? <em className="mv-chip mv-nuevo">entró al top</em> : null}
            {i.subio >= 2 ? <em className="mv-chip mv-sube">▲ {i.subio}</em> : null}
            {i.subio <= -2 ? <em className="mv-chip mv-baja">▼ {Math.abs(i.subio)}</em> : null}
            {i.enNuestroScan ? <em className="mv-chip" title="Este producto aparece en el listado que escaneamos para este nicho">en tu scan</em> : null}
          </span>
        </li>
      ))}</ol>
      <p className="og-lectura">Ranking oficial de ML para la categoría dominante de este nicho{datos.nichos?.length > 1 ? ` (compartida con ${datos.nichos.filter((n) => n !== nicho).slice(0, 3).join(', ')})` : ''}. Un producto que entra y se sostiene es demanda real antes de que se note en las reseñas.</p>
    </div>
  )
}

const stockTexto = (f) => (f.stockAhora == null ? '—' : f.topadoAhora ? `+${f.stockAhora - 1}` : f.stockAhora === 0 ? 'agotado' : `${f.stockAhora} exactas`)

// VENDEDORES COMO TÚ, SEGUIDOS POR STOCK. ML muestra el stock en baldes ("+25",
// "+10", "+5") y exacto solo al final; la baja entre dos lecturas es venta REAL
// de ese vendedor, como mínimo. No es un contador: es la prueba de si un
// entrante chico vende o no en este nicho.
export function VendedoresSeguidos({ nicho }) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    let vivo = true
    api.seguimiento(nicho).then((d) => vivo && setDatos(d)).catch(() => vivo && setDatos(false))
    return () => { vivo = false }
  }, [nicho])
  if (datos === null) return null
  const n = datos ? datos.nichos?.[0] : null
  if (!n) return <div className="og og-mv"><div className="og-cab"><h4>Vendedores como tú, seguidos por stock</h4></div>
    <p className="og-lectura">Todavía no se sigue a nadie acá. Se siguen solos los nichos en cotización o con la ventana de compra abierta, después de su próximo scan.</p></div>
  const cal = datos.calibracion
  return (
    <div className="og og-mv">
      <div className="og-cab"><h4>Vendedores como tú, seguidos por stock</h4>
        <span className="og-cifra">{n.vendiendo} de {n.publicaciones.length} vendiendo{n.unidadesPisoSemana ? ` · ≥${fmtNum(n.unidadesPisoSemana)} u/semana` : ''}</span></div>
      <ol className="mv-lista">{n.publicaciones.map((f) => (
        <li key={f.sku} className="mv-fila">
          {f.imagen ? <Miniatura src={f.imagen} lado={40} /> : <span className="mv-sinfoto" aria-hidden="true" />}
          <span className="mv-titulo"><a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{f.vendedor ?? 'vendedor'}</a>
            <small>{f.titulo}</small></span>
          <span className="mv-chips">
            <em className="mv-chip" title="Stock que muestra hoy Mercado Libre">{stockTexto(f)}</em>
            {f.unidadesPiso > 0 ? <em className="mv-chip mv-sube" title={`${f.unidadesExactas} contadas exactas; el resto es el mínimo que implica el cambio de balde`}>≥{f.unidadesPiso} u en {f.dias} d</em>
              : <em className="mv-chip" title="Entre las lecturas no se vio bajar el stock">{f.lecturas < 2 ? '1ª lectura' : 'sin baja visible'}</em>}
            {f.reposiciones ? <em className="mv-chip mv-nuevo">repuso ×{f.reposiciones}</em> : null}
          </span>
        </li>
      ))}</ol>
      <p className="og-lectura">Es un mínimo, no un conteo: ML muestra el stock en rangos y solo se ve lo que cruza de rango o baja en las últimas unidades.
        {cal?.pctVisto != null ? <> En tus propias publicaciones, donde la venta real se conoce, este método ve el <strong>{cal.pctVisto}%</strong> de las unidades ({fmtNum(cal.unidadesVistas)} de {fmtNum(cal.unidadesReales)}).</> : ' La calibración contra tus propias publicaciones aparece con unos días de lecturas.'}</p>
    </div>
  )
}
