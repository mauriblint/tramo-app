import OpenAI from 'openai'

import { config } from '../config.js'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// Low effort keeps chat turns fast; planning quality comes from the prompt, not from long reasoning.
export const REASONING = { effort: 'low' } as const

let client: OpenAI | null = null
export function openai(): OpenAI {
  if (!config.openaiApiKey) throw new HttpError(500, 'Falta OPENAI_API_KEY en backend/.env')
  client ??= new OpenAI({ apiKey: config.openaiApiKey })
  return client
}

export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function daysBetween(start: string | null, end: string | null): string[] {
  if (!isDate(start) || !isDate(end)) return []
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last && out.length < 60) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
