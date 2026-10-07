import type { Pin, PinDraft, PinStatus, PinType, TimeOfDay } from './api'

export const TYPE_META: Record<PinType, { label: string; emoji: string }> = {
  place: { label: 'Lugar', emoji: '📍' },
  food: { label: 'Comida', emoji: '🍜' },
  activity: { label: 'Actividad', emoji: '🎯' },
  route: { label: 'Recorrido', emoji: '🗺️' },
  idea: { label: 'Idea / tip', emoji: '💡' },
  summary: { label: 'Resumen', emoji: '📝' },
}

export const STATUS_META: Record<PinStatus, { label: string; emoji: string; cls: string }> = {
  idea: { label: 'Idea', emoji: '💭', cls: 'bg-slate-100 text-slate-700' },
  want: { label: 'Quiero', emoji: '👍', cls: 'bg-sky-100 text-sky-800' },
  must: { label: 'Imperdible', emoji: '⭐', cls: 'bg-amber-100 text-amber-800' },
  done: { label: 'Hecho', emoji: '✅', cls: 'bg-emerald-100 text-emerald-800' },
  discarded: { label: 'Descartado', emoji: '🚫', cls: 'bg-rose-50 text-rose-700' },
}

export const PIN_TYPES = Object.keys(TYPE_META) as PinType[]
export const PIN_STATUSES = Object.keys(STATUS_META) as PinStatus[]

/** Google Maps search link for pins that live somewhere. */
export function mapsUrl(p: PinDraft | Pin): string | null {
  if (!['place', 'food', 'activity'].includes(p.type)) return null
  const q = [p.title, p.city].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export function emptyDraft(): PinDraft {
  return { type: 'place', title: '', body: '', city: null, tags: [], url: null, status: 'idea', day: null, timeOfDay: null }
}

export const TIME_META: Record<TimeOfDay, { label: string; emoji: string }> = {
  morning: { label: 'Mañana', emoji: '🌅' },
  afternoon: { label: 'Tarde', emoji: '☀️' },
  evening: { label: 'Noche', emoji: '🌙' },
}
export const TIMES = Object.keys(TIME_META) as TimeOfDay[]

/** Today as YYYY-MM-DD in the traveler's own timezone (UTC is a day behind in Japan until 9 am). */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** All dates between start and end (inclusive), YYYY-MM-DD. */
export function daysBetween(start: string | null, end: string | null): string[] {
  if (!start || !end) return []
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last && out.length < 60) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('es', opts).replace(/\./g, '')

/** The stop you're based at on a given day: from its arrival day up to the day before leaving (the last stop keeps its last day). */
/** The stop a day belongs to: arrival up to the day before leaving; the trip's last day goes to the stop that reaches it. */
export function stopForDay<S extends { startDate: string | null; endDate: string | null }>(stops: S[], day: string, tripEnd?: string | null): S | null {
  const end = tripEnd ?? stops.at(-1)?.endDate
  return stops.find((s) => s.startDate && s.endDate && day >= s.startDate && (day < s.endDate || (day === s.endDate && s.endDate === end))) ?? null
}

/** "Día 3" while the dates are placeholders, the real date otherwise. */
export function dayName(trip: { startDate: string | null; datesTentative: boolean }, day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!trip.datesTentative || !trip.startDate) return fmtDay(day, opts)
  return `Día ${Math.round((Date.parse(day) - Date.parse(trip.startDate)) / 86_400_000) + 1}`
}

/**
 * A day's headline until the generator writes real titles: its first places as the title,
 * the rest as a one-line summary. Transfers ("route" pins) don't name the day.
 */
export function dayHeadline(pins: Pick<Pin, 'title' | 'type'>[]): { title: string; summary: string } {
  const named = pins.filter((p) => p.type !== 'route' && p.type !== 'summary')
  const list = named.length ? named : pins
  return {
    title: list.slice(0, 2).map((p) => p.title).join(' y '),
    summary: list.slice(2).map((p) => p.title).join(' · '),
  }
}
