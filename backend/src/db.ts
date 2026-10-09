import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'

import { config } from './config.js'
import { today } from './today.js'

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
  /** Built day by day by the user (empty days are fine), instead of the guided route + full generation. */
  freeform: boolean
  /** The dates are placeholders (no tickets yet): the UI shows "Día 1, Día 2…" and they move when set for real. */
  datesTentative: boolean
  /** Rough length when there are no dates yet ("unos 15 días"). */
  lengthDays: number | null
  /** Rough "when" as the user said it ("julio", "enero 2027"), shown while the dates are tentative. */
  whenHint: string | null
  /** ISO country codes of the destination (["jp"], ["it", "es"]); empty for a continent/region or unknown. Used to scope map searches. */
  countryCodes: string[]
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
  ['freeform', 'INTEGER NOT NULL DEFAULT 0'],
  ['dates_tentative', 'INTEGER NOT NULL DEFAULT 0'],
  ['length_days', 'INTEGER'],
  ['when_hint', 'TEXT'],
  ['country_codes', "TEXT NOT NULL DEFAULT '[]'"],
] as const) {
  if (!tripCols.has(col)) db.exec(`ALTER TABLE trips ADD COLUMN ${col} ${def}`)
}
const stopCols = new Set((db.prepare('PRAGMA table_info(stops)').all() as { name: string }[]).map((c) => c.name))
if (!stopCols.has('day_trips')) db.exec(`ALTER TABLE stops ADD COLUMN day_trips TEXT NOT NULL DEFAULT '[]'`)

// One-off data migrations, numbered with SQLite's user_version.
const dataVersion = db.pragma('user_version', { simple: true }) as number
if (dataVersion < 1) {
  // The geocoder learned to retry without trailing details ("…, observatorio sur"): look up approximate pins again.
  db.exec(`UPDATE pins SET lat = NULL, lng = NULL, geo_status = NULL WHERE geo_status = 'approx'`)
  db.pragma('user_version = 1')
}

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
  freeform: !!r.freeform,
  datesTentative: !!r.dates_tentative,
  lengthDays: r.length_days ?? null,
  whenHint: r.when_hint ?? null,
  countryCodes: JSON.parse(r.country_codes ?? '[]'),
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

// People a trip is shared with (the owner is trips.user_id): they see and edit everything.
db.exec(`
  CREATE TABLE IF NOT EXISTS trip_members (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    invited_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (trip_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS trip_members_user ON trip_members(user_id);
`)

/** Your trips and the ones shared with you. */
export function listTrips(userId: string): Trip[] {
  return db
    .prepare('SELECT * FROM trips WHERE user_id = ? OR id IN (SELECT trip_id FROM trip_members WHERE user_id = ?) ORDER BY updated_at DESC')
    .all(userId, userId)
    .map((r) => toTrip(r as Row))
}

const memberCols = new Set((db.prepare('PRAGMA table_info(trip_members)').all() as { name: string }[]).map((c) => c.name))
// editor: changes everything · viewer: sees everything and forwards bookings, changes nothing.
if (!memberCols.has('role')) db.exec(`ALTER TABLE trip_members ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'`)

export const MEMBER_ROLES = ['editor', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]
export type TripRole = 'owner' | MemberRole

/** What this person is in the trip (null = no access). */
export function tripRole(trip: Trip, userId: string): TripRole | null {
  if (trip.userId === userId) return 'owner'
  const r = db.prepare('SELECT role FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, userId) as { role: MemberRole } | undefined
  return r?.role ?? null
}

/** Owner or member. */
export function canAccessTrip(trip: Trip, userId: string): boolean {
  return tripRole(trip, userId) !== null
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
       interests = ?, arrival_city = ?, arrival_time = ?, departure_city = ?, departure_time = ?, current_city = ?,
       freeform = ?, dates_tentative = ?, length_days = ?, when_hint = ?, country_codes = ?, updated_at = ?
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
    next.freeform ? 1 : 0,
    next.datesTentative ? 1 : 0,
    next.lengthDays ?? null,
    next.whenHint ?? null,
    JSON.stringify(next.countryCodes ?? []),
    now(),
    id,
  )
  return getTrip(id)
}

const shiftDate = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/**
 * New dates without losing anything: a new start moves the whole plan (activities and stops) by the same
 * number of days; whatever then falls after the new end goes back to Ideas, and stops are cut to fit.
 * Bookings are real dates and stay where they are.
 */
