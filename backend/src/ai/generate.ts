import { config } from '../config.js'
import {
  PIN_TYPES,
  TIMES_OF_DAY,
  createMessage,
  createPin,
  deletePin,
  getTrip,
  listPins,
  listStops,
  isOngoing,
  setDayCity,
  stopOfDay,
  type Stop,
  type Trip,
} from '../db.js'
import { HttpError, REASONING, daysBetween, openai } from './client.js'

/**
 * Itinerary generation: one streamed LLM call per stop, all in parallel. Each day is saved
 * as soon as its JSON object is complete, so the UI (polling) sees days appear one by one.
 */

interface Job {
  /** The days being written, so the UI can show them as pending (and only them). */
  days: string[]
  totalDays: number
  doneDays: Set<string>
  pendingCities: Set<string>
  failedCities: string[]
}

const jobs = new Map<string, Job>()

export interface GenerationStatus {
  running: boolean
  days: string[]
  totalDays: number
  doneDays: string[]
  pendingCities: string[]
  failedCities: string[]
}

export function generationStatus(tripId: string): GenerationStatus | null {
  const j = jobs.get(tripId)
  if (!j) return null
  return {
    running: j.pendingCities.size > 0,
    days: j.days,
    totalDays: j.totalDays,
    doneDays: [...j.doneDays],
    pendingCities: listStops(tripId)
      .filter((s) => j.pendingCities.has(s.id))
      .map((s) => s.city),
    failedCities: j.failedCities,
  }
}

export const isGenerating = (tripId: string) => (jobs.get(tripId)?.pendingCities.size ?? 0) > 0

/** Days that belong to a stop: arrival day up to the day before leaving; the trip's last day goes to the stop that reaches it. */
export function stopDays(trip: Trip, stops: Stop[], stop: Stop): string[] {
  const days = daysBetween(stop.startDate, stop.endDate)
  const own = stop.endDate === trip.endDate ? days : days.slice(0, -1)
  const inTrip = new Set(daysBetween(trip.startDate, trip.endDate))
  return own.filter((d) => inTrip.has(d))
}

const daySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['days'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'items'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['timeOfDay', 'type', 'title', 'note'],
              properties: {
                timeOfDay: { type: 'string', enum: [...TIMES_OF_DAY] },
                type: { type: 'string', enum: [...PIN_TYPES] },
                title: { type: 'string' },
                note: { type: 'string', description: '1-2 frases útiles: qué es, tip, horario o cómo llegar' },
              },
            },
          },
        },
      },
    },
  },
} as const

type GenItem = { timeOfDay: (typeof TIMES_OF_DAY)[number]; type: (typeof PIN_TYPES)[number]; title: string; note: string }
type GenDay = { date: string; items: GenItem[] }

/**
 * Incremental parser: given the growing JSON text `{"days":[{...},{...}`, returns each day object
 * once its closing brace arrives. Keeps its scan position between calls.
 */
function dayStreamParser(onDay: (d: GenDay) => void) {
  let buf = ''
  let pos = 0
  let arrayStart = -1
  let depth = 0
  let inString = false
  let escaped = false
  let objStart = -1

  return (chunk: string) => {
    buf += chunk
    if (arrayStart < 0) {
      const m = /"days"\s*:\s*\[/.exec(buf)
      if (!m) return
      arrayStart = m.index + m[0].length
      pos = arrayStart
    }
    for (; pos < buf.length; pos++) {
      const c = buf[pos]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{') {
        if (depth === 0) objStart = pos
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0 && objStart >= 0) {
          try {
            onDay(JSON.parse(buf.slice(objStart, pos + 1)))
          } catch {
            // Malformed fragment: skip it, the rest of the stream can still be used.
          }
          objStart = -1
        }
      }
    }
  }
}

