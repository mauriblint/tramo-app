import { registerSW } from 'virtual:pwa-register'

import { isStandalone } from './install'

/**
 * The installed app stays alive in memory for days and never navigates, so it never notices a new deploy on
 * its own. Look for one every time it comes back to the screen; a new version takes over and the page
 * reloads (autoUpdate), right as the user opens it.
 */
export function watchForUpdates() {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {})
      })
    },
  })
}

const PULL = 80 // px of pull that reloads
const MAX = 120

/**
 * Pull down from the top to reload, like any app. Browsers do this themselves; the installed app (iOS and
 * Android) doesn't, so it's ours there. Only when the page itself is at the top and the touch isn't on
 * something that scrolls or drags on its own (map, sheets, modals, chat).
 */
export function enablePullToRefresh() {
  if (!isStandalone()) return
  const dot = document.createElement('div')
  dot.setAttribute('aria-hidden', 'true')
  dot.style.cssText =
    'position:fixed;left:50%;top:0;z-index:2000;width:40px;height:40px;margin-left:-20px;border-radius:20px;background:#fff;' +
    'box-shadow:0 4px 14px rgba(14,31,24,.18);display:grid;place-items:center;opacity:0;pointer-events:none;' +
    'transform:translateY(-48px);transition:none'
  dot.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>'
  document.body.appendChild(dot)
  const icon = dot.firstElementChild as SVGElement

  let startY: number | null = null
  let pull = 0

  const show = (y: number, spin = 0) => {
    dot.style.opacity = String(Math.min(1, y / PULL))
    dot.style.transform = `translateY(${Math.min(y, MAX) - 48 + 12}px)`
    icon.style.transform = `rotate(${spin || (y / PULL) * 270}deg)`
  }
  const reset = () => {
    dot.style.transition = 'transform .2s, opacity .2s'
    dot.style.opacity = '0'
    dot.style.transform = 'translateY(-48px)'
    setTimeout(() => (dot.style.transition = 'none'), 200)
  }

  /** Something under the finger scrolls or drags by itself: leave the gesture to it. */
  const ownsGesture = (el: Element | null): boolean => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.closest('.leaflet-container, [role="dialog"], .fixed, [data-no-pull]')) return true
      const s = getComputedStyle(n)
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true
    }
    return false
  }

  window.addEventListener(
    'touchstart',
    (e) => {
      startY = e.touches.length === 1 && window.scrollY <= 0 && !ownsGesture(e.target as Element) ? e.touches[0]!.clientY : null
      pull = 0
    },
    { passive: true },
  )
  window.addEventListener(
    'touchmove',
    (e) => {
      if (startY === null) return
      const dy = e.touches[0]!.clientY - startY
      if (dy <= 0 || window.scrollY > 0) {
        if (pull) reset()
        startY = null
        pull = 0
        return
      }
      pull = dy * 0.55 // resistance, like the native one
      show(pull)
    },
    { passive: true },
  )
  window.addEventListener('touchend', () => {
    if (startY === null) return
    startY = null
    if (pull < PULL) return reset()
    show(PULL, 0)
    icon.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 700, iterations: Infinity })
    window.location.reload()
  })
}
