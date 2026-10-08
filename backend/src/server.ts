import { timingSafeEqual } from 'node:crypto'

import express, { type ErrorRequestHandler } from 'express'

import { config } from './config.js'
import { HttpError } from './ai/chat.js'
import {
  AuthError,
  clearSessionCookie,
  logout,
  sessionTokenOf,
  setSessionCookie,
  startLogin,
  userFromRequest,
  verifyLogin,
} from './auth.js'
import { receiveEmail } from './inbound.js'
import { router } from './routes.js'
import { withLocalDate } from './today.js'

const app = express()
app.set('trust proxy', true)
app.use(express.json({ limit: '2mb' }))
// The traveler's own date for everything this request does (see today.ts).
app.use((req, _res, next) => withLocalDate(req.get('x-local-date') ?? undefined, next))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: Boolean(config.openaiApiKey), model: config.openaiModel })
})

// ---- auth (public)
app.post('/api/auth/start', async (req, res) => {
  res.json(await startLogin(String(req.body?.email ?? ''), req.body?.name))
})
app.post('/api/auth/verify', (req, res) => {
  const { user, sessionToken } = verifyLogin({ token: req.body?.token, email: req.body?.email, code: req.body?.code })
  setSessionCookie(res, sessionToken)
  res.json({ user })
})
app.get('/api/auth/me', (req, res) => {
  const user = userFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Sin sesión' })
    return
  }
  res.json({ user, inboundAddress: config.inboundAddress ?? null })
})
app.post('/api/auth/logout', (req, res) => {
  logout(sessionTokenOf(req))
  clearSessionCookie(res)
  res.status(204).end()
})

// ---- forwarded booking emails (from the Cloudflare Email Worker, authenticated by a shared secret)
const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
app.post('/api/inbound/email', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  if (!config.inboundSecret) {
    res.status(503).json({ error: 'Inbound off' })
    return
  }
  if (!sameSecret(String(req.get('x-inbound-secret') ?? ''), config.inboundSecret)) {
    res.status(401).json({ error: 'Bad secret' })
    return
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: 'Empty email' })
    return
  }
  const result = await receiveEmail(req.body, req.get('x-envelope-from') ?? undefined)
  console.log('[inbound]', req.get('x-envelope-from'), '→', result)
  // 202 either way: an unknown sender is dropped quietly instead of bounced (no confirmation that the address exists).
  res.status(202).json(result)
})

// ---- app (signed in)
app.use('/api', router)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError || err instanceof AuthError ? err.status : (err?.status ?? 500)
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err?.message ?? 'Error', code: err instanceof AuthError ? err.code : undefined })
}
app.use(errorHandler)

app.listen(config.port, config.host, () => {
  console.log(`tramo api on http://${config.host}:${config.port}`)
})
