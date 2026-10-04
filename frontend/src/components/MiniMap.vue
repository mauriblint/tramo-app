<script setup lang="ts">
import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ lat: number; lng: number; approx?: boolean; emoji: string }>()

const el = ref<HTMLElement>()
let map: L.Map | undefined
let marker: L.Marker | L.Circle | undefined

function place() {
  if (!map) return
  marker?.remove()
  const at: L.LatLngTuple = [props.lat, props.lng]
  if (props.approx) {
    // Only the city is known: show the area, not a fake exact spot.
    marker = L.circle(at, { radius: 2500, color: '#6366f1', weight: 1, fillOpacity: 0.12 }).addTo(map)
    map.setView(at, 11)
  } else {
    const icon = L.divIcon({ className: '', html: `<div class="pin-marker"><span>${props.emoji}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] })
    marker = L.marker(at, { icon, interactive: false }).addTo(map)
    map.setView(at, 15)
  }
}

onMounted(() => {
  map = L.map(el.value!, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
  })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
  place()
})

watch(() => [props.lat, props.lng, props.approx], place)
onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="el" class="h-full w-full" />
    <span class="absolute right-1 bottom-0.5 z-[400] rounded bg-white/75 px-1 text-[9px] text-slate-500">© OpenStreetMap</span>
  </div>
</template>
