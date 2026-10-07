import { Router, type Request } from 'express'

import { GREETING, HttpError, chat, cleanDraft, extractPins, modeFor, nextQuestion } from './ai/chat.js'
import * as repo from './db.js'
import { generationStatus, startDayGeneration, startGeneration } from './ai/generate.js'
import { requireUser } from './auth.js'
import * as bookings from './bookings.js'
import { parseBookings } from './ai/bookings.js'
import { dismissInbound, importInbound, listInbox } from './inbound.js'
import { geocode, locatePin } from './geo.js'
import { getWeather } from './weather.js'

export const router = Router()
router.use(requireUser)

/** The scripted onboarding question the UI should show buttons for (null once the route phase starts). */
function currentQuestion(tripId: string) {
  const trip = repo.getTrip(tripId)
  return trip && modeFor(tripId) === 'parse' ? nextQuestion(trip) : null
}

/** A trip that exists AND belongs to the signed-in user (anything else is a 404). */
function tripOr404(req: Request): repo.Trip {
  const trip = repo.getTrip(String(req.params.tripId))
  if (!trip || trip.userId !== req.user?.id) throw new HttpError(404, 'Trip no encontrado')
  return trip
}

function pinOr404(req: Request): repo.Pin {
  const pin = repo.getPin(String(req.params.pinId))
  if (!pin || pin.tripId !== req.params.tripId) throw new HttpError(404, 'Pin no encontrado')
  return pin
}

function messageOr404(req: Request): repo.Message {
  const msg = repo.getMessage(String(req.params.messageId))
  if (!msg || msg.tripId !== req.params.tripId) throw new HttpError(404, 'Mensaje no encontrado')
  return msg
}

