import type { Booking, BookingInput, BookingKind, Leg, Stop, TimeOfDay, Trip } from './api'
import { daysBetween, stopForDay } from './pinMeta'

export const KIND_META: Record<BookingKind, { label: string; icon: string }> = {
  flight: {
    label: 'Vuelo',
    icon: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  },
  train: { label: 'Tren', icon: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/>' },
  bus: { label: 'Bus', icon: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>' },
  hotel: { label: 'Hotel', icon: '<path d="M3 19V6M3 14h18v5M21 14a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="11" r="1.6"/>' },
}
export const TRANSPORT_KINDS: BookingKind[] = ['flight', 'train', 'bus']

/** Usual hotel times when the booking doesn't say. */
export const DEFAULT_CHECK_IN = '15:00'
export const DEFAULT_CHECK_OUT = '11:00'

export function emptyBooking(kind: BookingKind, prefill: Partial<BookingInput> = {}): BookingInput {
  return {
    kind,
    legs: [],
    origin: null,
    destination: null,
    departDate: null,
    departTime: null,
    arriveDate: null,
    arriveTime: null,
    carrier: null,
    number: null,
    seat: null,
    hotelName: null,
    address: null,
    city: null,
    checkInDate: null,
    checkInTime: null,
    checkOutDate: null,
    checkOutTime: null,
    reference: null,
    notes: null,
    ...prefill,
  }
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Time to change between two legs ("15 min", "1 h 20"), when both times are known and it's the same day. */
export function transferTime(a: Leg, b: Leg): string | null {
  if (!a.arriveTime || !b.departTime || (a.arriveDate ?? a.departDate) !== b.departDate) return null
  const m = minutes(b.departTime) - minutes(a.arriveTime)
  if (m < 0) return null
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`
}

/** "Cambio en Toyama", "2 cambios", for one-line summaries. */
export function changesLabel(b: BookingInput): string | null {
  if (b.legs.length < 2) return null
  const word = b.kind === 'flight' ? 'Escala' : 'Cambio'
  return b.legs.length === 2 ? `${word} en ${b.legs[0]!.destination}` : `${b.legs.length - 1} ${word.toLowerCase()}s`
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
const mentions = (text: string | null, city: string) => !!text && !!city && norm(text).includes(norm(city))

/** Route changes (city A → city B on a date) that have no transport loaded yet. */
export function missingLegs(stops: Stop[], bookings: Booking[]) {
  const transports = bookings.filter((b) => b.kind !== 'hotel')
  return stops.slice(1).flatMap((to, i) => {
    const from = stops[i]!
    const date = to.startDate
    if (!date) return []
    const covered = transports.some((b) => b.departDate === date || mentions(b.destination, to.city))
    return covered ? [] : [{ from: from.city, to: to.city, date }]
  })
}

/** Every night of the trip and the hotel you sleep in (or null). */
export function nights(trip: Trip, stops: Stop[], bookings: Booking[]) {
  const days = daysBetween(trip.startDate, trip.endDate).slice(0, -1)
  return days.map((date) => ({ date, city: stopForDay(stops, date, trip.endDate)?.city ?? null, hotel: hotelForNight(bookings, date) }))
}

export function hotelForNight(bookings: Booking[], date: string): Booking | null {
  return bookings.find((b) => b.kind === 'hotel' && b.checkInDate! <= date && date < b.checkOutDate!) ?? null
}

export type DayEvent = {
  booking: Booking
  type: 'depart' | 'arrive' | 'checkin' | 'checkout'
  /** HH:MM, or null when the booking has no time (e.g. a train with a rail pass). */
  time: string | null
  label: string
}

/** What your bookings put on a given day, in time order. */
export function dayEvents(bookings: Booking[], date: string): DayEvent[] {
  const out: DayEvent[] = []
  for (const b of bookings) {
    if (b.kind === 'hotel') {
      if (b.checkInDate === date) out.push({ booking: b, type: 'checkin', time: b.checkInTime ?? DEFAULT_CHECK_IN, label: `Check-in · ${b.hotelName}` })
      if (b.checkOutDate === date) out.push({ booking: b, type: 'checkout', time: b.checkOutTime ?? DEFAULT_CHECK_OUT, label: `Check-out · ${b.hotelName}` })
      continue
    }
    if (b.departDate === date) out.push({ booking: b, type: 'depart', time: b.departTime, label: `${KIND_META[b.kind].label} a ${b.destination}` })
    if (b.arriveDate === date) out.push({ booking: b, type: 'arrive', time: b.arriveTime, label: `Llegás a ${b.destination}` })
  }
  return out.sort((a, b) => (a.time ?? '00:00').localeCompare(b.time ?? '00:00'))
}

/** Short text for a day card's chip: "Tren 11:03", "Check-in 15:00". */
export function chipLabel(e: DayEvent): string {
  const t = e.time ? ` ${e.time}` : ''
  if (e.type === 'checkin') return `Check-in${t}`
  if (e.type === 'checkout') return `Check-out${t}`
  if (e.type === 'arrive') return `Llegada${t}`
  return `${KIND_META[e.booking.kind].label}${t}`
}

export function slotOf(time: string | null): TimeOfDay {
  if (!time) return 'morning'
  const h = Number(time.slice(0, 2))
  return h < 12 ? 'morning' : h < 19 ? 'afternoon' : 'evening'
}

/** Google Maps search for a station, airport or hotel, scoped to a city when we know it. */
export function mapsSearch(place: string, near?: string | null): string {
  const q = near && !mentions(place, near) ? `${place}, ${near}` : place
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** Where "Cómo llegar" should take you for an event: the departure point, or the hotel. */
export function eventDirections(e: DayEvent, city?: string | null): string {
  const b = e.booking
  if (b.kind === 'hotel') return mapsSearch(b.address || b.hotelName!, b.address ? null : city)
  return mapsSearch(e.type === 'arrive' ? b.destination! : b.origin!, city)
}