function stopPrompt(trip: Trip, stops: Stop[], i: number, days: string[], note?: string | null): string {
  const stop = stops[i]!
  const prev = stops[i - 1]
  const next = stops[i + 1]
  const otherTrips = stops.filter((s) => s.id !== stop.id).flatMap((s) => [s.city, ...s.dayTrips])
  // Only a part of the stop may be planned now (a day-by-day trip): arrival/departure apply when those days are included.
  const own = stopDays(trip, stops, stop)
  const isFirst = i === 0 && days[0] === own[0]
  const arrives = days[0] === own[0]
  const isLast = stop.endDate === trip.endDate && days.at(-1) === own.at(-1)
  const leaves = days.at(-1) === own.at(-1)
  // In a day-by-day trip the stops may have gaps: only talk about the transfer when they're back to back.
  const fromPrev = prev && prev.endDate === stop.startDate ? prev : null
  const toNext = next && next.startDate === stop.endDate ? next : null
  const city = stop.city.toLowerCase()
  const all = listPins(trip.id).filter((p) => p.status !== 'discarded')
  const pins = all.filter((p) => p.city?.toLowerCase().includes(city))
  const onDays = all.filter((p) => p.day && days.includes(p.day))
  const keep = [...onDays, ...pins.filter((p) => p.day && !days.includes(p.day) && p.status !== 'idea')]
  const wanted = pins.filter((p) => !p.day && (p.status === 'want' || p.status === 'must'))
  const ideas = pins.filter((p) => !p.day && p.status === 'idea')

  return `Armá el itinerario día por día de UNA parada de un viaje.

Viaje: ${trip.name} — ${trip.destination ?? ''}
Viajan: ${trip.travelers ?? '?'}${trip.kids && trip.kids !== 'no' ? ` con chicos (${trip.kids})` : ''} · Ritmo: ${trip.pace ?? 'intermedio'} · Intereses: ${trip.interests.join(', ') || 'variados'}
Ficha del viajero:
${trip.notes ?? '(sin ficha)'}

Ruta completa: ${stops.map((s) => s.city).join(' → ')}
Esta parada: ${stop.city}${stop.lodging ? ` (alojamiento: ${stop.lodging})` : ''}
${stop.dayTrips.length ? `Excursiones de día desde esta base (incluilas, un día cada una): ${stop.dayTrips.join(', ')}` : 'Sin excursiones de día asignadas: quedate en la ciudad.'}
${otherTrips.length ? `NO hagas excursiones a: ${otherTrips.join(', ')} (las cubre otra parada).` : ''}
Días a planificar (exactamente estos, en orden): ${days.join(', ')}
${isFirst && isOngoing(trip) ? '- El viaje ya está en curso: el primer día es HOY y ya están en esta ciudad (no hay llegada ni traslado).' : isFirst ? '- El primer día es la LLEGADA del viaje (ver vuelos en la ficha): algo liviano.' : arrives && fromPrev ? `- El primer día llegan desde ${fromPrev.city}: incluí el traslado (type "route") a la mañana y algo liviano.` : ''}
${isLast ? '- El último día es la SALIDA del viaje (ver vuelos en la ficha): planificá según la hora del vuelo, incluí el traslado al aeropuerto.' : leaves && toNext ? `- Al día siguiente del último se van a ${toNext.city} (eso lo planifica otra parada).` : ''}
${trip.datesTentative ? '- Las fechas son provisorias (todavía no hay pasajes): no asumas día de la semana, feriados ni eventos puntuales.' : ''}
${keep.length ? `Ya está en el plan (no lo repitas; contalo dentro de los ítems del día y planificá alrededor):\n${keep.map((p) => `- ${p.day} ${p.timeOfDay ?? ''}: ${p.title}`).join('\n')}` : ''}
${wanted.length ? `El usuario QUIERE hacer esto acá, incluilo:\n${wanted.map((p) => `- ${p.title}`).join('\n')}` : ''}
${ideas.length ? `Ideas guardadas por el usuario (usalas si encajan):\n${ideas.map((p) => `- ${p.title}`).join('\n')}` : ''}
${note?.trim() ? `Lo que el usuario pidió para estos días (respetalo por sobre todo lo demás): ${note.trim()}` : ''}

Reglas:
- Ítems por día según el ritmo, contando lo que ya está en el plan: tranqui 2, intermedio 3, intenso 3-4. Con chicos: actividades aptas para su edad, pausas y nada de jornadas eternas; agrupá por cercanía geográfica; no repitas lugares entre días.
- Cada ítem es un lugar/actividad/comida real y concreto con nombre propio (nunca "X o Y" ni "a elección").
- Escribí en el idioma de la ficha. note: 1-2 frases útiles.`
}

async function generateStop(trip: Trip, stops: Stop[], i: number, days: string[], job: Job, note?: string | null) {
  const stop = stops[i]!
  const allowed = new Set(days)
  const t0 = Date.now()

  const stream = await openai().responses.create({
    model: config.openaiGenModel,
    reasoning: REASONING,
    instructions: stopPrompt(trip, stops, i, days, note),
    input: `Generá los días ${days[0]} a ${days.at(-1)} en ${stop.city}.`,
    text: { format: { type: 'json_schema', name: 'stop_days', strict: true, schema: daySchema } },
    stream: true,
  })

  const feed = dayStreamParser((d) => {
    if (!allowed.has(d.date) || job.doneDays.has(d.date)) return
    for (const it of d.items) {
      createPin(trip.id, {
        type: it.type,
        title: it.title.trim(),
        body: it.note.trim(),
        city: stop.city,
        tags: [],
        url: null,
        status: 'idea',
        day: d.date,
        timeOfDay: it.timeOfDay,
      })
    }
    job.doneDays.add(d.date)
  })

  let usage = ''
  for await (const ev of stream) {
    if (ev.type === 'response.output_text.delta') feed(ev.delta)
    if (ev.type === 'response.completed') {
      const u = ev.response.usage
      usage = ` in=${u?.input_tokens} cached=${u?.input_tokens_details?.cached_tokens ?? 0} out=${u?.output_tokens}`
    }
  }
  console.log(`[gen] ${stop.city}: ${days.length} días en ${((Date.now() - t0) / 1000).toFixed(1)}s${usage}`)
}