export function setTripDates(id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}): { moved: number; toIdeas: number } {
  const cur = getTrip(id)
  if (!cur) return { moved: 0, toIdeas: 0 }
  const moved = cur.startDate ? daysFrom(cur.startDate, startDate) : 0
  let toIdeas = 0
  db.transaction(() => {
    if (moved) {
      for (const p of db.prepare('SELECT id, day FROM pins WHERE trip_id = ? AND day IS NOT NULL').all(id) as { id: string; day: string }[])
        db.prepare('UPDATE pins SET day = ? WHERE id = ?').run(shiftDate(p.day, moved), p.id)
      for (const s of db.prepare('SELECT id, start_date, end_date FROM stops WHERE trip_id = ?').all(id) as Row[])
        db.prepare('UPDATE stops SET start_date = ?, end_date = ? WHERE id = ?').run(
          s.start_date && shiftDate(s.start_date, moved),
          s.end_date && shiftDate(s.end_date, moved),
          s.id,
        )
    }
    // The stay that reached the old last day owns that day only while it's the trip's end: a longer trip
    // would leave it without it, so it keeps it explicitly (the new days are "Por definir").
    const oldEnd = cur.endDate ? shiftDate(cur.endDate, moved) : null
    if (oldEnd && endDate > oldEnd) db.prepare('UPDATE stops SET end_date = ? WHERE trip_id = ? AND end_date = ?').run(shiftDate(oldEnd, 1), id, oldEnd)
    toIdeas = db.prepare('UPDATE pins SET day = NULL, time_of_day = NULL WHERE trip_id = ? AND day IS NOT NULL AND (day > ? OR day < ?)').run(id, endDate, startDate).changes
    db.prepare('DELETE FROM stops WHERE trip_id = ? AND start_date > ?').run(id, endDate)
    db.prepare('UPDATE stops SET end_date = ? WHERE trip_id = ? AND end_date > ?').run(endDate, id, endDate)
    updateTrip(id, { ...extra, startDate, endDate })
  })()
  return { moved, toIdeas }
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

/**
 * "Where you sleep these days" (null = back to "Por definir"). Works on the day → city map, so it can extend,
 * shorten, split or join stays: consecutive days in the same city are one stop. A stay keeps its lodging and
 * day trips when it's the same city as before.
 */
export function setDaysCity(tripId: string, days: string[], city: string | null, opts: { fillGaps?: boolean } = {}): Stop[] {
  const trip = getTrip(tripId)
  if (!trip?.startDate || !trip.endDate) return listStops(tripId)
  const stops = listStops(tripId)
  const all = daysBetweenDates(trip.startDate, trip.endDate)
  const owner = new Map<string, Stop | null>(all.map((d) => [d, stopOfDay(trip, stops, d)]))
  const name = city?.trim() || null
  const key = (s: string) => s.trim().toLowerCase()

  // The new map: a city per day (null = no stay), remembering which old stop each day came from.
  const cityOf = new Map<string, string | null>(all.map((d) => [d, owner.get(d)?.city ?? null]))
  const before = new Map(cityOf)
  const set = new Set(days.filter((d) => cityOf.has(d)))
  for (const d of set) cityOf.set(d, name)
  // "A until B": a city holds until the next one. Setting it on a day also takes over the rest of the
  // stretch that day belonged to (the same city, or no city), up to where a different one starts.
  if (name) {
    for (const d of [...set].sort()) {
      const next = shiftDate(d, 1)
      if (set.has(next) || !before.has(next)) continue
      const inherited = before.get(d) ?? null
      for (let x = next; before.has(x) && !set.has(x) && (before.get(x) ?? null) === inherited; x = shiftDate(x, 1)) cityOf.set(x, name)
    }
  }

  if (opts.fillGaps) fillForward(all, cityOf)

  type Run = { city: string; days: string[]; from: Stop | null }
  const runs: Run[] = []
  for (const d of all) {
    const c = cityOf.get(d)
    if (!c) continue
    const last = runs.at(-1)
    const prevDay = last?.days.at(-1)
    if (last && key(last.city) === key(c) && prevDay && shiftDate(prevDay, 1) === d) last.days.push(d)
    else runs.push({ city: c, days: [d], from: null })
    const old = owner.get(d)
    const run = runs.at(-1)!
    if (!run.from && old && key(old.city) === key(c)) run.from = old
  }

  const used = new Set<string>()
  const ins = db.prepare('INSERT INTO stops (id, trip_id, city, start_date, end_date, lodging, day_trips, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    db.prepare('DELETE FROM stops WHERE trip_id = ?').run(tripId)
    runs.forEach((r, i) => {
      const last = r.days.at(-1)!
      // A stay runs to the morning after its last night; the trip's last day is the end itself.
      const end = last === trip.endDate ? last : shiftDate(last, 1)
      const keep = r.from && !used.has(r.from.id) ? r.from : null
      if (keep) used.add(keep.id)
      ins.run(keep?.id ?? randomUUID(), tripId, r.city, r.days[0], end, keep?.lodging ?? null, JSON.stringify(keep?.dayTrips ?? []), i)
    })
  })()
  touchTrip(tripId)
  return listStops(tripId)
}

