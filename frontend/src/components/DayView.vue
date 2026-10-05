<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { api, type Pin, type Stop, type TimeOfDay, type Trip, type WeatherDay } from '@/api'
import DayMap, { type DayPoint } from '@/components/DayMap.vue'
import { geocodeCity } from '@/geo'
import { TIMES, TIME_META, dayHeadline, daysBetween, fmtDay, stopForDay } from '@/pinMeta'
import { weatherIcon } from '@/weather'

/** One day, focused: its map, then morning / afternoon / evening as short cards that open each activity. */
const props = defineProps<{ trip: Trip; stops: Stop[]; pins: Pin[]; day: string; weather: Record<string, WeatherDay> }>()
const emit = defineEmits<{ located: [Pin, Pin]; add: [string] }>()

const allDays = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))
const index = computed(() => allDays.value.indexOf(props.day))
const prev = computed(() => allDays.value[index.value - 1] ?? null)
const next = computed(() => allDays.value[index.value + 1] ?? null)

const stop = computed(() => stopForDay(props.stops, props.day))
const dayPins = computed(() => props.pins.filter((p) => p.day === props.day).sort((a, b) => a.position - b.position))
const head = computed(() => dayHeadline(dayPins.value))
const w = computed(() => props.weather[props.day])

/** Transfers read as a line between cards; everything else is a numbered stop of the day. */
const isLeg = (p: Pin) => p.type === 'route'
const numbered = computed(() => dayPins.value.filter((p) => !isLeg(p)))
const numberOf = (p: Pin) => numbered.value.indexOf(p) + 1

const groups = computed(() => {
  const slots: (TimeOfDay | null)[] = [...TIMES, null]
  return slots
    .map((t) => ({ key: t ?? 'none', label: t ? TIME_META[t].label : 'Sin horario', pins: dayPins.value.filter((p) => p.timeOfDay === t) }))
    .filter((g) => g.pins.length)
})

const dayTrip = computed(() => stop.value?.dayTrips.find((t) => dayPins.value.some((p) => p.city?.toLowerCase().includes(t.toLowerCase()))) ?? null)

const facts = computed(() =>
  [
    w.value ? `${weatherIcon(w.value.code).label}, ${w.value.max}° / ${w.value.min}°` : null,
    numbered.value.length ? `${numbered.value.length} ${numbered.value.length === 1 ? 'lugar' : 'lugares'}` : null,
    dayTrip.value ? `Excursión a ${dayTrip.value}` : null,
  ].filter((x): x is string => !!x),
)

// ---- map: pins are geocoded lazily, one at a time (the geocoder is rate-limited)
const center = ref<{ lat: number; lng: number } | null>(null)
const points = computed<DayPoint[]>(() =>
  numbered.value
    .filter((p) => p.lat != null && p.lng != null && p.geoStatus === 'ok')
    .map((p) => ({ n: numberOf(p), lat: p.lat!, lng: p.lng!, dark: p.timeOfDay === 'evening' })),
)

let locating = false
async function locateAll() {
  if (locating) return
  locating = true
  try {
    for (const p of numbered.value) {
      if (p.geoStatus !== null || p.day !== props.day) continue
      try {
        emit('located', p, await api.locatePin(p.tripId, p.id))
      } catch {
        // the day still works without its map
      }
    }
  } finally {
    locating = false
  }
}

async function loadCenter() {
  const city = dayTrip.value ?? stop.value?.city
  center.value = city ? await geocodeCity(city, props.trip.destination) : null
}

onMounted(() => {
  locateAll()
  loadCenter()
})
watch(
  () => props.day,
  () => {
    locateAll()
    loadCenter()
  },
)

function firstSentence(s: string) {
  const m = s.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : s).trim()
}
</script>

