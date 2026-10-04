import { api } from './api'

type LatLng = { lat: number; lng: number }

// Shared across components: the map cover and the weather ask for the same cities.
const cache = new Map<string, Promise<LatLng | null>>()

/** "Japón: Tokio → Kioto" / "Japón — Tokio, Kioto" → "Japón" */
export function countryOf(destination: string | null | undefined): string | null {
  return destination?.split(/[—:,(→-]/)[0]?.trim() || null
}

function lookup(q: string): Promise<LatLng | null> {
  if (!cache.has(q)) cache.set(q, api.geo(q).catch(() => null))
  return cache.get(q)!
}

/** Geocode a city, scoped to the trip's country when possible, falling back to the bare name. */
export async function geocodeCity(city: string, destination?: string | null): Promise<LatLng | null> {
  const country = countryOf(destination)
  return (country && (await lookup(`${city}, ${country}`))) || lookup(city)
}
