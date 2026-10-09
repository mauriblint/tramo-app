import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

import { config } from './config.js'
import { db } from './db.js'
import { sendLoginEmail } from './email.js'

/**
 * Passwordless auth: an email carries both a link and a 6-digit code. The code exists because
 * on iOS an installed PWA doesn't share cookies with Safari, where mail links open.
 */

const CODE_TTL_MIN = 15
const SESSION_DAYS = 60
const MAX_ATTEMPTS = 5
const MAX_EMAILS_PER_HOUR = 5
export const SESSION_COOKIE = 'tramo_session'

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    code_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_codes_email ON login_codes(email, created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`)
const tripCols = new Set((db.prepare('PRAGMA table_info(trips)').all() as { name: string }[]).map((c) => c.name))
if (!tripCols.has('user_id')) db.exec('ALTER TABLE trips ADD COLUMN user_id TEXT')

export interface User {
  id: string
  name: string
  email: string
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const normEmail = (e: string) => e.trim().toLowerCase()
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason for the UI (e.g. 'needs_name' → switch the modal to sign-up). */
    public code?: string,
  ) {
    super(message)
  }
}

export function findUserByEmail(email: string): User | null {
  return (db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(normEmail(email)) as User | undefined) ?? null
}

/** Step 1: email a link + code. `name` is only needed for new accounts. */
export async function startLogin(rawEmail: string, rawName: string | undefined): Promise<{ isNew: boolean }> {
  const email = normEmail(rawEmail)
  if (!isEmail(email)) throw new AuthError(400, 'Revisá el email')
  const existing = findUserByEmail(email)
  const name = rawName?.trim() || existing?.name
  if (!name) throw new AuthError(400, 'Es tu primera vez: decinos tu nombre y listo.', 'needs_name')

  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?')
    .get(email, new Date(Date.now() - 3_600_000).toISOString()) as { n: number }
  if (recent.n >= MAX_EMAILS_PER_HOUR) throw new AuthError(429, 'Pediste muchos emails. Probá de nuevo en un rato.')

  const { code, link } = createLoginLink(email, name, CODE_TTL_MIN)
  await sendLoginEmail({ to: email, name, code, link, isNew: !existing })
  return { isNew: !existing }
}

/**
 * A one-time sign-in link (and its 6-digit code) for this email. `next` is where the app goes after
 * signing in (an invitation lands on the trip); invitations live longer than the 15-minute login.
 */
export function createLoginLink(rawEmail: string, name: string | null, ttlMinutes: number, next?: string): { code: string; link: string } {
  const email = normEmail(rawEmail)
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const token = randomBytes(32).toString('base64url')
  db.prepare(
    `INSERT INTO login_codes (id, email, name, code_hash, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), email, name, sha(code), sha(token), inMinutes(ttlMinutes), now())
  const params = new URLSearchParams({ token, ...(next ? { next } : {}) })
  return { code, link: `${config.appUrl}/auth/verify?${params}` }
}

/** Find the account for an email, or create it (an invited person gets one right away). */
export function ensureUser(rawEmail: string, name?: string | null): { user: User; created: boolean } {
  const email = normEmail(rawEmail)
  if (!isEmail(email)) throw new AuthError(400, 'Revisá el email')
  const existing = findUserByEmail(email)
  if (existing) return { user: existing, created: false }
  const user = { id: randomUUID(), name: name?.trim() || email.split('@')[0]!, email }
  db.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(user.id, user.name, user.email, now())
  return { user, created: true }
}

type CodeRow = { id: string; email: string; name: string | null; code_hash: string; attempts: number }

/** Step 2: exchange the link token, or email + code, for a session. */
export function verifyLogin(input: { token?: string; email?: string; code?: string }): { user: User; sessionToken: string } {
  let row: CodeRow | undefined
  if (input.token) {
    row = db
      .prepare('SELECT * FROM login_codes WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(sha(input.token), now()) as CodeRow | undefined
    if (!row) throw new AuthError(400, 'El link venció o ya se usó. Pedí uno nuevo.')
  } else {
    const email = normEmail(input.email ?? '')
    const code = (input.code ?? '').replace(/\D/g, '')
    row = db
      .prepare('SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .get(email, now()) as CodeRow | undefined
    if (!row) throw new AuthError(400, 'El código venció. Pedí uno nuevo.')
    if (row.attempts >= MAX_ATTEMPTS) throw new AuthError(429, 'Demasiados intentos. Pedí un código nuevo.')
    const ok = code.length === 6 && timingSafeEqual(Buffer.from(sha(code)), Buffer.from(row.code_hash))
    if (!ok) {
      db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
      throw new AuthError(400, 'Código incorrecto')
    }
  }
  db.prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').run(now(), row.id)

  let user = findUserByEmail(row.email)
  if (!user) {
    user = { id: randomUUID(), name: row.name ?? row.email.split('@')[0]!, email: row.email }
    db.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(user.id, user.name, user.email, now())
  }

  const sessionToken = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha(sessionToken),
    user.id,
    now(),
    inMinutes(SESSION_DAYS * 24 * 60),
  )
  return { user, sessionToken }
}

export function logout(sessionToken: string | undefined) {
  if (sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(sessionToken))
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export const sessionTokenOf = (req: Request) => readCookie(req, SESSION_COOKIE)

export function userFromRequest(req: Request): User | null {
  const token = sessionTokenOf(req)
  if (!token) return null
  return (
    (db
      .prepare(
        `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha(token), now()) as User | undefined) ?? null
  )
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 3_600_000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
  }
}

/** Everything behind this needs an account (it's also what protects the OpenAI key). */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = userFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Necesitás entrar a tu cuenta' })
    return
  }
  req.user = user
  next()
}
