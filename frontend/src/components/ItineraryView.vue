<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { api, type GenerationStatus, type Pin, type Stop, type Trip, type Weather } from '@/api'
import { STATUS_META, TIME_META, TYPE_META, daysBetween, fmtDay, mapsUrl } from '@/pinMeta'
import { loadWeather, weatherIcon } from '@/weather'

const props = defineProps<{ trip: Trip; stops: Stop[]; pins: Pin[]; highlightIds: string[]; generation: GenerationStatus | null }>()
const emit = defineEmits<{ edit: [Pin]; add: [string]; reordered: [Pin[]] }>()

const days = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))

/** The stop you wake up in on a given day (travel days belong to the arriving stop). */
function stopFor(day: string): Stop | undefined {
  return (
    [...props.stops].reverse().find((s) => s.startDate && s.startDate <= day && (!s.endDate || day <= s.endDate)) ??
    props.stops.find((s) => !s.startDate)
  )
}

// Group consecutive days by stop, so each stop reads as a chapter of the trip.
const sections = computed(() => {
  const out: { stop: Stop | undefined; days: string[] }[] = []
  for (const d of days.value) {
    const s = stopFor(d)
    const last = out.at(-1)
    if (last && last.stop?.id === s?.id) last.days.push(d)
    else out.push({ stop: s, days: [d] })
  }
  return out
})

const byDay = computed(() => {
  const m = new Map<string, Pin[]>()
  for (const p of props.pins) {
    if (!p.day) continue
    m.set(p.day, [...(m.get(p.day) ?? []), p])
  }
  for (const list of m.values()) list.sort((a, b) => a.position - b.position)
  return m
})

const outside = computed(() => props.pins.filter((p) => p.day && !days.value.includes(p.day)))

const nights = (s: Stop) =>
  s.startDate && s.endDate ? Math.round((Date.parse(s.endDate) - Date.parse(s.startDate)) / 86_400_000) : null

// ---- weather per stop (one request per stop)
const weatherByDay = ref<Record<string, Weather['days'][number]>>({})
const weatherMode = ref<Weather['mode'] | null>(null)

async function loadStopsWeather() {
  for (const s of props.stops) {
    if (!s.startDate) continue
    try {
      const geo = await api.geo(`${s.city}${props.trip.destination ? `, ${props.trip.destination.split(/[—-]/)[0]}` : ''}`)
      if (!geo) continue
      const w = await loadWeather(geo.lat, geo.lng, s.startDate, s.endDate)
      weatherMode.value = w.mode
      for (const d of w.days) weatherByDay.value = { ...weatherByDay.value, [d.date]: d }
    } catch {
      // Weather is a nice-to-have.
    }
  }
}
onMounted(loadStopsWeather)
watch(() => props.stops.map((s) => `${s.city}${s.startDate}${s.endDate}`).join(), loadStopsWeather)

// ---- drag & drop between / within days
const dragId = ref<string | null>(null)
const overDay = ref<string | null>(null)

async function drop(day: string, beforeId: string | null) {
  const id = dragId.value
  dragId.value = null
  overDay.value = null
  if (!id || id === beforeId) return
  const ids = (byDay.value.get(day) ?? []).map((p) => p.id).filter((x) => x !== id)
  const at = beforeId ? ids.indexOf(beforeId) : -1
  ids.splice(at < 0 ? ids.length : at, 0, id)
  emit('reordered', await api.reorderDay(props.trip.id, day, ids))
}

const generating = computed(() => !!props.generation?.running)
/** A day still being written by the generator: no items yet and not reported done. */
const pendingDay = (d: string) => generating.value && !props.generation!.doneDays.includes(d) && !byDay.value.get(d)?.length

const isToday = (d: string) => d === new Date().toISOString().slice(0, 10)
</script>

