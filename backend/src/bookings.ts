import { randomUUID } from 'node:crypto'

import { HttpError } from './ai/client.js'
import { daysBetweenDates, db, getTrip, listStops, setDaysCity, shiftDate, stopOfDay } from './db.js'

/**
 * What the traveler booked (flights, trains, buses, hotels): facts they load themselves, shown in the
 * itinerary. One table for every kind; each kind uses its own group of columns and leaves the rest empty.
 * The AI doesn't read these (yet).
 */

export const BOOKING_KINDS = ['flight', 'train', 'bus', 'hotel'] as const
export type BookingKind = (typeof BOOKING_KINDS)[number]
export const isTransport = (k: BookingKind) => k !== 'hotel'

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,

    -- Transport (flight, train, bus)
    origin TEXT,            -- "Haneda", "Estación Tokio"
    destination TEXT,
    depart_date TEXT,       -- YYYY-MM-DD
    depart_time TEXT,       -- HH:MM, local time where it leaves; empty = no fixed time (e.g. a rail pass)
    arrive_date TEXT,       -- only when it differs from depart_date (overnight)
    arrive_time TEXT,
    carrier TEXT,           -- airline / operator ("Emirates", "JR")
    number TEXT,            -- flight or train number ("EK 318", "Nozomi 21")
    seat TEXT,              -- "7A" · "coche 7, 7A 7B"

    -- Hotel
    hotel_name TEXT,
    address TEXT,
    city TEXT,              -- where the hotel is ("Kioto"): sets where you sleep on nights that don't have a place yet
    check_in_date TEXT,
    check_in_time TEXT,     -- empty = the usual "from 15:00"
    check_out_date TEXT,
    check_out_time TEXT,    -- empty = the usual "until 11:00"

    -- Any kind
    reference TEXT,         -- booking / confirmation code
    notes TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bookings_trip ON bookings(trip_id);
