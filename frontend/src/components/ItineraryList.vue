<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Booking, GenerationStatus, Pin, Stop, Trip, WeatherDay } from '@/api'
import { KIND_META, chipLabel, dayEvents, hotelForNight } from '@/bookings'
import { dayHeadline, daysBetween, fmtDay, localToday, stopForDay } from '@/pinMeta'
import { nightsOf } from '@/tripProfile'
import { weatherIcon } from '@/weather'

/** The trip at a glance: each day is one short card (title + one line) that opens the day. */
const props = defineProps<{
  trip: Trip
  stops: Stop[]
  pins: Pin[]
  bookings: Booking[]
  generation: GenerationStatus | null
  highlightIds: string[]
  weather: Record<string, WeatherDay>
}>()

const today = localToday()

const allDays = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))

type Section = { key: string; stop: Stop | null; n: number; days: string[]; next: Stop | null; past: boolean }
// Every day of the trip, grouped by where you sleep; runs of days without a stop are "Por definir".
const sections = computed<Section[]>(() => {
  const out: Section[] = []
  let n = 0
  for (const d of allDays.value) {
    const stop = stopForDay(props.stops, d, props.trip.endDate)
    // A trip that already started: days before today with no city and nothing planned are history, folded away.
    const past = !stop && d < today && !byDay.value.get(d)?.length
    const last = out.at(-1)
    if (last && (last.stop?.id ?? null) === (stop?.id ?? null) && last.past === past) last.days.push(d)
    else out.push({ key: stop?.id ?? `gap-${d}`, stop, n: stop ? ++n : 0, days: [d], next: null, past })
  }
  // The transfer line only joins two stops that are back to back.
  out.forEach((sec, i) => {
    const nxt = out[i + 1]
    sec.next = sec.stop && nxt?.stop && nxt.stop.startDate === sec.stop.endDate ? nxt.stop : null
  })
  return out
})
const tentative = computed(() => props.trip.datesTentative)
const showPast = ref(false)
const visibleDays = (sec: Section) => (sec.past && !showPast.value ? [] : sec.days)

const byDay = computed(() => {
  const m = new Map<string, Pin[]>()
  for (const p of props.pins) if (p.day) m.set(p.day, [...(m.get(p.day) ?? []), p])
  for (const list of m.values()) list.sort((a, b) => a.position - b.position)
  return m
})

const generating = computed(() => !!props.generation?.running)
// Only the days being written wait for content (a day can already show what it had while more arrives).
const pending = (d: string) => generating.value && props.generation!.days.includes(d) && !props.generation!.doneDays.includes(d)

/** The transport you booked to get to the next city (on the day you leave), if any. */
function transferTo(next: Stop) {
  if (!next.startDate) return null
  return props.bookings.find((b) => b.kind !== 'hotel' && b.departDate === next.startDate) ?? null
}

