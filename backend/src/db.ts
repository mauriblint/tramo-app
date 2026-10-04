import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'

import { config } from './config.js'

export const PIN_TYPES = ['place', 'food', 'activity', 'route', 'idea', 'summary'] as const
export const PIN_STATUSES = ['idea', 'want', 'must', 'done', 'discarded'] as const

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening'] as const

export type PinType = (typeof PIN_TYPES)[number]
export type PinStatus = (typeof PIN_STATUSES)[number]
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const TRAVELERS = ['solo', 'pareja', 'amigos', 'familia'] as const
export const PACES = ['tranqui', 'intermedio', 'intenso'] as const
export type Travelers = (typeof TRAVELERS)[number]
export type Pace = (typeof PACES)[number]

export interface Trip {
  id: string
  name: string
  destination: string | null
  startDate: string | null
  endDate: string | null
  /** Free-form brief (markdown) the agent keeps up to date. */
  notes: string | null
  // Structured profile: what the agent must know before proposing a route.
  travelers: Travelers | null
  /** Kids and ages when traveling as a family, e.g. "2: 5 y 8 años"; "no" if none. */
  kids: string | null
  pace: Pace | null
  interests: string[]
  arrivalCity: string | null
  /** morning | afternoon | evening */
  arrivalTime: TimeOfDay | null
  departureCity: string | null
  departureTime: TimeOfDay | null
  /** Where they are now, when the trip already started. */
  currentCity: string | null
  userId: string | null
  createdAt: string
  updatedAt: string
}

/** What the LLM (or the user) proposes; becomes a Pin once saved. */
export interface PinDraft {
  type: PinType
  title: string
  body: string
  city: string | null
  tags: string[]
  url: string | null
  status: PinStatus
  /** YYYY-MM-DD when the pin is scheduled in the itinerary; null = loose idea. */
  day: string | null
  timeOfDay: TimeOfDay | null
}

/** A leg of the trip: where you sleep between two dates. */
export interface Stop {
  id: string
  tripId: string
  city: string
  startDate: string | null
  endDate: string | null
  lodging: string | null
  /** Day trips planned from this base (e.g. Nara from Kyoto), so other stops don't repeat them. */
  dayTrips: string[]
  position: number
}

export type StopDraft = Pick<Stop, 'city' | 'startDate' | 'endDate' | 'lodging' | 'dayTrips'>

export type GeoStatus = 'ok' | 'approx' | 'none'

export interface Pin extends PinDraft {
  id: string
  tripId: string
  lat: number | null
  lng: number | null
  /** null = not geocoded yet; 'approx' = only the city was found; 'none' = nothing found. */
  geoStatus: GeoStatus | null
  /** Order within its day. */
  position: number
  createdAt: string
  updatedAt: string
}

