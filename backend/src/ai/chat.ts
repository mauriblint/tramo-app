import OpenAI from 'openai'

import { config } from '../config.js'
import { today, todayPlus } from '../today.js'
import { HttpError, REASONING, addDays, daysBetween, isDate, openai } from './client.js'
import { isGenerating, startDayGeneration, startGeneration } from './generate.js'
import { FIRST_QUESTION, nextQuestion, type QuestionOption } from '../onboarding.js'
import {
  PIN_STATUSES,
  PIN_TYPES,
  PACES,
  TIMES_OF_DAY,
  TRAVELERS,
  missingForRoute,
  planStart,
  isOngoing,
  UNKNOWN,
  createMessage,
  createPin,
  deletePin,
  getPin,
  getTrip,
  listMessages,
  listPins,
  listStops,
  moveDays,
  replaceStops,
  setDaysCity,
  setTripDates,
  sortDay,
  updatePin,
  updateTrip,
  type Message,
  type Pin,
  type PinDraft,
  type StopDraft,
  type Suggestion,
  type Trip,
} from '../db.js'

const HISTORY_LIMIT = 30
const MAX_TOOL_ROUNDS = 6

export const GREETING = FIRST_QUESTION

// ---- JSON schemas (strict: every key required, nullables via type unions)

const DATE = { type: ['string', 'null'], description: 'YYYY-MM-DD o null' } as const

const pinDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'title', 'body', 'city', 'tags', 'url', 'status', 'day', 'timeOfDay'],
  properties: {
    type: {
      type: 'string',
      enum: [...PIN_TYPES],
      description:
        'place = lugar a visitar; food = restaurante/comida/bar; activity = experiencia (onsen, clase, show); route = recorrido o traslado (ej. tren Tokio→Kioto); idea = tip, pendiente o plan sin un lugar concreto con nombre propio (ej. "comprar la Suica", "karaoke en cabina", "ir temprano"); summary = resumen. Si no podés nombrar un lugar puntual que exista en un mapa, usá idea.',
    },
    title: {
      type: 'string',
      description:
        'Para lugares: solo el nombre tal como figura en un mapa (ej. "Fushimi Inari Taisha", "Fuunji"); los detalles van en body. Para ideas: corto y concreto (ej. "Comprar la Suica en el aeropuerto").',
    },
    body: {
      type: 'string',
      description: 'Markdown breve y autocontenido: qué es, por qué, tips, horario, precio aprox., cómo llegar.',
    },
    city: { type: ['string', 'null'], description: 'Ciudad o zona (ej. "Kioto", "Tokio - Shibuya")' },
    tags: { type: 'array', items: { type: 'string' }, description: '0-4 tags cortos en minúscula' },
    url: { type: ['string', 'null'] },
    status: { type: 'string', enum: [...PIN_STATUSES], description: 'Por defecto "idea"; "must" si el usuario lo marcó imperdible' },
    day: { ...DATE, description: 'Día del itinerario (YYYY-MM-DD dentro del viaje) o null si es una idea suelta' },
    timeOfDay: { type: ['string', 'null'], enum: [...TIMES_OF_DAY, null], description: 'Momento del día si tiene día' },
  },
} as const

const stopSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['city', 'nights', 'lodging', 'dayTrips'],
  properties: {
    dayTrips: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Excursiones de día a OTRA ciudad/pueblo fuera de la base (ej. ["Nara"] desde Kioto, ["Nikko"] desde Tokio). No barrios de la misma ciudad ni la base misma. Cada destino en UNA sola parada. Casi siempre [] o 1.',
    },
    city: { type: 'string', description: 'Ciudad base donde se duerme' },
    nights: { type: 'integer', description: 'Noches en esta base. La suma debe dar las noches totales del viaje.' },
    lodging: { type: ['string', 'null'], description: 'Alojamiento si se conoce o zona recomendada' },
  },
} as const

const pinsArg = {
  type: 'object',
  additionalProperties: false,
  required: ['pins'],
  properties: { pins: { type: 'array', items: pinDraftSchema } },
} as const

const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] })

