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

const instructions = (trip: Trip) => `Extraé las reservas de este mail de confirmación (vuelos, trenes, buses u hoteles).

Reglas:
- Un elemento por tramo: cada vuelo de una conexión va por separado; la ida y la vuelta también. Un hotel es un solo elemento.
- Fechas en YYYY-MM-DD y horas en HH:MM (24 h), en hora LOCAL tal como figuran en el mail. Si falta el año, usá el del viaje (${trip.startDate ?? 'desconocido'} → ${trip.endDate ?? 'desconocido'}).
- Transporte (flight/train/bus): origin y destination como "Ciudad Aeropuerto/Estación (CÓDIGO)" cuando el mail los da, p. ej. "Tokio Haneda (HND)", "Kioto". arriveDate solo si llega otro día. carrier = aerolínea u operador; number = nº de vuelo o tren ("EK 318", "Nozomi 21"); seat = asiento(s) ("32A", "coche 7, 7A 7B").
- Hotel: hotelName, address, checkInDate, checkOutDate, y horas solo si el mail las dice.
- reference: el código de reserva / localizador.
- notes: solo datos útiles que no tengan campo (terminal, clase, tipo de habitación, desayuno), máx. 120 caracteres; si no hay, null.
- No inventes nada: lo que no está en el mail va en null. Los campos que no corresponden al tipo, en null.
- Si el texto no contiene reservas, devolvé una lista vacía.`

export async function parseBookings(trip: Trip, rawText: string): Promise<{ bookings: BookingInput[]; skipped: number }> {
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
  for (const b of raw) {
    try {
      bookings.push(cleanBooking(b))
    } catch {
      // skipped
    }
  }
  console.log(`[llm:bookings] ${text.length} chars → ${bookings.length} ok, ${raw.length - bookings.length} skipped`)
  return { bookings, skipped: raw.length - bookings.length }
}
