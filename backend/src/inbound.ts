import { randomUUID } from 'node:crypto'

import { convert } from 'html-to-text'
import { simpleParser } from 'mailparser'

import { parseBookings } from './ai/bookings.js'
import { findUserByEmail, type User } from './auth.js'
import { cleanBooking, createBooking, listBookings, type Booking, type BookingInput } from './bookings.js'
import { db, getTrip, listTrips, type Trip } from './db.js'

/**
 * Booking emails forwarded to the inbound address (Cloudflare Email Routing → Email Worker → POST here).
 * For now the sender identifies the account: a registered email is processed, anything else is dropped.
 * When there's exactly one trip it can go to and the dates fit, the bookings are added right away;
 * otherwise the email waits in the account's inbox for the user to pick the trip.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS inbound_emails (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    subject TEXT,
    text TEXT NOT NULL,         -- what the parser reads
    status TEXT NOT NULL,       -- processing | review | imported | dismissed
    bookings TEXT NOT NULL DEFAULT '[]',  -- BookingInput[] found in the email
    skipped INTEGER NOT NULL DEFAULT 0,   -- found but incomplete
    error TEXT,
    trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,  -- where it went, or the suggestion while in review
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inbound_user ON inbound_emails(user_id, status);
`)

export interface InboundEmail {
  id: string
  sender: string
  subject: string | null
  status: 'processing' | 'review' | 'imported' | 'dismissed'
  bookings: BookingInput[]
  skipped: number
  error: string | null
  tripId: string | null
  receivedAt: string
}

type Row = Record<string, any>
const toInbound = (r: Row): InboundEmail => ({
  id: r.id,
  sender: r.sender,
  subject: r.subject,
  status: r.status,
  bookings: JSON.parse(r.bookings),
  skipped: r.skipped,
  error: r.error,
  tripId: r.trip_id,
  receivedAt: r.created_at,
})

const now = () => new Date().toISOString()
const today = () => now().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10)

function setInbound(id: string, f: Partial<Record<'status' | 'bookings' | 'skipped' | 'error' | 'trip_id', unknown>>) {
  const cols = Object.keys(f)
  db.prepare(`UPDATE inbound_emails SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...cols.map((c) => (f as Row)[c]),
    now(),
    id,
  )
}

// ---- reading the email

/** HTML is what booking emails get right (the text part is often an afterthought); tables become aligned rows. */
function bodyText(html: string | false, text: string | undefined): string {
  if (html)
    return convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'table', format: 'dataTable' },
      ],
    })
  return text ?? ''
}

/** The receiving side (Cloudflare) says the sender is forged. Only a fail counts: a "pass" could be a header the sender wrote. */
const forged = (headers: Map<string, unknown>) =>
  ['authentication-results', 'arc-authentication-results'].some((h) => /\bdmarc=fail\b/i.test(String(headers.get(h) ?? '')))

export async function receiveEmail(raw: Buffer, envelopeFrom?: string): Promise<{ accepted: boolean; reason?: string }> {
  const mail = await simpleParser(raw)
  if (forged(mail.headers)) return { accepted: false, reason: 'dmarc' }

  // The forwarder is the From of the forward; the envelope sender is a fallback (some forwards rewrite it).
  const senders = [...(mail.from?.value.map((a) => a.address) ?? []), envelopeFrom].filter((a): a is string => !!a)
  let user: User | null = null
  let sender = ''
  for (const s of senders) {
    user = findUserByEmail(s)
    if (user) {
      sender = s.toLowerCase()
      break
    }
  }
  if (!user) return { accepted: false, reason: 'unknown sender' }

  const subject = mail.subject?.trim() || null
  const text = [subject && `Asunto: ${subject}`, bodyText(mail.html, mail.text)].filter(Boolean).join('\n\n')
  const id = randomUUID()
  const t = now()
  db.prepare(
    `INSERT INTO inbound_emails (id, user_id, sender, subject, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`,
  ).run(id, user.id, sender, subject, text, t, t)

  // The LLM takes a few seconds: answer the Worker now, read the email in the background.
  void readInbound(id, user.id).catch((e) => {
    console.error('[inbound] process', id, e)
    setInbound(id, { status: 'review', error: 'No pudimos leer este email' })
  })
  return { accepted: true }
}

