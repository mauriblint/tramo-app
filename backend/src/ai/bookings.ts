import { config } from '../config.js'
import { BOOKING_KINDS, cleanBooking, type BookingInput } from '../bookings.js'
import type { Trip } from '../db.js'
import { HttpError, openai } from './client.js'

/**
 * "Pegá tu confirmación": read a confirmation email (airline, rail, Booking, Airbnb…) and turn it into
 * bookings for the user to review. Extraction only — nothing is saved here.
 */

const MAX_CHARS = 20_000
const str = { type: ['string', 'null'] } as const

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
    : `Si falta el año, usá el de la próxima vez que caiga esa fecha (hoy es ${new Date().toISOString().slice(0, 10)}).`

const instructions = (trip: DatesHint) => `Extraé las reservas de este mail de confirmación (vuelos, trenes, buses u hoteles).

Reglas:
- Un elemento por tramo: cada vuelo de una conexión va por separado; la ida y la vuelta también. Un hotel es un solo elemento.
- Fechas en YYYY-MM-DD y horas en HH:MM (24 h), en hora LOCAL tal como figuran en el mail. ${yearHint(trip)}
- Transporte (flight/train/bus): origin y destination como "Ciudad Aeropuerto/Estación (CÓDIGO)" cuando el mail los da, p. ej. "Tokio Haneda (HND)", "Kioto". arriveDate solo si llega otro día. carrier = aerolínea u operador; number = nº de vuelo o tren ("EK 318", "Nozomi 21"); seat = asiento(s) ("32A", "coche 7, 7A 7B").
- Hotel: hotelName, address, checkInDate, checkOutDate, y horas solo si el mail las dice.
- reference: el código de reserva / localizador.
- notes: solo datos útiles que no tengan campo (terminal, clase, tipo de habitación, desayuno), máx. 120 caracteres; si no hay, null.
- No inventes nada: lo que no está en el mail va en null. Los campos que no corresponden al tipo, en null.
- Si el texto no contiene reservas, devolvé una lista vacía.`

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

  // Same validation as manual entry: whatever doesn't pass (e.g. a flight without date) is left out.
  const bookings: BookingInput[] = []
  const problems: string[] = []
  for (const b of raw) {
    try {
      bookings.push(cleanBooking(b))
    } catch (e) {
      problems.push((e as Error).message)
      console.log('[llm:bookings] skipped:', (e as Error).message, JSON.stringify(b))
    }
  }
  console.log(`[llm:bookings] ${text.length} chars → ${bookings.length} ok, ${problems.length} skipped`)
  return { bookings, skipped: problems.length, problems: [...new Set(problems)] }
}