const tools: OpenAI.Responses.Tool[] = [
  { type: 'web_search' },
  {
    type: 'function',
    name: 'update_trip',
    strict: true,
    description:
      'Guarda lo que vas sabiendo del viaje. Llamalo apenas el usuario da un dato. Campos en null = no cambiar.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'destination',
        'startDate',
        'endDate',
        'travelers',
        'kids',
        'pace',
        'interests',
        'arrivalCity',
        'arrivalTime',
        'departureCity',
        'departureTime',
        'currentCity',
        'brief',
        'noFixedDates',
        'lengthDays',
        'whenHint',
        'approxStartDate',
      ],
      properties: {
        travelers: { type: ['string', 'null'], enum: [...TRAVELERS, null], description: 'Quiénes viajan' },
        kids: {
          type: ['string', 'null'],
          description: 'Si viajan chicos: cuántos y edades (ej. "2: 5 y 8 años"); "no" si no van chicos',
        },
        pace: { type: ['string', 'null'], enum: [...PACES, null], description: 'Ritmo: tranqui (relax), intermedio, intenso (ver todo)' },
        interests: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Intereses cortos en minúscula (ej. ["comida","templos","naturaleza"]). Lista COMPLETA (reemplaza).',
        },
        arrivalCity: { type: ['string', 'null'], description: 'Ciudad de llegada del viaje' },
        arrivalTime: { type: ['string', 'null'], enum: [...TIMES_OF_DAY, null], description: 'Franja de llegada' },
        departureCity: { type: ['string', 'null'], description: 'Ciudad desde donde se vuelve' },
        departureTime: { type: ['string', 'null'], enum: [...TIMES_OF_DAY, null], description: 'Franja de salida' },
        currentCity: {
          type: ['string', 'null'],
          description: 'CIUDAD donde está el usuario ahora, si el viaje ya empezó (ej. "Kanazawa"). Nunca el país o la región: "estamos en Japón" no es una ciudad (null).',
        },
        name: { type: ['string', 'null'], description: 'Nombre corto y lindo, ej. "Japón otoño 2026"' },
        destination: { type: ['string', 'null'], description: 'País/región y ciudades clave' },
        startDate: { ...DATE, description: 'Primer día del viaje (llegada)' },
        endDate: { ...DATE, description: 'Último día del viaje (salida)' },
        noFixedDates: {
          type: ['boolean', 'null'],
          description: 'true SOLO si el usuario dice explícitamente que todavía no tiene fechas fijas o pasajes. Si simplemente no mencionó fechas: null (la app se las pregunta).',
        },
        lengthDays: { type: ['integer', 'null'], description: 'Duración aproximada en días si la dice sin fechas ("15 días", "dos semanas" = 14)' },
        whenHint: { type: ['string', 'null'], description: 'Cuándo, aproximado y tal como lo dijo, si no hay fechas fijas ("julio", "enero 2027", "en primavera")' },
        approxStartDate: { ...DATE, description: 'Si no hay fechas fijas pero dice el mes: el día 1 de ese mes (el próximo que venga)' },
        brief: {
          type: ['string', 'null'],
          description:
            'Ficha COMPLETA y actualizada en markdown (reemplaza la anterior), bullets cortos: vuelos, viajeros, intereses, ritmo, ciudades fijas/abiertas, alojamientos, restricciones. SOLO lo que el usuario dijo: omití por completo lo que no se sabe (nada de "no especificado").',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'set_stops',
    strict: true,
    description:
      'Define o reemplaza la ruta: paradas en orden con noches en cada una (las fechas se calculan solas desde el inicio del viaje). Usalo para proponer la ruta macro y para cada ajuste ("un día menos en Tokio", "sumá Nara").',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['stops'],
      properties: { stops: { type: 'array', items: stopSchema } },
    },
  },
  {
    type: 'function',
    name: 'move_nights',
    strict: true,
    description:
      'Pasa noches de una parada a otra sin tocar el resto ("uno menos en Kioto y sumalo a Tokio"). Usalo en vez de set_stops para estos ajustes: el sistema hace la cuenta.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'nights'],
      properties: {
        from: { type: 'string', description: 'Ciudad que pierde noches (si se repite, "primera"/"última" en whichFrom no aplica: usá el nombre)' },
        to: { type: 'string', description: 'Ciudad que gana noches. Si aparece dos veces en la ruta, se usa la última aparición.' },
        nights: { type: 'integer', description: 'Cuántas noches mover (normalmente 1)' },
      },
    },
  },
  {
    type: 'function',
    name: 'generate_itinerary',
    strict: true,
    description:
      'Genera (en segundo plano) los ítems día por día a partir de la ruta. Sin cities = todo el viaje; con cities = solo esas paradas ("rehacé Kioto"). Reemplaza solo los ítems en estado "idea" de esos días.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cities'],
      properties: { cities: { type: ['array', 'null'], items: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    name: 'plan_days',
    strict: true,
    description:
      'Arma (en segundo plano) las actividades de SOLO estos días. replace false = suma alrededor de lo que ya tengan; replace true = rehace lo generado (lo que el usuario marcó queda). Para días sin ciudad, pasá city.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['days', 'city', 'replace', 'note'],
      properties: {
        days: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD dentro del viaje' },
        city: { type: ['string', 'null'], description: 'Ciudad para los días que no tienen; null si ya la tienen' },
        replace: { type: 'boolean', description: 'true para rehacer esos días ("recalculá", "rehacé", "cambiá el plan")' },
        note: {
          type: ['string', 'null'],
          description: 'Lo que el usuario quiere para estos días, con sus palabras y lo de la ficha que aplique ("un barrio distinto por día", "algo tranqui, llegamos cansados"). null si no dijo nada.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'move_days',
    strict: true,
    description:
      'Mueve un bloque de días (sus planes y su ciudad) para que empiece en otra fecha: "pasá los días de Tokio al final", "corré los días 5 y 6 un día después". Los días que quedan atrás pasan a "Por definir". Los planes que ya hubiera en los días destino se quedan.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['days', 'to'],
      properties: {
        days: { type: 'array', items: { type: 'string' }, description: 'Fechas YYYY-MM-DD del bloque, en orden' },
        to: { type: 'string', description: 'YYYY-MM-DD donde empieza el bloque ("al final" = que su último día caiga en el último día del viaje)' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_stay',
    strict: true,
    description:
      'Define dónde duermen ciertos días, sin tocar las actividades: alarga, acorta o cambia una estadía ("2 días más en Tokio" = los 2 días siguientes a la estadía de Tokio). city null = esos días vuelven a "Por definir". Si además quiere actividades para esos días, después llamá plan_days.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['days', 'city'],
      properties: {
        days: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD dentro del viaje' },
        city: { type: ['string', 'null'] },
      },
    },
  },
  {
    type: 'function',
    name: 'add_pins',
    strict: true,
    description:
      'Agrega ítems directamente al viaje: en un día (day + timeOfDay) o como idea suelta (day null). Usalo cuando el usuario pide agregar algo o acepta una propuesta.',
    parameters: pinsArg,
  },
  {
    type: 'function',
    name: 'suggest_pins',
    strict: true,
    description:
      'Propone ítems sin guardarlos (el usuario ve tarjetas con "Añadir"). Usalo para ideas/alternativas cuando el usuario explora y todavía no decidió. Máx. 6.',
    parameters: pinsArg,
  },
  {
    type: 'function',
    name: 'update_pins',
    strict: true,
    description:
      'Modifica ítems existentes (mover de día/momento, cambiar estado, editar). En changes, null = no cambiar; day "none" = sacarlo del itinerario y dejarlo como idea.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['updates'],
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'changes'],
            properties: {
              id: { type: 'string' },
              changes: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'body', 'city', 'status', 'day', 'timeOfDay', 'type'],
                properties: {
                  type: nullable({ type: 'string', enum: [...PIN_TYPES] }),
                  title: { type: ['string', 'null'] },
                  body: { type: ['string', 'null'] },
                  city: { type: ['string', 'null'] },
                  status: nullable({ type: 'string', enum: [...PIN_STATUSES] }),
                  day: { type: ['string', 'null'], description: 'YYYY-MM-DD, "none" para quitar del día, null = no cambiar' },
                  timeOfDay: nullable({ type: 'string', enum: [...TIMES_OF_DAY] }),
                },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    name: 'remove_pins',
    strict: true,
    description: 'Borra ítems del viaje (cuando el usuario pide sacarlos del todo).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['ids'],
      properties: { ids: { type: 'array', items: { type: 'string' } } },
    },
  },
]

// ---- context

const STATUS_LABEL: Record<string, string> = {
  idea: 'idea',
  want: 'quiero',
  must: 'imperdible',
  done: 'hecho',
  discarded: 'descartado',
}
const TIME_LABEL: Record<string, string> = { morning: 'mañana', afternoon: 'tarde', evening: 'noche' }

export function tripDays(trip: Trip): string[] {
  return daysBetween(trip.startDate, trip.endDate)
}

const pinLine = (p: Pin) =>
  `- [${p.id}] ${p.timeOfDay ? `(${TIME_LABEL[p.timeOfDay]}) ` : ''}${p.title}${p.city ? ` — ${p.city}` : ''} · ${p.type}, ${STATUS_LABEL[p.status]}`

/** Planned = the day-by-day itinerary exists (or is being generated). Stops alone are still the route draft. */
export function isPlanned(tripId: string): boolean {
  return isGenerating(tripId) || listPins(tripId).some((p) => p.day)
}

const nightsOf = (s: { startDate: string | null; endDate: string | null }) =>
  s.startDate && s.endDate ? Math.round((Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000) : null

/** Lay stops out back to back from the trip start; returns a mismatch note if nights don't add up. */
function layoutStops(trip: Trip, stops: { city: string; nights: number; lodging: string | null; dayTrips?: string[] }[]) {
  let cursor = planStart(trip)
  const drafts: StopDraft[] = stops.map((s) => {
    const nights = Math.max(0, Math.round(s.nights))
    const startDate = cursor
    const endDate = cursor ? addDays(cursor, nights) : null
    cursor = endDate
    const base = s.city.trim().toLowerCase()
    const dayTrips = (s.dayTrips ?? [])
      .map((d) => d.trim())
      .filter((d) => d && !d.toLowerCase().includes(base) && !base.includes(d.toLowerCase()))
    return { city: s.city.trim(), startDate, endDate, lodging: s.lodging?.trim() || null, dayTrips }
  })
  const total = stops.reduce((n, s) => n + Math.max(0, Math.round(s.nights)), 0)
  const start = planStart(trip)
  const tripNights = start && trip.endDate ? nightsOf({ startDate: start, endDate: trip.endDate }) : null
  const warning =
    tripNights == null
      ? 'El viaje no tiene fechas: las paradas quedan sin fechas hasta saberlas.'
      : total !== tripNights
        ? `Las noches suman ${total} pero el viaje tiene ${tripNights}. Ajustalas con set_stops (o preguntá al usuario qué recortar/extender).`
        : null
  return { drafts, total, tripNights, warning }
}

const MAX_NIGHTS: Record<string, number> = { tranqui: 8, intermedio: 6, intenso: 5 }
/** Average nights per base: fewer hotel changes for slower travelers. */
const MIN_AVG_NIGHTS: Record<string, number> = { tranqui: 4, intermedio: 3, intenso: 2.5 }
const sameCity = (a: string, b: string) => {
  const x = a.toLowerCase().trim()
  const y = b.toLowerCase().trim()
  return x.includes(y) || y.includes(x)
}

/** Hard checks the model must satisfy: start/end where the flights are, nights within reason. */
function routeProblems(trip: Trip, stops: { city: string; nights: number }[]): string[] {
  const out: string[] = []
  if (!stops.length) return ['La ruta está vacía.']
  const first = stops[0]!.city
  const last = stops.at(-1)!.city
  const startCity = isOngoing(trip) ? trip.currentCity : trip.arrivalCity
  if (startCity && startCity !== UNKNOWN && !sameCity(first, startCity)) {
    out.push(`La ruta tiene que empezar en ${startCity} (${isOngoing(trip) ? 'donde están ahora' : 'llegan ahí'}), no en ${first}.`)
  }
  if (trip.departureCity && trip.departureCity !== UNKNOWN && !sameCity(last, trip.departureCity)) {
    out.push(
      `La ruta tiene que terminar en ${trip.departureCity} (vuelven desde ahí). Si ya pasaron por esa ciudad, repetila al final con 1-2 noches.`,
    )
  }
  const totalNights = stops.reduce((n, s) => n + s.nights, 0)
  const maxStops = Math.max(2, Math.ceil(totalNights / (MIN_AVG_NIGHTS[trip.pace ?? 'intermedio'] ?? 3)))
  if (stops.length > maxStops) {
    out.push(`Son ${stops.length} paradas para ${totalNights} noches: demasiados cambios de hotel. Usá como máximo ${maxStops} bases y cubrí el resto con excursiones de día.`)
  }
  const start = planStart(trip)
  const available = start && trip.endDate ? nightsOf({ startDate: start, endDate: trip.endDate }) : null
  if (available != null && totalNights !== available) {
    out.push(
      `Las noches suman ${totalNights} pero hay ${available} (${start} → ${trip.endDate}). ${totalNights > available ? `Sacá ${totalNights - available}` : `Sumá ${available - totalNights}`} vos mismo, sin preguntarle al usuario.`,
    )
  }
  // Hard ceiling at twice the comfortable max: one base can't swallow the trip.
  const cap = (MAX_NIGHTS[trip.pace ?? 'intermedio'] ?? 6) * 2
  for (const s of stops) {
    if (s.nights > cap) out.push(`${s.city} tiene ${s.nights} noches: máximo ${cap}. Repartí en más bases o sumá excursiones de día.`)
  }
  const oneNight = stops.slice(0, -1).filter((s) => s.nights <= 1).length
  if (oneNight > 2) out.push(`Hay ${oneNight} paradas de 1 noche: máximo 2. Convertilas en excursiones de día desde una base cercana.`)
  return out
}

/** Soft advice: worth mentioning to the model, but the user may want it that way. */
function routeWarnings(trip: Trip, stops: { city: string; nights: number }[]): string[] {
  const max = MAX_NIGHTS[trip.pace ?? 'intermedio'] ?? 6
  return stops
    .filter((s) => s.nights > max)
    .map((s) => `${s.city} tiene ${s.nights} noches (para ritmo ${trip.pace ?? 'intermedio'} suele ser mucho). Si fue pedido por el usuario, está bien.`)
}

function buildContext(trip: Trip): string {
  const stops = listStops(trip.id)
  const pins = listPins(trip.id)
  const days = tripDays(trip)

  const stopLines = stops.length
    ? stops
        .map((s) => `- ${s.city}: ${nightsOf(s) ?? '?'} noches (${s.startDate ?? '?'} → ${s.endDate ?? '?'})${s.dayTrips.length ? ` · excursiones: ${s.dayTrips.join(', ')}` : ''}${s.lodging ? ` aloj.: ${s.lodging}` : ''}`)
        .join('\n')
    : '(sin paradas)'

  const dayBlocks = days
    .map((day, i) => {
      const items = pins.filter((p) => p.day === day)
      const wd = new Date(`${day}T00:00:00Z`).toLocaleDateString('es', { weekday: 'short', timeZone: 'UTC' })
      return `Día ${i + 1} · ${wd} ${day}\n${items.length ? items.map(pinLine).join('\n') : '  (vacío)'}`
    })
    .join('\n')

  // Items whose day is outside the trip range still need to be visible.
  const orphan = pins.filter((p) => p.day && !days.includes(p.day))
  const ideas = pins.filter((p) => !p.day)

  return `## Estado actual del viaje
Nombre: ${trip.name}
Destino: ${trip.destination ?? 'sin definir'}
Fechas: ${trip.startDate ?? '?'} → ${trip.endDate ?? '?'}${days.length ? ` (${days.length} días, ${days.length - 1} noches)` : ''}${trip.datesTentative ? `\nOJO: fechas PROVISORIAS (todavía no tiene pasajes${trip.whenHint ? `; dijo "${trip.whenHint}"` : ''}). Con el usuario hablá de "Día 1, Día 2…", no de fechas ni días de la semana. Cuando tenga fechas reales, update_trip con startDate/endDate: todo el plan se mueve solo.` : ''}
Hoy: ${today()}

Perfil:
- Viajan: ${trip.travelers ?? '?'}${trip.kids ? ` (chicos: ${trip.kids})` : ''}
- Ritmo: ${trip.pace ?? '?'}
- Intereses: ${trip.interests.length ? trip.interests.join(', ') : '?'}
${isOngoing(trip) ? `- El viaje YA EMPEZÓ: hoy están en ${trip.currentCity ?? '?'}; la ruta se planifica desde hoy (${planStart(trip)}).\n` : ''}- Llegada: ${trip.arrivalCity ?? '?'}${trip.arrivalTime ? ` (${TIME_LABEL[trip.arrivalTime]})` : ''} · Salida: ${trip.departureCity ?? '?'}${trip.departureTime ? ` (${TIME_LABEL[trip.departureTime]})` : ''}
${missingForRoute(trip).length ? `- FALTA para proponer la ruta: ${missingForRoute(trip).join(', ')}` : '- Listo para proponer la ruta.'}

Ficha:
${trip.notes?.trim() || '(vacía)'}

Paradas:
${stopLines}

Itinerario:
${isGenerating(trip.id) ? '(generándose ahora mismo en segundo plano)\n' : ''}${pins.some((p) => p.day) || isGenerating(trip.id) || trip.freeform ? dayBlocks : '(todavía no se generó el día por día)'}
${orphan.length ? `\nÍtems con fecha fuera del viaje:\n${orphan.map((p) => `${pinLine(p)} [${p.day}]`).join('\n')}\n` : ''}
Ideas sueltas (sin día):
${ideas.length ? ideas.map(pinLine).join('\n') : '(ninguna)'}`
}

const COMMON_RULES = `- Respondé en el idioma del usuario, cálido pero conciso. Markdown liviano. Nada de relleno.
- El usuario VE el itinerario y la ficha en pantalla: no los repitas enteros; resumí lo que cambiaste en 1-3 líneas.
- Usá web_search para datos actuales o verificables (horarios, cierres, reservas, eventos, precios, traslados).
- Ítems con day deben caer dentro de las fechas del viaje. Agrupá por cercanía geográfica, días de llegada/salida livianos, traslados entre ciudades como ítem "route".
- Tené en cuenta lo marcado quiero/imperdible: no lo borres ni lo muevas sin que el usuario lo pida.
- No podés reservar ni comprar nada: nunca lo ofrezcas. Sí podés averiguar y avisar qué conviene reservar.`

export type Mode = 'parse' | 'route' | 'planned'

export function modeFor(tripId: string): Mode {
  if (isPlanned(tripId) || getTrip(tripId)?.freeform) return 'planned'
  return listStops(tripId).length ? 'route' : 'parse'
}

const NO_NARRATION = `- Nunca digas que guardaste, anotaste, registraste o actualizaste algo, ni hables de "datos", "ficha", "perfil" o "ruta macro". Hablá como una persona que ayuda a planear un viaje; el usuario ve el progreso en pantalla.`

function buildInstructions(trip: Trip, mode: Mode): string {
  const text = {
    planned: `Sos el copiloto del viaje. El itinerario día por día ya existe; ayudá a refinarlo conversando.
- Si el usuario pide un cambio concreto, hacelo directamente con las tools (update_pins, add_pins, remove_pins) y confirmá breve.
- Si cambia la ruta (noches, sumar/sacar ciudad): set_stops y después generate_itinerary solo para las ciudades afectadas.
- "Rehacé los días de X" → generate_itinerary con cities [X].
- Si está explorando o pide recomendaciones ("¿qué hay en Nara?", "ramen en Tokio", "planes si llueve"), usá suggest_pins: cada recomendación se muestra como una tarjeta propia con botón para guardarla. En el texto poné solo una intro breve (1-2 frases) y, si suma, un cierre; no repitas la lista que ya va en las tarjetas.
- Si dice "guardá/guardame/anotá/pineá esto" (o "eso", "los dos"), guardá lo que se viene hablando con add_pins y day null: queda en sus Ideas. Confirmá en una frase corta.
- Si dice "agregalo al jueves", add_pins con ese día.
- Proponé mejoras cuando veas algo útil (día sobrecargado, lluvia, algo que requiere reserva), sin ser pesado.${trip.freeform ? `
- Este viaje se arma DE A POCO: es normal que haya días vacíos y días sin ciudad. Nunca armes todo el viaje por tu cuenta.
- "Armame el día 3", "del 5 al 7 en Kioto" → plan_days con esos días (y city si todavía no la tienen). Si no sabés la ciudad, preguntala.
- Dónde duermen se define por días con set_stay: "2 días más en Tokio" = los 2 días siguientes al último día de Tokio; "4 días en Tokio" = Día 1 a Día 4 (4 fechas); "Kioto del 5 al 8". Pasá TODAS las fechas (YYYY-MM-DD) de esos días, mirando el Itinerario de abajo (Día N · fecha). Si además dice qué quiere hacer esos días ("un barrio por día", "y armalos", "recalculá"), en el mismo turno plan_days con esos días y note = lo que pidió (replace true si pide rehacer, o si cambia el criterio de días ya armados de esa estadía). Si solo pidió sumar días, set_stay y ofrecé armarlos en una frase.
- Un mensaje "Sobre el día N…" que describe varias noches ("son 4 noches en Tokio, un barrio por día") = set_stay desde ese día por esas noches y plan_days de todos esos días con note, de una.
- "Mové / pasá / corré estos días a…" (con sus planes) → move_days. No rehagas los días para moverlos.
- Preferencias de cómo quiere el viaje ("un barrio por día", "nada de museos") → sumalas a la ficha (update_trip brief) y aplicalas en lo que armes.
- Si pide que le propongas una ruta: contala en 2-3 líneas (ciudades y días) y, si la acepta, un set_stay por ciudad con sus días. Los días que no cubras quedan "Por definir". No armes actividades salvo que lo pida.
- Si para armar días te faltan quiénes viajan, ritmo o intereses, preguntalo en una línea (y guardalo con update_trip), pero no frenes: con lo que haya alcanza.` : ''}
- NUNCA digas que hiciste, armaste, agregaste o anotaste algo si no llamaste la tool y devolvió ok. Si una tool falló, decí qué falta en una línea.`,
    parse: `Estás arrancando un viaje con el usuario. La app le hace las preguntas; vos solo interpretás lo que escribe.
- Extraé TODO dato del mensaje (destino, fechas, ciudad de llegada y de regreso con su franja horaria, ciudad actual si el viaje ya empezó, quiénes viajan, edades de chicos, ritmo, intereses) y guardalo con update_trip (también brief = ficha en markdown con lo que dijo). Poné un name lindo apenas sepas destino.
- Fechas: SIEMPRE completá startDate y endDate (YYYY-MM-DD) si el usuario da días y meses. "10/11" = día/mes. Sin año: elegí el año que deja el viaje más cerca de hoy (puede estar en curso: si hoy cae entre las fechas, es este año). No pidas confirmación.
- Si DICE que no tiene fechas fijas ("todavía no tengo fechas", "no compré pasajes", "en julio pero no sé qué días"): noFixedDates true, lengthDays si dice cuánto, whenHint con el cuándo aproximado y approxStartDate si nombra el mes. No inventes startDate/endDate. Si solo no las nombró ("15 días por Europa"), guardá lengthDays y dejá noFixedDates en null: la app pregunta las fechas.
- Si dice que prefiere armarlo solo / de a poco / día por día, también vale noFixedDates solo si no tiene fechas; si las tiene, guardalas igual.
- "Vuelvo desde X" = departureCity X. "Llego a X" = arrivalCity X. Si dice que no sabe, usá "${UNKNOWN}".
- Después devolvé el JSON: reaction = UNA frase corta y cálida (máx. 12 palabras) que reaccione a lo que contó, sin preguntas y sin mencionar que guardaste nada (ej.: "¡Japón en otoño, qué buen plan!"); reply = si el usuario hizo una pregunta, la respuesta en 1-2 líneas, si no null. La app agrega la próxima pregunta.`,
    route: `Estás proponiendo y ajustando la RUTA del viaje (ciudades base y noches) antes de armar el día por día.
- Si todavía no hay ruta, proponé UNA con set_stops: la mejor para este grupo, ritmo e intereses. Con chicos o ritmo tranqui: menos cambios de hotel; a full: más ciudades. Tiene que empezar donde llegan (o donde están, si el viaje ya empezó) y terminar en la ciudad desde donde vuelven: si es la misma ciudad del inicio, repetila al final con 1-2 noches. Noches por ciudad razonables (el sistema valida y te dice qué corregir). Sumá excursiones de día (cada una en una sola base).
- Preferí bases de 2-4 noches con excursiones de día antes que muchas paradas de 1 noche.
- Tu mensaje: MÁXIMO 3 frases cortas, cálidas. Por qué ese reparto + qué quedó afuera y cómo sumarlo ("si no se quieren perder Hiroshima, le saco una noche a Tokio") + "¿La ajustamos o arranco con el día por día?". NUNCA listes las paradas ni las noches: se ven en pantalla.
- Recorrido lógico: avanzá en una dirección geográfica, sin ir y volver entre regiones (nada de Tokio → Sendai → Osaka → Tokio). Solo se repite una ciudad al final si desde ahí sale el vuelo.
- "Uno menos en X y sumalo a Y" → move_nights (el sistema hace la cuenta). Cambios de ciudades → set_stops manteniendo la suma. Si cambia un dato del viaje, update_trip.
- Cuando confirma ("dale", "armalo", "me gusta"): generate_itinerary (cities null) y decí en una línea que lo vas armando.`,
  }[mode]

  const mode_ = text
  return `${mode_}
${mode === 'planned' ? '' : NO_NARRATION}

Reglas:
${COMMON_RULES}

${buildContext(trip)}`
}

// ---- chat loop

type Input = OpenAI.Responses.ResponseInput

export interface ChatResult {
  userMessage: Message
  assistantMessage: Message
  changedPinIds: string[]
}

type ToolCtx = { userText: string; trip: Trip; suggestions: Suggestion[]; changed: Set<string>; touchedDays: Set<string> }

function runTool(name: string, args: any, ctx: ToolCtx): unknown {
  const tripId = ctx.trip.id
  const add = (d: PinDraft) => {
    const pin = createPin(tripId, d)
    ctx.changed.add(pin.id)
    if (pin.day) ctx.touchedDays.add(pin.day)
    return pin
  }

  switch (name) {
    case 'update_trip': {
      const patch: Partial<Trip> = {}
      if (args.name) patch.name = args.name
      if (args.destination) patch.destination = args.destination
      if (isDate(args.startDate)) patch.startDate = args.startDate
      if (isDate(args.endDate)) patch.endDate = args.endDate
      Object.assign(patch, fixYear(patch.startDate ?? undefined, patch.endDate ?? undefined, ctx.userText))
      if (args.brief) patch.notes = args.brief
      if (TRAVELERS.includes(args.travelers)) patch.travelers = args.travelers
      if (args.kids) patch.kids = String(args.kids).trim()
      if (PACES.includes(args.pace)) patch.pace = args.pace
      if (Array.isArray(args.interests)) patch.interests = args.interests.map((x: string) => String(x).trim().toLowerCase()).filter(Boolean)
      if (args.arrivalCity) patch.arrivalCity = String(args.arrivalCity).trim()
      if (TIMES_OF_DAY.includes(args.arrivalTime)) patch.arrivalTime = args.arrivalTime
      if (args.departureCity) patch.departureCity = String(args.departureCity).trim()
      if (TIMES_OF_DAY.includes(args.departureTime)) patch.departureTime = args.departureTime
      // "Estamos en Japón" is the destination, not where they are today: the app still asks for the city.
      const dest = (patch.destination ?? ctx.trip.destination ?? '').toLowerCase()
      if (args.currentCity && !dest.startsWith(String(args.currentCity).trim().toLowerCase())) patch.currentCity = String(args.currentCity).trim()
      if (Number.isInteger(args.lengthDays) && args.lengthDays > 0) patch.lengthDays = Math.min(120, args.lengthDays)
      if (args.whenHint) patch.whenHint = String(args.whenHint).trim()
      if (args.noFixedDates === true && !patch.startDate && !ctx.trip.startDate) Object.assign(patch, { freeform: true, datesTentative: true })

      // A day-by-day trip (or one with placeholder dates) keeps its plan when the dates change: it moves along.
      const start = patch.startDate ?? ctx.trip.startDate
      const end = patch.endDate ?? ctx.trip.endDate
      if ((patch.startDate || patch.endDate) && start && end && ctx.trip.startDate && (ctx.trip.freeform || ctx.trip.datesTentative)) {
        const { startDate: _s, endDate: _e, ...rest } = patch
        const moved = setTripDates(tripId, start, end, { datesTentative: false, ...rest })
        ctx.trip = getTrip(tripId) ?? ctx.trip
        return { ok: true, ...moved }
      }
      ctx.trip = updateTrip(tripId, patch) ?? ctx.trip
      ctx.trip = ensureTentativeDates(ctx.trip, isDate(args.approxStartDate) ? args.approxStartDate : null)
      // New dates: keep the route's nights and re-lay it from the new start.
      const stops = listStops(tripId)
      if ((patch.startDate || patch.endDate) && stops.length) {
        const { drafts, warning } = layoutStops(
          ctx.trip,
          stops.map((x) => ({ city: x.city, nights: nightsOf(x) ?? 1, lodging: x.lodging, dayTrips: x.dayTrips })),
        )
        replaceStops(tripId, drafts)
        return { ok: true, warning }
      }
      return { ok: true }
    }
    case 'set_stops': {
      // Don't propose a route blind: the backend enforces the minimum profile (a day-by-day trip doesn't need it).
      const missing = ctx.trip.freeform ? [] : missingForRoute(ctx.trip)
      if (missing.length) {
        return { ok: false, missing, todo: `Antes de proponer la ruta preguntá (natural, de a 1-2): ${missing.join(', ')}.` }
      }
      // A day-by-day trip may cover only part of the trip with stays: the rest stays "Por definir".
      const problems = routeProblems(ctx.trip, args.stops).filter((p) => !(ctx.trip.freeform && p.startsWith('Las noches suman') && p.includes('Sumá')))
      if (problems.length) return { ok: false, problems, todo: 'Corregí la ruta y llamá set_stops de nuevo.' }
      const { drafts, total, tripNights, warning } = layoutStops(ctx.trip, args.stops)
      const stops = replaceStops(tripId, drafts)
      const advice = routeWarnings(ctx.trip, args.stops)
      return {
        ok: true,
        stops: stops.map((x) => `${x.city} ${x.startDate} → ${x.endDate}`),
        total,
        tripNights,
        warnings: [warning, ...advice].filter(Boolean),
      }
    }
    case 'move_nights': {
      const cur = listStops(tripId).map((x) => ({ city: x.city, nights: nightsOf(x) ?? 0, lodging: x.lodging, dayTrips: x.dayTrips }))
      const n = Math.max(1, Math.round(args.nights))
      const fromIdx = cur.findIndex((x) => sameCity(x.city, args.from))
      const toIdx = cur.map((x) => sameCity(x.city, args.to)).lastIndexOf(true)
      if (fromIdx < 0 || toIdx < 0) return { ok: false, error: `No encontré ${fromIdx < 0 ? args.from : args.to} en la ruta` }
      if (cur[fromIdx]!.nights - n < 1) return { ok: false, error: `${cur[fromIdx]!.city} quedaría sin noches: sacala con set_stops si eso quiere el usuario` }
      cur[fromIdx]!.nights -= n
      cur[toIdx]!.nights += n
      const { drafts } = layoutStops(ctx.trip, cur)
      const stops = replaceStops(tripId, drafts)
      return {
        ok: true,
        stops: stops.map((x) => `${x.city} ${nightsOf(x)}n`),
        todo: 'Hecho y aplicado. No llames set_stops. Confirmá en una frase corta y preguntá si arrancamos con el día por día.',
      }
    }
    case 'plan_days': {
      const st = startDayGeneration(tripId, Array.isArray(args.days) ? args.days : [], args.city, args.replace === true, args.note)
      return { ok: true, started: true, days: st.totalDays }
    }
    case 'move_days': {
      const res = moveDays(tripId, (Array.isArray(args.days) ? args.days : []).filter(isDate), String(args.to ?? ''))
      if ('error' in res) return { ok: false, error: res.error }
      return { ok: true, ...res }
    }
    case 'set_stay': {
      const days = (Array.isArray(args.days) ? args.days : []).filter(isDate)
      if (!days.length) return { ok: false, error: 'Sin días válidos (YYYY-MM-DD dentro del viaje)' }
      const stops = setDaysCity(tripId, days, args.city ?? null)
      return { ok: true, stays: stops.map((x) => `${x.city} ${x.startDate} → ${x.endDate} (${nightsOf(x)} noches)`) }
    }
    case 'generate_itinerary': {
      const st = startGeneration(tripId, args.cities)
      return { ok: true, started: true, days: st.totalDays }
    }
    case 'add_pins': {
      const pins = (args.pins as PinDraft[]).map(cleanDraft).map(add)
      ctx.suggestions.push(...pins.map((p) => ({ draft: toDraft(p), pinId: p.id })))
      return { ok: true, added: pins.map((p) => ({ id: p.id, title: p.title, day: p.day })) }
    }
    case 'suggest_pins': {
      const drafts = (args.pins as PinDraft[]).map(cleanDraft)
      ctx.suggestions.push(...drafts.map((draft) => ({ draft, pinId: null })))
      return { ok: true, shown: drafts.length }
    }
    case 'update_pins': {
      const results = (args.updates as { id: string; changes: Record<string, any> }[]).map(({ id, changes }) => {
        const cur = getPin(id)
        if (!cur || cur.tripId !== tripId) return { id, ok: false, error: 'no encontrado' }
        const patch: Partial<PinDraft> = {}
        for (const k of ['type', 'title', 'body', 'city', 'status', 'timeOfDay'] as const) {
          if (changes[k] != null) (patch as any)[k] = changes[k]
        }
        if (changes.day === 'none') patch.day = null
        else if (isDate(changes.day)) patch.day = changes.day
        const next = updatePin(id, cleanDraft({ ...cur, ...patch }))
        ctx.changed.add(id)
        if (cur.day) ctx.touchedDays.add(cur.day)
        if (next?.day) ctx.touchedDays.add(next.day)
        return { id, ok: true }
      })
      return { results }
    }
    case 'remove_pins': {
      for (const id of args.ids as string[]) {
        const p = getPin(id)
        if (p?.tripId === tripId) deletePin(id)
      }
      return { ok: true }
    }
    default:
      return { ok: false, error: `tool desconocida ${name}` }
  }
}

// Parsing is extraction, not thinking: keep it cheap and fast, and get the reply as data.
const PARSE_PARAMS = {
  reasoning: { effort: /^gpt-5(-mini|-nano)?$/.test(config.openaiModel) ? 'minimal' : 'none' },
  text: {
    format: {
      type: 'json_schema',
      name: 'reaction',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['reaction', 'reply'],
        properties: { reaction: { type: 'string' }, reply: { type: ['string', 'null'] } },
      },
    },
  },
} as const

// Designing the route is the one step that needs real thought (geography, balance); it's a single call.
const ROUTE_PARAMS = { reasoning: { effort: 'medium' } } as const

/**
 * Models tend to push year-less dates to next year even when the trip is happening now.
 * If the user didn't write a year and this year's version of the dates hasn't ended yet, use it.
 */
function fixYear(start: string | undefined, end: string | undefined, userText: string) {
  if (!start || !end || /\b20\d\d\b/.test(userText)) return {}
  const thisYear = Number(today().slice(0, 4))
  const shift = Number(start.slice(0, 4)) - thisYear
  if (shift <= 0) return {}
  const back = (d: string) => `${Number(d.slice(0, 4)) - shift}${d.slice(4)}`
  return back(end) >= today() ? { startDate: back(start), endDate: back(end) } : {}
}

/** Keep the model's reaction only if it's short and doesn't narrate bookkeeping. */
const NARRATION = /guard|anot|registr|fij[eéa]|actualic|puse|tom[eé] nota|dato|resumen|lo tengo|ya tengo|tengo (las|el|la|los)/i

function parseReaction(raw: string, userText: string): string {
  try {
    const { reaction, reply } = JSON.parse(raw) as { reaction: string; reply: string | null }
    const r = reaction?.trim() ?? ''
    const ok = r && r.length <= 90 && !NARRATION.test(r)
    // A reply only makes sense if the user actually asked something; otherwise it's the model chatting.
    const answer = userText.includes('?') && reply && !NARRATION.test(reply) ? reply.trim() : ''
    return [ok ? r : '', answer].filter(Boolean).join('\n\n')
  } catch {
    return ''
  }
}

export interface ChatOptions {
  /** Structured answer from a quick-reply button, applied before anything else. */
  patch?: Partial<Trip>
  /** The text is exactly a button label: nothing for the model to interpret. */
  structured?: boolean
  /** What the user is looking at ("el Día 3 [2026-11-08]"): told to the model, not shown in the chat. */
  context?: string
}

const TOOLS_BY_MODE: Record<Mode, string[] | null> = {
  parse: ['update_trip'],
  route: ['web_search', 'update_trip', 'set_stops', 'move_nights', 'generate_itinerary'],
  planned: null, // all
}
// A day-by-day trip has no whole-route tools: stays are set by days (set_stay) and only the asked days get built.
const WHOLE_ROUTE = ['set_stops', 'move_nights', 'generate_itinerary']
const toolsFor = (mode: Mode, trip: Trip) =>
  (TOOLS_BY_MODE[mode] ? tools.filter((t) => TOOLS_BY_MODE[mode]!.includes(t.type === 'function' ? t.name : t.type)) : tools).filter(
    (t) => !(trip.freeform && t.type === 'function' && WHOLE_ROUTE.includes(t.name)),
  )

export async function chat(tripId: string, text: string, opts: ChatOptions = {}): Promise<ChatResult> {
  let trip = getTrip(tripId)
  if (!trip) throw new HttpError(404, 'Trip no encontrado')
  const wasFreeform = trip.freeform
  if (opts.patch && Object.keys(opts.patch).length) trip = ensureTentativeDates(updateTrip(tripId, opts.patch) ?? trip, null)

  const history = listMessages(tripId, HISTORY_LIMIT)
  const userInput = { role: 'user', content: opts.context ? `(El usuario está viendo ${opts.context}.)\n${text}` : text } as const
  const ctx: ToolCtx = { userText: text, trip, suggestions: [], changed: new Set(), touchedDays: new Set() }

  const call = async (mode: Mode, params: Partial<OpenAI.Responses.ResponseCreateParamsNonStreaming>) => {
    const t0 = Date.now()
    const resp = await openai().responses.create({
      model: config.openaiModel,
      // Rebuilt each call so follow-ups see the effect of previous tools.
      instructions: buildInstructions(ctx.trip, mode),
      tools: toolsFor(mode, ctx.trip),
      reasoning: REASONING,
      ...params,
    } as OpenAI.Responses.ResponseCreateParamsNonStreaming)
    const u = resp.usage
    const did = resp.output.map((o) => (o.type === 'function_call' ? o.name : o.type)).join(',')
    console.log(
      `[llm:${mode}] ${((Date.now() - t0) / 1000).toFixed(1)}s in=${u?.input_tokens} cached=${u?.input_tokens_details?.cached_tokens ?? 0} out=${u?.output_tokens} (reasoning=${u?.output_tokens_details?.reasoning_tokens}) → ${did}`,
    )
    return resp
  }

  /** Run one model turn, executing tool calls until it answers in text. */
  async function turn(mode: Mode, input: Input): Promise<string> {
    let resp = await call(mode, { input, ...(mode === 'parse' ? PARSE_PARAMS : mode === 'route' ? ROUTE_PARAMS : {}) })
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = resp.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call')
      if (!calls.length) break
      const outputs: Input = calls.map((c) => {
        let result: unknown
        try {
          console.log(`[tool] ${c.name} ${c.arguments.slice(0, 400)}`)
          result = runTool(c.name, JSON.parse(c.arguments), ctx)
        } catch (err) {
          result = { ok: false, error: String(err) }
        }
        return { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result) } as const
      })
      resp = await call(mode, {
        previous_response_id: resp.id,
        input: outputs,
        ...(mode === 'parse' ? PARSE_PARAMS : mode === 'route' ? ROUTE_PARAMS : {}),
      })
    }
    const out = resp.output_text?.trim() ?? ''
    return mode === 'parse' ? parseReaction(out, text) : out
  }

  const historyInput = history.map((m) => ({ role: m.role, content: m.content }) as const)
  let content: string
  const mode = modeFor(tripId)

  if (opts.structured && !wasFreeform && ctx.trip.freeform) {
    // A quick reply just switched to day by day: say so (or ask what's still needed), no model call.
    const q = nextQuestion(ctx.trip)
    content = q ? q.text : freeformReady(ctx.trip)
  } else if (mode === 'parse') {
    // Onboarding: the model only interprets free text; the script asks the questions.
    const reaction = opts.structured ? '' : await turn('parse', [...historyInput, userInput])
    const q = nextQuestion(ctx.trip)
    if (q) {
      // Same question as last time: the answer didn't land, so ask it more concretely instead of looping.
      const last = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? ''
      const qText = last.trim().endsWith(q.text) && q.retryText ? q.retryText : q.text
      content = [reaction, qText].filter(Boolean).join('\n\n')
    } else if (ctx.trip.freeform) {
      // Day by day: no route proposal, straight to the (empty) itinerary.
      content = [reaction, freeformReady(ctx.trip)].filter(Boolean).join('\n\n')
    } else {
      // Everything we need: propose the route right away.
      content = await turn('route', [
        ...historyInput,
        userInput,
        { role: 'developer', content: 'Ya están todos los datos: proponé la ruta ahora.' },
      ])
    }
  } else {
    content = await turn(mode, [...historyInput, userInput])
  }

  for (const day of ctx.touchedDays) sortDay(tripId, day)

  // Persist the turn only once the LLM round-trip succeeded.
  const userMessage = createMessage(tripId, 'user', text)
  const assistantMessage = createMessage(tripId, 'assistant', content || 'Listo.', ctx.suggestions)
  return { userMessage, assistantMessage, changedPinIds: [...ctx.changed] }
}

