<script setup lang="ts">
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface DayPoint {
  n: number
  lat: number
  lng: number
  label?: string
  /** Evening stops get the dark pin, like in the day list. */
  dark?: boolean
}

/** A day's (or a single place's) map: numbered pins in visiting order joined by a dashed line. */
const props = defineProps<{ points: DayPoint[]; center?: { lat: number; lng: number } | null; zoom?: number }>()

const el = ref<HTMLElement>()
let map: L.Map | undefined
let layer: L.LayerGroup | undefined

function draw() {
  if (!map || !layer) return
  layer.clearLayers()
  const path = props.points.map((p): L.LatLngTuple => [p.lat, p.lng])
  if (path.length > 1) L.polyline(path, { color: '#0A7A55', weight: 2.5, opacity: 0.75, dashArray: '2 8', lineCap: 'round' }).addTo(layer)
  for (const p of props.points) {
    const label = p.label ? `<span class="cover-pin-city">${p.label}</span>` : ''
    const html = `<div class="cover-pin"><span class="cover-pin-n" style="${p.dark ? 'background:#0E1F18' : ''}">${p.n}</span>${label}</div>`
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [15, 15] }), interactive: false }).addTo(layer)
  }
  if (path.length > 1) map.fitBounds(L.latLngBounds(path), { paddingTopLeft: [40, 76], paddingBottomRight: [60, 56], maxZoom: 16 })
  else if (path.length === 1) map.setView(path[0]!, props.zoom ?? 15)
  else if (props.center) map.setView([props.center.lat, props.center.lng], 12)
}

onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, attributionControl: false, scrollWheelZoom: false })
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
  }).addTo(map)
  layer = L.layerGroup().addTo(map)
  map.setView([20, 0], 2)
  draw()
})

watch(() => [JSON.stringify(props.points), props.center?.lat], draw)
onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div class="relative h-full w-full bg-[#e9ece9]">
    <div ref="el" class="h-full w-full" />
    <span class="pointer-events-none absolute right-3 bottom-8 z-[400] text-[9px] text-slate-500">© Esri</span>
  </div>
</template>