export const setDayCity = (tripId: string, day: string, city: string) => setDaysCity(tripId, [day], city)

/** "A until B": every day without a city takes the one before it (days before the first city stay empty). */
function fillForward(all: string[], cityOf: Map<string, string | null>) {
  let last: string | null = null
  for (const d of all) {
    const c = cityOf.get(d) ?? null
    if (c) last = c
    else if (last) cityOf.set(d, last)
  }
}

/** Fill a trip's gaps between cities with the city before them (see fillForward). */
export function fillCityGaps(tripId: string): void {
  const trip = getTrip(tripId)
  if (!trip?.startDate || !trip.endDate) return
  const stops = listStops(tripId)
  if (!stops.length) return
  const all = daysBetweenDates(trip.startDate, trip.endDate)
  const empty = all.filter((d) => !stopOfDay(trip, stops, d))
  const first = stops[0]!
  if (empty.some((d) => first.startDate && d > first.startDate)) setDaysCity(tripId, [], null, { fillGaps: true })
}

/**
 * "Pasá los días 14 y 15 al final": move a block of days, plans and city, so it starts on `to`. The days it
 * leaves behind become "Por definir"; plans already on the target days stay where they are.
 */
export function moveDays(tripId: string, days: string[], to: string): { moved: number; days: string[] } | { error: string } {
  const trip = getTrip(tripId)
  if (!trip?.startDate || !trip.endDate) return { error: 'El viaje no tiene fechas' }
  const src = [...new Set(days)].sort()
  if (!src.length) return { error: 'Sin días' }
  const offset = daysFrom(src[0]!, to)
  const target = src.map((d) => shiftDate(d, offset))
  if (target.some((d) => d < trip.startDate! || d > trip.endDate!)) return { error: 'Los días quedarían fuera del viaje' }
  if (!offset) return { moved: 0, days: target }

  const stops = listStops(tripId)
  const cityOf = new Map(src.map((d) => [d, stopOfDay(trip, stops, d)?.city ?? null]))
  db.transaction(() => {
    // Plans move with their day (both directions at once: the source days are known by date).
    const pins = db.prepare(`SELECT id, day FROM pins WHERE trip_id = ? AND day IN (${src.map(() => '?').join(',')})`).all(tripId, ...src) as { id: string; day: string }[]
    const upd = db.prepare('UPDATE pins SET day = ? WHERE id = ?')
    for (const p of pins) upd.run(shiftDate(p.day, offset), p.id)
  })()
  // Then the cities: the days left behind first, then the new ones (a day may be both).
  setDaysCity(tripId, src.filter((d) => !target.includes(d)), null)
  const byCity = new Map<string | null, string[]>()
  src.forEach((d, i) => byCity.set(cityOf.get(d) ?? null, [...(byCity.get(cityOf.get(d) ?? null) ?? []), target[i]!]))
  for (const [city, ds] of byCity) setDaysCity(tripId, ds, city)
  return { moved: offset, days: target }
}

function daysBetweenDates(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d)
  return out
}

/** The stop a day belongs to: from arrival up to the day before leaving; the trip's last day belongs to the stop that reaches it. */
export function stopOfDay(trip: Trip, stops: Stop[], day: string): Stop | null {
  return stops.find((s) => s.startDate && s.endDate && day >= s.startDate && (day < s.endDate || (day === s.endDate && s.endDate === trip.endDate))) ?? null
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

// One-off: day-by-day trips made before "A until B" have gaps between their cities; fill them.
if ((db.pragma('user_version', { simple: true }) as number) < 2) {
  for (const r of db.prepare('SELECT id FROM trips WHERE freeform = 1').all() as { id: string }[]) fillCityGaps(r.id)
  db.pragma('user_version = 2')
}
