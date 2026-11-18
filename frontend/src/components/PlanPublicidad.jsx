import { Megaphone } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'
import { Aviso, Cifra, Cifras, Nota } from './sistema.jsx'

// EL PLAN DE PUBLICIDAD ANTES DE ANUNCIAR (src/services/ml/publicidad.js): lo
// que los anuncios de la cuenta enseñaron —lo que cuesta cada venta por
// anuncio, el envío real— aplicado a este producto. Desde el 21-oct-2026 manda
// lo que una venta AGUANTA de publicidad contra lo que cuesta una venta por
// anuncio, no el ROAS de las brochas: a otro precio, el plan es una prueba.
const TONOS = {
  anunciar: { clase: 'bien', titulo: 'Anunciar' },
  'anunciar-con-cuidado': { clase: 'medio', titulo: 'Anunciar con cuidado' },
  'depende-del-costo': { clase: 'medio', titulo: 'Depende del costo' },
  probar: { clase: 'medio', titulo: 'Probar con presupuesto chico' },
  'solo-organico': { clase: 'mal', titulo: 'Vender orgánico, sin publicidad' },
  'no-cierra': { clase: 'mal', titulo: 'No cierra ni sin publicidad' },
}

const TONO_SISTEMA = { bien: 'bien', medio: 'atencion', mal: 'problema' }
// el veredicto en una línea, para el resumen de la sección cuando está cerrada
export function resumenPlan(plan) {
  if (!plan) return null
  const t = TONOS[plan.veredicto] ?? TONOS['depende-del-costo']
  return `${t.titulo}${plan.presupuestoDiario > 0 ? ` · para partir, ${fmtPrecio(plan.presupuestoDiario)} al día` : ''}`
}

// DENTRO DE LA TARJETA DE MIS PRODUCTOS (18-nov-2026): nueve cifras chicas en una fila, con nombres como «aguanta
// de publicidad» o «ROAS objetivo», no se leían. Quedan el veredicto en palabras y las cuatro cuentas que deciden:
// cuánto aguanta una venta, cuánto cuesta una venta por anuncio en la cuenta, cuánto quedaría y con cuánto partir.
function PlanCompacto({ plan, t, x }) {
  const conCosto = plan.costoUnitario != null
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Aviso tono={TONO_SISTEMA[t.clase]} Icono={Megaphone} titulo={`${t.titulo}.`}>{plan.texto}.</Aviso>
      <Cifras>
        {conCosto && plan.aguantaPorVenta != null ? <Cifra etiqueta="Una venta aguanta" valor={fmtPrecio(plan.aguantaPorVenta)} detalle="de publicidad sin perder plata" /> : null}
        {!conCosto ? <Cifra etiqueta="El producto puede costarte hasta" valor={plan.costoMaximo > 0 ? fmtPrecio(plan.costoMaximo) : 'no cierra'} tono={plan.costoMaximo > 0 ? undefined : 'problema'} detalle="para que una venta por anuncio no pierda; falta cargar el costo" /> : null}
        {plan.referencia?.mediana ? <Cifra etiqueta="Una venta por anuncio cuesta" valor={fmtPrecio(plan.referencia.mediana)} detalle="lo que se ha pagado en tu cuenta" /> : null}
        {conCosto && plan.gananciaPorVentaAds != null ? <Cifra etiqueta="Te quedaría por venta con anuncio" valor={fmtPrecio(plan.gananciaPorVentaAds)} tono={plan.gananciaPorVentaAds > 0 ? 'bien' : 'problema'} detalle="después de pagar el anuncio" /> : null}
        {plan.presupuestoDiario > 0 ? <Cifra etiqueta="Para partir" valor={`${fmtPrecio(plan.presupuestoDiario)} al día`} detalle={`${conCosto ? `ROAS objetivo ${x(plan.roasObjetivo)} · ` : ''}prueba de 14 días: ${fmtPrecio(plan.presupuestoPrueba14Dias)}`} /> : null}
      </Cifras>
      <Nota>Sale de lo que enseñaron {plan.aprendidoDe} anuncios de tu cuenta (confianza {plan.confianza}). El detalle de cada campaña está en Publicidad.</Nota>
    </div>
  )
}

