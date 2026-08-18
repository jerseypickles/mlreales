import { useEffect, useState } from 'react'
import { AlertTriangle, Landmark, Upload } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// POSICIÓN DE IVA DEL MES. Lo que se paga o el remanente que queda, cruzando el
// débito de las ventas contra el crédito de importaciones y gastos.
//
// La fuente de verdad es el RCV del SII (Registro de Compras y Ventas), no las
// órdenes de ML. Esta pantalla muestra lo que el sistema SÍ puede medir de su
// lado —ventas y cargos reales de ML— y dice qué falta, en vez de dar una
// posición incompleta por buena.
//
// El texto va PLEGADO a propósito (18-ago-2026). Las advertencias son ciertas y
// hay que conservarlas —la DIN que no entra sola al Registro de Compras vale
// millones— pero cuatro párrafos abiertos tapaban los números, que es a lo que
// se entra. Lo que se lee de un vistazo son las cifras; el porqué se despliega.

const IVA = 0.19

function Fila({ etiqueta, valor, detalle, tono, sangria }) {
  return (
    <li className={`iva-fila${tono ? ` iva-${tono}` : ''}${sangria ? ' iva-sangria' : ''}`}>
      <span className="iva-etiqueta">
        {etiqueta}
        {detalle ? <small>{detalle}</small> : null}
      </span>
      <b>{valor}</b>
    </li>
  )
}

