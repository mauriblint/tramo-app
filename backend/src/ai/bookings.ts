import { config } from '../config.js'
import { today } from '../today.js'
import { BOOKING_KINDS, cleanBooking, type BookingInput } from '../bookings.js'
import type { Trip } from '../db.js'
import { HttpError, openai } from './client.js'

/**
 * "Pegá tu confirmación": read a confirmation email (airline, rail, Booking, Airbnb…) and turn it into
 * bookings for the user to review. Extraction only — nothing is saved here.
 */

const MAX_CHARS = 20_000
const str = { type: ['string', 'null'] } as const

const LEG_KEYS = ['origin', 'destination', 'departDate', 'departTime', 'arriveDate', 'arriveTime', 'carrier', 'number', 'seat'] as const
const legSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...LEG_KEYS],
  properties: Object.fromEntries(LEG_KEYS.map((k) => [k, str])),
} as const

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['bookings'],
  properties: {
    bookings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'kind',
          'origin',
          'destination',
          'departDate',
          'departTime',
          'arriveDate',
          'arriveTime',
          'carrier',
          'number',
          'seat',
          'hotelName',
          'address',
          'checkInDate',
          'checkInTime',
          'checkOutDate',
          'checkOutTime',
          'reference',
          'notes',
          'legs',
        ],
        properties: {
          kind: { type: 'string', enum: [...BOOKING_KINDS] },
          origin: str,
          destination: str,
          departDate: str,
          departTime: str,
          arriveDate: str,
          arriveTime: str,
          carrier: str,
          number: str,
          seat: str,
          hotelName: str,
          address: str,
          checkInDate: str,
          checkInTime: str,
          checkOutDate: str,
          checkOutTime: str,
          reference: str,
          notes: str,
          legs: { type: 'array', items: legSchema },
        },
      },
    },
  },
} as const

/** The trip's dates, when we know which trip it is, help fill a missing year. */
type DatesHint = Pick<Trip, 'startDate' | 'endDate'> | null

const yearHint = (trip: DatesHint) =>
  trip?.startDate
    ? `Si falta el año, usá el del viaje (${trip.startDate} → ${trip.endDate ?? 'desconocido'}).`
    : `Si falta el año, usá el de la próxima vez que caiga esa fecha (hoy es ${today()}).`

const instructions = (trip: DatesHint) => `Extraé las reservas de este mail de confirmación (vuelos, trenes, buses u hoteles).

Reglas:
- Un elemento por viaje de punta a punta, como se compró: una escala o un cambio de tren/bus dentro del mismo pasaje es UN solo elemento, con origin = primer origen, destination = destino final, la salida del primer tramo y la llegada del último. Cada tramo va en legs, en orden, con sus propios datos (número, horarios, asiento). Si es directo, legs = [].
- La ida y la vuelta son elementos separados, igual que reservas distintas en el mismo mail. Un hotel es un solo elemento (legs = []).
- Fechas en YYYY-MM-DD y horas en HH:MM (24 h), en hora LOCAL tal como figuran en el mail. ${yearHint(trip)}
- Transporte (flight/train/bus): origin y destination como "Ciudad Aeropuerto/Estación (CÓDIGO)" cuando el mail los da, p. ej. "Tokio Haneda (HND)", "Kioto". arriveDate solo si llega otro día. carrier = aerolínea u operador; number = nº de vuelo o tren ("EK 318", "Nozomi 21"); seat = asiento(s) ("32A", "coche 7, 7A 7B").
- Hotel: hotelName, address, checkInDate, checkOutDate, y horas solo si el mail las dice.
- reference: el código de reserva / localizador.
- notes: solo datos útiles que no tengan campo (terminal, clase, tipo de habitación, desayuno), máx. 120 caracteres; si no hay, null.
- No inventes nada: lo que no está en el mail va en null. Los campos que no corresponden al tipo, en null.
- Si el texto no contiene reservas, devolvé una lista vacía.`

/** A journey with connections: its ends and times come from the first and last leg; number and seat live in each leg. */
function spanLegs(b: Record<string, any>) {
  const legs = Array.isArray(b.legs) ? b.legs : []
  if (b.kind === 'hotel' || legs.length < 2) return { ...b, legs: [] }
  const first = legs[0]
  const last = legs[legs.length - 1]
  const departDate = first.departDate ?? b.departDate
  const arriveDate = last.arriveDate ?? last.departDate ?? null
  const uniq = (k: string) => [...new Set(legs.map((l: any) => l[k]).filter(Boolean))]
  return {
    ...b,
    origin: first.origin,
    destination: last.destination,
    departDate,
    departTime: first.departTime,
    arriveDate: arriveDate && arriveDate !== departDate ? arriveDate : null,
    arriveTime: last.arriveTime,
    number: uniq('number').join(' · ') || b.number,
    carrier: uniq('carrier').join(' / ') || b.carrier,
    seat: null,
    legs: legs.map((l: any) => ({ ...l, departDate: l.departDate ?? departDate })),
  }
}

export async function parseBookings(trip: DatesHint, rawText: string): Promise<{ bookings: BookingInput[]; skipped: number; problems: string[] }> {
  const text = rawText.trim().slice(0, MAX_CHARS)
  if (text.length < 20) throw new HttpError(400, 'Pegá el texto del mail de confirmación')

  const resp = await openai().responses.create({
    model: config.openaiModel,
    reasoning: { effort: /^gpt-5(-mini|-nano)?$/.test(config.openaiModel) ? 'minimal' : 'none' },
    instructions: instructions(trip),
    input: text,
    text: { format: { type: 'json_schema', name: 'bookings', strict: true, schema } },
  })
  const raw = (JSON.parse(resp.output_text) as { bookings: unknown[] }).bookings

  // Same validation as manual entry (after making the journey span its legs exactly): whatever doesn't pass (e.g. a flight without date) is left out.
  const bookings: BookingInput[] = []
  const problems: string[] = []
  for (const b of raw) {
    try {
      bookings.push(cleanBooking(spanLegs(b as Record<string, any>)))
    } catch (e) {
      problems.push((e as Error).message)
      console.log('[llm:bookings] skipped:', (e as Error).message, JSON.stringify(b))
    }
  }
  console.log(`[llm:bookings] ${text.length} chars → ${bookings.length} ok, ${problems.length} skipped`)
  return { bookings, skipped: problems.length, problems: [...new Set(problems)] }
}
