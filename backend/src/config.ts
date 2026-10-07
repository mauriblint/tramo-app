import 'dotenv/config'

export const config = {
  port: Number(process.env.API_PORT) || 3100,
  host: process.env.API_HOST?.trim() || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL?.trim() || './data/tripplanner.db',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
  /** Model for the day-by-day generation (defaults to the chat model). */
  /** Public URL of the app, used in login links. */
  appUrl: (process.env.APP_URL?.trim() || 'http://localhost:5180').replace(/\/$/, ''),
  resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  resendFrom: process.env.RESEND_FROM?.trim() || 'tramo <hola@trytramo.com>',
  /** Where users forward booking emails (shown in the app); the Cloudflare Email Worker posts them to /api/inbound/email. */
  inboundAddress: process.env.INBOUND_ADDRESS?.trim() || undefined,
  /** Shared with the Email Worker; without it the inbound endpoint is off. */
  inboundSecret: process.env.INBOUND_SECRET?.trim() || undefined,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  openaiGenModel: process.env.OPENAI_GEN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
}
