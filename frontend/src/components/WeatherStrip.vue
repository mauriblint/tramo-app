<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { Weather } from '@/api'
import { loadWeather, weatherIcon } from '@/weather'

const props = defineProps<{ lat: number; lng: number; start: string | null; end: string | null }>()

const weather = ref<Weather | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    weather.value = await loadWeather(props.lat, props.lng, props.start, props.end)
  } catch {
    failed.value = true
  }
})

const dow = (d: string) => new Date(d + 'T00:00').toLocaleDateString('es', { weekday: 'short' }).replace('.', '')
const dom = (d: string) => new Date(d + 'T00:00').getDate()

function rainLabel(w: Weather, rain: number | null) {
  if (rain == null) return ''
  return w.mode === 'forecast' ? (rain >= 20 ? `${rain}%` : '') : rain >= 1 ? `${Math.round(rain)}mm` : ''
}
</script>

<template>
  <div v-if="weather?.days.length" class="rounded-lg bg-slate-50 px-2 py-1.5">
    <div class="mb-1 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
      {{ weather.mode === 'forecast' ? 'Pronóstico' : 'Mismas fechas, año pasado' }}
    </div>
    <div class="flex justify-between gap-1">
      <div
        v-for="d in weather.days"
        :key="d.date"
        class="flex min-w-0 flex-1 flex-col items-center text-center"
        :title="weatherIcon(d.code).label"
      >
        <span class="text-[10px] text-slate-500 capitalize">{{ dow(d.date) }} {{ dom(d.date) }}</span>
        <span class="text-base leading-5">{{ weatherIcon(d.code).emoji }}</span>
        <span class="text-[11px] font-semibold text-slate-700">{{ d.max }}°</span>
        <span class="text-[10px] text-slate-400">{{ d.min }}°</span>
        <span class="h-3 text-[9px] text-sky-600">{{ rainLabel(weather, d.rain) }}</span>
      </div>
    </div>
  </div>
  <div v-else-if="!failed" class="h-[78px] animate-pulse rounded-lg bg-slate-50" />
</template>
