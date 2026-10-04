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
import { router } from './routes.js'

const app = express()
app.set('trust proxy', true)
app.use(express.json({ limit: '2mb' }))

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
  res.json({ user })
})
app.post('/api/auth/logout', (req, res) => {
  logout(sessionTokenOf(req))
  clearSessionCookie(res)
  res.status(204).end()
})

// ---- app (signed in)
app.use('/api', router)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError || err instanceof AuthError ? err.status : (err?.status ?? 500)
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err?.message ?? 'Error' })
}
app.use(errorHandler)

app.listen(config.port, config.host, () => {
  console.log(`tramo api on http://${config.host}:${config.port}`)
})
