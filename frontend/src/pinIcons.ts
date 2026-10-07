import type { PinDraft, PinType } from './api'

/** Stroke icon (24×24 paths) + tile colors per pin type, shared by the copilot bubbles and the Ideas board. */
export const PIN_LOOK: Record<PinType, { label: string; icon: string; bg: string; fg: string }> = {
  place: { label: 'Ver', icon: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>', bg: '#E3F5EC', fg: '#075C40' },
  food: { label: 'Comer', icon: '<path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M12 7c0-2 2-2 2-4"/>', bg: '#FDF1CC', fg: '#6B4E00' },
  activity: {
    label: 'Hacer',
    icon: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.9 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    bg: '#E6EEFB',
    fg: '#1F4C8F',
  },
  route: { label: 'Traslado', icon: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/>', bg: '#EEF0F3', fg: '#3F4B45' },
  idea: {
    label: 'Idea',
    icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
    bg: '#FDF1CC',
    fg: '#6B4E00',
  },
  summary: { label: 'Nota', icon: '<path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4"/>', bg: '#EEF0F3', fg: '#3F4B45' },
}

/** Types that are a real place you can go to (map link, coordinates). The rest are ideas/tips. */
export const isPlace = (t: PinType) => t === 'place' || t === 'food' || t === 'activity'

export function googleMapsSearch(d: Pick<PinDraft, 'title' | 'city'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.title, d.city].filter(Boolean).join(', '))}`
}

/** First sentence of a note, without markdown, for one-line previews. */
export function oneLine(s: string, max = 140): string {
  const plain = s.replace(/[#*_>`]/g, '').trim()
  const m = plain.match(/^.*?[.!?](\s|$)/)
  const first = (m ? m[0] : plain).trim()
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}