// El porqué, a un clic. Nada de esto se borró: dejó de estar abierto.
function Nota({ titulo, tono, children }) {
  return (
    <details className={`cont-detalle${tono ? ` cont-detalle-${tono}` : ''}`}>
      <summary>{titulo}</summary>
      <div>{children}</div>
    </details>
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

  const { periodo, ventas, cargosMl, periodoMl, debito, creditoMl, emision } = datos
  const familias = cargosMl.familias ?? []

  return (
    <main className="contabilidad">
      <header className="cont-cabeza">
        <h2>
          <Landmark aria-hidden="true" /> Posición de IVA
        </h2>
        <span className="cont-periodo">
          período {periodo}
          {cargosMl.sincronizadoEl ? ` · cargos al ${fmtFecha(cargosMl.sincronizadoEl)}` : ''}
        </span>
      </header>

      <div className="cont-grid">
        <section className="cont-caja">
          <h3>Débito · documentos emitidos</h3>
          <ul className="iva-lista">
            <Fila etiqueta="Bruto documentado" detalle={debito.base} valor={fmtPrecio(debito.brutoClp)} />
            <Fila etiqueta="Neto" valor={fmtPrecio(debito.netoClp)} />
            <Fila etiqueta="IVA débito" valor={fmtPrecio(debito.clp)} tono="debito" />
          </ul>

          <Nota titulo={`No calza con tus ${ventas.ordenes} órdenes de ${fmtPrecio(ventas.brutoClp)} — y está bien`}>
            <p>
              Una boleta puede cubrir <b>varias órdenes</b> del mismo carro, y un carro que cruza el fin de
              mes se factura en un período mientras sus órdenes caen en el otro. Para declarar manda la{' '}
              <b>fecha de emisión</b>, que es lo que muestra este cuadro.
              {ventas.sinBoleta ? ` Quedan ${ventas.sinBoleta} orden(es) sin documento sincronizado.` : ''}
            </p>
          </Nota>

          {emision ? (
            <Nota titulo={`Las boletas las emite ${emision.emisorNombre}, pero el débito es tuyo`}>
              <p>
                Las emite con sus propios folios (RUT {emision.emisorRut}) con el mensaje legal{' '}
                <b>“por cuenta y orden de {emision.porCuentaDe}”</b>. Es un mandato de facturación: la venta
                es tuya y este débito también — ML solo emite en tu nombre.
              </p>
            </Nota>
          ) : null}

          <Nota titulo="Falta confirmar que estén en tu Registro de Ventas del SII" tono="alerta">
            <p>
              Es lo primero que hay que mirar al cargar el RCV: si no están, el débito estaría informado
              bajo otro RUT y habría que corregirlo.
            </p>
          </Nota>
        </section>

        <section className="cont-caja">
          <h3>Crédito · lo que puedes descontar</h3>
          <ul className="iva-lista">
            <Fila
              etiqueta="Cargos de ML"
              detalle={cargosMl.lineas ? `${cargosMl.lineas} líneas facturadas` : 'sin sincronizar aún'}
              valor={fmtPrecio(cargosMl.totalClp)}
            />
            {familias.map((f) => (
              <Fila key={f.familia} etiqueta={f.etiqueta} valor={fmtPrecio(f.clp)} sangria />
            ))}
            <Fila
              etiqueta="IVA de esos cargos"
              detalle="asumiendo montos con IVA incluido"
              valor={cargosMl.totalClp ? fmtPrecio(creditoMl.clp) : '—'}
              tono="credito"
            />
            <Fila etiqueta="Importaciones (DIN)" detalle="requiere el RCV" valor="—" />
            <Fila etiqueta="Gastos de la empresa" detalle="requiere el RCV" valor="—" />
          </ul>

          {periodoMl ? (
            <Nota
              titulo={`ML factura ${fmtPrecio(periodoMl.totalClp)} en su período${periodoMl.impagoClp ? ` · ${fmtPrecio(periodoMl.impagoClp)} sin pagar` : ''}`}
              tono={Math.abs(periodoMl.descuadreClp) > 1000 ? 'alerta' : 'ok'}
            >
              <p>
                Su período corre del <b>{periodoMl.desde}</b> al <b>{periodoMl.hasta}</b>, que no es el mes
                calendario. Medido sobre esa misma ventana tenemos {fmtPrecio(periodoMl.medidoClp)}:{' '}
                {Math.abs(periodoMl.descuadreClp) > 1000 ? (
                  <b>faltan {fmtPrecio(Math.abs(periodoMl.descuadreClp))} por sincronizar.</b>
                ) : (
                  <>cuadra con la factura.</>
                )}
              </p>
              {periodoMl.impagoClp ? (
                <p>
                  Lo impago es deuda que se acumula: comisión y envío se descuentan de cada venta, pero{' '}
                  <b>publicidad, colecta y almacenamiento</b> se cobran aparte.
                </p>
              ) : null}
            </Nota>
          ) : null}

          {cargosMl.anulacionesClp ? (
            <Nota titulo={`Incluye ${fmtPrecio(cargosMl.anulacionesClp)} en anulaciones, ya restadas`}>
              <p>
                ML manda las anulaciones como líneas aparte (BV anula la comisión, BFF el envío, BPAD la
                publicidad) y con monto positivo. Sumarlas contaría la devolución como un costo más.
              </p>
            </Nota>
          ) : null}

          <Nota titulo="La DIN no entra sola al Registro de Compras" tono="alerta">
            <p>
              Hay que cargarla a mano como documento no electrónico, código <b>914</b>. Si tu contador no lo
              hace, el IVA de cada importación no se está tomando como crédito — y ahí hay millones.
            </p>
          </Nota>
        </section>
      </div>

      <section className="cont-falta">
        <h3>Para cerrar la posición falta el RCV</h3>
        <p>
          Arriba está lo que el sistema mide solo: tus ventas y lo que ML te cobró. El crédito grande son
          las <b>importaciones</b> y los <b>gastos</b>, y viven en el Registro de Compras y Ventas del SII.
          Se sube con los dos CSV que se bajan de sii.cl, sin certificado digital ni costo.
        </p>
        <button className="boton-secundario" disabled>
          <Upload aria-hidden="true" /> Subir RCV (próximo paso)
        </button>
        <p className="cont-pie">
          <AlertTriangle aria-hidden="true" /> No existe API para presentar ni pagar el F29: eso sigue
          siendo sii.cl con clave tributaria. Esto es un panel de gestión, no una declaración.
        </p>
      </section>
    </main>
  )
}

export { IVA }
