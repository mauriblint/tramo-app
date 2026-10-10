import { getGeocache, getTrip, listPins, setGeocache, setPinGeo, type Pin, type Trip } from './db.js'

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

/** `countries` (ISO codes) keeps the search inside the trip's countries: "Takayama" can't land elsewhere. */
export async function geocode(query: string, countries: string[] = []): Promise<{ lat: number; lng: number } | null> {
  const cc = countries.filter((c) => /^[a-z]{2}$/.test(c)).join(',')
  const key = `${query.trim().toLowerCase()}${cc ? `|${cc}` : ''}`
  const cached = getGeocache(key)
  if (cached) return cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null

  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', 'accept-language': 'es' })
  if (cc) params.set('countrycodes', cc)
  const url = `${NOMINATIM}?${params}`
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

/**
 * Names to try, most specific first. Generated titles often carry a detail the map doesn't know
 * ("Tokyo Metropolitan Government Building, observatorio sur", "Sensō-ji (al amanecer)"):
 * retry with just the place name.
 */
export function nameVariants(title: string): string[] {
  const t = title.trim()
  const noParens = t.replace(/\s*\([^)]*\)/g, '').trim()
  const head = noParens.split(/\s*(?:,|;|\s[–—-]\s|:)\s*/)[0]!.trim()
  return [...new Set([t, noParens, head])].filter((v) => v.length >= 3)
}

/** Resolve a pin's coordinates: exact place first, then fall back to its city (approximate). */
export async function locatePin(pin: Pin, trip: Trip): Promise<Pin> {
  if (pin.geoStatus) return pin
  const cc = trip.countryCodes
  // Known countries scope the search; otherwise the destination text helps only when it names one place.
  const scope = cc.length ? null : trip.destination
  const region = pin.city ?? trip.destination
  const exact = LOCATABLE.includes(pin.type)
    ? nameVariants(pin.title).flatMap((name) => [pin.city && `${name}, ${pin.city}`, scope ? `${name}, ${scope}` : cc.length ? name : null])
    : []
  for (const q of exact) {
    if (!q) continue
    const hit = await geocode(q, cc)
    if (hit) return setPinGeo(pin.id, hit.lat, hit.lng, 'ok')!
  }
  if (region) {
    const hit = await geocode(region, cc)
    if (hit) return setPinGeo(pin.id, hit.lat, hit.lng, 'approx')!
  }
  return setPinGeo(pin.id, null, null, 'none')!
}

// ---- the whole trip, in the background (for the trip map)

const locating = new Set<string>()

/** Pins still waiting to be placed on the map. */
export const unlocatedCount = (tripId: string) => listPins(tripId).filter((p) => p.geoStatus === null).length

/**
 * Place every pin of the trip that isn't placed yet, one at a time (the geocoder allows ~1 request/s and
 * caches). Runs once per trip at a time; the map polls and shows them as they come.
 */
export function locateTripInBackground(tripId: string): number {
  const pending = unlocatedCount(tripId)
  if (!pending || locating.has(tripId)) return pending
  locating.add(tripId)
  void (async () => {
    try {
      for (;;) {
        const trip = getTrip(tripId)
        const next = trip && listPins(tripId).find((p) => p.geoStatus === null)
        if (!trip || !next) break
        await locatePin(next, trip)
      }
    } catch (e) {
      console.error('[geo] trip', tripId, e)
    } finally {
      locating.delete(tripId)
    }
  })()
  return pending
}
