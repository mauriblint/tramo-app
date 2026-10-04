import { getGeocache, setGeocache, setPinGeo, type Pin, type Trip } from './db.js'

// Nominatim usage policy: max 1 req/s and an identifying User-Agent.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'tripplanner-personal/0.1'
const MIN_GAP_MS = 1100

let queue: Promise<unknown> = Promise.resolve()
let lastCall = 0

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return fn()
  })
  queue = run.catch(() => undefined)
  return run
}

export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const key = query.trim().toLowerCase()
  const cached = getGeocache(key)
  if (cached) return cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null

  const url = `${NOMINATIM}?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', 'accept-language': 'es' })}`
  const hit = await throttled(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Nominatim ${res.status}`)
    const rows = (await res.json()) as { lat: string; lon: string }[]
    return rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null
  })
  setGeocache(key, hit?.lat ?? null, hit?.lng ?? null)
  return hit
}

const LOCATABLE: Pin['type'][] = ['place', 'food', 'activity', 'route']

/** Resolve a pin's coordinates: exact place first, then fall back to its city (approximate). */
export async function locatePin(pin: Pin, trip: Trip): Promise<Pin> {
  if (pin.geoStatus) return pin
  const region = pin.city ?? trip.destination
  const exact = LOCATABLE.includes(pin.type)
    ? [pin.city && `${pin.title}, ${pin.city}`, trip.destination && `${pin.title}, ${trip.destination}`]
    : []
  for (const q of exact) {
    if (!q) continue
    const hit = await geocode(q)
    if (hit) return setPinGeo(pin.id, hit.lat, hit.lng, 'ok')!
  }
  if (region) {
    const hit = await geocode(region)
    if (hit) return setPinGeo(pin.id, hit.lat, hit.lng, 'approx')!
  }
  return setPinGeo(pin.id, null, null, 'none')!
}
