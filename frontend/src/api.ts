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
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
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
  updateTrip: (id: string, t: Partial<Trip>) => req<Trip>('PATCH', `/trips/${id}`, t),
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
  geo: (q: string) => req<{ lat: number; lng: number } | null>('GET', `/geo?${new URLSearchParams({ q })}`),
  deletePin: (tripId: string, id: string) => req<void>('DELETE', `/trips/${tripId}/pins/${id}`),

  chat: (tripId: string, text: string, patch?: Partial<Trip>, structured = false) =>
    req<{
      userMessage: Message
      assistantMessage: Message
      trip: Trip
      stops: Stop[]
      pins: Pin[]
      changedPinIds: string[]
      generation: GenerationStatus | null
      question: Question | null
    }>('POST', `/trips/${tripId}/chat`, { text, patch, structured }),
  clearChat: (tripId: string) => req<void>('DELETE', `/trips/${tripId}/messages`),
  extract: (tripId: string, messageId: string) => req<Message>('POST', `/trips/${tripId}/messages/${messageId}/extract`),
  acceptSuggestion: (tripId: string, messageId: string, index: number, override?: Partial<PinDraft>) =>
    req<{ pin: Pin; message: Message }>('POST', `/trips/${tripId}/messages/${messageId}/suggestions/${index}/accept`, override ?? {}),
  dismissSuggestion: (tripId: string, messageId: string, index: number) =>
    req<Message>('DELETE', `/trips/${tripId}/messages/${messageId}/suggestions/${index}`),
}
