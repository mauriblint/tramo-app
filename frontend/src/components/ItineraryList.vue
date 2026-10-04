<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { GenerationStatus, Pin, Stop, Trip, Weather } from '@/api'
import { geocodeCity } from '@/geo'
import { TIME_META, daysBetween, fmtDay } from '@/pinMeta'
import { nightsOf } from '@/tripProfile'
import { loadWeather, weatherIcon } from '@/weather'

/** Compact day-by-day: one stop after another, each day as a short list of titles. */
const props = defineProps<{ trip: Trip; stops: Stop[]; pins: Pin[]; generation: GenerationStatus | null; highlightIds: string[] }>()
const emit = defineEmits<{ edit: [Pin] }>()

const today = new Date().toISOString().slice(0, 10)

// Days that belong to each stop: arrival day up to the day before leaving (the last stop keeps its last day).
const sections = computed(() =>
  props.stops.map((s, i) => {
    const all = daysBetween(s.startDate, s.endDate)
    const days = i === props.stops.length - 1 ? all : all.slice(0, -1)
    return { stop: s, n: i + 1, days }
  }),
)
const dayNumber = computed(() => {
  const all = daysBetween(props.trip.startDate, props.trip.endDate)
  return (d: string) => all.indexOf(d) + 1
})

const byDay = computed(() => {
  const m = new Map<string, Pin[]>()
  for (const p of props.pins) if (p.day) m.set(p.day, [...(m.get(p.day) ?? []), p])
  for (const list of m.values()) list.sort((a, b) => a.position - b.position)
  return m
})

const generating = computed(() => !!props.generation?.running)
const pending = (d: string) => generating.value && !props.generation!.doneDays.includes(d) && !byDay.value.get(d)?.length

// Weather: one request per stop.
const weather = ref<Record<string, Weather['days'][number]>>({})
async function loadAllWeather() {
  for (const s of props.stops) {
    if (!s.startDate) continue
    try {
      const geo = await geocodeCity(s.city, props.trip.destination)
      if (!geo) continue
      const w = await loadWeather(geo.lat, geo.lng, s.startDate, s.endDate)
      for (const d of w.days) weather.value = { ...weather.value, [d.date]: d }
    } catch {
      // nice-to-have
    }
  }
}
onMounted(loadAllWeather)
watch(() => props.stops.map((s) => `${s.city}${s.startDate}`).join(), loadAllWeather)
</script>

<template>
  <div class="flex flex-col gap-7">
    <section v-for="sec in sections" :key="sec.stop.id">
      <header class="mb-3 flex items-center gap-3">
        <span class="grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 text-sm font-extrabold text-white">{{ sec.n }}</span>
        <div class="min-w-0">
          <h2 class="font-display truncate text-xl leading-tight font-bold">{{ sec.stop.city }}</h2>
          <p class="truncate text-[13px] text-slate-500">
            {{ nightsOf(sec.stop) }} {{ nightsOf(sec.stop) === 1 ? 'noche' : 'noches' }}
            <template v-if="sec.stop.dayTrips.length"> · excursión a {{ sec.stop.dayTrips.join(', ') }}</template>
          </p>
        </div>
      </header>

      <ol class="flex flex-col gap-2">
        <li
          v-for="d in sec.days"
          :key="d"
          class="flex gap-4 rounded-2xl bg-white px-4 py-3.5"
          :class="d === today ? 'ring-2 ring-sun' : ''"
        >
          <div class="w-11 flex-none text-center">
            <div class="text-[11px] font-bold text-slate-400 uppercase">{{ fmtDay(d, { weekday: 'short' }) }}</div>
            <div class="font-display text-2xl leading-none font-bold">{{ Number(d.slice(8)) }}</div>
            <div class="mt-1 text-[11px] text-slate-400">Día {{ dayNumber(d) }}</div>
          </div>

          <div class="min-w-0 flex-1">
            <ul v-if="byDay.get(d)?.length" class="flex flex-col gap-1.5">
              <li
                v-for="p in byDay.get(d)"
                :key="p.id"
                class="flex cursor-pointer items-baseline gap-2 animate-[fadein_.4s_ease-out]"
                :class="highlightIds.includes(p.id) ? 'text-brand' : ''"
                @click="emit('edit', p)"
              >
                <span class="w-4 flex-none text-center text-xs" :title="p.timeOfDay ? TIME_META[p.timeOfDay].label : ''">
                  {{ p.timeOfDay ? TIME_META[p.timeOfDay].emoji : '·' }}
                </span>
                <span class="truncate text-[15px] leading-snug" :class="p.type === 'route' ? 'text-slate-500' : 'font-medium'">{{ p.title }}</span>
              </li>
            </ul>
            <div v-else-if="pending(d)" class="flex flex-col gap-2 pt-1">
              <span class="h-3 w-3/4 animate-pulse rounded-full bg-slate-100" />
              <span class="h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
              <span class="h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
            </div>
            <p v-else class="pt-1 text-sm text-slate-400">Día libre</p>
          </div>

          <div v-if="weather[d]" class="flex-none text-right text-xs text-slate-500" :title="weatherIcon(weather[d]!.code).label">
            <div class="text-base leading-none">{{ weatherIcon(weather[d]!.code).emoji }}</div>
            <div class="mt-1">{{ weather[d]!.max }}°</div>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
