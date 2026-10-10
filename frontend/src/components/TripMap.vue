<script setup lang="ts">
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { Booking, Pin, Stop, Trip } from '@/api'
import { mapsSearch } from '@/bookings'
import { geocodeCity } from '@/geo'
import { TIME_META, dayName, daysBetween, fmtDay, stopForDay } from '@/pinMeta'
import { nightsOf } from '@/tripProfile'

/**
 * The trip on one map: its cities (numbered, joined by the route), each day's places in that day's color,
 * hotels and saved ideas. Tap anything for a card. Layers and a day filter decide what shows.
 */
const props = defineProps<{
  trip: Trip
  stops: Stop[]
  pins: Pin[]
  bookings: Booking[]
  locating: boolean
  /** Fill the parent's height (desktop panel): filters on top, the map takes the rest. */
  fill?: boolean
}>()

const DAY_COLORS = ['#3B82C4', '#8B5CF6', '#C2417A', '#E07A2E', '#14996B', '#B7791F', '#0E7490', '#6D5D4B']
const days = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))
const colorOf = (day: string) => DAY_COLORS[Math.max(0, days.value.indexOf(day)) % DAY_COLORS.length]!

// ---- what shows
const layers = ref({ itinerario: true, hoteles: true, ideas: true })
const LAYERS: { key: keyof typeof layers.value; label: string }[] = [
  { key: 'itinerario', label: 'Itinerario' },
  { key: 'hoteles', label: 'Hoteles' },
  { key: 'ideas', label: 'Ideas' },
]
/** null = the whole trip */
const day = ref<string | null>(null)
const daysWithPlaces = computed(() => days.value.filter((d) => props.pins.some((p) => p.day === d)))

const placed = (p: Pin) => p.lat != null && p.lng != null && p.geoStatus === 'ok'
const dayPins = computed(() =>
  props.pins
    .filter((p) => p.day && p.type !== 'route' && placed(p) && (!day.value || p.day === day.value))
    .sort((a, b) => a.day!.localeCompare(b.day!) || a.position - b.position),
)
const ideaPins = computed(() => props.pins.filter((p) => !p.day && placed(p)))
const hotels = computed(() =>
  props.bookings.filter((b) => b.kind === 'hotel' && (!day.value || (b.checkInDate! <= day.value && day.value < b.checkOutDate!))),
)
/** Order of a place within its day (transfers don't count), as in the day view. */
function orderInDay(p: Pin) {
  return props.pins.filter((x) => x.day === p.day && x.type !== 'route').sort((a, b) => a.position - b.position).indexOf(p) + 1
}

// ---- the tapped thing
type Selected = { kind: 'city'; stop: Stop; n: number } | { kind: 'place'; pin: Pin } | { kind: 'idea'; pin: Pin } | { kind: 'hotel'; booking: Booking }
const selected = ref<Selected | null>(null)
const firstSentence = (s: string) => ((s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s) || '').trim()
const cityOfDay = (d: string) => stopForDay(props.stops, d, props.trip.endDate)?.city ?? null

// ---- the map
const el = ref<HTMLElement>()
let map: L.Map | undefined
let layer: L.LayerGroup | undefined
const geo = ref<Record<string, { lat: number; lng: number } | null>>({})

/** Cities and hotels are placed here (cached); pins come placed from the server. */
async function placeCitiesAndHotels() {
  const want = [
    ...props.stops.map((s) => ({ key: `city:${s.city}`, q: s.city })),
    ...props.bookings
      .filter((b) => b.kind === 'hotel')
      .map((b) => ({ key: `hotel:${b.id}`, q: b.address || [b.hotelName, b.city ?? (b.checkInDate && cityOfDay(b.checkInDate))].filter(Boolean).join(', ') })),
  ]
  for (const w of want) {
    if (w.key in geo.value) continue
    const at = await geocodeCity(w.q, props.trip)
    geo.value = { ...geo.value, [w.key]: at }
  }
}

const pinIcon = (html: string, size = 30) => L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [size / 2, size / 2] })
const circle = (text: string | number, color: string, size: number, ring = false) =>
  `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${color};border:${size > 30 ? 3 : 2.5}px solid #fff;box-sizing:border-box;color:#fff;font:800 ${size > 30 ? 13 : 11}px var(--font-sans);box-shadow:${ring ? `0 0 0 6px ${color}40` : '0 3px 8px rgb(14 31 24 / .25)'}">${text}</span>`

