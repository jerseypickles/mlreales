import { useEffect, useState } from 'react'
import { ChevronDown, PackageX } from 'lucide-react'
import { Etiqueta, Nivel } from './sistema.jsx'
import { fmtNum, fmtPrecio } from '../lib/formato.js'

// STOCK EN FULL, EN TODA LA APP (rehecha el 18-nov-2026). La franja avisa ANTES de quedarse sin stock, con la fecha
// límite para despachar. Pedido del importador al usarla: «debería ser inteligente y muestra lo que ya se fue hace
// harto, que no llega stock… el diseño no me gusta, falta rediseñarlo completo». La versión anterior ponía primero,
// en rojo y con plata perdida por día, productos agotados hace semanas que no se reponen; lo que sí había que mandar
// quedaba abajo o escondido. Ahora «no hay stock» son tres cosas distintas (inventarioFull.alertaDeStock):
//   · para mandar ahora: se acabó hace poco o se acaba antes de que alcance a llegar un envío;
//   · en camino: se acabó, pero ya hay un envío anotado (se espera, no se grita);
//   · agotado sin reposición: se acabó y no viene más. No es alerta ni cuenta plata: va al final, plegado.
// Plegada es una línea en palabras. Abierta, una tarjeta por producto con su foto, agrupadas por lo que hay que hacer.
// Si lo único que hay son agotados, la franja no aparece.

const dia = (f) => new Date(f).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '')
const esHoyOAntes = (f) => new Date(f).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0)
const dias = (n) => `${fmtNum(n)} ${n === 1 ? 'día' : 'días'}`
const corto = (titulo) => (titulo ?? '').split(/\s+/).slice(0, 5).join(' ')

// lo que dice la tarjeta de cada producto según su caso: la etiqueta, la línea de detalle y lo que hay que mandar
function lectura(p, plazo) {
  if (p.nivel === 'quebrado') return {
    tono: 'problema', estado: p.diasQuebrado ? `sin stock hace ${dias(p.diasQuebrado)}` : 'sin stock',
    detalle: p.perdidaDiaClp ? `se dejan de vender ${fmtPrecio(p.perdidaDiaClp)} al día` : 'ya perdió su ritmo de venta', manda: p.aEnviar,
  }
  if (p.nivel === 'enviar_ya' || p.nivel === 'preparar') return {
    tono: p.nivel === 'enviar_ya' ? 'problema' : 'atencion', estado: `alcanza para ${dias(p.diasCobertura)}`,
    detalle: `quedan ${fmtNum(p.stock)} · ${esHoyOAntes(p.despacharAntesDel) ? `despacha hoy: un envío tarda unos ${plazo} días` : `despacha antes del ${dia(p.despacharAntesDel)}`}`,
    manda: p.aEnviar, nivel: p.diasCobertura / 21,
  }
  if (p.nivel === 'en_camino') return {
    tono: 'destacada', estado: `${p.enCamino === 1 ? 'viene 1' : `vienen ${fmtNum(p.enCamino)}`} en camino`,
    detalle: `${p.diasQuebrado ? `sin stock hace ${dias(p.diasQuebrado)}` : 'sin stock'}${p.enCaminoDesde ? ` · anotado el ${dia(p.enCaminoDesde)}` : ''}`,
  }
  return {
    tono: 'neutra', estado: p.sinStockDesde ? `sin stock desde el ${dia(`${p.sinStockDesde}T12:00:00Z`)}` : 'sin stock',
    detalle: p.decision === 'no' ? 'dijiste que no se repone' : `${p.diasQuebrado ? `${dias(p.diasQuebrado)} y ` : ''}nada en camino`,
  }
}

function Producto({ p, plazo, alAbrir }) {
  const l = lectura(p, plazo)
  return (
    <button type="button" className="s-franja-producto" onClick={() => alAbrir?.(p)} title={`${p.titulo}: ver en Mis productos`}>
      <span className="s-franja-foto">{p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <PackageX size={20} aria-hidden="true" />}</span>
      <span className="s-franja-datos">
        <strong><span>{corto(p.titulo)}</span>{p.variante ? <em>{p.variante}</em> : null}</strong>
        <span><Etiqueta tono={l.tono}>{l.estado}</Etiqueta>{l.manda > 0 ? <b>manda {fmtNum(l.manda)}</b> : null}</span>
        {l.nivel != null ? <Nivel fraccion={l.nivel} tono={l.tono} title="La barra llena son tres semanas de stock" /> : null}
        <small>{l.detalle}</small>
      </span>
    </button>
  )
}

