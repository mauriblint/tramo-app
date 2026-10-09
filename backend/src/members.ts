import { HttpError } from './ai/client.js'
import { createLoginLink, ensureUser, type User } from './auth.js'
import { db, getTrip, type Trip } from './db.js'
import { sendInviteEmail } from './email.js'

/**
 * Sharing a trip: the owner invites by email. The person becomes a member right away (their account is
 * created if needed) and gets a 7-day sign-in link that opens the trip. Members see and edit everything;
 * only the owner deletes the trip or removes people, and a member can leave.
 */

const INVITE_TTL_MIN = 7 * 24 * 60

export interface Member {
  id: string
  name: string
  email: string
  owner: boolean
}

export function listMembers(trip: Trip): Member[] {
  const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(trip.userId) as User | undefined
  const rest = db
    .prepare('SELECT u.id, u.name, u.email FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ? ORDER BY m.created_at')
    .all(trip.id) as User[]
  return [...(owner ? [{ ...owner, owner: true }] : []), ...rest.map((u) => ({ ...u, owner: false }))]
}

export async function inviteMember(trip: Trip, by: User, email: string, name?: string | null): Promise<Member[]> {
  if (trip.userId !== by.id) throw new HttpError(403, 'Solo quien creó el viaje puede invitar')
  const { user, created } = ensureUser(email, name)
  if (user.id === trip.userId) throw new HttpError(400, 'Ese email ya es el tuyo')
  db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)').run(
    trip.id,
    user.id,
    by.id,
    new Date().toISOString(),
  )
  const { link } = createLoginLink(user.email, user.name, INVITE_TTL_MIN, `/trips/${trip.id}`)
  await sendInviteEmail({ to: user.email, name: user.name, from: by.name, trip: trip.name, link, isNew: created })
  return listMembers(getTrip(trip.id)!)
}

/** The owner removes someone, or a member leaves. */
export function removeMember(trip: Trip, by: User, userId: string): void {
  if (userId === trip.userId) throw new HttpError(400, 'Quien creó el viaje no puede salir: borralo si ya no lo querés')
  if (by.id !== trip.userId && by.id !== userId) throw new HttpError(403, 'Solo quien creó el viaje puede sacar a alguien')
  db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(trip.id, userId)
}