<template>
  <div>
    <!-- Back to the trip + day stepper -->
    <div class="flex items-center gap-2.5 px-3 pt-3 pb-3 md:px-0 md:pt-0">
      <RouterLink :to="`/trips/${trip.id}`" class="flex h-11 min-w-0 items-center gap-1 rounded-full bg-white pr-4 pl-2 text-sm font-extrabold md:bg-rocio">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        <span class="truncate">{{ trip.name }}</span>
      </RouterLink>
      <span class="flex-1" />
      <div class="flex h-11 flex-none items-center rounded-full bg-white md:bg-rocio">
        <RouterLink
          v-if="prev"
          :to="`/trips/${trip.id}/days/${prev}`"
          replace
          aria-label="Día anterior"
          class="grid h-11 w-11 place-items-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </RouterLink>
        <span v-else class="w-11" />
        <span class="text-sm font-extrabold tabular-nums">Día {{ index + 1 }} de {{ allDays.length }}</span>
        <RouterLink
          v-if="next"
          :to="`/trips/${trip.id}/days/${next}`"
          replace
          aria-label="Día siguiente"
          class="grid h-11 w-11 place-items-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </RouterLink>
        <span v-else class="w-11" />
      </div>
    </div>

    <div class="relative h-[240px] md:h-[260px] md:overflow-hidden md:rounded-t-[28px]">
      <DayMap :points="points" :center="center" />
    </div>

    <section class="relative z-[600] -mt-7 rounded-t-[28px] bg-rocio px-4 pt-6 pb-6 md:rounded-[28px] md:px-5">
      <div class="flex flex-col gap-2 px-1 pb-2">
        <span class="text-[13px] font-extrabold tracking-wide text-brand uppercase">
          {{ fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' }) }}<template v-if="stop"> · {{ stop.city }}</template>
        </span>
        <h1 class="font-display text-[30px] leading-[1.05] font-bold tracking-tight md:text-[34px]">{{ head.title || 'Día libre' }}</h1>
        <p v-if="facts.length" class="flex flex-wrap gap-x-2 gap-y-1 text-[14px] text-slate-500">
          <template v-for="(f, i) in facts" :key="f">
            <span v-if="i" class="text-slate-300">·</span>
            <span>{{ f }}</span>
          </template>
        </p>
      </div>

      <div v-for="g in groups" :key="g.key" class="mt-4 flex flex-col gap-2">
        <h2 class="px-1 text-xs font-extrabold tracking-[0.07em] text-slate-400 uppercase">{{ g.label }}</h2>
        <template v-for="p in g.pins" :key="p.id">
          <div v-if="isLeg(p)" class="flex items-center gap-3 pl-7 text-[13px] font-bold text-slate-500">
            <span class="h-5 w-0.5 bg-[#CFE3D8]" />
            {{ p.title }}
          </div>
          <RouterLink
            v-else
            :to="`/trips/${trip.id}/pins/${p.id}`"
            class="flex items-center gap-3.5 rounded-[20px] bg-white py-3.5 pr-3 pl-3.5 transition hover:shadow-[0_6px_18px_rgba(14,31,24,0.08)]"
            :class="p.status === 'done' ? 'opacity-60' : ''"
          >
            <span
              class="grid h-[30px] w-[30px] flex-none place-items-center rounded-full text-[13px] font-extrabold text-white"
              :class="p.timeOfDay === 'evening' ? 'bg-noche' : 'bg-brand'"
            >
              <svg v-if="p.status === 'done'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="Hecho"><path d="M5 12l5 5 9-10" /></svg>
              <template v-else>{{ numberOf(p) }}</template>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[16px] leading-snug font-extrabold" :class="p.status === 'done' ? 'line-through decoration-slate-400' : ''">{{ p.title }}</span>
              <span v-if="p.body" class="mt-0.5 block truncate text-[14px] text-slate-500">{{ firstSentence(p.body) }}</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A39C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </RouterLink>
        </template>
      </div>

      <p v-if="!dayPins.length" class="mt-4 rounded-[20px] bg-white px-4 py-5 text-center text-[15px] text-slate-500">
        Nada planeado todavía. Pedile ideas al copiloto o agregá algo vos.
      </p>

      <div v-if="stop?.lodging" class="mt-5 flex items-center gap-2.5 rounded-[20px] bg-brand-soft px-4 py-3.5 text-[14px] text-[#3F5A4D]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M3 19V6M3 14h18v5M21 14a3 3 0 0 0-3-3h-7v3" /><circle cx="7" cy="11" r="1.6" /></svg>
        <span>Dormís en <b class="text-brand-dark">{{ stop.lodging }}</b></span>
      </div>

      <button
        class="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed border-[#9FC9B4] text-[15px] font-bold text-brand-dark hover:bg-white"
        @click="emit('add', day)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Agregar algo a este día
      </button>
    </section>
  </div>
</template>