`)
const bookingCols = new Set((db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[]).map((c) => c.name))
// Connections bought as one ticket (a layover, a train change): the booking is the whole journey, each leg in here.
if (!bookingCols.has('legs')) db.exec(`ALTER TABLE bookings ADD COLUMN legs TEXT NOT NULL DEFAULT '[]'`)
if (!bookingCols.has('city')) db.exec('ALTER TABLE bookings ADD COLUMN city TEXT')

const FIELDS = [
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
  'city',
  'checkInDate',
  'checkInTime',
  'checkOutDate',
  'checkOutTime',
  'reference',
  'notes',
] as const
type Field = (typeof FIELDS)[number]

const LEG_FIELDS = ['origin', 'destination', 'departDate', 'departTime', 'arriveDate', 'arriveTime', 'carrier', 'number', 'seat'] as const
/** One leg of a journey with connections; the booking's own origin…arriveTime span the whole journey. */
export type Leg = { [K in (typeof LEG_FIELDS)[number]]: string | null }
const MAX_LEGS = 6

export type BookingInput = { kind: BookingKind; legs: Leg[] } & { [K in Field]: string | null }
export type Booking = BookingInput & { id: string; tripId: string; createdAt: string; updatedAt: string }

const col = (f: string) => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

type Row = Record<string, string | null>
function toBooking(r: Row): Booking {
  const b = { id: r.id, tripId: r.trip_id, kind: r.kind, legs: JSON.parse(r.legs ?? '[]'), createdAt: r.created_at, updatedAt: r.updated_at } as Booking
  for (const f of FIELDS) b[f] = r[col(f)] ?? null
  return b
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const date = (v: string | null) => (v && DATE.test(v) ? v : null)
const time = (v: string | null) => {
  const t = v && /^\d:\d{2}$/.test(v) ? `0${v}` : v
  return t && TIME.test(t) ? t : null
}

/** Legs that make a journey: at least two, each with both ends (anything malformed is dropped, not an error). */
function cleanLegs(raw: unknown): Leg[] {
  if (!Array.isArray(raw)) return []
  const legs = raw.slice(0, MAX_LEGS).map((l: any) => {
    const leg = Object.fromEntries(LEG_FIELDS.map((f) => [f, str(l?.[f])])) as Leg
    for (const f of ['departDate', 'arriveDate'] as const) leg[f] = date(leg[f])
    for (const f of ['departTime', 'arriveTime'] as const) leg[f] = time(leg[f])
    return leg
  })
  return legs.length >= 2 && legs.every((l) => l.origin && l.destination) ? legs : []
}

/** The legs still describe the booking (same ends, same departure and arrival); after a manual edit that changed them, they don't. */
function legsMatch(b: BookingInput, legs: Leg[]): boolean {
  const first = legs[0]!
  const last = legs[legs.length - 1]!
  return (
    first.origin === b.origin &&
    last.destination === b.destination &&
    (first.departDate ?? b.departDate) === b.departDate &&
    first.departTime === b.departTime &&
    last.arriveTime === b.arriveTime
  )
}

/** Keep only known fields, trim them, and check what each kind needs. Throws 400 with a readable message. */
export function cleanBooking(body: any, current?: Booking): BookingInput {
  const kind = (body?.kind ?? current?.kind) as BookingKind
  if (!BOOKING_KINDS.includes(kind)) throw new HttpError(400, 'Tipo de reserva inválido')
  const out = { kind, legs: [] as Leg[] } as BookingInput
  for (const f of FIELDS) {
    const v = f in (body ?? {}) ? body[f] : current?.[f]
    const s = typeof v === 'string' ? v.trim() : null
    out[f] = s || null
  }
  for (const f of ['departDate', 'arriveDate', 'checkInDate', 'checkOutDate'] as const) {
    if (out[f] && !DATE.test(out[f]!)) throw new HttpError(400, 'Fecha inválida')
  }
  for (const f of ['departTime', 'arriveTime', 'checkInTime', 'checkOutTime'] as const) {
    if (out[f] && /^\d:\d{2}$/.test(out[f]!)) out[f] = `0${out[f]}`
    if (out[f] && !TIME.test(out[f]!)) throw new HttpError(400, 'Hora inválida')
  }

  if (isTransport(kind)) {
    if (!out.origin || !out.destination) throw new HttpError(400, 'Completá desde y hasta')
    if (!out.departDate) throw new HttpError(400, 'Completá la fecha')
    if (out.arriveDate && out.arriveDate < out.departDate) throw new HttpError(400, 'La llegada es antes de la salida')
    if (out.arriveDate === out.departDate) out.arriveDate = null
    for (const f of ['hotelName', 'address', 'city', 'checkInDate', 'checkInTime', 'checkOutDate', 'checkOutTime'] as const) out[f] = null
    const legs = cleanLegs(body && 'legs' in body ? body.legs : current?.legs)
    out.legs = legs.length && legsMatch(out, legs) ? legs : []
  } else {
    if (!out.hotelName) throw new HttpError(400, 'Completá el nombre del hotel')
    if (!out.checkInDate || !out.checkOutDate) throw new HttpError(400, 'Completá check-in y check-out')
    if (out.checkOutDate <= out.checkInDate) throw new HttpError(400, 'El check-out tiene que ser después del check-in')
    for (const f of ['origin', 'destination', 'departDate', 'departTime', 'arriveDate', 'arriveTime', 'carrier', 'number', 'seat'] as const)
      out[f] = null
  }
  return out
}

/** In time order: when it leaves, or when you check in. */
export function listBookings(tripId: string): Booking[] {
  return (
    db
      .prepare(
        `SELECT * FROM bookings WHERE trip_id = ?
         ORDER BY COALESCE(depart_date, check_in_date), COALESCE(depart_time, check_in_time, '99:99'), created_at`,
      )
      .all(tripId) as Row[]
  ).map(toBooking)
}

export function getBooking(id: string): Booking | null {
  const r = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Row | undefined
  return r ? toBooking(r) : null
}

export function createBooking(tripId: string, b: BookingInput): Booking {
  const id = randomUUID()
  const t = new Date().toISOString()
  db.prepare(
    `INSERT INTO bookings (id, trip_id, kind, legs, ${FIELDS.map(col).join(', ')}, created_at, updated_at)
     VALUES (?, ?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
  ).run(id, tripId, b.kind, JSON.stringify(b.legs), ...FIELDS.map((f) => b[f]), t, t)
  return getBooking(id)!
}

export function updateBooking(id: string, b: BookingInput): Booking | null {
  db.prepare(`UPDATE bookings SET kind = ?, legs = ?, ${FIELDS.map((f) => `${col(f)} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    b.kind,
    JSON.stringify(b.legs),
    ...FIELDS.map((f) => b[f]),
    new Date().toISOString(),
    id,
  )
  return getBooking(id)
}

export function deleteBooking(id: string): void {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id)
}

/**
 * A hotel says where you sleep: its nights that don't have a place yet take the hotel's city (using the
 * trip's own spelling when it's already there). Nights that already have a city stay as they are.
 */
export function claimHotelNights(b: Booking): void {
  if (b.kind !== 'hotel' || !b.city || !b.checkInDate || !b.checkOutDate) return
  const trip = getTrip(b.tripId)
  if (!trip?.startDate || !trip.endDate) return
  const stops = listStops(trip.id)
  const nights = daysBetweenDates(b.checkInDate, shiftDate(b.checkOutDate, -1)).filter(
    (d) => d >= trip.startDate! && d <= trip.endDate! && !stopOfDay(trip, stops, d),
  )
  if (!nights.length) return
  const known = stops.find((s) => s.city.trim().toLowerCase() === b.city!.trim().toLowerCase())
  setDaysCity(trip.id, nights, known?.city ?? b.city)
}
