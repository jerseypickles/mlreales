import { useEffect, useState } from 'react'
import { Landmark } from 'lucide-react'
import { api } from '../api.js'
import { Cargando } from './ui.jsx'
import { fmtPrecio, fmtFecha } from '../lib/formato.js'

// POSICIÓN DE IVA.
//
// La versión anterior mostraba débito y crédito en dos columnas y NUNCA decía
// cuánto se paga. El importador lo dijo así: "veo un enredo y no sé qué es lo
// que se impone, después gastamos en publicidad y no sé cuánto queda". Sus dos
// preguntas eran esas y ninguna estaba en pantalla — había cinco notas
// plegables compitiendo por atención y ningún resultado.
//
// Ahora la página empieza por la respuesta y después explica de dónde sale.
// El texto no se borró: bajó al final, plegado, porque las advertencias siguen
// siendo ciertas (la DIN que no entra sola al Registro de Compras vale
// millones) pero ninguna es lo primero que hay que leer.

const IVA = 0.19

function Linea({ etiqueta, valor, detalle, signo, fuerte }) {
  return (
    <div className={`cta-linea${fuerte ? ' cta-linea-fuerte' : ''}`}>
      <span>
        {etiqueta}
        {detalle ? <small>{detalle}</small> : null}
      </span>
      <b className={signo === '-' ? 'cta-resta' : undefined}>
        {signo === '-' ? '−' : ''}
        {valor}
      </b>
    </div>
  )
}