function card(d: string, stop: Stop | null) {
  const pins = byDay.value.get(d) ?? []
  const head = dayHeadline(pins)
  const dayTrip = stop?.dayTrips.find((t) => pins.some((p) => p.city?.toLowerCase().includes(t.toLowerCase())))
  return {
    ...head,
    dayTrip: dayTrip ?? null,
    events: dayEvents(props.bookings, d),
    highlighted: pins.some((p) => props.highlightIds.includes(p.id)),
  }
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <template v-for="sec in sections" :key="sec.key">
      <header v-if="sec.stop" class="flex items-center gap-3 px-1 pt-4 pb-0.5 first:pt-0">
        <span class="grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 text-sm font-extrabold text-white">{{ sec.n }}</span>
        <div class="min-w-0">
          <h2 class="font-display truncate text-[21px] leading-tight font-bold tracking-tight">{{ sec.stop.city }}</h2>
          <p class="truncate text-[13px] text-slate-500">
            {{ nightsOf(sec.stop) }} {{ nightsOf(sec.stop) === 1 ? 'noche' : 'noches' }}
            <template v-if="sec.stop.startDate && hotelForNight(bookings, sec.stop.startDate)"> · {{ hotelForNight(bookings, sec.stop.startDate)!.hotelName }}</template>
            <template v-else-if="sec.stop.lodging"> · {{ sec.stop.lodging }}</template>
            <template v-else-if="sec.stop.dayTrips.length"> · excursión a {{ sec.stop.dayTrips.join(', ') }}</template>
          </p>
        </div>
      </header>
      <button
        v-else-if="sec.past"
        type="button"
        class="flex items-center gap-3 rounded-[18px] px-1 pt-4 pb-0.5 text-left first:pt-0"
        :aria-expanded="showPast"
        @click="showPast = !showPast"
      >
        <span class="grid h-8 w-8 place-items-center rounded-full bg-rocio text-slate-500 md:bg-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" :class="showPast ? 'rotate-90' : ''" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </span>
        <span class="min-w-0">
          <span class="font-display block truncate text-[19px] leading-tight font-bold tracking-tight text-slate-500">Días anteriores</span>
          <span class="block truncate text-[13px] text-slate-500">{{ sec.days.length }} {{ sec.days.length === 1 ? 'día' : 'días' }} que ya pasaron</span>
        </span>
      </button>
      <header v-else class="flex items-center gap-3 px-1 pt-4 pb-0.5 first:pt-0">
        <span class="grid h-8 w-8 place-items-center rounded-full border-2 border-dashed border-[#B9C9C1] text-sm font-extrabold text-slate-400">?</span>
        <div class="min-w-0">
          <h2 class="font-display truncate text-[21px] leading-tight font-bold tracking-tight text-slate-500">Por definir</h2>
          <p class="truncate text-[13px] text-slate-500">{{ sec.days.length }} {{ sec.days.length === 1 ? 'día' : 'días' }} sin ciudad todavía · elegila al armar un día</p>
        </div>
      </header>

      <RouterLink
        v-for="d in visibleDays(sec)"
        :key="d"
        :to="`/trips/${trip.id}/days/${d}`"
        class="flex items-center gap-4 rounded-[20px] bg-white py-3.5 md:bg-rocio pr-3 pl-3.5 transition hover:shadow-[0_6px_18px_rgba(14,31,24,0.08)]"
        :class="[d === today ? 'ring-2 ring-sun' : '', card(d, sec.stop).highlighted ? 'ring-2 ring-brand' : '']"
      >
        <div v-if="tentative" class="w-11 flex-none text-center">
          <div class="text-[11px] font-extrabold text-slate-400 uppercase">Día</div>
          <div class="font-display text-[26px] leading-none font-bold">{{ allDays.indexOf(d) + 1 }}</div>
        </div>
        <div v-else class="w-11 flex-none text-center">
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
            <span v-if="pending(d)" class="mt-1 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-brand-dark">
              <span class="h-2 w-2 animate-pulse rounded-full bg-brand" />Sumando planes…
            </span>
          </template>
          <div v-else-if="pending(d)" class="flex flex-col gap-2 py-0.5" aria-busy="true">
            <span class="text-[13px] font-extrabold text-brand-dark">Armando el día…</span>
            <span class="h-3.5 w-3/4 animate-pulse rounded-full bg-[#D3E5DA]" />
            <span class="h-3 w-1/2 animate-pulse rounded-full bg-[#D3E5DA]" />
          </div>
          <p v-else class="text-[15px] text-slate-400">Día libre</p>
          <div v-if="card(d, sec.stop).events.length" class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="e in card(d, sec.stop).events"
              :key="e.booking.id + e.type"
              class="inline-flex h-6 items-center gap-1 rounded-full bg-brand-soft pr-2.5 pl-2 text-xs font-bold text-brand-dark"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[e.booking.kind].icon" />
              {{ chipLabel(e) }}
            </span>
          </div>
        </div>

        <div v-if="weather[d]" class="flex-none text-center text-xs text-slate-500" :title="weatherIcon(weather[d]!.code).label">
          <div class="text-base leading-none">{{ weatherIcon(weather[d]!.code).emoji }}</div>
          <div class="mt-1 font-semibold">{{ weather[d]!.max }}°</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A39C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </RouterLink>

      <div v-if="sec.next" class="flex items-center gap-2.5 px-1 pt-2 text-[13px] font-bold text-slate-500">
        <span class="flex-1 border-t-2 border-dashed border-[#CFE3D8]" />
        <svg v-if="transferTo(sec.next)" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[transferTo(sec.next)!.kind].icon" />
        <template v-if="sec.next.startDate && !tentative">{{ fmtDay(sec.next.startDate, { weekday: 'short', day: 'numeric' }) }} · </template>
        <template v-if="transferTo(sec.next)">{{ `${KIND_META[transferTo(sec.next)!.kind].label} ${transferTo(sec.next)!.departTime ?? ''}`.trim() }} → {{ sec.next.city }}</template>
        <template v-else>a {{ sec.next.city }}</template>
        <span class="flex-1 border-t-2 border-dashed border-[#CFE3D8]" />
      </div>
    </template>
  </div>
</template>
