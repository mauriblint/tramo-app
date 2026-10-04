import type { Stop, Trip } from './api'
import { TIME_META, daysBetween, fmtDay } from './pinMeta'

export const TRAVELERS_LABEL: Record<NonNullable<Trip['travelers']>, string> = {
  solo: 'Solo/a',
  pareja: 'En pareja',
  amigos: 'Con amigos',
  familia: 'En familia',
}
export const PACE_LABEL: Record<NonNullable<Trip['pace']>, string> = {
  tranqui: 'Tranqui',
  intermedio: 'Intermedio',
  intenso: 'A full',
}

export interface Step {
  key: string
  label: string
  ok: boolean
  value: string | null
}

export const nightsOf = (s: Pick<Stop, 'startDate' | 'endDate'>) =>
  s.startDate && s.endDate ? Math.round((Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000) : 0

/** What we know so far, as the progress steps shown in the header and side panel. */
export function profileSteps(t: Trip, stops: Stop[]): Step[] {
  const days = daysBetween(t.startDate, t.endDate).length
  const city = (c: string | null) => (c && c !== 'a definir' ? c : 'a definir')
  const time = (c: string | null, tod: Trip['arrivalTime']) => `${city(c)}${tod ? `, ${TIME_META[tod].label.toLowerCase()}` : ''}`
  const who = t.travelers ? `${TRAVELERS_LABEL[t.travelers]}${t.kids && t.kids !== 'no' ? ` · ${t.kids}` : ''}` : null
  return [
    {
      key: 'destino',
      label: 'Destino',
      ok: !!(t.destination && t.startDate && t.endDate),
      value: t.destination
        ? `${t.destination}${t.startDate && t.endDate ? `\n${fmtDay(t.startDate)} → ${fmtDay(t.endDate)} · ${days} días` : ''}`
        : null,
    },
    {
      key: 'vuelos',
      label: 'Vuelos',
      ok: !!(t.arrivalCity || t.currentCity) && !!t.departureCity,
      value:
        t.currentCity || t.arrivalCity || t.departureCity
          ? [
              t.currentCity ? `Ahora en ${t.currentCity}` : t.arrivalCity && `Llegan a ${time(t.arrivalCity, t.arrivalTime)}`,
              t.departureCity && `Vuelven desde ${time(t.departureCity, t.departureTime)}`,
            ]
              .filter(Boolean)
              .join('\n')
          : null,
    },
    { key: 'ustedes', label: 'Ustedes', ok: !!t.travelers && (t.travelers !== 'familia' || !!t.kids), value: who },
    {
      key: 'ritmo',
      label: 'Ritmo',
      ok: !!t.pace && t.interests.length > 0,
      value: t.pace ? `${PACE_LABEL[t.pace]}${t.interests.length ? ` · ${t.interests.join(', ')}` : ''}` : null,
    },
    {
      key: 'ruta',
      label: 'Ruta',
      ok: stops.length > 0,
      value: stops.length ? stops.map((s) => `${s.city} ${nightsOf(s)}n`).join(' → ') : null,
    },
  ]
}

export interface QuickReply {
  label: string
  patch?: Partial<Trip>
}

/** Route-phase shortcuts (the questions before that come scripted from the backend). */
export function routeReplies(stops: Stop[]): QuickReply[] {
  if (!stops.length) return []
  const first = stops[0]!.city
  return [{ label: 'Dale, armá el día por día' }, { label: `Un día menos en ${first}` }, { label: 'Sumá una ciudad más' }, { label: 'Menos mudanzas' }]
}
