import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatTile } from './ui.jsx'
import { fmtNum, fmtPrecio, fmtPct } from '../lib/formato.js'

const CAMPOS_DESGLOSE = [
  ['fobClp', 'Costo del producto (FOB)'],
  ['fleteClp', 'Flete'],
  ['seguroClp', 'Seguro'],
  ['arancelClp', 'Arancel'],
  ['despachoClp', 'Despacho aduana (prorrateado)'],
  ['landedNetoClp', 'Costo puesto en Chile'],
  ['comisionMlClp', 'Comisión Mercado Libre'],
  ['fullClp', 'Tarifa Full'],
]

// "100-200 unidades" → 100 (borde conservador)
function parsearUnidades(texto) {
  const m = String(texto ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

export function Simulador({ nicho, reporte, precioInicial }) {
  const rec = reporte?.analisis?.recomendacion
  const unidadesPrueba = parsearUnidades(rec?.primeraCompra)

  const [form, setForm] = useState({
    precioVentaClp: precioInicial ?? rec?.precioVentaClp ?? reporte?.metricas?.precio?.mediana ?? '',
    costoFobUsd: rec?.fobMaximoUsd ?? '',
    unidades: unidadesPrueba ?? 500,
    comisionPct: 16,
    modoFlete: 'maritimo',
    volumenM3: 0.003,
    pesoKg: 0.5,
  })
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [calculando, setCalculando] = useState(false)

  useEffect(() => {
    if (precioInicial != null) setForm((f) => ({ ...f, precioVentaClp: precioInicial }))
  }, [precioInicial])

  const campo = (clave) => ({
    value: form[clave],
    onChange: (e) => setForm((f) => ({ ...f, [clave]: e.target.value })),
  })

  async function calcular(e) {
    e?.preventDefault()
    setCalculando(true)
    setError(null)
    try {
      const r = await api.simularMargen({
        precioVentaClp: Number(form.precioVentaClp),
        costoFobUsd: Number(form.costoFobUsd),
        unidades: Number(form.unidades),
        modoFlete: form.modoFlete,
        volumenM3: Number(form.volumenM3),
        pesoKg: Number(form.pesoKg),
        parametros: { mercadoLibre: { comisionPct: Number(form.comisionPct) } },
      })
      setResultado(r)
    } catch (err) {
      setError(err.message)
      setResultado(null)
    } finally {
      setCalculando(false)
    }
  }

  const mlSeLleva = resultado
    ? (resultado.porUnidad.comisionMlClp ?? 0) + (resultado.porUnidad.fullClp ?? 0)
    : null

  return (
    <div className="simulador">
      <form onSubmit={calcular} className="form-simulador">
        <h3>¿Cuánto te queda si lo traes?</h3>
        {rec?.aplica ? (
          <p className="nota">
            Precargado con la recomendación del análisis: {rec.titular ?? rec.segmento} — pedido de
            prueba {rec.primeraCompra ?? '—'}, FOB máximo US$ {rec.fobMaximoUsd}.
          </p>
        ) : (
          <p className="nota">Precio precargado con la mediana de "{nicho.keyword}".</p>
        )}
        <div className="grilla-form">
          <label>
            Precio de venta (CLP)
            <input type="number" required min="1" {...campo('precioVentaClp')} />
          </label>
          <label>
            Costo por unidad en China (USD FOB)
            <input type="number" required min="0.01" step="0.01" placeholder="ej: 3.50" {...campo('costoFobUsd')} />
          </label>
          <label>
            Unidades del pedido
            <input type="number" required min="1" {...campo('unidades')} />
            {unidadesPrueba ? (
              <span className="ayuda-campo">
                pedido de prueba sugerido: {rec.primeraCompra}
                {Number(form.unidades) !== unidadesPrueba ? (
                  <button
                    type="button"
                    className="enlace-boton"
                    onClick={() => setForm((f) => ({ ...f, unidades: unidadesPrueba }))}
                  >
                    usar
                  </button>
                ) : null}
              </span>
            ) : null}
          </label>
          <label>
            Comisión Mercado Libre (%)
            <input type="number" required min="0" max="30" step="0.5" {...campo('comisionPct')} />
            <span className="ayuda-campo">
              según tu categoría (13-19%); revísala en el tarifario de ML. Bajo $9.990 se suma cargo
              fijo automáticamente
            </span>
          </label>
          <label>
            Modo de flete
            <select {...campo('modoFlete')}>
              <option value="maritimo">Marítimo (por m³)</option>
              <option value="aereo">Aéreo (por kg)</option>
            </select>
          </label>
          {form.modoFlete === 'maritimo' ? (
            <label>
              Volumen por unidad (m³)
              <input type="number" required min="0.0001" step="0.0001" {...campo('volumenM3')} />
            </label>
          ) : (
            <label>
              Peso por unidad (kg)
              <input type="number" required min="0.01" step="0.01" {...campo('pesoKg')} />
            </label>
          )}
        </div>
        <button type="submit" disabled={calculando} className="boton-primario">
          {calculando ? 'Calculando…' : 'Calcular cuánto me queda'}
        </button>
        {error ? <p className="error-bloque">{error}</p> : null}
      </form>

      {resultado ? (
        <div className="resultado-simulacion">
          <div className="tiles">
            <StatTile
              destacado
              label="Te queda por unidad"
              value={fmtPrecio(resultado.porUnidad.margenClp)}
              detalle={`${fmtPct(resultado.resultado.margenPctSobreVenta)} del precio de venta`}
            />
            <StatTile
              label="Te queda del pedido completo"
              value={fmtPrecio(resultado.resultado.margenTotalClp)}
              detalle={`${fmtNum(resultado.resultado.unidades)} unidades vendidas`}
            />
            <StatTile
              label="Mercado Libre se lleva"
              value={fmtPrecio(mlSeLleva)}
              detalle={`por unidad: comisión ${form.comisionPct}% + tarifa Full`}
            />
            <StatTile
              label="Caja para partir"
              value={fmtPrecio(resultado.resultado.inversionCajaClp)}
              detalle="compra + importación + IVA (se recupera como crédito)"
            />
            <StatTile label="Retorno sobre lo invertido" value={fmtPct(resultado.resultado.roiPct)} detalle="margen / costo puesto en Chile" />
          </div>

          <h4>De cada venta de {fmtPrecio(resultado.porUnidad.precioVentaClp)}, ¿a dónde va la plata?</h4>
          <div className="tabla-envoltura">
            <table>
              <tbody>
                {CAMPOS_DESGLOSE.map(([clave, etiqueta]) => (
                  <tr key={clave}>
                    <td>{etiqueta}</td>
                    <td className="num">{fmtPrecio(resultado.porUnidad[clave])}</td>
                  </tr>
                ))}
                <tr>
                  <td>IVA (crédito fiscal: lo recuperas al vender)</td>
                  <td className="num">{fmtPrecio(resultado.porUnidad.ivaImportacionClp)}</td>
                </tr>
                <tr className="fila-total">
                  <td>Te queda</td>
                  <td className="num">{fmtPrecio(resultado.porUnidad.margenClp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="nota">
            Supuestos: dólar a {fmtNum(resultado.supuestos.tipoCambioUsdClp)} · arancel{' '}
            {resultado.supuestos.arancelPct}% (TLC China-Chile con certificado de origen) · valores
            netos de IVA. Ajusta la comisión al tarifario real de tu categoría.
          </p>
        </div>
      ) : null}
    </div>
  )
}
