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
