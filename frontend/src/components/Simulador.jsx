import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { fmtNum, fmtPrecio, fmtPct } from '../lib/formato.js'

// "100-200 unidades" → 100 (borde conservador)
function parsearUnidades(texto) {
  const m = String(texto ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

// De cada peso de la venta (neta): producto, logística, Mercado Libre, y lo tuyo.
function FlujoVenta({ porUnidad }) {
  const producto = porUnidad.exwClp ?? porUnidad.fobClp ?? 0
  const logistica =
    (porUnidad.fleteClp ?? 0) + (porUnidad.seguroClp ?? 0) + (porUnidad.arancelClp ?? 0) + (porUnidad.despachoClp ?? 0)
  const ml = (porUnidad.comisionMlClp ?? 0) + (porUnidad.fullClp ?? 0)
  const margen = porUnidad.margenClp ?? 0
  const total = producto + logistica + ml + Math.max(margen, 0)
  if (total <= 0) return null

  const segmentos = [
    { clave: 'producto', nombre: 'Producto', valor: producto },
    { clave: 'logistica', nombre: 'Traerlo a Chile', valor: logistica },
    { clave: 'ml', nombre: 'Mercado Libre', valor: ml },
    { clave: 'margen', nombre: 'Te queda', valor: Math.max(margen, 0) },
  ]

  return (
    <figure className="flujo">
      <figcaption>De cada venta (neta de IVA), ¿a dónde va la plata?</figcaption>
      <div className="flujo-barra" role="img" aria-label={segmentos.map((s) => `${s.nombre}: ${fmtPrecio(s.valor)}`).join(', ')}>
        {segmentos.map((s) =>
          s.valor > 0 ? (
            <div
              key={s.clave}
              className={`flujo-seg flujo-${s.clave}`}
              style={{ width: `${(s.valor / total) * 100}%` }}
              title={`${s.nombre}: ${fmtPrecio(s.valor)}`}
            />
          ) : null,
        )}
      </div>
      <div className="flujo-leyenda">
        {segmentos.map((s) => (
          <span key={s.clave} className="flujo-item">
            <span className={`flujo-punto flujo-${s.clave}`} />
            {s.nombre} <strong>{fmtPrecio(s.valor)}</strong>
          </span>
        ))}
      </div>
    </figure>
  )
}

export function Simulador({ nicho, reporte, precioInicial }) {
  const rec = reporte?.analisis?.recomendacion
  const unidadesPrueba = parsearUnidades(rec?.primeraCompra)

  const [form, setForm] = useState({
    precioVentaClp: precioInicial ?? rec?.precioVentaClp ?? reporte?.metricas?.precio?.mediana ?? '',
    costoExwUsd: rec?.exwMaximoUsd ?? rec?.fobMaximoUsd ?? '',
    unidades: unidadesPrueba ?? 500,
    // la comisión la estima el análisis según la categoría; 17% conservador si no hay análisis
    comisionPct: rec?.comisionMlPct ?? 17,
    unidadesBulto: 1,
    modoFlete: 'maritimo',
    fleteM3Usd: '', // se precarga desde el servidor (FLETE_M3_USD real del importador)
    volumenM3: 0.003,
    pesoKg: 0.5,
  })
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const temporizador = useRef(null)

  useEffect(() => {
    if (precioInicial != null) setForm((f) => ({ ...f, precioVentaClp: precioInicial }))
  }, [precioInicial])

  // la tarifa marítima real vive en el servidor (contenedor del importador):
  // precargarla en vez de adivinar un default en el frontend
  useEffect(() => {
    let vigente = true
    api
      .parametrosMargen()
      .then((p) => {
        const tarifa = p?.flete?.maritimoUsdPorM3
        if (vigente && Number.isFinite(tarifa)) {
          setForm((f) => (f.fleteM3Usd === '' ? { ...f, fleteM3Usd: tarifa } : f))
        }
      })
      .catch(() => {})
    return () => {
      vigente = false
    }
  }, [])

  // cálculo automático: al abrir (si hay datos) y con debounce al editar
  useEffect(() => {
    const listo =
      Number(form.precioVentaClp) > 0 &&
      Number(form.costoExwUsd) > 0 &&
      Number(form.unidades) >= 1 &&
      (form.modoFlete === 'maritimo' ? Number(form.volumenM3) > 0 : Number(form.pesoKg) > 0)
    if (!listo) return

    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(async () => {
      setCalculando(true)
      setError(null)
      try {
        const r = await api.simularMargen({
          precioVentaClp: Number(form.precioVentaClp),
          costoExwUsd: Number(form.costoExwUsd),
          unidades: Number(form.unidades),
          modoFlete: form.modoFlete,
          volumenM3: Number(form.volumenM3),
          pesoKg: Number(form.pesoKg),
          parametros: {
            mercadoLibre: { comisionPct: Number(form.comisionPct) },
            ...(Number(form.fleteM3Usd) > 0 ? { flete: { maritimoUsdPorM3: Number(form.fleteM3Usd) } } : {}),
          },
        })
        setResultado(r)
      } catch (err) {
        setError(err.message)
      } finally {
        setCalculando(false)
      }
    }, 450)
    return () => clearTimeout(temporizador.current)
  }, [form])

  const campo = (clave) => ({
    value: form[clave],
    onChange: (e) => setForm((f) => ({ ...f, [clave]: e.target.value })),
  })

  const margen = resultado?.porUnidad?.margenClp
  const pierde = Number.isFinite(margen) && margen <= 0
  const mlSeLleva = resultado
    ? (resultado.porUnidad.comisionMlClp ?? 0) + (resultado.porUnidad.fullClp ?? 0)
    : null

  return (
    <div className="simulador">
      <div className="sim-grilla">
        {/* ---- INPUTS ---- */}
        <div className="sim-panel">
          <h3>Tu pedido</h3>
          {rec?.aplica ? (
            <p className="nota sim-nota">
              Precargado con la recomendación: {rec.titular ?? rec.segmento}
            </p>
          ) : null}
          <label className="sim-campo">
            Precio de venta (CLP)
            <input type="number" min="1" {...campo('precioVentaClp')} />
          </label>
          <label className="sim-campo">
            {Number(form.unidadesBulto) > 1
              ? `Costo del BULTO completo en China (USD EXW — las ${form.unidadesBulto} piezas juntas)`
              : 'Costo por unidad en China (USD EXW, precio ex-fábrica)'}
            <input type="number" min="0.01" step="0.01" placeholder="ej: 3.50" {...campo('costoExwUsd')} />
            {(rec?.exwMaximoUsd ?? rec?.fobMaximoUsd) ? <span className="ayuda-campo">máximo recomendado: US$ {rec.exwMaximoUsd ?? rec.fobMaximoUsd}</span> : null}
          </label>
          <label className="sim-campo">
            Unidades por bulto vendido
            <input type="number" min="1" {...campo('unidadesBulto')} />
            <span className="ayuda-campo">
              {Number(form.unidadesBulto) > 1 && Number(form.precioVentaClp) > 0 && Number(form.costoExwUsd) > 0
                ? `por pieza: vendes a ${fmtPrecio(Number(form.precioVentaClp) / Number(form.unidadesBulto))} · EXW US$ ${(Number(form.costoExwUsd) / Number(form.unidadesBulto)).toFixed(2)}`
                : 'si vendes packs (ej: 60 toallitas), el precio y el EXW de arriba son del bulto completo'}
            </span>
          </label>
          <label className="sim-campo">
            Unidades del pedido
            <input type="number" min="1" {...campo('unidades')} />
            {unidadesPrueba ? (
              <span className="ayuda-campo">
                prueba sugerida: {rec.primeraCompra}
                {Number(form.unidades) !== unidadesPrueba ? (
                  <button type="button" className="enlace-boton" onClick={() => setForm((f) => ({ ...f, unidades: unidadesPrueba }))}>
                    usar
                  </button>
                ) : null}
              </span>
            ) : null}
          </label>
          <p className="ayuda-campo sim-comision">
            Comisión ML: <strong>{form.comisionPct}%</strong>
            {rec?.comisionMlPct ? ' (estimada para esta categoría por el análisis)' : ' (estándar)'} · el
            cargo fijo bajo $9.990 se aplica solo
          </p>
          <details className="pliegue pliegue-suave">
            <summary>Ajustes avanzados</summary>
            <label className="sim-campo">
              Comisión Mercado Libre (%)
              <input type="number" min="0" max="30" step="0.5" {...campo('comisionPct')} />
              <span className="ayuda-campo">si conoces la tarifa exacta de tu categoría, ponla aquí</span>
            </label>
            <label className="sim-campo">
              Flete
              <select {...campo('modoFlete')}>
                <option value="maritimo">Marítimo (por m³)</option>
                <option value="aereo">Aéreo (por kg)</option>
              </select>
            </label>
            {form.modoFlete === 'maritimo' ? (
              <>
                <label className="sim-campo">
                  Volumen por unidad (m³)
                  <input type="number" min="0.0001" step="0.0001" {...campo('volumenM3')} />
                </label>
                <label className="sim-campo">
                  Tarifa marítima prorrateada (US$/m³)
                  <input type="number" min="1" step="1" {...campo('fleteM3Usd')} />
                  <span className="ayuda-campo">
                    contenedor surtido completo: costo all-in del contenedor ÷ m³ útiles (ej: US$3.600 / 60 m³ = 60) · si va LCL suelto ≈ 180
                  </span>
                </label>
              </>
            ) : (
              <label className="sim-campo">
                Peso por unidad (kg)
                <input type="number" min="0.01" step="0.01" {...campo('pesoKg')} />
              </label>
            )}
          </details>
          {error ? <p className="error-bloque">{error}</p> : null}
        </div>

        {/* ---- RESULTADO ---- */}
        <div className={`sim-panel sim-resultado ${calculando ? 'calculando' : ''}`}>
          {!resultado ? (
            <p className="vacio">Completa precio y costo EXW: el cálculo corre solo.</p>
          ) : (
            <>
              <div className={`sim-hero ${pierde ? 'sim-pierde' : ''}`}>
                <span className="sim-hero-label">{pierde ? 'A este costo PIERDES' : 'Te queda por unidad'}</span>
                <span className="sim-hero-valor">{fmtPrecio(margen)}</span>
                <span className="sim-hero-detalle">
                  {fmtPct(resultado.resultado.margenPctSobreVenta)} del precio · ROI {fmtPct(resultado.resultado.roiPct)}
                </span>
              </div>

              <div className="sim-stats">
                <div>
                  <span className="dato-label">Del pedido completo ({fmtNum(resultado.resultado.unidades)} u)</span>
                  <span className="dato-valor">{fmtPrecio(resultado.resultado.margenTotalClp)}</span>
                </div>
                <div>
                  <span className="dato-label">Mercado Libre se lleva /u</span>
                  <span className="dato-valor">{fmtPrecio(mlSeLleva)}</span>
                </div>
                <div>
                  <span className="dato-label">Caja para partir</span>
                  <span className="dato-valor">{fmtPrecio(resultado.resultado.inversionCajaClp)}</span>
                </div>
              </div>

              {!pierde ? <FlujoVenta porUnidad={resultado.porUnidad} /> : null}

              <details className="pliegue">
                <summary>Desglose completo por unidad</summary>
                <div className="tabla-envoltura">
                  <table>
                    <tbody>
                      <tr><td>Precio de venta (bruto)</td><td className="num">{fmtPrecio(resultado.porUnidad.precioVentaClp)}</td></tr>
                      <tr><td>Ingreso neto (sin IVA)</td><td className="num">{fmtPrecio(resultado.porUnidad.ingresoNetoClp)}</td></tr>
                      <tr><td>Producto (EXW)</td><td className="num">{fmtPrecio(resultado.porUnidad.exwClp ?? resultado.porUnidad.fobClp)}</td></tr>
                      <tr><td>Flete</td><td className="num">{fmtPrecio(resultado.porUnidad.fleteClp)}</td></tr>
                      <tr><td>Seguro</td><td className="num">{fmtPrecio(resultado.porUnidad.seguroClp)}</td></tr>
                      <tr><td>Arancel</td><td className="num">{fmtPrecio(resultado.porUnidad.arancelClp)}</td></tr>
                      <tr><td>Despacho aduana (prorrateado)</td><td className="num">{fmtPrecio(resultado.porUnidad.despachoClp)}</td></tr>
                      <tr><td>Comisión Mercado Libre</td><td className="num">{fmtPrecio(resultado.porUnidad.comisionMlClp)}</td></tr>
                      <tr><td>Tarifa Full</td><td className="num">{fmtPrecio(resultado.porUnidad.fullClp)}</td></tr>
                      <tr><td>IVA importación (lo recuperas como crédito)</td><td className="num">{fmtPrecio(resultado.porUnidad.ivaImportacionClp)}</td></tr>
                      <tr className="fila-total"><td>Te queda</td><td className="num">{fmtPrecio(margen)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </details>

              <p className="nota">
                Dólar {fmtNum(resultado.supuestos.tipoCambioUsdClp)} · arancel {resultado.supuestos.arancelPct}%
                (TLC China-Chile con certificado) · valores netos de IVA.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