export interface Suggestion {
  draft: PinDraft
  /** Set once the suggestion has been added to the trip. */
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

const dir = path.dirname(config.databaseUrl)
fs.mkdirSync(dir, { recursive: true })

export const db = new Database(config.databaseUrl)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    destination TEXT,
    start_date TEXT,
    end_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pins (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    city TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    url TEXT,
    status TEXT NOT NULL DEFAULT 'idea',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pins_trip ON pins(trip_id);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    suggestions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_trip ON messages(trip_id, created_at);

  CREATE TABLE IF NOT EXISTS stops (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    lodging TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS stops_trip ON stops(trip_id, position);

  CREATE TABLE IF NOT EXISTS geocache (
    query TEXT PRIMARY KEY,
    lat REAL,
    lng REAL,
    created_at TEXT NOT NULL
  );
`)

// Additive column migrations.
const pinCols = new Set((db.prepare('PRAGMA table_info(pins)').all() as { name: string }[]).map((c) => c.name))
for (const [col, def] of [
  ['lat', 'REAL'],
  ['lng', 'REAL'],
  ['geo_status', 'TEXT'],
  ['day', 'TEXT'],
  ['time_of_day', 'TEXT'],
  ['position', 'INTEGER NOT NULL DEFAULT 0'],
] as const) {
  if (!pinCols.has(col)) db.exec(`ALTER TABLE pins ADD COLUMN ${col} ${def}`)
}
const tripCols = new Set((db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).map((c) => c.name))
for (const [col, def] of [
  ['travelers', 'TEXT'],
  ['kids', 'TEXT'],
  ['pace', 'TEXT'],
  ['interests', "TEXT NOT NULL DEFAULT '[]'"],
  ['arrival_city', 'TEXT'],
  ['arrival_time', 'TEXT'],
  ['departure_city', 'TEXT'],
  ['departure_time', 'TEXT'],
  ['current_city', 'TEXT'],
] as const) {
  if (!tripCols.has(col)) db.exec(`ALTER TABLE trips ADD COLUMN ${col} ${def}`)
}
const stopCols = new Set((db.prepare('PRAGMA table_info(stops)').all() as { name: string }[]).map((c) => c.name))
if (!stopCols.has('day_trips')) db.exec(`ALTER TABLE stops ADD COLUMN day_trips TEXT NOT NULL DEFAULT '[]'`)

const now = () => new Date().toISOString()

type Row = Record<string, any>

const toTrip = (r: Row): Trip => ({
  id: r.id,
  name: r.name,
  destination: r.destination,
  startDate: r.start_date,
  endDate: r.end_date,
  notes: r.notes,
  travelers: r.travelers,
  kids: r.kids,
  pace: r.pace,
  interests: JSON.parse(r.interests ?? '[]'),
  arrivalCity: r.arrival_city,
  arrivalTime: r.arrival_time,
  departureCity: r.departure_city,
  departureTime: r.departure_time,
  currentCity: r.current_city,
  userId: r.user_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toPin = (r: Row): Pin => ({
  id: r.id,
  tripId: r.trip_id,
  type: r.type,
  title: r.title,
  body: r.body,
  city: r.city,
  tags: JSON.parse(r.tags),
  url: r.url,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  geoStatus: r.geo_status,
  day: r.day,
  timeOfDay: r.time_of_day,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toMessage = (r: Row): Message => ({
  id: r.id,
  tripId: r.trip_id,
  role: r.role,
  content: r.content,
  suggestions: JSON.parse(r.suggestions),
  createdAt: r.created_at,
})

// ---- trips

export function listTrips(userId: string): Trip[] {
  return db
    .prepare('SELECT * FROM trips WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map((r) => toTrip(r as Row))
}

export function getTrip(id: string): Trip | null {
  const r = db.prepare('SELECT * FROM trips WHERE id = ?').get(id)
  return r ? toTrip(r as Row) : null
}

export function createTrip(userId: string, input: Partial<Trip> & { name: string }): Trip {
  const id = randomUUID()
  const t = now()
  db.prepare(
    `INSERT INTO trips (id, user_id, name, destination, start_date, end_date, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.name, input.destination ?? null, input.startDate ?? null, input.endDate ?? null, input.notes ?? null, t, t)
  return getTrip(id)!
}

export function updateTrip(id: string, input: Partial<Trip>): Trip | null {
  const cur = getTrip(id)
  if (!cur) return null
  const next = { ...cur, ...input }
  db.prepare(
    `UPDATE trips SET name = ?, destination = ?, start_date = ?, end_date = ?, notes = ?, travelers = ?, kids = ?, pace = ?,
       interests = ?, arrival_city = ?, arrival_time = ?, departure_city = ?, departure_time = ?, current_city = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.name,
    next.destination,
    next.startDate,
    next.endDate,
    next.notes,
    next.travelers,
    next.kids,
    next.pace,
    JSON.stringify(next.interests ?? []),
    next.arrivalCity,
    next.arrivalTime,
    next.departureCity,
    next.departureTime,
    next.currentCity,
    now(),
    id,
  )
  return getTrip(id)
}

export function deleteTrip(id: string): void {
  db.prepare('DELETE FROM trips WHERE id = ?').run(id)
}

const touchTrip = (id: string) => db.prepare('UPDATE trips SET updated_at = ? WHERE id = ?').run(now(), id)

// ---- pins

export function listPins(tripId: string): Pin[] {
  return db
    .prepare('SELECT * FROM pins WHERE trip_id = ? ORDER BY day IS NULL, day, position, created_at DESC')
    .all(tripId)
    .map((r) => toPin(r as Row))
}

export function getPin(id: string): Pin | null {
  const r = db.prepare('SELECT * FROM pins WHERE id = ?').get(id)
  return r ? toPin(r as Row) : null
}

const TIME_RANK: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 }

/** Next position at the end of a day, after anything in the same or an earlier time slot. */
function nextPosition(tripId: string, day: string | null): number {
  const r = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pins WHERE trip_id = ? AND day IS ?')
    .get(tripId, day) as { p: number }
  return r.p
}

export function createPin(tripId: string, d: PinDraft): Pin {
  const id = randomUUID()
  const t = now()
  db.prepare(
    `INSERT INTO pins (id, trip_id, type, title, body, city, tags, url, status, day, time_of_day, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    tripId,
    d.type,
    d.title,
    d.body,
    d.city,
    JSON.stringify(d.tags),
    d.url,
    d.status,
    d.day,
    d.timeOfDay,
    nextPosition(tripId, d.day),
    t,
    t,
  )
  touchTrip(tripId)
  return getPin(id)!
}

export function updatePin(id: string, input: Partial<PinDraft>): Pin | null {
  const cur = getPin(id)
  if (!cur) return null
  const n = { ...cur, ...input }
  const position = n.day !== cur.day ? nextPosition(cur.tripId, n.day) : cur.position
  db.prepare(
    `UPDATE pins SET type = ?, title = ?, body = ?, city = ?, tags = ?, url = ?, status = ?, day = ?, time_of_day = ?, position = ?, updated_at = ?
     WHERE id = ?`,
  ).run(n.type, n.title, n.body, n.city, JSON.stringify(n.tags), n.url, n.status, n.day, n.timeOfDay, position, now(), id)
  // Where it is may have changed → geocode again lazily.
  if (n.title !== cur.title || n.city !== cur.city || n.type !== cur.type) {
    db.prepare('UPDATE pins SET lat = NULL, lng = NULL, geo_status = NULL WHERE id = ?').run(id)
  }
  touchTrip(cur.tripId)
  return getPin(id)
}

/** Sort a day's pins by time slot, keeping their relative order. */
export function sortDay(tripId: string, day: string): void {
  const pins = listPins(tripId).filter((p) => p.day === day)
  pins.sort((a, b) => (TIME_RANK[a.timeOfDay ?? ''] ?? 1) - (TIME_RANK[b.timeOfDay ?? ''] ?? 1) || a.position - b.position)
  const upd = db.prepare('UPDATE pins SET position = ? WHERE id = ?')
  db.transaction(() => pins.forEach((p, i) => upd.run(i, p.id)))()
}

/** Explicit reorder from drag & drop. */
export function reorderDay(tripId: string, day: string | null, ids: string[]): void {
  const upd = db.prepare('UPDATE pins SET day = ?, position = ? WHERE id = ? AND trip_id = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(day, i, id, tripId)))()
  touchTrip(tripId)
}

export function setPinGeo(id: string, lat: number | null, lng: number | null, status: GeoStatus): Pin | null {
  db.prepare('UPDATE pins SET lat = ?, lng = ?, geo_status = ? WHERE id = ?').run(lat, lng, status, id)
  return getPin(id)
}

export function getGeocache(query: string): { lat: number | null; lng: number | null } | undefined {
  return db.prepare('SELECT lat, lng FROM geocache WHERE query = ?').get(query) as { lat: number | null; lng: number | null } | undefined
}

export function setGeocache(query: string, lat: number | null, lng: number | null): void {
  db.prepare('INSERT OR REPLACE INTO geocache (query, lat, lng, created_at) VALUES (?, ?, ?, ?)').run(query, lat, lng, now())
}

// ---- stops

const toStop = (r: Row): Stop => ({
  id: r.id,
  tripId: r.trip_id,
  city: r.city,
  startDate: r.start_date,
  endDate: r.end_date,
  lodging: r.lodging,
  dayTrips: JSON.parse(r.day_trips ?? '[]'),
  position: r.position,
})

export function listStops(tripId: string): Stop[] {
  return db
    .prepare('SELECT * FROM stops WHERE trip_id = ? ORDER BY position')
    .all(tripId)
    .map((r) => toStop(r as Row))
}

export function replaceStops(tripId: string, stops: StopDraft[]): Stop[] {
  const ins = db.prepare(
    'INSERT INTO stops (id, trip_id, city, start_date, end_date, lodging, day_trips, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  db.transaction(() => {
    db.prepare('DELETE FROM stops WHERE trip_id = ?').run(tripId)
    stops.forEach((s, i) =>
      ins.run(randomUUID(), tripId, s.city, s.startDate, s.endDate, s.lodging, JSON.stringify(s.dayTrips ?? []), i),
    )
  })()
  touchTrip(tripId)
  return listStops(tripId)
}

export function deletePin(id: string): void {
  db.prepare('DELETE FROM pins WHERE id = ?').run(id)
}

// ---- messages

export function listMessages(tripId: string, limit?: number): Message[] {
  const rows = limit
    ? db.prepare('SELECT * FROM (SELECT * FROM messages WHERE trip_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC').all(tripId, limit)
    : db.prepare('SELECT * FROM messages WHERE trip_id = ? ORDER BY created_at ASC').all(tripId)
  return rows.map((r) => toMessage(r as Row))
}

export function getMessage(id: string): Message | null {
  const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
  return r ? toMessage(r as Row) : null
}

export function createMessage(tripId: string, role: Message['role'], content: string, suggestions: Suggestion[] = []): Message {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO messages (id, trip_id, role, content, suggestions, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, tripId, role, content, JSON.stringify(suggestions), now())
  touchTrip(tripId)
  return getMessage(id)!
}

export function setMessageSuggestions(id: string, suggestions: Suggestion[]): Message | null {
  db.prepare('UPDATE messages SET suggestions = ? WHERE id = ?').run(JSON.stringify(suggestions), id)
  return getMessage(id)
}

export function clearMessages(tripId: string): void {
  db.prepare('DELETE FROM messages WHERE trip_id = ?').run(tripId)
}

/** Answer meaning "don't know yet": counts as answered but doesn't constrain the route. */
export const UNKNOWN = 'a definir'

const today = () => new Date().toISOString().slice(0, 10)

/** The trip already started (and hasn't ended): plan from today, from where they are. */
export function isOngoing(t: Trip): boolean {
  return !!t.startDate && !!t.endDate && t.startDate <= today() && today() <= t.endDate
}

/** First day the route covers: the trip start, or today for a trip in progress. */
export function planStart(t: Trip): string | null {
  return isOngoing(t) ? today() : t.startDate
}

/** What's still missing before a route can be proposed (empty = ready). */
export function missingForRoute(t: Trip): string[] {
  const out: string[] = []
  if (!t.destination) out.push('destino')
  if (!t.startDate || !t.endDate) out.push('fechas')
  if (isOngoing(t) ? !t.currentCity : !t.arrivalCity) out.push(isOngoing(t) ? 'dónde están ahora' : 'ciudad de llegada')
  if (!t.departureCity) out.push('ciudad de regreso')
  if (!t.travelers) out.push('quiénes viajan')
  else if (t.travelers === 'familia' && !t.kids) out.push('edades de los chicos')
  if (!t.pace) out.push('ritmo')
  if (!t.interests.length) out.push('qué les gusta hacer')
  return out
}
