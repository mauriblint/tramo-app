import { localToday } from './pinMeta'

export type PinType = 'place' | 'food' | 'activity' | 'route' | 'idea' | 'summary'
export type PinStatus = 'idea' | 'want' | 'must' | 'done' | 'discarded'
export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

export interface Trip {
  id: string
  name: string
  destination: string | null
  startDate: string | null
  endDate: string | null
  notes: string | null
  travelers: 'solo' | 'pareja' | 'amigos' | 'familia' | null
  kids: string | null
  pace: 'tranqui' | 'intermedio' | 'intenso' | null
  interests: string[]
  arrivalCity: string | null
  arrivalTime: TimeOfDay | null
  departureCity: string | null
  departureTime: TimeOfDay | null
  currentCity: string | null
  /** Built day by day (empty days are fine) instead of the guided route + full generation. */
  freeform: boolean
  /** Placeholder dates (no tickets yet): shown as "Día 1, Día 2…"; setting real ones moves the plan along. */
  datesTentative: boolean
  lengthDays: number | null
  /** Rough "when" as the user said it ("julio"), while the dates are tentative. */
  whenHint: string | null
  /** ISO codes of the destination's countries (["jp"]); empty for a continent or region. */
  countryCodes: string[]
  createdAt: string
  updatedAt: string
}

export interface PinDraft {
  type: PinType
  title: string
  body: string
  city: string | null
  tags: string[]
  url: string | null
  status: PinStatus
  day: string | null
  timeOfDay: TimeOfDay | null
}

export interface Stop {
  id: string
  tripId: string
  city: string
  startDate: string | null
  endDate: string | null
  lodging: string | null
  dayTrips: string[]
  position: number
}

export type BookingKind = 'flight' | 'train' | 'bus' | 'hotel'

/** One leg of a journey with connections (a layover, a train change). */
export interface Leg {
  origin: string | null
  destination: string | null
  departDate: string | null
  departTime: string | null
  arriveDate: string | null
  arriveTime: string | null
  carrier: string | null
  number: string | null
  seat: string | null
}

/** Something the traveler booked. Transport uses origin…seat, hotels hotelName…checkOutTime; the rest stays null. */
export interface BookingInput {
  kind: BookingKind
  /** Empty for a direct trip; otherwise the legs of the journey, whose ends and times the booking spans. */
  legs: Leg[]
  origin: string | null
  destination: string | null
  departDate: string | null
  departTime: string | null
  arriveDate: string | null
  arriveTime: string | null
  carrier: string | null
  number: string | null
  seat: string | null
  hotelName: string | null
  address: string | null
  checkInDate: string | null
  checkInTime: string | null
  checkOutDate: string | null
  checkOutTime: string | null
  reference: string | null
  notes: string | null
}

export interface Booking extends BookingInput {
  id: string
  tripId: string
  createdAt: string
  updatedAt: string
}

/** A forwarded email whose bookings wait for the user to pick the trip. */
export interface InboxItem {
  id: string
  sender: string
  subject: string | null
  bookings: BookingInput[]
  skipped: number
  error: string | null
  /** The trip whose dates fit, when there's exactly one. */
  tripId: string | null
  receivedAt: string
}

export interface QuestionOption {
  label: string
  patch?: Partial<Trip>
}

/** Scripted onboarding question (same for every trip); the UI renders its buttons. */
export interface Question {
  id: string
  text: string
  kind: 'free' | 'single' | 'multi'
  options: QuestionOption[]
}

export interface GenerationStatus {
  running: boolean
  /** The days being written right now. */
  days: string[]
  totalDays: number
  doneDays: string[]
  pendingCities: string[]
  failedCities: string[]
}

export interface Pin extends PinDraft {
  id: string
  tripId: string
  lat: number | null
  lng: number | null
  geoStatus: 'ok' | 'approx' | 'none' | null
  position: number
  createdAt: string
  updatedAt: string
}

export interface Suggestion {
  draft: PinDraft
  pinId: string | null
}

export interface Message {
  id: string
  tripId: string
  role: 'user' | 'assistant'
  content: string
  suggestions: Suggestion[]
  createdAt: string
}

export interface WeatherDay {
  date: string
  code: number
  max: number
  min: number
  rain: number | null
}

