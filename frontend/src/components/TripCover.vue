<script setup lang="ts">
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { Stop } from '@/api'
import { geocodeCity } from '@/geo'

/** Cover map: the route's stops as numbered pins joined by a dashed line, in visiting order. */
const props = defineProps<{ stops: Stop[]; destination: string | null; countryCodes?: string[] }>()

const el = ref<HTMLElement>()
let map: L.Map | undefined
let layer: L.LayerGroup | undefined

async function draw() {
  if (!map || !layer) return
  const points = await Promise.all(props.stops.map((s) => geocodeCity(s.city, { destination: props.destination, countryCodes: props.countryCodes })))
  layer.clearLayers()

  const path: L.LatLngTuple[] = []
  // A city can repeat (e.g. back to Tokyo to fly home): one pin listing both numbers.
  const pins = new Map<string, { at: L.LatLngTuple; city: string; numbers: number[] }>()
  props.stops.forEach((s, i) => {
    const p = points[i]
    if (!p) return
    const at: L.LatLngTuple = [p.lat, p.lng]
    path.push(at)
    const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`
    const pin = pins.get(key) ?? { at, city: s.city, numbers: [] }
    pin.numbers.push(i + 1)
    pins.set(key, pin)
  })
  if (!path.length) return

  L.polyline(path, { color: '#0A7A55', weight: 2.5, opacity: 0.7, dashArray: '2 8', lineCap: 'round' }).addTo(layer)
  // With many stops the names collide: label only where the trip starts and ends (the list below names them all).
  const crowded = props.stops.length > 5
  const last = props.stops.length
  for (const pin of pins.values()) {
    const labeled = !crowded || pin.numbers.includes(1) || pin.numbers.includes(last)
    const label = labeled ? `<span class="cover-pin-city">${pin.city}</span>` : ''
    const html = `<div class="cover-pin"><span class="cover-pin-n">${pin.numbers.join('·')}</span>${label}</div>`
    L.marker(pin.at, { icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [15, 15] }), interactive: false }).addTo(layer)
  }
  // Room for the floating buttons on top and the title sheet overlapping the bottom.
  map.fitBounds(L.latLngBounds(path), { paddingTopLeft: [40, 76], paddingBottomRight: [90, 64], maxZoom: 9 })
}

onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: false, scrollWheelZoom: false })
  // Light, label-quiet basemap so the route is the protagonist.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
  }).addTo(map)
  layer = L.layerGroup().addTo(map)
  map.setView([20, 0], 2)
  draw()
})

watch(() => props.stops.map((s) => s.city).join('|'), draw)
onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div class="relative h-full w-full bg-[#e9ece9]">
    <div ref="el" class="h-full w-full" />
    <span class="pointer-events-none absolute right-2 bottom-8 z-[400] text-[9px] text-slate-500">© Esri</span>
  </div>
</template>