const isoIn = todayPlus

/** Placeholder dates for a trip without tickets: from the month they named (or a month from now), as long as they said. */
function ensureTentativeDates(trip: Trip, approxStart: string | null): Trip {
  if (!trip.datesTentative || trip.startDate || !trip.lengthDays) return trip
  const start = approxStart && approxStart > isoIn(0) ? approxStart : isoIn(30)
  const end = addDays(start, trip.lengthDays - 1)
  return updateTrip(trip.id, { startDate: start, endDate: end }) ?? trip
}

function freeformReady(trip: Trip): string {
  const n = tripDays(trip).length
  const when = trip.datesTentative ? `${n} días, con fechas a confirmar` : `${n} días`
  return `Listo, tu viaje quedó en blanco (${when}). Lo vamos armando de a poco: entrá a un día y tocá **Armar este día**, cargá tus reservas, o pedime ideas y una ruta cuando quieras.${trip.datesTentative ? ' Cuando tengas los pasajes, poné las fechas y todo se acomoda solo.' : ''}`
}

export { nextQuestion }
export type { QuestionOption }

/** Distill an arbitrary text (typically an assistant message) into pin drafts. */
export async function extractPins(trip: Trip, text: string): Promise<PinDraft[]> {
  const resp = await openai().responses.create({
    model: config.openaiModel,
    instructions: `Del texto que te paso, extraé los ítems concretos que valga la pena guardar en el viaje (lugares, comidas, actividades, recorridos, tips clave). Si es más bien una explicación, devolvé un único ítem "summary" autocontenido. Máx. 8. day y timeOfDay en null salvo que el texto los asigne claramente.

${buildContext(trip)}`,
    input: text,
    text: { format: { type: 'json_schema', name: 'pins', strict: true, schema: pinsArg } },
  })
  const parsed = JSON.parse(resp.output_text) as { pins: PinDraft[] }
  return parsed.pins.map(cleanDraft)
}

// ---- sanitizers

export { HttpError }

const toDraft = (p: Pin): PinDraft => ({
  type: p.type,
  title: p.title,
  body: p.body,
  city: p.city,
  tags: p.tags,
  url: p.url,
  status: p.status,
  day: p.day,
  timeOfDay: p.timeOfDay,
})

export function cleanDraft(d: Partial<PinDraft>): PinDraft {
  const day = isDate(d.day) ? d.day : null
  return {
    type: PIN_TYPES.includes(d.type as never) ? d.type! : 'idea',
    title: String(d.title ?? '').trim() || 'Sin título',
    body: String(d.body ?? '').trim(),
    city: d.city?.trim() || null,
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6) : [],
    url: d.url?.trim() || null,
    status: PIN_STATUSES.includes(d.status as never) ? d.status! : 'idea',
    day,
    timeOfDay: day && TIMES_OF_DAY.includes(d.timeOfDay as never) ? d.timeOfDay! : null,
  }
}