function draw(fit = false) {
  if (!map || !layer) return
  layer.clearLayers()
  const bounds: L.LatLngTuple[] = []
  const sel = selected.value

  // Cities and the route (always, faded when looking at one day)
  const route: L.LatLngTuple[] = []
  props.stops.forEach((s, i) => {
    const at = geo.value[`city:${s.city}`]
    if (!at) return
    route.push([at.lat, at.lng])
    if (!day.value) bounds.push([at.lat, at.lng])
    const label = `<span class="cover-pin-city">${s.city}</span>`
    const html = `<div class="cover-pin" style="opacity:${day.value ? 0.55 : 1}"><span class="cover-pin-n">${i + 1}</span>${label}</div>`
    // The whole trip: cities on top of the day dots; one day: its places on top.
    L.marker([at.lat, at.lng], { icon: pinIcon(html), zIndexOffset: day.value ? 100 : 2000 }).on('click', () => select({ kind: 'city', stop: s, n: i + 1 })).addTo(layer!)
  })
  if (route.length > 1) L.polyline(route, { color: '#0A7A55', weight: 2.5, opacity: day.value ? 0.35 : 0.7, dashArray: '2 8', lineCap: 'round' }).addTo(layer)

  // A day's places joined in order
  if (layers.value.itinerario) {
    if (day.value) {
      const path = dayPins.value.map((p): L.LatLngTuple => [p.lat!, p.lng!])
      if (path.length > 1) L.polyline(path, { color: colorOf(day.value), weight: 2.5, opacity: 0.8, dashArray: '2 7', lineCap: 'round' }).addTo(layer)
    }
    for (const p of dayPins.value) {
      const isSel = sel?.kind === 'place' && sel.pin.id === p.id
      const color = p.timeOfDay === 'evening' && day.value ? '#0E1F18' : colorOf(p.day!)
      const size = isSel ? 38 : day.value ? 28 : 22
      L.marker([p.lat!, p.lng!], { icon: pinIcon(circle(day.value ? orderInDay(p) : '', color, size, isSel), size), zIndexOffset: isSel ? 1000 : 200 })
        .on('click', () => select({ kind: 'place', pin: p }))
        .addTo(layer)
      if (day.value) bounds.push([p.lat!, p.lng!])
    }
  }

  if (layers.value.hoteles) {
    for (const b of hotels.value) {
      const at = geo.value[`hotel:${b.id}`]
      if (!at) continue
      const html = `<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#fff;border:2px solid #0A7A55;box-sizing:border-box;color:#0A7A55;box-shadow:0 3px 8px rgb(14 31 24 / .2)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19V6M3 14h18v5M21 14a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="11" r="1.6"/></svg></span>`
      L.marker([at.lat, at.lng], { icon: pinIcon(html), zIndexOffset: 300 }).on('click', () => select({ kind: 'hotel', booking: b })).addTo(layer)
      if (day.value) bounds.push([at.lat, at.lng])
    }
  }

  if (layers.value.ideas) {
    for (const p of ideaPins.value) {
      if (day.value && p.city && p.city !== cityOfDay(day.value)) continue
      const isSel = sel?.kind === 'idea' && sel.pin.id === p.id
      const html = `<span style="display:block;width:${isSel ? 26 : 20}px;height:${isSel ? 26 : 20}px;border-radius:13px;background:#fff;border:4px solid #F5C84C;box-sizing:border-box;box-shadow:0 3px 8px rgb(14 31 24 / .2)"></span>`
      L.marker([p.lat!, p.lng!], { icon: pinIcon(html, isSel ? 26 : 20), zIndexOffset: 150 }).on('click', () => select({ kind: 'idea', pin: p })).addTo(layer)
    }
  }

  if (fit && bounds.length) {
    if (bounds.length === 1) map.setView(bounds[0]!, 14)
    else map.fitBounds(L.latLngBounds(bounds), { padding: [60, 60], maxZoom: day.value ? 15 : 9 })
  }
}

function select(s: Selected) {
  selected.value = s
  draw()
}
function unselect() {
  selected.value = null
  draw()
}
function pickDay(d: string | null) {
  day.value = d
  selected.value = null
  draw(true)
}
function fitAll() {
  pickDay(null)
}

