import express, { type ErrorRequestHandler } from 'express'

import { config } from './config.js'
import { HttpError } from './ai/chat.js'
import { router } from './routes.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: Boolean(config.openaiApiKey), model: config.openaiModel })
})
app.use('/api', router)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : (err?.status ?? 500)
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err?.message ?? 'Error' })
}
app.use(errorHandler)

app.listen(config.port, config.host, () => {
  console.log(`tripplanner api on http://${config.host}:${config.port}`)
})