function Nota({ titulo, tono, children }) {
  return (
    <details className={`cta-nota${tono ? ` cta-nota-${tono}` : ''}`}>
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

  const { periodo, ventas, cargosMl, resultado: res, periodoMl, debito, creditoMl, emision } = datos
  const familias = cargosMl.familias ?? []
  const rango = res && res.ivaAPagar !== res.ivaAPagarSiNeto

  return (
    <main className="contabilidad">
      <header className="cont-cabeza">
        <h2>
          <Landmark aria-hidden="true" /> Posición de IVA
        </h2>
        <span className="cont-periodo">
          {periodo}
          {cargosMl.sincronizadoEl ? ` · cargos al ${fmtFecha(cargosMl.sincronizadoEl)}` : ''}
        </span>
      </header>

      {/* LA RESPUESTA PRIMERO */}
      {res ? (
        <section className="cta-respuestas">
          <div className="cta-respuesta">
            <span>IVA a pagar este mes</span>
            <strong>{fmtPrecio(res.ivaAPagar)}</strong>
            {rango ? (
              <em>
                entre {fmtPrecio(res.ivaAPagarSiNeto)} y {fmtPrecio(res.ivaAPagar)} — se define cuando ML emita su
                factura
              </em>
            ) : null}
          </div>
          <div className="cta-respuesta cta-respuesta-caja">
            <span>Lo que queda en caja</span>
            <strong className={res.quedaEnCaja > 0 ? 'res-bien' : 'res-mal'}>{fmtPrecio(res.quedaEnCaja)}</strong>
            <em>antes del costo de la mercadería, que no está cargado</em>
          </div>
        </section>
      ) : null}

      {/* DE DÓNDE SALE */}
      {res ? (
        <section className="cta-caja">
          <h3>De dónde sale</h3>
          <div className="cta-cuenta">
            <Linea etiqueta="Vendiste" detalle={`${debito.documentos} documentos emitidos`} valor={fmtPrecio(res.vendido)} />
            <Linea
              etiqueta="ML te cobró"
              detalle={`${cargosMl.lineas} líneas · publicidad ${fmtPrecio(res.publicidad)}`}
              valor={fmtPrecio(res.cobradoPorMl)}
              signo="-"
            />
            <Linea etiqueta="IVA a pagar" valor={fmtPrecio(res.ivaAPagar)} signo="-" />
            <Linea etiqueta="Queda" valor={fmtPrecio(res.quedaEnCaja)} fuerte />
          </div>
        </section>
      ) : null}

      <div className="cont-grid">
        <section className="cta-caja">
          <h3>Débito · lo que cobraste</h3>
          <div className="cta-cuenta">
            <Linea etiqueta="Bruto documentado" valor={fmtPrecio(debito.brutoClp)} />
            <Linea etiqueta="Neto" valor={fmtPrecio(debito.netoClp)} />
            <Linea etiqueta="IVA débito" valor={fmtPrecio(debito.clp)} fuerte />
          </div>
        </section>

        <section className="cta-caja">
          <h3>Crédito · lo que descuentas</h3>
          <div className="cta-cuenta">
            <Linea etiqueta="Cargos de ML" valor={fmtPrecio(cargosMl.totalClp)} />
            {familias.map((f) => (
              <Linea key={f.familia} etiqueta={f.etiqueta} valor={fmtPrecio(f.clp)} detalle=" " />
            ))}
            <Linea etiqueta="IVA de esos cargos" valor={fmtPrecio(creditoMl.clp)} fuerte />
            <Linea etiqueta="Importaciones (DIN)" detalle="requiere el RCV" valor="—" />
            <Linea etiqueta="Gastos de la empresa" detalle="requiere el RCV" valor="—" />
          </div>
        </section>
      </div>

      {/* EL PORQUÉ, AL FINAL Y PLEGADO */}
      <section className="cta-notas">
        <Nota titulo="La DIN no entra sola al Registro de Compras" tono="alerta">
          <p>
            Hay que cargarla a mano como documento no electrónico, código <b>914</b>. Si tu contador no lo hace, el
            IVA de cada importación no se toma como crédito — y en importación ese IVA es el monto grande, mucho
            mayor que todo lo de ML junto.
          </p>
        </Nota>

        {periodoMl?.impagoClp ? (
          <Nota titulo={`ML factura ${fmtPrecio(periodoMl.totalClp)} en su período · ${fmtPrecio(periodoMl.impagoClp)} sin pagar`}>
            <p>
              Su período corre del <b>{periodoMl.desde}</b> al <b>{periodoMl.hasta}</b>, que no es el mes calendario.
              Comisión y envío se descuentan de cada venta; <b>publicidad, colecta y almacenamiento</b> se cobran
              aparte y por eso se acumulan como deuda.
            </p>
          </Nota>
        ) : null}

        <Nota titulo={`No calza con tus ${ventas.ordenes} órdenes de ${fmtPrecio(ventas.brutoClp)} — y está bien`}>
          <p>
            Una boleta puede cubrir <b>varias órdenes</b> del mismo carro, y un carro que cruza el fin de mes se
            factura en un período mientras sus órdenes caen en el otro. Para declarar manda la <b>fecha de emisión</b>.
            {ventas.sinBoleta ? ` Quedan ${ventas.sinBoleta} orden(es) sin documento sincronizado.` : ''}
          </p>
        </Nota>

        {emision ? (
          <Nota titulo={`Las boletas las emite ${emision.emisorNombre}, pero el débito es tuyo`}>
            <p>
              Con folios propios (RUT {emision.emisorRut}) y el mensaje legal{' '}
              <b>“por cuenta y orden de {emision.porCuentaDe}”</b>. Es un mandato de facturación: la venta es tuya y
              este débito también. Falta confirmar que aparezcan en tu Registro de Ventas del SII.
            </p>
          </Nota>
        ) : null}

        {cargosMl.anulacionesClp ? (
          <Nota titulo={`Incluye ${fmtPrecio(cargosMl.anulacionesClp)} en anulaciones, ya restadas`}>
            <p>
              ML manda las anulaciones como líneas aparte y con monto positivo (BV anula la comisión, BFF el envío,
              BPAD la publicidad). Sumarlas contaría la devolución como un costo más.
            </p>
          </Nota>
        ) : null}

        <Nota titulo="Para cerrar la posición falta el RCV">
          <p>
            Arriba está lo que el sistema mide solo: tus ventas y lo que ML te cobró. El crédito grande son las
            importaciones y los gastos, y viven en el Registro de Compras y Ventas del SII. No existe API para
            presentar el F29: esto es un panel de gestión, no una declaración.
          </p>
        </Nota>
      </section>
    </main>
  )
}

export { IVA }