// ---- deciding the trip

/** Trips a new booking can belong to: ongoing or upcoming (or not dated yet), leaving out empty drafts. */
function openTrips(userId: string): Trip[] {
  return listTrips(userId).filter((t) => t.destination && (!t.endDate || t.endDate >= today()))
}

const datesOf = (b: BookingInput) => [b.departDate, b.arriveDate, b.checkInDate, b.checkOutDate].filter((d): d is string => !!d)

/** Every date of the bookings falls within the trip, give or take two days (a flight the night before…). */
function fits(trip: Trip, list: BookingInput[]): boolean {
  if (!trip.startDate || !trip.endDate) return false
  const from = addDays(trip.startDate, -2)
  const to = addDays(trip.endDate, 2)
  return list.every((b) => datesOf(b).every((d) => from <= d && d <= to))
}

/** Forwarding the same email twice shouldn't duplicate the flight. */
const keyOf = (b: BookingInput) =>
  [b.kind, b.departDate ?? b.checkInDate, b.departTime ?? '', b.number ?? b.hotelName ?? '', b.reference ?? ''].join('|').toLowerCase()

function addToTrip(tripId: string, list: BookingInput[]): Booking[] {
  const existing = new Set(listBookings(tripId).map(keyOf))
  const created: Booking[] = []
  for (const b of list) {
    if (existing.has(keyOf(b))) continue
    existing.add(keyOf(b))
    created.push(createBooking(tripId, b))
  }
  return created
}

async function readInbound(id: string, userId: string) {
  const row = db.prepare('SELECT text FROM inbound_emails WHERE id = ?').get(id) as { text: string }
  const open = openTrips(userId)
  const only = open.length === 1 ? open[0]! : null

  const { bookings, skipped } = await parseBookings(only, row.text)
  const target = only && bookings.length && fits(only, bookings) ? only : null
  if (target) {
    const created = addToTrip(target.id, bookings)
    setInbound(id, { status: 'imported', bookings: JSON.stringify(bookings), skipped, trip_id: target.id })
    console.log(`[inbound] ${id}: ${created.length} bookings → trip ${target.id}`)
    return
  }
  // Not sure: suggest the trip whose dates fit, if exactly one does.
  const fitting = bookings.length ? open.filter((t) => fits(t, bookings)) : []
  setInbound(id, {
    status: 'review',
    bookings: JSON.stringify(bookings),
    skipped,
    trip_id: fitting.length === 1 ? fitting[0]!.id : null,
  })
  console.log(`[inbound] ${id}: ${bookings.length} bookings to review (${open.length} open trips)`)
}

// ---- the account's inbox

export function listInbox(userId: string): InboundEmail[] {
  return (db.prepare(`SELECT * FROM inbound_emails WHERE user_id = ? AND status = 'review' ORDER BY created_at`).all(userId) as Row[]).map(
    toInbound,
  )
}

function inboundOf(userId: string, id: string): InboundEmail | null {
  const r = db.prepare('SELECT * FROM inbound_emails WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined
  return r ? toInbound(r) : null
}

/** "Agregar al viaje": the user picked the trip (and may have removed some of the bookings). */
export function importInbound(userId: string, id: string, tripId: string, picked?: unknown[]): Booking[] | null {
  const item = inboundOf(userId, id)
  const trip = getTrip(tripId)
  if (!item || item.status !== 'review' || !trip || trip.userId !== userId) return null
  const list = (Array.isArray(picked) ? picked : item.bookings).map((b) => cleanBooking(b))
  const created = addToTrip(trip.id, list)
  setInbound(id, { status: 'imported', trip_id: trip.id })
  return created
}

export function dismissInbound(userId: string, id: string): boolean {
  const item = inboundOf(userId, id)
  if (!item || item.status !== 'review') return false
  setInbound(id, { status: 'dismissed' })
  return true
}
