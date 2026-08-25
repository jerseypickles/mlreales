import { useEffect, useState } from 'react'
import { Landmark, Link2, ShieldCheck, Check, Clock, TriangleAlert, HelpCircle } from 'lucide-react'
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
//
// Y una advertencia que todavía no puede aplicar tampoco va encendida: la de la
// DIN aparece recién con la primera carga (importaciones.enJuego), porque hasta
// octubre no hay ninguna importación que declarar y la alarma solo compite con
// los casilleros del F29, que es lo que este mes sí hay que mirar.

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

// LOS CASILLEROS DEL F29.
//
// Aviso del SII del 25-ago-2026: ML vende por mandato y lo que se declara son
// las liquidaciones factura que emite, en cuatro códigos. La pantalla mostraba
// la plata correcta pero nunca en qué línea escribirla — y el cruce de líneas
// es justamente lo que deja la declaración observada.
//
// Cada casillero muestra lo que FALTA para poder llenarlo, si falta algo. Un
// número sin esa advertencia se copia al formulario tal cual, y dos de los
// cuatro todavía dependen de leer el documento.
function Casillero({ c }) {
  const vacio = c.valor === null || c.valor === undefined
  return (
    <div className={`f29-casilla${vacio ? ' f29-casilla-vacia' : ''}${c.falta ? ' f29-casilla-abierta' : ''}`}>
      <span className="f29-codigo">[{c.codigo}]</span>
      <b className="f29-valor">
        {vacio ? '—' : c.unidad === 'clp' ? fmtPrecio(c.valor) : c.valor}
        {c.valorSiNeto != null && c.valorSiNeto !== c.valor ? (
          <em className="f29-alt"> o {fmtPrecio(c.valorSiNeto)}</em>
        ) : null}
      </b>
      <span className="f29-que">{c.que}</span>
      {c.falta ? <span className="f29-falta">falta: {c.falta}</span> : null}
    </div>
  )
}

// EL CIERRE DEL MES: TRES RELOJES QUE NO COINCIDEN.
//
// "Necesito control, porque si cierra ML, ¿cierra el SII o no?". No. La
// facturación de ML corre del 29 al 25, las liquidaciones son semanales y el
// período tributario va del 1 al 31 — y lo que decide en qué F29 cae cada peso
// no es ninguno de esos cierres, es la FECHA DEL DOCUMENTO.
//
// Los tres chequeos separan a propósito "falta que hagas algo" (alerta) de
// "falta que llegue algo" (espera). Mezclarlos convierte el bloque en un
// semáforo siempre rojo que se termina ignorando.
const ICONO_CHEQUEO = { ok: Check, esperando: Clock, alerta: TriangleAlert, sin_datos: HelpCircle }

function Chequeo({ c }) {
  const Icono = ICONO_CHEQUEO[c.estado] ?? HelpCircle
  return (
    <li className={`cierre-chequeo cierre-${c.estado}`}>
      <Icono aria-hidden="true" />
      <div>
        <b>{c.titulo}</b>
        <span>{c.detalle}</span>
      </div>
    </li>
  )
}

function Cierre({ cierre }) {
  if (!cierre) return null
  const { relojes: r, chequeos, puedeDeclarar, alertas, esperando } = cierre
  const titular = puedeDeclarar
    ? 'El mes está listo para declarar'
    : alertas
      ? `${alertas} cosa(s) que revisar antes de declarar`
      : esperando
        ? 'Falta que lleguen documentos'
        : 'Sin datos suficientes'

  return (
    <section className={`cta-caja cierre${puedeDeclarar ? ' cierre-listo' : alertas ? ' cierre-alerta' : ''}`}>
      <h3>Cierre del mes</h3>
      <p className="cierre-titular">{titular}</p>

      {/* los tres relojes, que es lo que nadie tiene en la cabeza */}
      <div className="cierre-relojes">
        <div>
          <span>Facturación de ML</span>
          <b>
            {r.ml ? `${r.ml.desde} → ${r.ml.hasta}` : '—'}
            {r.ml?.estado === 'OPEN' ? <em> abierto</em> : r.ml ? <em> cerrado</em> : null}
          </b>
        </div>
        <div>
          <span>Liquidaciones de ventas</span>
          <b>semanales{r.ultimaLiquidacion ? <em> última {r.ultimaLiquidacion}</em> : null}</b>
        </div>
        <div>
          <span>Período tributario</span>
          <b>
            {r.sii.desde} → {r.sii.hasta}
            <em> lo que manda</em>
          </b>
        </div>
      </div>

      <ul className="cierre-lista">
        {chequeos.map((c) => (
          <Chequeo key={c.id} c={c} />
        ))}
      </ul>

      <p className="cierre-pie">
        Lo que decide en qué F29 cae cada peso no es ninguno de los tres cierres: es la <b>fecha del documento</b>.
        Si ML cierra su facturación y emite la factura de sus cargos con fecha del mes siguiente, el crédito se va a
        ese F29 y este mes lo pagas completo.
      </p>
    </section>
  )
}

