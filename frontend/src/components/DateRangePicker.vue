<script setup lang="ts">
import { computed, ref } from 'vue'

import { fmtDay, localToday } from '@/pinMeta'

/**
 * Trip dates: tap the first day, then the last. Two months side by side on desktop, one at a time
 * in a bottom sheet on the phone. `keepDays` offers "the same length" once the first day is picked.
 */
const props = defineProps<{ start: string | null; end: string | null; keepDays?: number | null; busy?: boolean }>()
const emit = defineEmits<{ save: [string, string]; close: [] }>()

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

const from = ref<string | null>(props.start)
const to = ref<string | null>(props.end)
const hover = ref<string | null>(null)

// First month shown: the one of the current start (or this month).
const first = (props.start ?? localToday()).slice(0, 7)
const cursor = ref({ y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) - 1 })
function move(n: number) {
  const t = cursor.value.y * 12 + cursor.value.m + n
  cursor.value = { y: Math.floor(t / 12), m: t % 12 }
}

const WEEK = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']
const today = localToday()

const months = computed(() =>
  [0, 1].map((k) => {
    const t = cursor.value.y * 12 + cursor.value.m + k
    const y = Math.floor(t / 12)
    const m = t % 12
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7 // Monday first
    const name = new Date(Date.UTC(y, m, 1)).toLocaleDateString('es', { month: 'long', timeZone: 'UTC' })
    const label = `${name[0]!.toUpperCase()}${name.slice(1)} ${y}`
    return { key: `${y}-${m}`, label, lead, days: Array.from({ length: count }, (_, i) => iso(y, m, i + 1)) }
  }),
)

/** While choosing the last day, the range follows the pointer. */
const rangeEnd = computed(() => to.value ?? (from.value && hover.value && hover.value >= from.value ? hover.value : null))
function cellClass(d: string) {
  const a = from.value
  const b = rangeEnd.value
  const edge = d === a || d === b
  const inside = a && b && d > a && d < b
  return [
    'relative grid h-11 place-items-center text-[15px] tabular-nums transition-colors',
    edge ? 'bg-brand font-extrabold text-white rounded-full z-[1]' : inside ? 'bg-brand-soft font-semibold text-brand-dark' : 'rounded-full hover:bg-rocio',
    d === today && !edge ? 'font-extrabold text-brand' : '',
  ]
}

function pick(d: string) {
  if (!from.value || to.value || d < from.value) {
    from.value = d
    to.value = null
  } else {
    to.value = d
  }
}
function keepLength() {
  if (from.value && props.keepDays) to.value = addDays(from.value, props.keepDays - 1)
}

const summary = computed(() => {
  if (!from.value) return 'Elegí el día de ida'
  const f = fmtDay(from.value, { weekday: 'short', day: 'numeric', month: 'short' })
  if (!to.value) return `${f} → elegí la vuelta`
  return `${f} → ${fmtDay(to.value, { weekday: 'short', day: 'numeric', month: 'short' })} · ${span(from.value, to.value)} días`
})
/** Picking 15 → 30 is 16 days: say so before saving, it's an easy slip. */
const lengthChange = computed(() => {
  if (!from.value || !to.value || !props.keepDays) return null
  const diff = span(from.value, to.value) - props.keepDays
  if (!diff) return null
  const n = Math.abs(diff)
  return `${n} ${n === 1 ? 'día' : 'días'} ${diff > 0 ? 'más' : 'menos'} que ahora (${props.keepDays})`
})
</script>

<template>
  <div class="fixed inset-0 z-[1300] flex items-end justify-center bg-noche/45 md:items-center md:p-4" @click.self="emit('close')">
    <div
      role="dialog"
      aria-label="Fechas del viaje"
      class="flex w-full flex-col gap-4 rounded-t-[28px] bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:w-auto md:rounded-[28px] md:px-7 md:pt-6"
    >
      <div class="flex items-center justify-between gap-4">
        <h2 class="font-display text-[22px] font-bold">Fechas del viaje</h2>
        <button type="button" aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full bg-rocio" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div class="relative flex gap-8">
        <button type="button" aria-label="Mes anterior" class="absolute top-0 left-0 z-[2] grid h-9 w-9 place-items-center rounded-full border border-[#DCE3DF] hover:border-brand" @click="move(-1)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" aria-label="Mes siguiente" class="absolute top-0 right-0 z-[2] grid h-9 w-9 place-items-center rounded-full border border-[#DCE3DF] hover:border-brand" @click="move(1)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>

        <!-- The second month only fits on wide screens -->
        <section v-for="(mo, k) in months" :key="mo.key" class="w-full md:w-[308px]" :class="k === 1 ? 'hidden md:block' : ''">
          <h3 class="mb-3 grid h-9 place-items-center text-[16px] font-extrabold">{{ mo.label }}</h3>
          <div class="grid grid-cols-7 text-center text-[12px] font-bold text-slate-400 uppercase">
            <span v-for="w in WEEK" :key="w" class="pb-2">{{ w }}</span>
          </div>
          <div class="grid grid-cols-7 gap-y-1" @mouseleave="hover = null">
            <span v-for="n in mo.lead" :key="`lead-${n}`" />
            <button
              v-for="d in mo.days"
              :key="d"
              type="button"
              :class="cellClass(d)"
              :aria-label="fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })"
              :aria-pressed="d === from || d === to"
              @click="pick(d)"
              @mouseenter="hover = d"
            >
              {{ Number(d.slice(8)) }}
            </button>
          </div>
        </section>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-[#E8EEEA] pt-4">
        <span class="min-w-0 flex-1 text-[14px] font-bold text-slate-600">
          {{ summary }}
          <span v-if="lengthChange" class="block text-[13px] font-extrabold text-[#8A6100]">{{ lengthChange }}</span>
        </span>
        <button
          v-if="from && !to && keepDays"
          type="button"
          class="h-10 rounded-full border-[1.5px] border-brand px-4 text-[13px] font-extrabold text-brand hover:bg-brand-soft"
          @click="keepLength"
        >
          Mantener {{ keepDays }} días
        </button>
        <button class="btn-primary h-11 px-6 text-[15px]" :disabled="!from || !to || busy" @click="emit('save', from!, to!)">
          {{ busy ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
  </div>
</template>
