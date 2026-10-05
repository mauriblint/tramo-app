<script setup lang="ts">
import { computed } from 'vue'

import type { GenerationStatus, Pin, Stop, Trip, WeatherDay } from '@/api'
import { dayHeadline, daysBetween, fmtDay } from '@/pinMeta'
import { nightsOf } from '@/tripProfile'
import { weatherIcon } from '@/weather'

/** The trip at a glance: each day is one short card (title + one line) that opens the day. */
const props = defineProps<{
  trip: Trip
  stops: Stop[]
  pins: Pin[]
  generation: GenerationStatus | null
  highlightIds: string[]
  weather: Record<string, WeatherDay>
}>()

const today = new Date().toISOString().slice(0, 10)

// Days that belong to each stop: arrival day up to the day before leaving (the last stop keeps its last day).
const sections = computed(() =>
  props.stops.map((s, i) => {
    const all = daysBetween(s.startDate, s.endDate)
    const days = i === props.stops.length - 1 ? all : all.slice(0, -1)
    return { stop: s, n: i + 1, days, next: props.stops[i + 1] ?? null }
  }),
)
const allDays = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))

const byDay = computed(() => {
  const m = new Map<string, Pin[]>()
  for (const p of props.pins) if (p.day) m.set(p.day, [...(m.get(p.day) ?? []), p])
  for (const list of m.values()) list.sort((a, b) => a.position - b.position)
  return m
})

const generating = computed(() => !!props.generation?.running)
const pending = (d: string) => generating.value && !props.generation!.doneDays.includes(d) && !byDay.value.get(d)?.length

function card(d: string, stop: Stop) {
  const pins = byDay.value.get(d) ?? []
  const head = dayHeadline(pins)
  const dayTrip = stop.dayTrips.find((t) => pins.some((p) => p.city?.toLowerCase().includes(t.toLowerCase())))
  return {
    ...head,
    dayTrip: dayTrip ?? null,
    highlighted: pins.some((p) => props.highlightIds.includes(p.id)),
  }
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <template v-for="sec in sections" :key="sec.stop.id">
      <header class="flex items-center gap-3 px-1 pt-4 pb-0.5 first:pt-0">
        <span class="grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 text-sm font-extrabold text-white">{{ sec.n }}</span>
        <div class="min-w-0">
          <h2 class="font-display truncate text-[21px] leading-tight font-bold tracking-tight">{{ sec.stop.city }}</h2>
          <p class="truncate text-[13px] text-slate-500">
            {{ nightsOf(sec.stop) }} {{ nightsOf(sec.stop) === 1 ? 'noche' : 'noches' }}
            <template v-if="sec.stop.lodging"> · {{ sec.stop.lodging }}</template>
            <template v-else-if="sec.stop.dayTrips.length"> · excursión a {{ sec.stop.dayTrips.join(', ') }}</template>
          </p>
        </div>
      </header>

      <RouterLink
        v-for="d in sec.days"
        :key="d"
        :to="`/trips/${trip.id}/days/${d}`"
        class="flex items-center gap-4 rounded-[20px] bg-white py-3.5 md:bg-rocio pr-3 pl-3.5 transition hover:shadow-[0_6px_18px_rgba(14,31,24,0.08)]"
        :class="[d === today ? 'ring-2 ring-sun' : '', card(d, sec.stop).highlighted ? 'ring-2 ring-brand' : '']"
      >
        <div class="w-11 flex-none text-center">
          <div class="text-[11px] font-extrabold text-slate-400 uppercase">{{ fmtDay(d, { weekday: 'short' }) }}</div>
          <div class="font-display text-[26px] leading-none font-bold">{{ Number(d.slice(8)) }}</div>
          <div class="mt-1 text-[11px] text-slate-400">Día {{ allDays.indexOf(d) + 1 }}</div>
        </div>

        <div class="min-w-0 flex-1">
          <template v-if="byDay.get(d)?.length">
            <span
              v-if="card(d, sec.stop).dayTrip"
              class="mb-1 inline-flex h-5 items-center rounded-full bg-sun-soft px-2 text-[11px] font-extrabold text-[#6B4E00]"
            >Excursión a {{ card(d, sec.stop).dayTrip }}</span>
            <p class="line-clamp-2 text-[16px] leading-snug font-extrabold">{{ card(d, sec.stop).title }}</p>
            <p v-if="card(d, sec.stop).summary" class="mt-0.5 truncate text-[14px] text-slate-500">{{ card(d, sec.stop).summary }}</p>
          </template>
          <div v-else-if="pending(d)" class="flex flex-col gap-2 py-1">
            <span class="h-3.5 w-3/4 animate-pulse rounded-full bg-slate-100" />
            <span class="h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
          </div>
          <p v-else class="text-[15px] text-slate-400">Día libre</p>
        </div>

        <div v-if="weather[d]" class="flex-none text-center text-xs text-slate-500" :title="weatherIcon(weather[d]!.code).label">
          <div class="text-base leading-none">{{ weatherIcon(weather[d]!.code).emoji }}</div>
          <div class="mt-1 font-semibold">{{ weather[d]!.max }}°</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A39C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </RouterLink>

      <div v-if="sec.next" class="flex items-center gap-2.5 px-1 pt-2 text-[13px] font-bold text-slate-500">
        <span class="flex-1 border-t-2 border-dashed border-[#CFE3D8]" />
        <template v-if="sec.next.startDate">{{ fmtDay(sec.next.startDate, { weekday: 'short', day: 'numeric' }) }} · </template>a {{ sec.next.city }}
        <span class="flex-1 border-t-2 border-dashed border-[#CFE3D8]" />
      </div>
    </template>
  </div>
</template>