onMounted(async () => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: false })
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 }).addTo(map)
  L.control.zoom({ position: 'topleft' }).addTo(map)
  layer = L.layerGroup().addTo(map)
  map.setView([20, 0], 2)
  draw(true)
  await placeCitiesAndHotels()
  draw(true)
})
watch(
  () => [props.stops.map((s) => s.city).join(), props.bookings.length],
  async () => {
    await placeCitiesAndHotels()
    draw()
  },
)
// Pins arrive placed while the background job runs.
watch(() => props.pins.filter(placed).length, () => draw())
watch(layers, () => draw(), { deep: true })
onBeforeUnmount(() => map?.remove())

const LEGEND_DAY = computed(() => (day.value ? colorOf(day.value) : null))
</script>

<template>
  <div class="flex flex-col gap-3" :class="fill ? 'h-full' : ''">
    <!-- Layers and days -->
    <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <!-- Desktop puts the section title on the same line as the layers -->
      <slot name="title" />
      <button
        v-for="l in LAYERS"
        :key="l.key"
        type="button"
        :aria-pressed="layers[l.key]"
        class="rounded-full border-[1.5px]"
        :class="[fill ? 'h-11 px-5 text-[15px]' : 'h-9 px-3.5 text-[13px]', layers[l.key] ? 'border-brand bg-brand font-extrabold text-white' : 'border-[#DCE3DF] bg-white font-bold text-slate-600']"
        @click="layers[l.key] = !layers[l.key]"
      >
        {{ l.label }}
      </button>
      <span v-if="locating" class="ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-bold text-slate-500">
        <span class="h-2 w-2 animate-pulse rounded-full bg-brand" />Ubicando lugares…
      </span>
    </div>
    <div role="radiogroup" aria-label="Día" class="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <button
        type="button"
        role="radio"
        :aria-checked="!day"
        class="h-9 flex-none rounded-full border-[1.5px] px-3.5 text-[13px]"
        :class="!day ? 'border-brand bg-brand font-extrabold text-white' : 'border-[#DCE3DF] bg-white font-bold text-slate-600'"
        @click="pickDay(null)"
      >
        Todo el viaje
      </button>
      <button
        v-for="d in daysWithPlaces"
        :key="d"
        type="button"
        role="radio"
        :aria-checked="day === d"
        class="inline-flex h-9 flex-none items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[13px]"
        :class="day === d ? 'border-brand bg-brand font-extrabold text-white' : 'border-[#DCE3DF] bg-white font-bold text-slate-600'"
        @click="pickDay(d)"
      >
        <span class="h-2 w-2 rounded-full" :style="{ background: colorOf(d) }" />
        <span class="capitalize">{{ dayName(trip, d, { weekday: 'short', day: 'numeric' }) }}</span>
      </button>
    </div>

    </div>

    <div class="relative overflow-hidden rounded-[24px] bg-[#e9ece9]" :class="fill ? 'min-h-0 flex-1' : 'h-[62dvh] min-h-[420px]'">
      <div ref="el" class="h-full w-full" />
      <button
        type="button"
        aria-label="Ver todo el viaje"
        title="Ver todo el viaje"
        class="absolute top-[86px] left-[10px] z-[500] grid h-[34px] w-[34px] place-items-center rounded-[4px] border-2 border-black/20 bg-white bg-clip-padding text-noche"
        @click="fitAll"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>

      <!-- Legend -->
      <div class="pointer-events-none absolute bottom-3 left-3 z-[500] hidden flex-wrap items-center gap-3 rounded-xl bg-white/95 px-3 py-2 text-[12px] font-bold text-slate-600 md:flex">
        <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full bg-brand" />Ciudades</span>
        <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full" :style="{ background: LEGEND_DAY ?? DAY_COLORS[0] }" />{{ day ? dayName(trip, day, { weekday: 'short', day: 'numeric' }) : 'Cada día, un color' }}</span>
        <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[4px] border-2 border-brand" />Hotel</span>
        <span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-full border-[3px] border-sun" />Ideas</span>
      </div>
      <span class="pointer-events-none absolute right-2 bottom-1 z-[400] text-[9px] text-slate-500">© Esri</span>

      <!-- The tapped point: bottom on the phone, right on desktop -->
      <article
        v-if="selected"
        class="absolute inset-x-3 bottom-3 z-[600] flex flex-col gap-2.5 rounded-[22px] bg-white p-4 shadow-[0_18px_40px_rgba(14,31,24,0.2)] md:inset-x-auto md:right-3 md:bottom-auto md:w-[330px]"
        :class="'md:top-3'"
      >
        <div class="flex items-center gap-2">
          <template v-if="selected.kind === 'place'">
            <span class="inline-flex h-6 items-center gap-1.5 rounded-full bg-rocio px-2.5 text-[12px] font-extrabold">
              <span class="h-2 w-2 rounded-full" :style="{ background: colorOf(selected.pin.day!) }" />
              {{ dayName(trip, selected.pin.day!) }}<template v-if="selected.pin.timeOfDay"> · {{ TIME_META[selected.pin.timeOfDay].label.toLowerCase() }}</template>
            </span>
          </template>
          <span v-else-if="selected.kind === 'idea'" class="inline-flex h-6 items-center rounded-full bg-sun-soft px-2.5 text-[12px] font-extrabold text-[#6B4E00]">Idea guardada</span>
          <span v-else-if="selected.kind === 'hotel'" class="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[12px] font-extrabold text-brand-dark">Hotel</span>
          <span v-else class="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[12px] font-extrabold text-brand-dark">Ciudad {{ selected.n }}</span>
          <span class="flex-1" />
          <button type="button" aria-label="Cerrar" class="grid h-8 w-8 place-items-center rounded-full bg-rocio" @click="unselect">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <template v-if="selected.kind === 'place' || selected.kind === 'idea'">
          <h3 class="font-display text-[20px] leading-tight font-bold">{{ selected.pin.title }}</h3>
          <p v-if="selected.pin.body" class="line-clamp-3 text-[14px] leading-relaxed text-slate-600">{{ firstSentence(selected.pin.body) }}</p>
          <span v-if="selected.pin.city" class="text-[13px] text-slate-500">{{ selected.pin.city }}</span>
          <div class="flex gap-2">
            <RouterLink :to="`/trips/${trip.id}/pins/${selected.pin.id}`" class="btn-primary h-11 flex-1 text-[14px]">Ver detalle</RouterLink>
            <a :href="mapsSearch(selected.pin.title, selected.pin.city)" target="_blank" rel="noopener" class="inline-flex h-11 flex-1 items-center justify-center rounded-full border-[1.5px] border-[#DCE3DF] text-[14px] font-extrabold">Cómo llegar</a>
          </div>
          <RouterLink v-if="selected.kind === 'place'" :to="`/trips/${trip.id}/days/${selected.pin.day}`" class="text-[13px] font-extrabold text-brand">Ver el día completo →</RouterLink>
        </template>

        <template v-else-if="selected.kind === 'hotel'">
          <h3 class="font-display text-[20px] leading-tight font-bold">{{ selected.booking.hotelName }}</h3>
          <span class="text-[14px] text-slate-600">
            {{ fmtDay(selected.booking.checkInDate!, { weekday: 'short', day: 'numeric', month: 'short' }) }} → {{ fmtDay(selected.booking.checkOutDate!, { weekday: 'short', day: 'numeric', month: 'short' }) }}
          </span>
          <span v-if="selected.booking.reference" class="self-start rounded-md bg-rocio px-1.5 text-xs font-extrabold tracking-wide">{{ selected.booking.reference }}</span>
          <a :href="mapsSearch(selected.booking.address || selected.booking.hotelName!, selected.booking.checkInDate && cityOfDay(selected.booking.checkInDate))" target="_blank" rel="noopener" class="btn-primary h-11 text-[14px]">Cómo llegar</a>
        </template>

        <template v-else>
          <h3 class="font-display text-[20px] leading-tight font-bold">{{ selected.stop.city }}</h3>
          <span class="text-[14px] text-slate-600">
            {{ nightsOf(selected.stop) }} {{ nightsOf(selected.stop) === 1 ? 'noche' : 'noches' }}
            <template v-if="selected.stop.startDate && !trip.datesTentative"> · desde el {{ fmtDay(selected.stop.startDate, { weekday: 'short', day: 'numeric', month: 'short' }) }}</template>
          </span>
          <RouterLink v-if="selected.stop.startDate" :to="`/trips/${trip.id}/days/${selected.stop.startDate}`" class="btn-primary h-11 text-[14px]">Ver sus días</RouterLink>
        </template>
      </article>
    </div>
  </div>
</template>
