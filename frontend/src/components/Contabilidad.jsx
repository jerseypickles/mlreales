import { useEffect, useState } from 'react'
import { AlertTriangle, FileText, Landmark, Upload } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// POSICIÓN DE IVA DEL MES. Lo que se paga o el remanente que queda, cruzando el
// débito de las ventas contra el crédito de importaciones y gastos.
//
// La fuente de verdad es el RCV del SII (Registro de Compras y Ventas), no las
// órdenes de ML: el RCV es lo mismo que el SII usa para proponer el F29. Esta
// pantalla muestra por ahora lo que el sistema SÍ puede medir de su lado —
// ventas y cargos reales de ML — y dice explícitamente qué falta, en vez de
// dar una posición incompleta por buena.

const IVA = 0.19

function Fila({ etiqueta, valor, detalle, tono }) {
  return (
    <li className={`iva-fila${tono ? ` iva-${tono}` : ''}`}>
      <span className="iva-etiqueta">
        {etiqueta}
        {detalle ? <small>{detalle}</small> : null}
      </span>
      <b>{valor}</b>
    </li>
  )
}

export function Contabilidad() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    api
      .contabilidad()
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [])

  if (error) return <main className="contabilidad"><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main className="contabilidad"><Cargando texto="Cargando la posición del mes…" /></main>

  const { periodo, ventas, cargosMl, debito, creditoMl } = datos

  return (
    <main className="contabilidad">
      <header className="cont-cabeza">
        <div>
          <h2>
            <Landmark aria-hidden="true" /> Posición de IVA
          </h2>
          <p className="cont-periodo">período {periodo}</p>
        </div>
      </header>

      <div className="cont-grid">
        <section className="cont-caja">
          <h3>Débito fiscal · lo que generan tus ventas</h3>
          <ul className="iva-lista">
            <Fila
              etiqueta="Ventas del período en ML"
              detalle={`${ventas.unidades} unidad(es) en ${ventas.ordenes} orden(es)`}
              valor={fmtPrecio(ventas.brutoClp)}
            />
            <Fila etiqueta="Neto" detalle="bruto ÷ 1,19" valor={fmtPrecio(ventas.netoClp)} />
            <Fila etiqueta="IVA débito" valor={fmtPrecio(debito.clp)} tono="debito" />
          </ul>
          <p className="cont-nota">
            <AlertTriangle aria-hidden="true" />
            En órdenes Full <b>la boleta la emite Mercado Libre</b>, no tú: tu débito ya va informado al
            SII por esa vía. Confírmalo en tu cuenta antes de usarlo para declarar.
          </p>
        </section>

        <section className="cont-caja">
          <h3>Crédito fiscal · lo que puedes descontar</h3>
          <ul className="iva-lista">
            <Fila
              etiqueta="Comisiones y cargos de ML"
              detalle={cargosMl.lineas ? `${cargosMl.lineas} línea(s) facturadas` : 'sin sincronizar aún'}
              valor={fmtPrecio(cargosMl.totalClp)}
            />
            <Fila
              etiqueta="IVA de esos cargos"
              detalle="asumiendo montos con IVA incluido"
              valor={cargosMl.totalClp ? fmtPrecio(creditoMl.clp) : '—'}
              tono="credito"
            />
            <Fila etiqueta="Importaciones (DIN)" detalle="requiere el RCV" valor="—" />
            <Fila etiqueta="Gastos de la empresa" detalle="requiere el RCV" valor="—" />
          </ul>
          <p className="cont-nota cont-nota-alerta">
            <AlertTriangle aria-hidden="true" />
            <span>
              <b>La DIN no entra sola al Registro de Compras.</b> Hay que cargarla a mano como documento
              no electrónico, código <b>914</b>. Si tu contador no lo hace, el IVA de cada importación no
              se está tomando como crédito — y ahí hay millones.
            </span>
          </p>
        </section>
      </div>

      <section className="cont-falta">
        <h3>
          <FileText aria-hidden="true" /> Para cerrar la posición falta el RCV
        </h3>
        <p>
          Lo de arriba es lo que el sistema puede medir por su cuenta: tus ventas y lo que ML te cobró.
          No alcanza para declarar, porque el crédito grande son las <b>importaciones</b> y los{' '}
          <b>gastos</b>, y esos viven en el Registro de Compras y Ventas del SII.
        </p>
        <p>
          El siguiente paso es subir los dos CSV del RCV (compras y ventas) que se bajan de sii.cl. Con
          eso queda la posición completa: débito, crédito desglosado por origen, resultado y remanente
          arrastrado. Sin certificado digital ni intermediarios, sin costo.
        </p>
        <button className="boton-secundario" disabled>
          <Upload aria-hidden="true" /> Subir RCV (próximo paso)
        </button>
        <p className="cont-pie">
          No existe API para presentar ni pagar el F29: eso sigue siendo sii.cl con clave tributaria.
          Esto es un panel de gestión, no una declaración.
        </p>
      </section>

      {datos.actualizadoEl ? (
        <p className="cont-pie">datos al {fmtFecha(datos.actualizadoEl)}</p>
      ) : null}
    </main>
  )
}

export { IVA }
