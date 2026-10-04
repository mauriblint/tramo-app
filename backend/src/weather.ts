// Open-Meteo: free, no key. Forecast covers ~16 days; beyond that we show last year's same dates.
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST_HORIZON_DAYS = 15
const MAX_DAYS = 7
const TTL_MS = 3 * 60 * 60 * 1000

export interface WeatherDay {
  date: string
  code: number
  max: number
  min: number
  /** Forecast: max precipitation probability (%). Archive: precipitation sum (mm). */
  rain: number | null
}

export interface Weather {
  mode: 'forecast' | 'last-year'
  days: WeatherDay[]
}

const cache = new Map<string, { at: number; value: Weather }>()

const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
const parse = (s: string) => new Date(`${s}T00:00:00Z`)

/**
 * Pick a window of up to 7 days: the trip's dates when known (the remaining part if already started),
 * otherwise the next 7 days.
 */
function window(startDate: string | null, endDate: string | null): { from: Date; to: Date } {
  const today = parse(ymd(new Date()))
  let from = startDate ? parse(startDate) : today
  if (from < today) from = today
  let to = endDate ? parse(endDate) : addDays(from, MAX_DAYS - 1)
  if (to < from) to = addDays(from, MAX_DAYS - 1)
  if ((to.getTime() - from.getTime()) / DAY >= MAX_DAYS) to = addDays(from, MAX_DAYS - 1)
  return { from, to }
}

export async function getWeather(lat: number, lng: number, startDate: string | null, endDate: string | null): Promise<Weather> {
  const { from, to } = window(startDate, endDate)
  const today = parse(ymd(new Date()))
  const inForecast = (to.getTime() - today.getTime()) / DAY <= FORECAST_HORIZON_DAYS

  // ~11km grid is plenty for weather and lets pins in the same area share a cache entry.
  const key = [lat.toFixed(1), lng.toFixed(1), ymd(from), ymd(to), inForecast].join('|')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const lastYear = (d: Date) => ymd(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())))
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    timezone: 'auto',
    start_date: inForecast ? ymd(from) : lastYear(from),
    end_date: inForecast ? ymd(to) : lastYear(to),
    daily: inForecast
      ? 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      : 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
  })
  const res = await fetch(`${inForecast ? FORECAST : ARCHIVE}?${params}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const data = (await res.json()) as { daily: Record<string, (number | string | null)[]> }
  const d = data.daily
  const days: WeatherDay[] = (d.time as string[]).map((_t, i) => ({
    // Report the trip's own dates even when data is from last year.
    date: ymd(addDays(from, i)),
    code: Number(d.weather_code?.[i] ?? 0),
    max: Math.round(Number(d.temperature_2m_max?.[i])),
    min: Math.round(Number(d.temperature_2m_min?.[i])),
    rain: ((inForecast ? d.precipitation_probability_max : d.precipitation_sum)?.[i] as number | null) ?? null,
  }))

  const value: Weather = { mode: inForecast ? 'forecast' : 'last-year', days }
  cache.set(key, { at: Date.now(), value })
  return value
}
