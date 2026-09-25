// TALLAS CHILENAS A PARTIR DE LA TABLA DEL PROVEEDOR.
//
// El 25-sep-2026 llegó la tabla de tallas de un proveedor de trajes de baño
// (S/M/L/XL con busto, cintura y cadera en cm). El importador: "no que se base
// en esta, pero sí necesito que indique qué talla es chilena". En Chile no hay
// tabla oficial: el comercio usa la numeración europea (36, 38, 40…) y letras.
// Por eso se compara por CENTÍMETROS, nunca por la letra: la de un proveedor
// chino suele venir una talla más chica, y publicar con su letra llena la
// cuenta de devoluciones por "me quedó chico".
//
// Referencia: escalera europea de mujer (cada número ≈ 4 cm de busto y cadera;
// sobre la 44 los saltos se abren a 6 cm) y las letras con que se vende en Chile.
export const ESCALERA_CL = [
  { numero: 34, letra: 'XS', busto: 80, cintura: 64, cadera: 88 },
  { numero: 36, letra: 'S', busto: 84, cintura: 68, cadera: 92 },
  { numero: 38, letra: 'M', busto: 88, cintura: 72, cadera: 96 },
  { numero: 40, letra: 'M', busto: 92, cintura: 76, cadera: 100 },
  { numero: 42, letra: 'L', busto: 96, cintura: 80, cadera: 104 },
  { numero: 44, letra: 'XL', busto: 100, cintura: 84, cadera: 108 },
  { numero: 46, letra: 'XXL', busto: 106, cintura: 90, cadera: 114 },
  { numero: 48, letra: '3XL', busto: 112, cintura: 96, cadera: 120 },
]
// lo que más se vende en trajes de baño en Chile va de S a XXL (36 a 46)
export const RANGO_DEMANDA_CL = [36, 46]
const ORDEN_LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']
// en traje de baño la cadera decide la parte de abajo y el busto la de arriba
const PESOS = { cadera: 0.45, busto: 0.4, cintura: 0.15 }

// número europeo equivalente a una medida, interpolando en la escalera (y
// extrapolando fuera de ella con el paso del extremo)
function numeroPorMedida(medida, cm) {
  const e = ESCALERA_CL
  let i = e.findIndex((x) => x[medida] >= cm)
  if (i === -1) i = e.length - 1
  if (i === 0) i = 1
  const a = e[i - 1], b = e[i]
  return a.numero + (cm - a[medida]) / (b[medida] - a[medida]) * (b.numero - a.numero)
}

const medio = (min, max) => (Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : Number.isFinite(min) ? min : Number.isFinite(max) ? max : null)

// Pura. filas: [{talla, bustoMin, bustoMax, cinturaMin, cinturaMax, caderaMin, caderaMax, copa?}]
export function equivalenciaChilena(filas) {
  const salida = (filas ?? []).map((f) => {
    let suma = 0, peso = 0
    for (const [medida, w] of Object.entries(PESOS)) {
      const cm = medio(f[`${medida}Min`], f[`${medida}Max`])
      if (cm == null) continue
      suma += numeroPorMedida(medida, cm) * w
      peso += w
    }
    if (!peso) return { ...f, numeroCl: null, letraCl: null }
    const numero = Math.round(suma / peso / 2) * 2
    const fila = ESCALERA_CL.find((x) => x.numero === numero)
    const letraCl = fila?.letra ?? (numero < 34 ? 'XXS' : '4XL')
    const iProv = ORDEN_LETRAS.indexOf(String(f.talla).toUpperCase()), iCl = ORDEN_LETRAS.indexOf(letraCl)
    return { ...f, numeroCl: numero, letraCl,
      // la letra del proveedor contra la chilena: "chica" = su letra le queda a una talla menor
      diferencia: iProv >= 0 && iCl >= 0 ? (iProv > iCl ? 'chica' : iProv < iCl ? 'grande' : 'igual') : null }
  })
  const cubiertos = new Set(salida.map((s) => s.numeroCl).filter(Number.isFinite))
  const faltan = ESCALERA_CL.filter((x) => x.numero >= RANGO_DEMANDA_CL[0] && x.numero <= RANGO_DEMANDA_CL[1] && !cubiertos.has(x.numero)
    // la 38 y la 40 son ambas "M": basta con cubrir una
    && !(x.letra === 'M' && [...cubiertos].some((n) => ESCALERA_CL.find((y) => y.numero === n)?.letra === 'M')))
  const corre = salida.filter((s) => s.diferencia === 'chica').length
  return { filas: salida, faltanEnChile: faltan.map((x) => `${x.letra} (${x.numero})`),
    correChica: corre >= Math.ceil(salida.length / 2),
    fueraDeDemanda: salida.filter((s) => Number.isFinite(s.numeroCl) && s.numeroCl < RANGO_DEMANDA_CL[0]).map((s) => s.talla) }
}
