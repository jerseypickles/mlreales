import { comisionMlExacta } from './comisionesMl.js'
import { costoEnvioFull, dimensionesDeItem, DIMENSIONES_POR_DEFECTO } from './envioFull.js'

// ¿A PARTIR DE QUÉ ROAS CADA ANUNCIO PIERDE PLATA?
//
// ML te muestra ACOS y ROAS contra la VENTA. Lo que decide si ganas es la
// CONTRIBUCIÓN: precio − comisión − envío Full. Y ML no la conoce, así que sus
// recomendaciones optimizan unidades vendidas, no tu bolsillo — el panel llegó
// a sugerir bajar el objetivo a 1,8x cuando el equilibrio de cuatro de los seis
// productos está sobre eso incluso regalando la mercadería.
//
// El costo del producto NO está cargado (el importador no lo recuerda), así que
// esto entrega el TECHO: el ROAS de equilibrio suponiendo mercadería gratis. El
// real es peor, nunca mejor. Se dice explícito para que nadie lo lea de más.

export function roasEquilibrio({ precio, comision, envio, costoUnitario = 0 }) {
  if (!Number.isFinite(precio) || precio <= 0) return null
  const contribucion = precio - (comision ?? 0) - (envio ?? 0) - (costoUnitario ?? 0)
  if (contribucion <= 0) return { contribucion, roas: null, imposible: true }
  return {
    contribucion: Math.round(contribucion),
    contribucionPct: Math.round((contribucion / precio) * 1000) / 10,
    // vender $X con ACOS = contribución% deja cero: el ROAS de equilibrio es su inverso
    roas: Math.round((precio / contribucion) * 100) / 100,
  }
}

// Veredicto de un anuncio contra SU propio equilibrio, no contra un ACOS parejo.
export function veredictoAnuncio({ roasReal, roasEquilibrio: eq, unidades }) {
  if (eq == null) return { estado: 'sin-economia', texto: 'falta precio del producto' }
  if (!unidades) return { estado: 'sin-ventas', texto: 'gasta sin vender' }
  if (!Number.isFinite(roasReal)) return { estado: 'sin-datos', texto: 'sin datos' }
  const holgura = Math.round(((roasReal - eq) / eq) * 100)
  if (roasReal >= eq * 1.25) return { estado: 'escalar', texto: `${holgura}% de aire`, holgura }
  if (roasReal >= eq) return { estado: 'justo', texto: `${holgura}% de aire`, holgura }
  return { estado: 'pierde', texto: `bajo su equilibrio (${eq}x)`, holgura }
}

// Economía real de cada anuncio: cruza las métricas de Product Ads con el
// precio del producto propio, la comisión exacta de su categoría y la tarifa
// Full escalonada. Todo sondeado en vivo, nada estimado.
export async function economiaPorAnuncio(porItem, propios) {
  const porId = new Map()
  for (const p of propios ?? []) {
    const id = p.itemIdMl ?? p.sku
    if (id) porId.set(id, p)
  }

  const salida = {}
  for (const [itemId, ad] of Object.entries(porItem ?? {})) {
    const propio = porId.get(itemId)
    const ult = (propio?.mediciones ?? []).at(-1) ?? {}
    const precioLista = ult.precio ?? null
    const m = ad.metricas ?? {}
    const gasto = Number(m.cost) || 0
    const venta = Number(m.total_amount) || 0
    const unidades = Number(m.units_quantity) || 0
    const roasReal = gasto > 0 ? Math.round((venta / gasto) * 100) / 100 : null

    // EL PRECIO QUE MANDA ES EL QUE SE COBRÓ, NO EL DE LA VITRINA.
    //
    // Esto calculaba la contribución con el precio de lista de hoy, y el ROAS
    // real con la venta atribuida — dos precios distintos para el mismo
    // anuncio. Cuando hubo descuento, las dos mitades se contradicen: la
    // lámpara mostraba "pierde" (ROAS 1,21x bajo su equilibrio de 1,3x) y a la
    // vez "+$4.034 de resultado", porque el veredicto miraba lo cobrado
    // ($6.893 por unidad, con el descuento de campaña que ya no existe) y el
    // resultado la contribución del precio de lista ($9.990).
    //
    // Con unidades vendidas, el precio efectivo sale de dividir lo facturado:
    // ahí la comisión, el envío y el equilibrio quedan sobre lo que de verdad
    // entró. Sin ventas no hay qué dividir y se usa la lista, que para el
    // equilibrio de referencia es lo correcto.
    const precioEfectivo = unidades > 0 && venta > 0 ? Math.round(venta / unidades) : null
    const precio = precioEfectivo ?? precioLista

    let eco = null
    if (Number.isFinite(precio) && precio > 0) {
      const [comision, envio] = await Promise.all([
        // pct + cargo fijo de la categoría real (listing_prices de la API oficial)
        comisionMlExacta({ precioClp: precio, categoriaId: propio?.categoriaMl ?? null })
          .then((c) =>
            Number.isFinite(c?.pct)
              ? Math.round((c.pct / 100) * precio) + (c.cargoFijoClp ?? 0)
              : Math.round(precio * 0.13),
          )
          .catch(() => Math.round(precio * 0.13)),
        // tarifa Full escalonada, con el descuento por nivel de vendedor ya aplicado
        costoEnvioFull({
          precioClp: precio,
          dimensiones: dimensionesDeItem(propio?.oficial) ?? DIMENSIONES_POR_DEFECTO,
        })
          .then((e) => (Number.isFinite(e?.clp) ? e.clp : 799))
          .catch(() => 799),
      ])
      eco = roasEquilibrio({ precio, comision, envio })
      if (eco) {
        eco.comision = comision
        eco.envio = envio
      }
    }

    salida[itemId] = {
      titulo: ad.titulo ?? null,
      estado: ad.estado ?? null,
      precio,
      precioLista,
      // se vendió por debajo de vitrina (descuento, promo o cupón de ML)
      vendidoBajoLista:
        Number.isFinite(precioEfectivo) && Number.isFinite(precioLista) && precioEfectivo < precioLista * 0.97
          ? { efectivo: precioEfectivo, lista: precioLista }
          : null,
      gasto: Math.round(gasto),
      venta: Math.round(venta),
      unidades,
      clicks: Number(m.clicks) || 0,
      // la vitrina: foto, link y campaña vienen del mismo payload del anuncio y
      // son lo que deja mostrar el producto como producto en la mesa
      foto: ad.foto ?? null,
      permalink: ad.permalink ?? null,
      campanaId: ad.campanaId ?? null,
      creadoEl: ad.creadoEl ?? null,
      impresiones: Number(m.prints) || 0,
      roasReal,
      ...(eco ?? {}),
      // la contribución que ESTE anuncio generó, contra lo que costó: es el
      // único número de ganancia calculable sin conocer el costo del producto
      contribucionGenerada: eco?.contribucion != null ? eco.contribucion * unidades : null,
      resultado:
        eco?.contribucion != null ? Math.round(eco.contribucion * unidades - gasto) : null,
      veredicto: veredictoAnuncio({ roasReal, roasEquilibrio: eco?.roas ?? null, unidades }),
    }
  }
  return salida
}
