import { Megaphone } from 'lucide-react'
import { fmtPrecio } from '../lib/formato.js'

// EL PLAN DE PUBLICIDAD ANTES DE ANUNCIAR (src/services/ml/publicidad.js): lo
// que los anuncios de la cuenta enseñaron —el ROAS que ML entrega, lo que
// cuesta cada venta por anuncio, el envío real— aplicado a este producto.
const TONOS = {
  anunciar: { clase: 'bien', titulo: 'Anunciar' },
  'anunciar-con-cuidado': { clase: 'medio', titulo: 'Anunciar con cuidado' },
  'depende-del-costo': { clase: 'medio', titulo: 'Depende del costo' },
  'solo-organico': { clase: 'mal', titulo: 'Vender orgánico, sin publicidad' },
  'no-cierra': { clase: 'mal', titulo: 'No cierra ni sin publicidad' },
}

export function PlanPublicidad({ plan, compacto = false }) {
  if (!plan) return null
  const t = TONOS[plan.veredicto] ?? TONOS['depende-del-costo']
  const x = (v) => (v != null ? `${String(v).replace('.', ',')}x` : '—')
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
            <div title="Bajo este ROAS cada venta por anuncio pierde"><dt>ROAS de empate</dt><dd>{x(plan.roasEquilibrio)}</dd></div>
            <div title="El empate con 20% de aire: es el que se pone en la campaña"><dt>ROAS objetivo</dt><dd><b>{x(plan.roasObjetivo)}</b></dd></div>
            <div><dt>gana por venta con anuncio</dt><dd className={plan.gananciaPorVentaAds > 0 ? 'bien' : 'mal'}>{plan.gananciaPorVentaAds != null ? fmtPrecio(plan.gananciaPorVentaAds) : '—'}</dd></div>
          </>
        ) : (
          <div title="Con el ROAS que ML suele entregar en tu cuenta"><dt>puede costar hasta</dt><dd className={plan.costoMaximo > 0 ? '' : 'mal'}><b>{plan.costoMaximo > 0 ? fmtPrecio(plan.costoMaximo) : 'nada'}</b></dd></div>
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
