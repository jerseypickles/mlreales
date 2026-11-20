import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../api.js'
import { Aviso } from './sistema.jsx'

// ¿SE ESTÁ MIDIENDO? (20-nov-2026). Dos días seguidos los scans terminaron sin leer reseñas y la mesa siguió
// mostrando la venta de antes como si fuera de hoy: nada lo decía. Estos avisos van arriba de todo en Oportunidades
// y solo aparecen cuando hay un problema (services/saludMedicion.js cuenta las mediciones seguidas en blanco).
// Se vuelve a preguntar cada vez que llega una mesa nueva (`alDia` cambia), sin temporizador propio.

// «18 nov a las 16:00»: día y hora en una frase, sin el año ni el «p. m.» (que dejaba dos puntos seguidos al cerrar
// la oración). Hora del navegador, como en el resto de la aplicación.
function cuando(iso) {
  if (!iso) return '—'
  const f = new Date(iso)
  const dia = f.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace(/\.$/, '')
  const hora = f.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${dia} a las ${hora}`
}

function textoDe(p) {
  if (p.id === 'scans-sin-resenas') {
    return {
      titulo: 'Los scans no están leyendo reseñas.',
      texto: `Los últimos ${p.seguidos} scans de nichos terminaron sin reseñas medidas (el primero, el ${cuando(p.desde)}). `
        + (p.ultimoBueno ? `El último que sí midió fue el ${cuando(p.ultimoBueno)}. ` : `Ninguno midió en los últimos ${p.diasMirados} días. `)
        + 'La venta en Mercado Libre y el puntaje que muestra la mesa son de antes de eso: no los tomes como de hoy.',
    }
  }
  if (p.id === 'stock-sin-lecturas') {
    return {
      titulo: 'El seguimiento de stock no está leyendo.',
      texto: `Las últimas ${p.pasadas} pasadas no pudieron leer ninguna publicación (${p.lecturas} lecturas fallidas desde el ${cuando(p.desde)}). `
        + (p.ultimaBuena ? `La última lectura buena fue el ${cuando(p.ultimaBuena)}. ` : '')
        + 'Lo que se ve del stock de la competencia es de antes de eso.',
    }
  }
  return null
}

export function AvisosDeMedicion({ alDia }) {
  const [salud, setSalud] = useState(null)
  useEffect(() => {
    let vivo = true
    // si la consulta falla no se muestra nada: el aviso no puede tapar la mesa con un error propio
    api.saludMedicion().then((s) => vivo && setSalud(s)).catch(() => {})
    return () => { vivo = false }
  }, [alDia])
  const avisos = (salud?.problemas ?? []).map((p) => ({ id: p.id, ...textoDe(p) })).filter((a) => a.titulo)
  if (!avisos.length) return null
  return (
    <>
      {avisos.map((a) => (
        <Aviso key={a.id} tono="problema" Icono={AlertTriangle} titulo={a.titulo}>{a.texto}</Aviso>
      ))}
    </>
  )
}
