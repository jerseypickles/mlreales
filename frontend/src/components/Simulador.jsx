import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatTile } from './ui.jsx'
import { fmtNum, fmtPrecio, fmtPct } from '../lib/formato.js'

const CAMPOS_DESGLOSE = [
  ['fobClp', 'FOB'],
  ['fleteClp', 'Flete'],
  ['seguroClp', 'Seguro'],
  ['arancelClp', 'Arancel'],
  ['despachoClp', 'Despacho (prorrateado)'],
  ['landedNetoClp', 'Landed cost neto'],
  ['ivaImportacionClp', 'IVA importación (crédito fiscal)'],
  ['comisionMlClp', 'Comisión ML (neta)'],
  ['fullClp', 'Tarifa Full (neta)'],
]

export function Simulador({ nicho, reporte, precioInicial }) {
  const [form, setForm] = useState({
    precioVentaClp: precioInicial ?? reporte?.metricas?.precio?.mediana ?? '',
    costoFobUsd: '',
    unidades: 500,
    modoFlete: 'maritimo',
    volumenM3: 0.002,
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
    e.preventDefault()
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
      })
      setResultado(r)
    } catch (err) {
      setError(err.message)
      setResultado(null)
    } finally {
      setCalculando(false)
    }
  }

  return (
    <div className="simulador">
      <form onSubmit={calcular} className="form-simulador">
        <h3>Unit economics China → Chile → Full</h3>
        <p className="nota">
          Precio de venta prellenado con la mediana de "{nicho.keyword}". Los parámetros del modelo
          (tipo de cambio, tarifas, comisión) viven en el backend y son estimaciones ajustables.
        </p>
        <div className="grilla-form">
          <label>
            Precio de venta (CLP)
            <input type="number" required min="1" {...campo('precioVentaClp')} />
          </label>
          <label>
            Costo FOB por unidad (USD)
            <input type="number" required min="0.01" step="0.01" placeholder="ej: 3.50" {...campo('costoFobUsd')} />
          </label>
          <label>
            Unidades del embarque
            <input type="number" required min="1" {...campo('unidades')} />
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
          {calculando ? 'Calculando…' : 'Calcular margen'}
        </button>
        {error ? <p className="error-bloque">{error}</p> : null}
      </form>

      {resultado ? (
        <div className="resultado-simulacion">
          <div className="tiles">
            <StatTile
              destacado
              label="Margen por unidad"
              value={fmtPrecio(resultado.porUnidad.margenClp)}
              detalle={`${fmtPct(resultado.resultado.margenPctSobreVenta)} sobre venta neta`}
            />
            <StatTile label="ROI" value={fmtPct(resultado.resultado.roiPct)} detalle="margen / landed cost" />
            <StatTile
              label="Margen del embarque"
              value={fmtPrecio(resultado.resultado.margenTotalClp)}
              detalle={`${fmtNum(resultado.resultado.unidades)} unidades`}
            />
            <StatTile
              label="Caja necesaria"
              value={fmtPrecio(resultado.resultado.inversionCajaClp)}
              detalle="landed + IVA de importación"
            />
          </div>

          <h4>Desglose por unidad</h4>
          <div className="tabla-envoltura">
            <table>
              <tbody>
                <tr>
                  <td>Precio de venta (bruto)</td>
                  <td className="num">{fmtPrecio(resultado.porUnidad.precioVentaClp)}</td>
                </tr>
                <tr>
                  <td>Ingreso neto (sin IVA)</td>
                  <td className="num">{fmtPrecio(resultado.porUnidad.ingresoNetoClp)}</td>
                </tr>
                {CAMPOS_DESGLOSE.map(([clave, etiqueta]) => (
                  <tr key={clave}>
                    <td>{etiqueta}</td>
                    <td className="num">{fmtPrecio(resultado.porUnidad[clave])}</td>
                  </tr>
                ))}
                <tr className="fila-total">
                  <td>Margen neto por unidad</td>
                  <td className="num">{fmtPrecio(resultado.porUnidad.margenClp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="nota">
            Supuestos: USD {fmtNum(resultado.supuestos.tipoCambioUsdClp)} · arancel{' '}
            {resultado.supuestos.arancelPct}% (TLC China-Chile con certificado) · comisión ML{' '}
            {resultado.supuestos.comisionMlPct}% · IVA como crédito fiscal.
          </p>
        </div>
      ) : null}
    </div>
  )
}
