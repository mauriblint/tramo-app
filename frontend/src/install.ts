import { reactive } from 'vue'

/**
 * "Add to Home Screen" support. Android/Chrome fires `beforeinstallprompt` (we keep it to offer our
 * own button); iOS has no API at all, so we show Share → Add to Home Screen instructions instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'tramo.installDismissedUntil'
const DISMISS_DAYS = 5

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
const isMobile = isIOS || /Android/.test(ua)

export const install = reactive({
  platform: (isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'other') as 'ios' | 'android' | 'other',
  deferred: null as BeforeInstallPromptEvent | null,
  installed: false,
})

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Call once at startup: Chrome fires the event early and only once per page load. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep Chrome's own mini-infobar quiet; we offer it at a better moment
    install.deferred = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    install.installed = true
    install.deferred = null
  })
}

/** Worth offering: on a phone, not already installed, not recently dismissed, and installable here. */
export function canOfferInstall(): boolean {
  if (!isMobile || isStandalone() || install.installed) return false
  try {
    if (Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now()) return false
  } catch {}
  return install.platform === 'ios' || !!install.deferred
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000))
  } catch {}
}

export async function promptInstall(): Promise<boolean> {
  const e = install.deferred
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  install.deferred = null
  if (outcome === 'accepted') install.installed = true
  return outcome === 'accepted'
}