const tripFields = (b: any): Partial<repo.Trip> => {
  const out: Partial<repo.Trip> = {}
  for (const k of [
    'name',
    'destination',
    'startDate',
    'endDate',
    'notes',
    'travelers',
    'kids',
    'pace',
    'interests',
    'arrivalCity',
    'arrivalTime',
    'departureCity',
    'departureTime',
    'currentCity',
    'whenHint',
  ] as const) {
    if (k in b) out[k] = b[k] === '' ? null : b[k]
  }
  if ('freeform' in b) out.freeform = !!b.freeform
  if ('datesTentative' in b) out.datesTentative = !!b.datesTentative
  if ('lengthDays' in b) out.lengthDays = Number.isFinite(Number(b.lengthDays)) && Number(b.lengthDays) > 0 ? Math.round(Number(b.lengthDays)) : null
  return out
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// ---- trips

router.get('/trips', (req, res) => {
  res.json(repo.listTrips(req.user!.id))
})

router.post('/trips', (req, res) => {
  const name = String(req.body?.name ?? '').trim() || 'Nuevo viaje'
  const trip = repo.createTrip(req.user!.id, { ...tripFields(req.body), name })
  repo.createMessage(trip.id, 'assistant', GREETING)
  res.status(201).json(trip)
})

router.get('/trips/:tripId', (req, res) => {
  const trip = tripOr404(req)
  res.json({
    trip,
    stops: repo.listStops(trip.id),
    pins: repo.listPins(trip.id),
    bookings: bookings.listBookings(trip.id),
    messages: repo.listMessages(trip.id),
    generation: generationStatus(trip.id),
    question: currentQuestion(trip.id),
  })
})

/** New dates move the whole plan along (see setTripDates); setting them by hand makes them real. */
router.patch('/trips/:tripId', (req, res) => {
  const trip = tripOr404(req)
  const fields = tripFields(req.body)
  const start = fields.startDate ?? trip.startDate
  const end = fields.endDate ?? trip.endDate
  if ((fields.startDate || fields.endDate) && isDay(start) && isDay(end)) {
    if (end < start) throw new HttpError(400, 'La vuelta es antes de la ida')
    const { startDate: _s, endDate: _e, ...rest } = fields
    const moved = repo.setTripDates(trip.id, start, end, { ...rest, datesTentative: false })
    res.json({ ...repo.getTrip(trip.id), ...moved })
    return
  }
  res.json(repo.updateTrip(trip.id, fields))
})

/** "Armar este día": only these days, around what they already have; `city` for a day that has no stop yet. */
router.post('/trips/:tripId/days/generate', (req, res) => {
  const trip = tripOr404(req)
  const days = Array.isArray(req.body?.days) ? req.body.days.filter(isDay) : []
  const city = typeof req.body?.city === 'string' ? req.body.city : null
  res.status(202).json({ generation: startDayGeneration(trip.id, days, city), stops: repo.listStops(trip.id) })
})

router.delete('/trips/:tripId', (req, res) => {
  repo.deleteTrip(tripOr404(req).id)
  res.status(204).end()
})

// ---- bookings (flights, trains, buses, hotels)

function bookingOr404(req: Request): bookings.Booking {
  const b = bookings.getBooking(String(req.params.bookingId))
  if (!b || b.tripId !== req.params.tripId) throw new HttpError(404, 'Reserva no encontrada')
  return b
}

router.post('/trips/:tripId/bookings', (req, res) => {
  const trip = tripOr404(req)
  res.status(201).json(bookings.createBooking(trip.id, bookings.cleanBooking(req.body)))
})

/** Read a pasted confirmation email into bookings for the user to review (nothing is saved). */
router.post('/trips/:tripId/bookings/parse', async (req, res) => {
  const trip = tripOr404(req)
  res.json(await parseBookings(trip, String(req.body?.text ?? '')))
})

router.patch('/trips/:tripId/bookings/:bookingId', (req, res) => {
  tripOr404(req)
  const cur = bookingOr404(req)
  res.json(bookings.updateBooking(cur.id, bookings.cleanBooking(req.body, cur)))
})

router.delete('/trips/:tripId/bookings/:bookingId', (req, res) => {
  tripOr404(req)
  bookings.deleteBooking(bookingOr404(req).id)
  res.status(204).end()
})

// ---- forwarded emails waiting for the user to pick the trip (account-wide)

router.get('/inbox', (req, res) => {
  res.json(listInbox(req.user!.id))
})

router.post('/inbox/:inboundId/import', (req, res) => {
  const created = importInbound(req.user!.id, String(req.params.inboundId), String(req.body?.tripId ?? ''), req.body?.bookings)
  if (!created) throw new HttpError(404, 'Email o viaje no encontrado')
  res.json(created)
})

router.delete('/inbox/:inboundId', (req, res) => {
  if (!dismissInbound(req.user!.id, String(req.params.inboundId))) throw new HttpError(404, 'Email no encontrado')
  res.status(204).end()
})

// ---- pins

router.post('/trips/:tripId/pins', (req, res) => {
  const trip = tripOr404(req)
  res.status(201).json(repo.createPin(trip.id, cleanDraft(req.body ?? {})))
})

router.patch('/trips/:tripId/pins/:pinId', (req, res) => {
  const pin = pinOr404(req)
  res.json(repo.updatePin(pin.id, cleanDraft({ ...pin, ...req.body })))
})

/** Drag & drop: set a day's (or the ideas list's) order. */
router.put('/trips/:tripId/days/:day/order', (req, res) => {
  const trip = tripOr404(req)
  const day = req.params.day === 'ideas' ? null : String(req.params.day)
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
  repo.reorderDay(trip.id, day, ids)
  res.json(repo.listPins(trip.id))
})

/** Lazily geocode a pin (called by the card when it becomes visible). */
router.post('/trips/:tripId/pins/:pinId/locate', async (req, res) => {
  const trip = tripOr404(req)
  res.json(await locatePin(pinOr404(req), trip))
})

router.delete('/trips/:tripId/pins/:pinId', (req, res) => {
  repo.deletePin(pinOr404(req).id)
  res.status(204).end()
})

// ---- chat

router.post('/trips/:tripId/chat', async (req, res) => {
  const trip = tripOr404(req)
  const text = String(req.body?.text ?? '').trim()
  if (!text) throw new HttpError(400, 'Mensaje vacío')
  const patch = req.body?.patch && typeof req.body.patch === 'object' ? tripFields(req.body.patch) : undefined
  const result = await chat(trip.id, text, { patch, structured: req.body?.structured === true })
  res.json({
    ...result,
    trip: repo.getTrip(trip.id),
    stops: repo.listStops(trip.id),
    pins: repo.listPins(trip.id),
    generation: generationStatus(trip.id),
    question: currentQuestion(trip.id),
  })
})

/** "Crear itinerario" button: generate day by day in the background (all stops, or only `cities`). */
router.post('/trips/:tripId/generate', (req, res) => {
  const trip = tripOr404(req)
  const cities = Array.isArray(req.body?.cities) ? req.body.cities.map(String) : null
  res.status(202).json(startGeneration(trip.id, cities))
})

router.delete('/trips/:tripId/messages', (req, res) => {
  repo.clearMessages(tripOr404(req).id)
  res.status(204).end()
})

/** "📌 Pinear": distill a message into suggested pins attached to that message. */
router.post('/trips/:tripId/messages/:messageId/extract', async (req, res) => {
  const trip = tripOr404(req)
  const msg = messageOr404(req)
  const drafts = await extractPins(trip, msg.content)
  const suggestions = [...msg.suggestions, ...drafts.map((draft) => ({ draft, pinId: null }))]
  res.json(repo.setMessageSuggestions(msg.id, suggestions))
})

/** "Añadir al trip" on a suggestion. Optional body overrides the draft (edited before saving). */
router.post('/trips/:tripId/messages/:messageId/suggestions/:index/accept', (req, res) => {
  const trip = tripOr404(req)
  const msg = messageOr404(req)
  const i = Number(req.params.index)
  const s = msg.suggestions[i]
  if (!s) throw new HttpError(404, 'Sugerencia no encontrada')
  if (s.pinId && repo.getPin(s.pinId)) throw new HttpError(409, 'Ya está en el trip')
  const pin = repo.createPin(trip.id, cleanDraft({ ...s.draft, ...(req.body ?? {}) }))
  msg.suggestions[i] = { ...s, pinId: pin.id }
  res.json({ pin, message: repo.setMessageSuggestions(msg.id, msg.suggestions) })
})

router.delete('/trips/:tripId/messages/:messageId/suggestions/:index', (req, res) => {
  const msg = messageOr404(req)
  const i = Number(req.params.index)
  msg.suggestions.splice(i, 1)
  res.json(repo.setMessageSuggestions(msg.id, msg.suggestions))
})

// ---- weather

router.get('/weather', async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'lat/lng inválidos')
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  res.json(await getWeather(lat, lng, date(req.query.start), date(req.query.end)))
})

router.get('/geo', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) throw new HttpError(400, 'q vacío')
  res.json(await geocode(q))
})