export interface Weather {
  mode: 'forecast' | 'last-year'
  days: WeatherDay[]
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    // The server runs on UTC: "today" (trip in progress, "armame hoy") has to be the traveler's own date.
    headers: { 'x-local-date': localToday(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    // Session missing/expired: ask to sign in, then the user can retry.
    const { openAuth } = await import('./auth')
    openAuth('login')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
  return data as T
}

export const api = {
  listTrips: () => req<Trip[]>('GET', '/trips'),
  createTrip: (t: Partial<Trip>) => req<Trip>('POST', '/trips', t),
  getTrip: (id: string) =>
    req<{
      trip: Trip
      stops: Stop[]
      pins: Pin[]
      bookings: Booking[]
      messages: Message[]
      generation: GenerationStatus | null
      question: Question | null
    }>('GET', `/trips/${id}`),
  generate: (id: string, cities?: string[]) => req<GenerationStatus>('POST', `/trips/${id}/generate`, { cities: cities ?? null }),
  /** New dates move the plan along: `moved` days, and `toIdeas` activities that fell outside. */
  updateTrip: (id: string, t: Partial<Trip>) => req<Trip & { moved?: number; toIdeas?: number }>('PATCH', `/trips/${id}`, t),
  generateDays: (id: string, days: string[], city: string | null) =>
    req<{ generation: GenerationStatus; stops: Stop[] }>('POST', `/trips/${id}/days/generate`, { days, city }),
  deleteTrip: (id: string) => req<void>('DELETE', `/trips/${id}`),

  createBooking: (tripId: string, b: BookingInput) => req<Booking>('POST', `/trips/${tripId}/bookings`, b),
  updateBooking: (tripId: string, id: string, b: BookingInput) => req<Booking>('PATCH', `/trips/${tripId}/bookings/${id}`, b),
  parseBookings: (tripId: string, text: string) =>
    req<{ bookings: BookingInput[]; skipped: number; problems: string[] }>('POST', `/trips/${tripId}/bookings/parse`, { text }),
  deleteBooking: (tripId: string, id: string) => req<void>('DELETE', `/trips/${tripId}/bookings/${id}`),

  inbox: () => req<InboxItem[]>('GET', '/inbox'),
  importInbox: (id: string, tripId: string, bookings: BookingInput[]) => req<Booking[]>('POST', `/inbox/${id}/import`, { tripId, bookings }),
  dismissInbox: (id: string) => req<void>('DELETE', `/inbox/${id}`),

  createPin: (tripId: string, p: Partial<PinDraft>) => req<Pin>('POST', `/trips/${tripId}/pins`, p),
  updatePin: (tripId: string, id: string, p: Partial<PinDraft>) => req<Pin>('PATCH', `/trips/${tripId}/pins/${id}`, p),
  locatePin: (tripId: string, id: string) => req<Pin>('POST', `/trips/${tripId}/pins/${id}/locate`),
  weather: (lat: number, lng: number, start: string | null, end: string | null) =>
    req<Weather>('GET', `/weather?${new URLSearchParams({ lat: String(lat), lng: String(lng), start: start ?? '', end: end ?? '' })}`),
  reorderDay: (tripId: string, day: string | null, ids: string[]) =>
    req<Pin[]>('PUT', `/trips/${tripId}/days/${day ?? 'ideas'}/order`, { ids }),
  geo: (q: string, countries: string[] = []) =>
    req<{ lat: number; lng: number } | null>('GET', `/geo?${new URLSearchParams({ q, ...(countries.length ? { cc: countries.join(',') } : {}) })}`),
  deletePin: (tripId: string, id: string) => req<void>('DELETE', `/trips/${tripId}/pins/${id}`),

  chat: (tripId: string, text: string, patch?: Partial<Trip>, structured = false, context?: string | null) =>
    req<{
      userMessage: Message
      assistantMessage: Message
      trip: Trip
      stops: Stop[]
      pins: Pin[]
      changedPinIds: string[]
      generation: GenerationStatus | null
      question: Question | null
    }>('POST', `/trips/${tripId}/chat`, { text, patch, structured, context: context ?? undefined }),
  clearChat: (tripId: string) => req<void>('DELETE', `/trips/${tripId}/messages`),
  extract: (tripId: string, messageId: string) => req<Message>('POST', `/trips/${tripId}/messages/${messageId}/extract`),
  acceptSuggestion: (tripId: string, messageId: string, index: number, override?: Partial<PinDraft>) =>
    req<{ pin: Pin; message: Message }>('POST', `/trips/${tripId}/messages/${messageId}/suggestions/${index}/accept`, override ?? {}),
  dismissSuggestion: (tripId: string, messageId: string, index: number) =>
    req<Message>('DELETE', `/trips/${tripId}/messages/${messageId}/suggestions/${index}`),
}
