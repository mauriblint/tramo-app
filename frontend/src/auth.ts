import { reactive } from 'vue'

export interface User {
  id: string
  name: string
  email: string
}

type Mode = 'signup' | 'login'
type Step = 'form' | 'sent'

/** Session + the sign-up modal, shared app-wide. */
export const auth = reactive({
  user: null as User | null,
  checked: false,
  modal: { open: false, mode: 'signup' as Mode, step: 'form' as Step, email: '', name: '' },
  /** Runs after a successful sign-in (e.g. start the trip that was typed before signing up). */
  onSignedIn: null as null | ((u: User) => void),
})

const PENDING_KEY = 'tramo.pendingMessage'

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
  return data as T
}

export async function fetchMe(): Promise<User | null> {
  try {
    auth.user = (await call<{ user: User }>('GET', '/me')).user
  } catch {
    auth.user = null
  }
  auth.checked = true
  return auth.user
}

export function openAuth(mode: Mode = 'signup', onSignedIn?: (u: User) => void) {
  auth.modal = { ...auth.modal, open: true, mode, step: 'form' }
  auth.onSignedIn = onSignedIn ?? null
}

export function closeAuth() {
  auth.modal.open = false
}

export async function startLogin(email: string, name?: string) {
  await call('POST', '/start', { email, name })
  auth.modal.email = email
  auth.modal.step = 'sent'
}

function signedIn(user: User) {
  auth.user = user
  auth.modal.open = false
  const cb = auth.onSignedIn
  auth.onSignedIn = null
  cb?.(user)
}

export async function verifyCode(code: string) {
  signedIn((await call<{ user: User }>('POST', '/verify', { email: auth.modal.email, code })).user)
}

export async function verifyToken(token: string) {
  signedIn((await call<{ user: User }>('POST', '/verify', { token })).user)
}

export async function logout() {
  await call('POST', '/logout')
  auth.user = null
}

// The first message typed before signing up survives the trip through email (even a page reload).
export function savePending(text: string) {
  try {
    localStorage.setItem(PENDING_KEY, text)
  } catch {}
}
export function takePending(): string | null {
  try {
    const t = localStorage.getItem(PENDING_KEY)
    localStorage.removeItem(PENDING_KEY)
    return t
  } catch {
    return null
  }
}
export function peekPending(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY)
  } catch {
    return null
  }
}