// CONECTAR EL SII SIN ENTREGAR LA CLAVE.
//
// No hay API del SII: el RCV se lee llamando los endpoints internos de su
// propia app con una sesión ya abierta. La decisión del importador el
// 25-ago-2026 fue que la clave tributaria NO se guarda en ninguna parte — así
// que el sistema recibe solo las cookies de una sesión que él abrió a mano.
//
// El precio es este formulario: la sesión dura un par de horas y hay que
// repetirlo cuando toque declarar. Para un trámite mensual es barato, y a
// cambio la credencial tributaria de la empresa no vive en Render.
const RECETA = "copy(document.cookie)"

function ConexionSii({ estado, onConectar }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const conectar = async () => {
    setEnviando(true)
    setError(null)
    try {
      await onConectar(texto.trim())
      setTexto('')
      setAbierto(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const viva = estado?.conectada
  return (
    <div className={`sii-conexion${viva ? ' sii-viva' : ''}`}>
      <span className="sii-estado">
        {viva ? <ShieldCheck aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {viva ? (
          <>
            SII conectado · {estado.rut}
            {estado.expiraEl ? <small>la sesión vence {fmtFecha(estado.expiraEl)}</small> : null}
          </>
        ) : (
          <>
            SII sin conectar
            <small>{estado?.motivo ?? 'los casilleros salen de lo que medimos, no del RCV'}</small>
          </>
        )}
      </span>
      <button type="button" className="sii-btn" onClick={() => setAbierto((v) => !v)}>
        {viva ? 'Reconectar' : 'Conectar'}
      </button>

      {abierto ? (
        <div className="sii-forma">
          <ol>
            <li>
              Entra a <b>sii.cl</b> con tu RUT y clave, y abre el Registro de Compras y Ventas.
            </li>
            <li>
              Abre la consola del navegador y corre <code>{RECETA}</code>
            </li>
            <li>Pega acá lo que quedó copiado.</li>
          </ol>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="TOKEN=...; CSESSIONID=...; RUT_NS=..."
            rows={3}
            spellCheck={false}
          />
          <div className="sii-forma-pie">
            <em>Tu clave no viaja acá y no se guarda: solo las cookies de la sesión.</em>
            <button type="button" onClick={conectar} disabled={!texto.trim() || enviando}>
              {enviando ? 'Conectando…' : 'Guardar sesión'}
            </button>
          </div>
          {error ? <p className="sii-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

// Las liquidaciones factura del período, tal como las ve el SII.
function Liquidaciones({ rcv }) {
  if (!rcv || rcv.error || !rcv.documentos) return null
  return (
    <div className="sii-liq">
      <h4>
        {rcv.documentos} liquidaciones factura en el RCV
        {rcv.pendientes ? <small> · {rcv.pendientes} todavía sin entrar al registro</small> : null}
      </h4>
      <table>
        <thead>
          <tr>
            <th>Folio</th>
            <th>Fecha</th>
            <th>Neto</th>
            <th>IVA</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rcv.detalle.map((d) => (
            <tr key={d.folio} className={d.estadoContab === 'PENDIENTE' ? 'liq-pendiente' : undefined}>
              <td>{d.folio}</td>
              <td>{d.fecha}</td>
              <td>{fmtPrecio(d.netoClp)}</td>
              <td>{fmtPrecio(d.ivaClp)}</td>
              <td>{fmtPrecio(d.totalClp)}</td>
              <td>{d.estadoContab === 'PENDIENTE' ? 'pendiente' : 'registrada'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [sii, setSii] = useState(null)

  const cargar = () => {
    api.contabilidad().then(setDatos).catch((e) => setError(e.message))
    api.siiEstado().then(setSii).catch(() => setSii({ conectada: false, motivo: 'no se pudo consultar' }))
  }

  useEffect(() => {
    let vigente = true
    api
      .contabilidad()
      .then((d) => vigente && setDatos(d))
      .catch((e) => vigente && setError(e.message))
    api
      .siiEstado()
      .then((e) => vigente && setSii(e))
      .catch(() => vigente && setSii({ conectada: false, motivo: 'no se pudo consultar' }))
    return () => {
      vigente = false
    }
  }, [])

  // al conectar hay que releer la posición: los casilleros cambian de fuente
  const conectarSii = async (cookies) => {
    await api.siiConectar(cookies)
    cargar()
  }

  if (error) return <main className="contabilidad"><p className="error-bloque">Error: {error}</p></main>
  if (!datos) return <main className="contabilidad"><Cargando texto="Cargando la posición del mes…" /></main>

  const { periodo, ventas, cargosMl, resultado: res, periodoMl, debito, creditoMl, emision, f29, importaciones } = datos
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

      <Cierre cierre={f29?.cierre} />

      {/* PARA EL FORMULARIO — aviso del SII del 25-ago-2026 sobre el mandato */}
      {f29 ? (
        <section className="cta-caja f29">
          <h3>
            Para el F29 de {periodo}
            {f29.ventana ? (
              <small>
                {' '}
                · la ventana de ML es {f29.ventana.desde} a {f29.ventana.hasta}, no el mes
              </small>
            ) : null}
          </h3>
          <ConexionSii estado={sii} onConectar={conectarSii} />
          <div className="f29-grid">
            {(f29.codigos ?? []).map((c) => (
              <Casillero key={c.codigo} c={c} />
            ))}
          </div>
          <Liquidaciones rcv={f29.rcv} />
          <p className="f29-pie">
            ML vende <b>por mandato</b>: el débito de esas ventas es tuyo y se declara desde la liquidación factura
            que ML te emite, no desde tus boletas. El <b>[519] y [520] son la línea general de facturas recibidas</b>
            (línea 28 del formulario), no una línea del mandato: la comisión de ML entra ahí como una factura más,
            junto con envíos, publicidad y cualquier otro proveedor. Mientras ML no emita esa factura, ese lado del
            formulario queda en cero aunque las liquidaciones ya estén registradas.
          </p>
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
            {/* la DIN solo aparece cuando hay importaciones en juego: hasta que
                llegue la primera carga es una fila vacía que no dice nada */}
            {importaciones?.enJuego ? (
              <Linea etiqueta="Importaciones (DIN)" detalle="requiere el RCV" valor="—" />
            ) : null}
            <Linea etiqueta="Gastos de la empresa" detalle="requiere el RCV" valor="—" />
          </div>
        </section>
      </div>

      {/* EL PORQUÉ, AL FINAL Y PLEGADO */}
      <section className="cta-notas">
        {importaciones?.enJuego ? (
          <Nota titulo="La DIN no entra sola al Registro de Compras" tono="alerta">
            <p>
              Hay que cargarla a mano como documento no electrónico, código <b>914</b>. Si tu contador no lo hace, el
              IVA de cada importación no se toma como crédito — y en importación ese IVA es el monto grande, mucho
              mayor que todo lo de ML junto.
            </p>
          </Nota>
        ) : (
          <Nota titulo={`Todavía no hay importaciones que declarar · la primera carga llega en ${importaciones?.desde ?? '2026-10'}`}>
            <p>
              Desde ese F29 aparece acá el crédito de la <b>DIN</b>. Son dos pasos distintos: se carga a mano al
              Registro de Compras como documento no electrónico <b>código 914</b>, y en el formulario va en la{' '}
              <b>línea 34</b> — cantidad en el [534] y crédito en el [535]. No entra solo, y en importación ese IVA
              es el monto grande. Mientras no haya carga en aduana no aplica y el aviso queda apagado.
            </p>
          </Nota>
        )}

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
              este débito también. El SII lo confirmó por correo el 25-ago-2026 y dijo cómo se declara: el débito de
              estas ventas <b>no se toma de estas boletas</b> sino de la liquidación factura que ML te emite, en los
              códigos [500] y [501]. Por eso el bloque de arriba.
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

        <Nota titulo="El crédito no es lo que ML te cobra: es el IVA que va adentro">
          <p>
            De los cargos de ML solo vuelve el <b>IVA</b>, no el monto. Si ML te cobra $100.000 con IVA incluido,
            $84.034 son costo real —bajan tu utilidad, no tu IVA— y solo $15.966 son crédito fiscal. Vale para la
            comisión, los envíos, la publicidad, la colecta y el almacenaje por igual: <b>gastar más en Product Ads
            no te baja el IVA de forma importante</b>, se justifica por las ventas que trae y nunca por el impuesto.
          </p>
        </Nota>

        <Nota titulo="El SII no tiene API para declarar: esto es un panel, no una declaración">
          <p>
            El RCV ya se lee solo —de ahí salen los casilleros— pero <b>no existe forma de presentar el F29 por
            software</b>. La vía oficial de "upload" genera un archivo que igual hay que subir a mano por el
            navegador. Alguien teclea los números en sii.cl; lo que el sistema hace es que sean los correctos.
          </p>
        </Nota>
      </section>
    </main>
  )
}

export { IVA }
