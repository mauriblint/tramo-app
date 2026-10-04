<script setup lang="ts">
import { computed } from 'vue'

import type { Stop, Trip } from '@/api'
import { daysBetween, fmtDay } from '@/pinMeta'
import { nightsOf } from '@/tripProfile'

const props = defineProps<{ trip: Trip; stops: Stop[]; busy: boolean; compact?: boolean }>()
defineEmits<{ generate: [] }>()

const tripNights = computed(() => Math.max(0, daysBetween(props.trip.startDate, props.trip.endDate).length - 1))
const routeNights = computed(() => props.stops.reduce((n, s) => n + nightsOf(s), 0))
const ok = computed(() => routeNights.value === tripNights.value)
const short = (d: string | null) => (d ? fmtDay(d, { day: 'numeric', month: 'short' }) : '?')

// Segment colors for the proportional bar, from the brand greens.
const SEG = ['#0A7A55', '#3FB98A', '#7EE2B8', '#BFE9D5', '#E3F5EC']
const SEG_TEXT = ['#FFFFFF', '#063D2A', '#063D2A', '#063D2A', '#063D2A']
</script>

<template>
  <article class="rounded-[22px] bg-white p-4 text-noche shadow-[0_12px_32px_rgba(14,31,24,0.12)]">
    <div class="flex items-baseline justify-between">
      <h3 class="font-display text-lg font-bold">Ruta</h3>
      <span class="text-xs font-bold" :class="ok ? 'text-brand' : 'text-amber-700'">{{ routeNights }} / {{ tripNights }} noches</span>
    </div>

    <div class="mt-3 flex h-9 gap-0.5 overflow-hidden rounded-xl">
      <span
        v-for="(s, i) in stops"
        :key="s.id"
        class="flex min-w-0 items-center overflow-hidden px-2 text-xs font-bold whitespace-nowrap"
        :style="{ flex: Math.max(nightsOf(s), 0.6), background: SEG[i % SEG.length], color: SEG_TEXT[i % SEG.length] }"
      >
        {{ s.city }}
      </span>
    </div>

    <ol v-if="!compact" class="mt-4 flex flex-col gap-3 border-l-2 border-brand-soft pl-4">
      <li v-for="s in stops" :key="s.id" class="flex justify-between gap-2">
        <span class="min-w-0">
          <span class="block font-bold">{{ s.city }}</span>
          <span class="block text-xs text-slate-500">{{ short(s.startDate) }} → {{ short(s.endDate) }}</span>
          <span v-for="d in s.dayTrips" :key="d" class="block text-xs font-semibold text-brand">↪ Excursión a {{ d }}</span>
        </span>
        <span class="text-sm font-bold">{{ nightsOf(s) }}n</span>
      </li>
    </ol>
    <p v-else class="mt-2 truncate text-xs text-slate-500">
      {{ stops.map((s) => `${s.city} ${nightsOf(s)}n`).join(' → ') }}
    </p>

    <button class="btn-primary mt-4 h-12 w-full text-[15px]" :disabled="busy || !ok" @click="$emit('generate')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></svg>
      Crear itinerario día por día
    </button>
    <p v-if="!ok" class="mt-2 text-center text-xs text-amber-700">Las noches no coinciden con las fechas: pedile al chat que lo ajuste.</p>
  </article>
</template>
