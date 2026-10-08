import { api } from './api'

type LatLng = { lat: number; lng: number }

// Shared across components: the map cover and the weather ask for the same cities.
const cache = new Map<string, Promise<LatLng | null>>()

/** "Japón: Tokio → Kioto" / "Japón — Tokio, Kioto" → "Japón" */
export function countryOf(destination: string | null | undefined): string | null {
  return destination?.split(/[—:,(→-]/)[0]?.trim() || null
}

function lookup(q: string, countries: string[] = []): Promise<LatLng | null> {
  const key = `${q}|${countries.join(',')}`
  if (!cache.has(key)) cache.set(key, api.geo(q, countries).catch(() => null))
  return cache.get(key)!
}

/** Regions and continents aren't a place to search next to a city ("París, Europa" lands anywhere). */
const GENERIC = /\b(europa|asia|[aá]frica|am[eé]rica|sudam[eé]rica|latinoam[eé]rica|centroam[eé]rica|norteam[eé]rica|ocean[ií]a|caribe|escandinavia|balcanes|medio oriente|oriente medio|sudeste asi[aá]tico|mediterr[aá]neo|patagonia)\b/i

/**
 * Geocode a city of the trip: inside its countries when we know them (ISO codes saved with the
 * destination), next to the destination's country name for older trips, or just the city.
 */
export async function geocodeCity(city: string, trip?: { destination?: string | null; countryCodes?: string[] } | null): Promise<LatLng | null> {
  const codes = trip?.countryCodes ?? []
  if (codes.length) return (await lookup(city, codes)) || lookup(city)
  const country = countryOf(trip?.destination)
  const usable = country && !GENERIC.test(country) && !/\s(y|e)\s/i.test(country)
  return (usable && (await lookup(`${city}, ${country}`))) || lookup(city)
}
