import 'dotenv/config'

export const config = {
  port: Number(process.env.API_PORT) || 3100,
  host: process.env.API_HOST?.trim() || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL?.trim() || './data/tripplanner.db',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
  /** Model for the day-by-day generation (defaults to the chat model). */
  openaiGenModel: process.env.OPENAI_GEN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
}
