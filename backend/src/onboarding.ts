import { UNKNOWN, isOngoing, type Trip } from './db.js'

/**
 * The fixed onboarding script. Questions with buttons are asked with static copy (instant,
 * consistent tone); the LLM only interprets free text and, at the end, proposes the route.
 */

export interface QuestionOption {
  label: string
  /** Structured answer applied directly. Options without a patch are sent as free text. */
  patch?: Partial<Trip>
}

export interface Question {
  id: 'where' | 'length' | 'now' | 'flights' | 'travelers' | 'kids' | 'pace' | 'interests'
  text: string
  /** Asked instead when the same question comes up twice in a row. */
  retryText?: string
  kind: 'free' | 'single' | 'multi'
  options: QuestionOption[]
}

export const FIRST_QUESTION = '¡Hola! ¿A dónde vamos y cuándo?'

export const INTERESTS = [
  'Comida y mercados',
  'Cultura e historia',
  'Naturaleza',
  'Relax y spa',
  'Compras',
  'Vida nocturna',
  'Arte y museos',
  'Tours guiados',
  'Aventura',
  'Playa',
  'Planes con chicos',
]

/** Quick reply on the first questions: skip the guided route and build the trip day by day. */
const DAY_BY_DAY: QuestionOption = { label: 'Lo armo día por día', patch: { freeform: true } }

export function nextQuestion(t: Trip): Question | null {
  // No tickets yet: placeholder dates need at least a rough length.
  if (t.datesTentative && !t.startDate) {
    return {
      id: 'length',
      text: 'Sin problema, lo armamos igual. ¿Cuántos días, más o menos?',
      retryText: 'Decime cuántos días, más o menos: "unos 10", "dos semanas"…',
      kind: 'single',
      options: [
        { label: 'Una semana', patch: { lengthDays: 7 } },
        { label: '10 días', patch: { lengthDays: 10 } },
        { label: 'Dos semanas', patch: { lengthDays: 14 } },
        { label: 'Tres semanas', patch: { lengthDays: 21 } },
        { label: 'Un mes', patch: { lengthDays: 30 } },
      ],
    }
  }
  if (!t.destination || !t.startDate || !t.endDate) {
    return {
      id: 'where',
      text: t.destination ? `¿Y en qué fechas vas a ${t.destination.split(/[—,(-]/)[0]!.trim()}?` : FIRST_QUESTION,
      retryText: t.destination
        ? 'No me quedaron claras las fechas. ¿Me las pasás con día y mes? Por ejemplo: del 30/9 al 4/11.'
        : 'Contame destino y fechas, por ejemplo: "Japón del 10 al 24 de noviembre".',
      kind: 'free',
      options: t.destination
        ? [{ label: 'Todavía no tengo fechas fijas', patch: { freeform: true, datesTentative: true } }]
        : [{ label: 'No sé a dónde, sorprendeme' }],
    }
  }
  // Day by day: nothing else is required up front (the copilot asks the profile when it's useful).
  if (t.freeform) {
    if (isOngoing(t) && !t.currentCity) return { id: 'now', text: 'Veo que el viaje ya arrancó. ¿En qué ciudad estás ahora?', kind: 'free', options: [] }
    return null
  }
  if (isOngoing(t) && !t.currentCity) {
    return {
      id: 'now',
      text: 'Veo que el viaje ya arrancó. ¿En qué ciudad estás ahora?',
      retryText: '¿En qué ciudad estás hoy? Con el nombre me alcanza.',
      kind: 'free',
      options: [],
    }
  }
  if ((!isOngoing(t) && !t.arrivalCity) || !t.departureCity) {
    return {
      id: 'flights',
      text: isOngoing(t) || t.arrivalCity ? '¿Desde qué ciudad vuelven?' : '¿Por qué ciudad llegan y desde cuál vuelven?',
      retryText: 'Decime las ciudades de los vuelos, por ejemplo: "llegamos a Roma y volvemos desde Milán".',
      kind: 'free',
      options: [{ label: 'Todavía no sé', patch: { arrivalCity: t.arrivalCity ?? UNKNOWN, departureCity: UNKNOWN } }, DAY_BY_DAY],
    }
  }
  if (!t.travelers) {
    return {
      id: 'travelers',
      text: '¿Con quién viajás?',
      kind: 'single',
      options: [
        { label: 'Solo/a', patch: { travelers: 'solo', kids: 'no' } },
        { label: 'En pareja', patch: { travelers: 'pareja', kids: 'no' } },
        { label: 'Con amigos', patch: { travelers: 'amigos', kids: 'no' } },
        { label: 'En familia', patch: { travelers: 'familia' } },
      ],
    }
  }
  if (t.travelers === 'familia' && !t.kids) {
    return {
      id: 'kids',
      text: '¿Van chicos? ¿De qué edades?',
      kind: 'single',
      options: [
        { label: 'Sin chicos', patch: { kids: 'no' } },
        { label: 'De 0 a 5', patch: { kids: 'chicos de 0 a 5 años' } },
        { label: 'De 6 a 12', patch: { kids: 'chicos de 6 a 12 años' } },
        { label: 'Adolescentes', patch: { kids: 'adolescentes' } },
      ],
    }
  }
  if (!t.pace) {
    return {
      id: 'pace',
      text: '¿Qué ritmo te gusta?',
      kind: 'single',
      options: [
        { label: 'Tranqui', patch: { pace: 'tranqui' } },
        { label: 'Intermedio', patch: { pace: 'intermedio' } },
        { label: 'A full, ver todo', patch: { pace: 'intenso' } },
      ],
    }
  }
  if (!t.interests.length) {
    return {
      id: 'interests',
      text: '¿Qué te gusta hacer? Elegí todo lo que va.',
      kind: 'multi',
      options: INTERESTS.map((label) => ({ label })),
    }
  }
  return null
}
