import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * "Today" as the traveler sees it. The server runs on UTC, a day behind Japan until 9 am and a day ahead
 * of Argentina after 9 pm; the app sends its local date with every request (X-Local-Date) and everything
 * that runs for that request — including the generation it starts — uses it.
 */
const store = new AsyncLocalStorage<string>()

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function withLocalDate<T>(date: string | undefined, fn: () => T): T {
  return date && DAY.test(date) ? store.run(date, fn) : fn()
}

export function today(): string {
  return store.getStore() ?? new Date().toISOString().slice(0, 10)
}

/** Today plus n days, YYYY-MM-DD. */
export function todayPlus(n: number): string {
  return new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}
