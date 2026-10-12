/**
 * Picking up where you left off. Phones (iOS above all) kill an installed app in the background and
 * relaunch it at its start page; a new deploy reloads it too. We remember the last trip screen and the day
 * you were on, so the app opens there instead of at the beginning.
 */

const PATH_KEY = 'tramo.lastPath'
const DAY_KEY = (tripId: string) => `tramo.lastDay.${tripId}`
/** After this long, "where you were" is stale: open the trips list / today instead. */
const FRESH_MS = 12 * 3_600_000

type Stamped = { v: string; at: number }

function save(key: string, v: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ v, at: Date.now() } satisfies Stamped))
  } catch {
    // private mode / storage off: just don't remember
  }
}

function load(key: string): string | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as Stamped | null
    return s && Date.now() - s.at < FRESH_MS ? s.v : null
  } catch {
    return null
  }
}

/** Last screen inside a trip (trip, day or activity, with its tab). */
export const rememberPath = (fullPath: string) => save(PATH_KEY, fullPath)
export const lastPath = () => load(PATH_KEY)

/** The day you were working on in a trip, to land on it when going back to the itinerary. */
export const rememberDay = (tripId: string, day: string) => save(DAY_KEY(tripId), day)
export const lastDay = (tripId: string) => load(DAY_KEY(tripId))
