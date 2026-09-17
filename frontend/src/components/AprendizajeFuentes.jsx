import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, PackageX, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtFecha, fmtNum, fmtPrecio } from '../lib/formato.js'

// DOS FUENTES QUE SE PUEDEN MIRAR POR DENTRO. El importador: "necesito ver qué
// está obteniendo". El resumen dice cuánto se guardó; esto muestra QUÉ se leyó,
// publicación por publicación, tal como llegó de Mercado Libre.

const stockTexto = (l) => (l?.stock == null ? '—' : l.topado ? `+${l.stock - 1}` : l.stock === 0 ? 'agotado' : String(l.stock))
const dentroDe = (fecha) => {
  const h = (new Date(fecha) - Date.now()) / 3600e3
  if (h <= 0) return 'toca ahora'
  return h < 24 ? `en ${Math.round(h)} h` : `en ${Math.round(h / 24)} d`
}
const hace = (fecha) => {
  const h = (Date.now() - new Date(fecha)) / 3600e3
  return h < 1 ? 'hace minutos' : h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} d`
}

// La serie de lecturas como una fila de fichas: "+25 → +10 → 4 → 1 → +25".
// Verde cuando bajó (vendió), azul cuando subió (repuso), gris si no se movió.
function SerieStock({ serie }) {
  const buenas = (serie ?? []).filter((l) => l.ok && l.stock != null)
  if (!buenas.length) return <span className="st-vacio">sin lecturas todavía</span>
  return (
    <span className="st-serie">
      {buenas.slice(-10).map((l, i, arr) => {
        const previa = arr[i - 1]
        const clase = !previa ? '' : l.stock < previa.stock ? 'st-bajo' : l.stock > previa.stock ? 'st-subio' : ''
        return <span key={l.fecha} className={`st-ficha ${clase}${l.topado ? ' st-balde' : ''}`} title={`${fmtFecha(l.fecha)}${l.topado ? ' · rango, no número exacto' : ' · número exacto'}${l.precio ? ` · ${fmtPrecio(l.precio)}` : ''}`}>{stockTexto(l)}</span>
      })}
    </span>
  )
}

function FilaSeguida({ f }) {
  return (
    <tr className={f.activo === false ? 'st-baja' : ''}>
      <td className="celda-titulo apr-producto"><div className="apr-producto-fila">
        {f.imagen ? <img src={f.imagen.replace(/^http:/, 'https:')} alt="" loading="lazy" width="48" height="48" /> : <span className="apr-foto-vacia" aria-hidden="true"><PackageX size={18} /></span>}
        <div><a href={f.url} target="_blank" rel="noreferrer">{f.esPropio ? (f.titulo ?? f.sku) : (f.vendedor ?? 'vendedor')}</a>
          <small>{f.esPropio ? 'publicación tuya · leída desde afuera' : f.titulo}</small></div>
      </div></td>
      <td><SerieStock serie={f.serie} /></td>
      <td className="num">{f.unidadesPiso > 0 ? <strong title={`${f.unidadesExactas} contadas exactas; el resto es el mínimo que implica el cambio de rango`}>≥{fmtNum(f.unidadesPiso)}</strong> : f.lecturas < 2 ? '—' : '0'}
        {f.porSemana ? <small className="st-sub">≥{fmtNum(f.porSemana)} / semana</small> : null}</td>
      <td className="num">{f.reposiciones || '—'}</td>
      <td className="num">{fmtNum(f.lecturas)}<small className="st-sub">{f.dias ? `en ${f.dias} d` : ''}</small></td>
      <td>{f.activo === false
        ? <span className="apr-chip apr-chip-aviso"><AlertTriangle size={13} aria-hidden="true" />{f.motivoBaja ?? 'fuera de la lista'}</span>
        : <span className="apr-chip"><Clock size={13} aria-hidden="true" />{dentroDe(f.proximaLecturaEl)}</span>}</td>
    </tr>
  )
}

function TablaSeguidos({ filas }) {
  return (
    <div className="tabla-envoltura apr-tabla">
      <table><thead><tr>
        <th scope="col">Publicación</th><th scope="col">Stock leído, de más antiguo a más nuevo</th>
        <th scope="col" className="num">Vendió como mínimo</th><th scope="col" className="num">Repuso</th>
        <th scope="col" className="num">Lecturas</th><th scope="col">Próxima lectura</th>
      </tr></thead><tbody>{filas.map((f) => <FilaSeguida key={f.sku} f={f} />)}</tbody></table>
    </div>
  )
}

export function StockCompetidores() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const cargar = useCallback(() => api.seguimiento().then((r) => { setD(r); setError(null) }).catch((e) => setError(e.message)), [])
  useEffect(() => {
    cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') cargar() }, 60_000)
    return () => clearInterval(t)
  }, [cargar])
  if (error && !d) return <p className="error-bloque" role="alert">No se pudo leer el seguimiento: {error}</p>
  if (!d) return <Cargando texto="Leyendo el seguimiento de stock…" />
  const pct = Math.min(100, (d.gasto.mesUsd / d.topeUsdMes) * 100)
  const cal = d.calibracion
  return (
    <>
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Cómo va el seguimiento de stock</h3>
          <p>Mercado Libre muestra el stock en rangos (“+25”, “+10”, “+5”) y el número exacto solo al final. Se lee seguido a vendedores chicos: cuando el stock baja de un rango a otro, eso es venta real — como mínimo.</p></div>
        <div className="apr-fuentes">
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><Wallet size={17} aria-hidden="true" /></span><h3>Gasto del mes</h3></div>
            <p className="apr-cifra">US${d.gasto.mesUsd.toFixed(2)}<small> de US${d.topeUsdMes}</small></p>
            <div className="apr-medidor"><span style={{ width: `${pct}%` }} /></div>
            <p className="apr-fuente-detalle">{fmtNum(d.gasto.lecturasMes)} lecturas este mes · tope fijo, no se pasa</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><PackageX size={17} aria-hidden="true" /></span><h3>Publicaciones seguidas</h3></div>
            <p className="apr-cifra">{fmtNum(d.seguidos)}<small> activas</small></p>
            <p className="apr-fuente-detalle">{fmtNum(d.nichos.length)} nichos · {fmtNum(d.propios.length)} tuyas para calibrar · {fmtNum(d.pendientesAhora ?? 0)} esperando lectura</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><TrendingDown size={17} aria-hidden="true" /></span><h3>Vendiendo</h3></div>
            <p className="apr-cifra">{fmtNum(d.nichos.reduce((a, n) => a + n.vendiendo, 0))}<small> publicaciones con baja vista</small></p>
            <p className="apr-fuente-detalle">{fmtNum(d.nichos.reduce((a, n) => a + n.reposiciones, 0))} reposiciones detectadas</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CheckCircle2 size={17} aria-hidden="true" /></span><h3>Cuánto ve el método</h3></div>
            <p className="apr-cifra">{cal?.pctVisto != null ? `${cal.pctVisto}%` : '—'}<small>{cal?.pctVisto != null ? ' de tus ventas reales' : ''}</small></p>
            <p className="apr-fuente-detalle">{cal ? `En ${cal.productos} publicaciones tuyas: vio ${fmtNum(cal.unidadesVistas)} de ${fmtNum(cal.unidadesReales)} unidades vendidas` : 'Se mide con tus publicaciones, donde la venta real se conoce. Necesita unos días de lecturas.'}</p></article>
        </div>
      </section>

      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Tus publicaciones, leídas desde afuera</h3><p>Se leen igual que un competidor. Como su venta real se conoce, dicen cuánto confiarle al método.</p></div>
        {d.propios.length ? <TablaSeguidos filas={d.propios} /> : <p className="apr-vacio">Sin publicaciones propias en seguimiento.</p>}
      </section>

      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Competidores por nicho</h3><p>Nichos en cotización o con la ventana de compra abierta. Hasta 6 vendedores por nicho, uno por tienda, sin tiendas oficiales.</p></div>
        {!d.nichos.length ? <p className="apr-vacio">Todavía no hay competidores en la lista. Se suman solos en la próxima pasada (corre cada 2 horas).</p>
          : d.nichos.sort((a, b) => b.unidadesPisoSemana - a.unidadesPisoSemana || b.seguidos - a.seguidos).map((n) => (
            <div key={n.keyword} className="st-nicho">
              <button type="button" className="st-nicho-cab" aria-expanded={abierto === n.keyword} onClick={() => setAbierto(abierto === n.keyword ? null : n.keyword)}>
                <strong>{n.keyword}</strong>
                <span className={`apr-chip ${n.vendiendo ? 'apr-chip-bien' : ''}`}>{n.vendiendo} de {n.publicaciones.length} vendiendo</span>
                {n.unidadesPisoSemana ? <span className="apr-chip apr-chip-bien"><TrendingDown size={13} aria-hidden="true" />≥{fmtNum(n.unidadesPisoSemana)} u / semana</span> : null}
                {n.reposiciones ? <span className="apr-chip">{n.reposiciones} reposiciones</span> : null}
                <span className="st-nicho-mini">{n.publicaciones.slice(0, 6).map((f) => <em key={f.sku} className="st-ficha st-balde">{stockTexto({ stock: f.stockAhora, topado: f.topadoAhora })}</em>)}</span>
              </button>
              {abierto === n.keyword ? <TablaSeguidos filas={n.publicaciones} /> : null}
            </div>
          ))}
      </section>

      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Lo último que se leyó</h3><p>El registro tal como llegó. Una lectura fallida también se paga.</p></div>
        {!d.ultimasLecturas?.length ? <p className="apr-vacio">Sin lecturas todavía.</p> : <div className="tabla-envoltura apr-tabla apr-tabla-corta"><table>
          <thead><tr><th scope="col">Cuándo</th><th scope="col">De quién</th><th scope="col">Nicho</th><th scope="col" className="num">Stock leído</th><th scope="col">Resultado</th></tr></thead>
          <tbody>{d.ultimasLecturas.map((l, i) => <tr key={`${l.sku}-${l.fecha}-${i}`}>
            <td title={fmtFecha(l.fecha)}>{hace(l.fecha)}</td>
            <td className="celda-titulo">{l.esPropio ? 'tuya' : (l.vendedor ?? '—')}<small className="st-sub">{l.titulo}</small></td>
            <td>{l.keyword ?? '—'}</td>
            <td className="num"><span className={`st-ficha${l.topado ? ' st-balde' : ''}`}>{l.ok ? stockTexto(l) : '—'}</span></td>
            <td>{l.ok ? (l.topado ? 'rango' : l.stock === 0 ? 'agotado' : 'número exacto') : <span className="apr-chip apr-chip-aviso">la ficha no respondió</span>}</td>
          </tr>)}</tbody></table></div>}
      </section>
    </>
  )
}

export function MasVendidosMl() {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [abierta, setAbierta] = useState(null)
  useEffect(() => { api.masVendidos().then(setD).catch((e) => setError(e.message)) }, [])
  if (error) return <p className="error-bloque" role="alert">No se pudo leer el ranking: {error}</p>
  if (!d) return <Cargando texto="Leyendo el ranking de más vendidos…" />
  const cats = [...d.categorias].sort((a, b) => (b.nichos?.length ?? 0) - (a.nichos?.length ?? 0))
  const items = cats.flatMap((c) => c.items)
  return (
    <>
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Ranking oficial de más vendidos</h3>
          <p>Los 20 más vendidos de cada categoría, según Mercado Libre y gratis por su API. Se guarda todos los días a las 07:40; con dos días guardados se ve quién entró al top y quién sube.</p></div>
        <div className="apr-fuentes">
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><TrendingUp size={17} aria-hidden="true" /></span><h3>Categorías seguidas</h3></div>
            <p className="apr-cifra">{fmtNum(cats.length)}</p><p className="apr-fuente-detalle">la categoría dominante de cada nicho activo y las de tus productos</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CheckCircle2 size={17} aria-hidden="true" /></span><h3>Productos en los rankings</h3></div>
            <p className="apr-cifra">{fmtNum(items.length)}</p><p className="apr-fuente-detalle">{fmtNum(items.filter((i) => i.titulo).length)} con nombre y foto · {fmtNum(items.filter((i) => i.enNuestroScan).length)} ya estaban en tus scans</p></article>
          <article className="apr-fuente"><div className="apr-cabeza"><span className="apr-icono"><CircleDashed size={17} aria-hidden="true" /></span><h3>Entraron o subieron</h3></div>
            <p className="apr-cifra">{fmtNum(d.entradas?.length ?? 0)}</p><p className="apr-fuente-detalle">{d.entradas?.length ? 'esto es lo que recibe el radar como evidencia' : 'aparece desde el segundo día guardado'}</p></article>
        </div>
      </section>
      {d.entradas?.length ? <section className="apr-seccion"><div className="apr-seccion-cabeza"><h3>Lo que se movió esta semana</h3></div>
        <ul className="apr-lista">{d.entradas.map((e, i) => <li key={i}><strong>#{e.posicion}</strong> {e.nuevo ? 'entró al top 20' : `subió ${e.subio} puestos`}: {e.titulo}{e.nichos?.length ? <small className="st-sub"> categoría de {e.nichos.slice(0, 3).join(', ')}</small> : null}</li>)}</ul></section> : null}
      <section className="apr-seccion">
        <div className="apr-seccion-cabeza"><h3>Por categoría</h3></div>
        {cats.map((c) => (
          <div key={c.categoriaId} className="st-nicho">
            <button type="button" className="st-nicho-cab" aria-expanded={abierta === c.categoriaId} onClick={() => setAbierta(abierta === c.categoriaId ? null : c.categoriaId)}>
              <strong>{c.nichos?.length ? c.nichos.slice(0, 3).join(' · ') : c.categoriaId}</strong>
              <span className="apr-chip">{c.items.length} productos</span>
              <span className="apr-chip">{c.comparadoCon ? `comparado con el ${c.comparadoCon.slice(8)}/${c.comparadoCon.slice(5, 7)}` : `día ${c.diasGuardados} guardado`}</span>
              {c.items.filter((i) => i.nuevo).length ? <span className="apr-chip apr-chip-bien">{c.items.filter((i) => i.nuevo).length} nuevos en el top</span> : null}
            </button>
            {abierta === c.categoriaId ? <ol className="mv-lista st-mv">{c.items.map((i) => (
              <li key={i.id} className="mv-fila"><span className="mv-pos">{i.posicion}</span>
                {i.imagen ? <img src={i.imagen.replace(/^http:/, 'https:')} alt="" loading="lazy" width="40" height="40" /> : <span className="mv-sinfoto" aria-hidden="true" />}
                <span className="mv-titulo">{i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.titulo ?? 'ver en Mercado Libre'}</a> : (i.titulo ?? i.id)}{i.precio ? <small>{fmtPrecio(i.precio)}</small> : null}</span>
                <span className="mv-chips">{i.nuevo ? <em className="mv-chip mv-nuevo">entró al top</em> : null}{i.subio >= 2 ? <em className="mv-chip mv-sube">▲ {i.subio}</em> : null}{i.subio <= -2 ? <em className="mv-chip mv-baja">▼ {Math.abs(i.subio)}</em> : null}
                  {i.enNuestroScan ? <em className="mv-chip">en tu scan</em> : null}<em className="mv-chip" title="Días de los guardados en que estuvo en el top 20">{i.diasEnElTop}/{i.diasGuardados} d</em></span></li>))}</ol> : null}
          </div>
        ))}
      </section>
    </>
  )
}