<template>
  <div class="space-y-8 p-4 md:p-6">
    <!-- Generation progress -->
    <div v-if="generating" class="sticky top-0 z-10 -mx-4 -mt-4 border-b border-indigo-100 bg-indigo-50/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mt-6 md:px-6">
      <div class="flex items-center gap-2 text-sm font-medium text-indigo-800">
        <span class="animate-pulse">✨</span>
        Armando el itinerario día por día…
        <span class="ml-auto tabular-nums">{{ generation!.doneDays.length }} / {{ generation!.totalDays }}</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100">
        <div
          class="h-full rounded-full bg-indigo-500 transition-all duration-500"
          :style="{ width: `${(100 * generation!.doneDays.length) / Math.max(1, generation!.totalDays)}%` }"
        />
      </div>
    </div>

    <!-- Route overview -->
    <div v-if="stops.length" class="flex flex-wrap items-center gap-1.5 text-sm">
      <template v-for="(s, i) in stops" :key="s.id">
        <span v-if="i" class="text-slate-300">→</span>
        <span class="rounded-full bg-white px-3 py-1 font-medium shadow-sm ring-1 ring-slate-200">
          {{ s.city }}
          <span v-if="nights(s) != null" class="font-normal text-slate-400">· {{ nights(s) }}n</span>
          <span v-for="t in s.dayTrips" :key="t" class="font-normal text-indigo-500"> ↪ {{ t }}</span>
        </span>
      </template>
      <span v-if="weatherMode === 'last-year'" class="ml-auto text-xs text-slate-400">Clima: mismas fechas del año pasado</span>
    </div>

    <section v-for="(sec, si) in sections" :key="si">
      <header class="mb-3 flex items-baseline gap-2">
        <h2 class="font-display text-2xl font-bold">{{ sec.stop?.city ?? 'Sin parada' }}</h2>
        <span class="text-sm text-slate-400">
          {{ fmtDay(sec.days[0]!, { day: 'numeric', month: 'short' }) }}
          <template v-if="sec.days.length > 1"> – {{ fmtDay(sec.days.at(-1)!, { day: 'numeric', month: 'short' }) }}</template>
        </span>
        <span v-if="sec.stop?.lodging" class="truncate text-sm text-slate-500">· 🛏️ {{ sec.stop.lodging }}</span>
      </header>

      <div class="grid gap-3 xl:grid-cols-2">
        <article
          v-for="d in sec.days"
          :key="d"
          class="rounded-2xl border bg-white p-3 shadow-sm transition"
          :class="[overDay === d ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200', isToday(d) ? 'ring-2 ring-amber-300' : '']"
          @dragover.prevent="overDay = d"
          @dragleave="overDay === d && (overDay = null)"
          @drop.prevent="drop(d, null)"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="rounded-md bg-slate-900 px-1.5 py-0.5 text-xs font-bold text-white">Día {{ days.indexOf(d) + 1 }}</span>
            <span class="text-sm font-medium capitalize">{{ fmtDay(d) }}</span>
            <span v-if="isToday(d)" class="chip bg-amber-100 text-amber-800">Hoy</span>
            <span class="flex-1" />
            <span v-if="weatherByDay[d]" class="text-xs text-slate-500" :title="weatherIcon(weatherByDay[d]!.code).label">
              {{ weatherIcon(weatherByDay[d]!.code).emoji }} {{ weatherByDay[d]!.max }}° / {{ weatherByDay[d]!.min }}°
            </span>
          </div>

          <ul class="space-y-1">
            <li
              v-for="p in byDay.get(d) ?? []"
              :key="p.id"
              draggable="true"
              class="group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 animate-[fadein_.4s_ease-out]"
              :class="[highlightIds.includes(p.id) ? 'bg-indigo-50' : '', dragId === p.id ? 'opacity-40' : '']"
              @dragstart="dragId = p.id"
              @dragend="dragId = null"
              @drop.prevent.stop="drop(d, p.id)"
              @click="emit('edit', p)"
            >
              <span class="w-5 shrink-0 pt-0.5 text-center text-xs" :title="p.timeOfDay ? TIME_META[p.timeOfDay].label : ''">
                {{ p.timeOfDay ? TIME_META[p.timeOfDay].emoji : '·' }}
              </span>
              <span class="shrink-0">{{ TYPE_META[p.type].emoji }}</span>
              <div class="min-w-0 flex-1">
                <div class="text-sm leading-5 font-medium" :class="p.status === 'done' ? 'text-slate-400 line-through' : ''">
                  {{ p.title }}
                </div>
                <div v-if="p.body" class="line-clamp-1 text-xs text-slate-500">{{ p.body.replace(/[#*_>`]/g, '') }}</div>
              </div>
              <span v-if="p.status === 'must' || p.status === 'want'" class="chip shrink-0" :class="STATUS_META[p.status].cls">
                {{ STATUS_META[p.status].emoji }}
              </span>
              <a
                v-if="mapsUrl(p)"
                :href="mapsUrl(p)!"
                target="_blank"
                rel="noopener"
                class="shrink-0 pt-0.5 text-xs text-slate-300 group-hover:text-indigo-600"
                title="Abrir en Google Maps"
                @click.stop
              >
                Maps ↗
              </a>
            </li>
            <template v-if="pendingDay(d)">
              <li v-for="n in 3" :key="n" class="flex items-center gap-2 px-2 py-2">
                <span class="h-3 w-3 animate-pulse rounded-full bg-slate-100" />
                <span class="h-3 animate-pulse rounded bg-slate-100" :style="{ width: `${40 + n * 15}%` }" />
              </li>
            </template>
            <li v-else-if="!(byDay.get(d)?.length)" class="px-2 py-1.5 text-sm text-slate-400">Día libre</li>
          </ul>

          <button class="mt-1 px-2 text-xs text-slate-400 hover:text-indigo-600" @click="emit('add', d)">+ Agregar</button>
        </article>
      </div>
    </section>

    <section v-if="outside.length">
      <h2 class="mb-2 text-sm font-semibold text-slate-500">Fuera de las fechas del viaje</h2>
      <ul class="space-y-1">
        <li v-for="p in outside" :key="p.id" class="cursor-pointer text-sm hover:underline" @click="emit('edit', p)">
          {{ p.day }} · {{ p.title }}
        </li>
      </ul>
    </section>
  </div>
</template>
