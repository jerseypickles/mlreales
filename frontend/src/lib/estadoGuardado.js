// ESTADO QUE SOBREVIVE A SALIR Y VOLVER A LA PANTALLA (11-nov-2026).
//
// Pedido del importador: «varias interfaces cuesta mucho que carguen la
// información». Cada pantalla partía vacía cada vez que se entraba a ella,
// aunque se hubiera visto hace diez segundos: había que esperar la respuesta
// para ver algo. Con esto lo último leído queda en memoria mientras la
// aplicación está abierta: al volver se muestra al tiro y la pantalla lo
// actualiza detrás, como ya hacía la mesa de Oportunidades.
//
// Se usa igual que useState, con una clave única por dato. No sobrevive a
// recargar la página, a propósito: lo que se guarda son datos de la cuenta y no
// deben quedar en el almacenamiento del navegador.
import { useCallback, useState } from 'react'

const memoria = new Map()

export function useEstadoGuardado(clave, inicial) {
  const [valor, setValor] = useState(() => (memoria.has(clave) ? memoria.get(clave) : inicial))
  const guardar = useCallback((nuevo) => {
    setValor((actual) => {
      const siguiente = typeof nuevo === 'function' ? nuevo(actual) : nuevo
      memoria.set(clave, siguiente)
      return siguiente
    })
  }, [clave])
  return [valor, guardar]
}

// Al bloquearse la aplicación (la clave dejó de servir) no queda nada guardado.
export function olvidarEstadoGuardado() {
  memoria.clear()
}