export function PlanPublicidad({ plan, compacto = false }) {
  if (!plan) return null
  const t = TONOS[plan.veredicto] ?? TONOS['depende-del-costo']
  const x = (v) => (v != null ? `${String(v).replace('.', ',')}x` : '—')
  if (compacto) return <PlanCompacto plan={plan} t={t} x={x} />
  return (
    <div className={`plan-ads plan-${t.clase}${compacto ? ' compacto' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="plan-ads-cab">
        <Megaphone size={15} aria-hidden="true" />
        <strong>Publicidad: {t.titulo}</strong>
        <small title={`Aprendido de ${plan.aprendidoDe} anuncios propios con 10+ ventas`}>aprendido de {plan.aprendidoDe} anuncios · confianza {plan.confianza}</small>
      </div>
      <p className="plan-ads-texto">{plan.texto}.</p>
      <dl className="plan-ads-cifras">
        <div><dt>precio{plan.precioEsPropio === false ? ' (mercado)' : ''}</dt><dd>{fmtPrecio(plan.precio)}</dd></div>
        <div title="Comisión de la categoría y envío Full"><dt>queda tras ML</dt><dd>{fmtPrecio(plan.quedaTrasMl)}</dd></div>
        <div title={plan.envioOrigen === 'medido' ? 'Envío facturado de este producto' : plan.envioOrigen === 'tarifa ajustada' ? `Tarifa de ML × lo que el envío real sube sobre la tarifa en tu cuenta${plan.cajaSupuesta ? ' (caja chica supuesta: carga m³ y kg para afinar)' : ''}` : 'Sin tarifa de envío'}>
          <dt>envío{plan.envioOrigen === 'tarifa ajustada' ? ' esperado' : ''}</dt><dd>{plan.envio != null ? fmtPrecio(plan.envio) : '—'}</dd>
        </div>
        {plan.costoUnitario != null ? (
          <>
            <div><dt>costo puesto</dt><dd>{fmtPrecio(plan.costoUnitario)}</dd></div>
            {plan.aguantaPorVenta != null ? (
              <div title="Lo que una venta puede pagar de publicidad sin perder plata"><dt>aguanta de publicidad</dt><dd><b>{fmtPrecio(plan.aguantaPorVenta)}</b></dd></div>
            ) : null}
            {plan.referencia?.mediana ? (
              <div title={`Lo que costó cada venta por anuncio en tu cuenta${plan.referencia.precioDesde ? `, medido en productos de ${fmtPrecio(plan.referencia.precioDesde)}-${fmtPrecio(plan.referencia.precioHasta)}` : ''}`}>
                <dt>venta por anuncio (cuenta)</dt><dd>{fmtPrecio(plan.referencia.mediana)}</dd>
              </div>
            ) : null}
            <div title={`El empate (${x(plan.roasEquilibrio)}) con 20% de aire: es el que se pone en la campaña`}><dt>ROAS objetivo</dt><dd><b>{x(plan.roasObjetivo)}</b></dd></div>
            <div><dt>gana por venta con anuncio</dt><dd className={plan.gananciaPorVentaAds > 0 ? 'bien' : 'mal'}>{plan.gananciaPorVentaAds != null ? fmtPrecio(plan.gananciaPorVentaAds) : '—'}</dd></div>
          </>
        ) : (
          <div title="Para que una venta por anuncio típica de tu cuenta no pierda"><dt>puede costar hasta</dt><dd className={plan.costoMaximo > 0 ? '' : 'mal'}><b>{plan.costoMaximo > 0 ? fmtPrecio(plan.costoMaximo) : 'nada'}</b></dd></div>
        )}
        {plan.presupuestoDiario > 0 ? (
          <div title={`Cada venta por anuncio costaría ~${fmtPrecio(plan.costoPorVentaEsperado)}. La prueba de 14 días es lo mínimo para que ML aprenda y para leer el resultado.`}>
            <dt>budget</dt><dd>{fmtPrecio(plan.presupuestoDiario)}/día · prueba {fmtPrecio(plan.presupuestoPrueba14Dias)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