/**
 * Start (re)generating the itinerary for all stops, or only for the given cities.
 * Returns immediately; progress is exposed via generationStatus().
 */
export function startGeneration(tripId: string, cities?: string[] | null): GenerationStatus {
  if (isGenerating(tripId)) throw new HttpError(409, 'Ya se está generando el itinerario')
  const trip = getTrip(tripId)
  if (!trip) throw new HttpError(404, 'Trip no encontrado')
  const stops = listStops(tripId)
  if (!stops.length) throw new HttpError(400, 'Primero definí la ruta (paradas y noches)')
  if (!trip.startDate || !trip.endDate) throw new HttpError(400, 'Faltan las fechas del viaje')

  const wanted = cities?.length ? new Set(cities.map((c) => c.toLowerCase())) : null
  const targets = stops
    .map((s, i) => ({ s, i, days: stopDays(trip, stops, s) }))
    .filter(({ s, days }) => days.length && (!wanted || wanted.has(s.city.toLowerCase())))
  if (!targets.length) throw new HttpError(400, 'No hay días para generar en esas paradas')

  // Replace what the generator owns (status "idea"); keep anything the user marked.
  const regenDays = new Set(targets.flatMap((t) => t.days))
  for (const p of listPins(tripId)) {
    if (p.day && regenDays.has(p.day) && p.status === 'idea') deletePin(p.id)
  }

  const job: Job = {
    days: [...regenDays].sort(),
    totalDays: regenDays.size,
    doneDays: new Set(),
    pendingCities: new Set(targets.map((t) => t.s.id)),
    failedCities: [],
  }
  jobs.set(tripId, job)

  for (const { s, i, days } of targets) {
    generateStop(trip, stops, i, days, job)
      .catch((err) => {
        console.error(`[gen] ${s.city} falló`, err)
        job.failedCities.push(s.city)
      })
      .finally(() => {
        job.pendingCities.delete(s.id)
        if (job.pendingCities.size === 0) finish(tripId, job, targets.length === stops.length)
      })
  }
  return generationStatus(tripId)!
}

/**
 * "Armar este día" / "armame del 3 al 5": generate only these days, around whatever they already have.
 * With `replace`, the generated items of those days ("idea") are redone; what the user marked stays.
 * A day without a stop needs `city`, which becomes (or extends) its stop.
 */
export function startDayGeneration(tripId: string, days: string[], city?: string | null, replace = false, note?: string | null): GenerationStatus {
  if (isGenerating(tripId)) throw new HttpError(409, 'Ya se está armando el itinerario')
  let trip = getTrip(tripId)
  if (!trip) throw new HttpError(404, 'Trip no encontrado')
  const inTrip = new Set(daysBetween(trip.startDate, trip.endDate))
  const wanted = [...new Set(days)].filter((d) => inTrip.has(d)).sort()
  if (!wanted.length) throw new HttpError(400, 'Esos días no están en el viaje')

  for (const d of wanted) {
    if (stopOfDay(trip, listStops(tripId), d)) continue
    if (!city?.trim()) throw new HttpError(400, '¿En qué ciudad vas a estar ese día?')
    setDayCity(tripId, d, city)
  }
  trip = getTrip(tripId)!
  const stops = listStops(tripId)
  if (replace) for (const p of listPins(tripId)) if (p.day && wanted.includes(p.day) && p.status === 'idea') deletePin(p.id)
  const groups = new Map<string, { i: number; days: string[] }>()
  for (const d of wanted) {
    const s = stopOfDay(trip, stops, d)!
    const g = groups.get(s.id) ?? { i: stops.indexOf(s), days: [] }
    g.days.push(d)
    groups.set(s.id, g)
  }

  const job: Job = { days: wanted, totalDays: wanted.length, doneDays: new Set(), pendingCities: new Set(groups.keys()), failedCities: [] }
  jobs.set(tripId, job)
  for (const [id, { i, days: ds }] of groups) {
    generateStop(trip, stops, i, ds, job, note)
      .catch((err) => {
        console.error(`[gen] ${stops[i]!.city} (días) falló`, err)
        job.failedCities.push(stops[i]!.city)
      })
      .finally(() => {
        job.pendingCities.delete(id)
        if (job.pendingCities.size === 0) finish(tripId, job, false)
      })
  }
  return generationStatus(tripId)!
}

function finish(tripId: string, job: Job, full: boolean) {
  const n = job.doneDays.size
  const failed = job.failedCities.length ? `\n\n⚠️ No pude generar: ${job.failedCities.join(', ')}. Pedime "rehacé ${job.failedCities[0]}" para reintentar.` : ''
  // Partial regenerations come from the chat, which already answered; only speak up on failure.
  if (!full && !failed) return
  const text = full
    ? `Listo ✨ Armé los ${n} días del viaje. Revisalo y pedime lo que quieras cambiar: mover cosas de día, sumar un restaurante, sacar algo, o "rehacé los días de Kioto".${failed}`
    : `Listo, regeneré ${n} días.${failed}`
  createMessage(tripId, 'assistant', text)
}