function Grupo({ titulo, nota, productos, plazo, alAbrir }) {
  if (!productos.length) return null
  return (
    <div className="s-franja-grupo">
      <h4>{titulo}<span className="s-cuenta">{productos.length}</span>{nota ? <small>{nota}</small> : null}</h4>
      <div className="s-franja-grilla">{productos.map((p) => <Producto key={p.id} p={p} plazo={plazo} alAbrir={alAbrir} />)}</div>
    </div>
  )
}

// `alAbrir(producto)`: lleva a ese producto en Mis productos (ahí se anota el envío o se dice que no se repone)
export function AlertaStock({ datos, alAbrir }) {
  const [abierta, setAbierta] = useState(() => { try { return localStorage.getItem('alerta-stock-abierta') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('alerta-stock-abierta', abierta ? '1' : '0') } catch { /* sin almacenamiento */ } }, [abierta])
  const de = (...niveles) => (datos?.productos ?? []).filter((p) => niveles.includes(p.nivel))
  const ahora = de('quebrado', 'enviar_ya'), preparar = de('preparar'), enCamino = de('en_camino'), agotados = de('agotado')
  if (!ahora.length && !preparar.length && !enCamino.length) return null
  const plazo = datos.plazoEnvioFullDias
  const perdida = datos.resumen?.perdidaDiaClp
  return (
    <section className="s-franja" aria-label="Stock en Full">
      <button type="button" className="s-franja-cabeza" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
        <strong>Stock en Full</strong>
        {ahora.length ? <Etiqueta tono="problema">{fmtNum(ahora.length)} para mandar ahora</Etiqueta> : null}
        {preparar.length ? <Etiqueta tono="atencion">{fmtNum(preparar.length)} para preparar</Etiqueta> : null}
        {enCamino.length ? <Etiqueta tono="destacada">{fmtNum(enCamino.length)} en camino</Etiqueta> : null}
        {!ahora.length && !preparar.length ? <Etiqueta tono="bien">nada que mandar por ahora</Etiqueta> : null}
        <span className="s-franja-lectura">
          {perdida > 0 ? `Lo que está sin stock deja de vender ${fmtPrecio(perdida)} al día.` : ''}
          {agotados.length ? ` ${fmtNum(agotados.length)} ${agotados.length === 1 ? 'agotado' : 'agotados'} sin reposición ya no ${agotados.length === 1 ? 'cuenta' : 'cuentan'}.` : ''}
        </span>
        <span className="s-franja-fotos" aria-hidden="true">{[...ahora, ...preparar].slice(0, 6).map((p) => (p.imagen ? <img key={p.id} src={p.imagen} alt="" loading="lazy" /> : null))}</span>
        <ChevronDown className="s-franja-flecha" size={16} aria-hidden="true" />
      </button>
      {abierta ? (
        <div className="s-franja-cuerpo">
          <Grupo titulo="Para mandar ahora" nota={`sin stock, o se acaba antes de que alcance a llegar un envío (unos ${plazo} días)`} productos={ahora} plazo={plazo} alAbrir={alAbrir} />
          <Grupo titulo="Para preparar" nota="todavía alcanza, pero conviene ir armando el envío" productos={preparar} plazo={plazo} alAbrir={alAbrir} />
          <Grupo titulo="En camino" nota="lo anotaste como enviado; cuando Full lo reciba se descuenta solo" productos={enCamino} plazo={plazo} alAbrir={alAbrir} />
          {agotados.length ? (
            <details className="s-franja-agotados">
              <summary>Agotados sin reposición ({fmtNum(agotados.length)}): llevan dos semanas o más sin stock y sin nada en camino, o dijiste que no se reponen</summary>
              <div className="s-franja-grilla">{agotados.map((p) => <Producto key={p.id} p={p} plazo={plazo} alAbrir={alAbrir} />)}</div>
            </details>
          ) : null}
          <p className="s-nota">Toca un producto para abrirlo en Mis productos: ahí anotas el envío a Full o dices que no se repone.</p>
        </div>
      ) : null}
    </section>
  )
}
