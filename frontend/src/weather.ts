import { api, type Weather } from './api'

// Dedupe across cards: pins in the same area/dates share one request.
const cache = new Map<string, Promise<Weather>>()

export function loadWeather(lat: number, lng: number, start: string | null, end: string | null): Promise<Weather> {
  const key = [lat.toFixed(1), lng.toFixed(1), start, end].join('|')
  let p = cache.get(key)
  if (!p) {
    p = api.weather(lat, lng, start, end)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** WMO weather code → emoji + short label. */
export function weatherIcon(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Despejado' }
  if (code <= 2) return { emoji: '🌤️', label: 'Parcialmente nublado' }
  if (code === 3) return { emoji: '☁️', label: 'Nublado' }
  if (code <= 48) return { emoji: '🌫️', label: 'Niebla' }
  if (code <= 57) return { emoji: '🌦️', label: 'Llovizna' }
  if (code <= 67) return { emoji: '🌧️', label: 'Lluvia' }
  if (code <= 77) return { emoji: '🌨️', label: 'Nieve' }
  if (code <= 82) return { emoji: '🌧️', label: 'Chaparrones' }
  if (code <= 86) return { emoji: '🌨️', label: 'Nevadas' }
  return { emoji: '⛈️', label: 'Tormenta' }
}
