<script setup lang="ts">
import { computed } from 'vue'

import type { Booking, BookingInput, Stop, Trip } from '@/api'
import { KIND_META, mapsSearch, missingLegs } from '@/bookings'
import { daysBetween, fmtDay } from '@/pinMeta'

/** Transport tab: what you loaded, by date, plus the route changes that still have nothing loaded. */
const props = defineProps<{ trip: Trip; stops: Stop[]; bookings: Booking[] }>()
const emit = defineEmits<{ edit: [Booking]; add: [Partial<BookingInput>] }>()

const allDays = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))
const dayLabel = (d: string) => {
  const n = allDays.value.indexOf(d)
  return `${fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' })}${n >= 0 ? ` · día ${n + 1}` : ''}`
}

type Row = { date: string; booking: Booking | null; leg: { from: string; to: string } | null }
const rows = computed<Row[]>(() => {
  const loaded: Row[] = props.bookings.filter((b) => b.kind !== 'hotel').map((b) => ({ date: b.departDate!, booking: b, leg: null }))
  const missing: Row[] = missingLegs(props.stops, props.bookings).map((l) => ({ date: l.date, booking: null, leg: l }))
  return [...loaded, ...missing].sort((a, b) => a.date.localeCompare(b.date) || (a.booking?.departTime ?? '').localeCompare(b.booking?.departTime ?? ''))
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-for="(r, i) in rows" :key="r.booking?.id ?? `${r.date}-${r.leg?.to}`">
      <div v-if="i === 0 || rows[i - 1]!.date !== r.date" class="px-1 pt-2 text-xs font-extrabold tracking-[0.06em] text-slate-400 uppercase">
        {{ dayLabel(r.date) }}
      </div>

      <button
        v-if="r.booking"
        type="button"
        class="flex flex-col gap-2.5 rounded-[20px] bg-white px-4 py-3.5 text-left transition hover:shadow-[0_6px_18px_rgba(14,31,24,0.08)] md:bg-rocio"
        @click="emit('edit', r.booking)"
      >
        <span class="flex items-center gap-2 text-xs font-bold text-slate-500">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[r.booking.kind].icon" />
          {{ KIND_META[r.booking.kind].label }}<template v-if="r.booking.number"> · {{ r.booking.number }}</template><template v-if="r.booking.carrier"> · {{ r.booking.carrier }}</template>
          <span class="flex-1" />
          <span v-if="r.booking.reference" class="rounded-lg bg-rocio px-2 py-0.5 font-extrabold tracking-wide text-noche md:bg-white">{{ r.booking.reference }}</span>
        </span>
        <span class="flex items-center gap-3">
          <span class="min-w-0">
            <span class="font-display block truncate text-[20px] leading-tight font-bold">{{ r.booking.origin }}</span>
            <span class="block min-h-4 text-xs text-slate-500">{{ r.booking.departTime ?? 'sin hora' }}</span>
          </span>
          <span class="h-0 min-w-6 flex-1 border-t-2 border-dashed border-[#CFE3D8]" />
          <span class="min-w-0 text-right">
            <span class="font-display block truncate text-[20px] leading-tight font-bold">{{ r.booking.destination }}</span>
            <span class="block min-h-4 text-xs text-slate-500">
              <template v-if="r.booking.arriveDate">{{ fmtDay(r.booking.arriveDate, { day: 'numeric', month: 'short' }) }} · </template>{{ r.booking.arriveTime ?? '' }}
            </span>
          </span>
        </span>
        <span v-if="r.booking.seat || r.booking.notes" class="text-[13px] text-slate-600">
          <template v-if="r.booking.seat">Asiento {{ r.booking.seat }}</template><template v-if="r.booking.seat && r.booking.notes"> · </template>{{ r.booking.notes }}
        </span>
        <a
          :href="mapsSearch(r.booking.origin!, r.booking.origin)"
          target="_blank"
          rel="noopener"
          class="self-start text-[13px] font-extrabold text-brand"
          @click.stop
        >Cómo llegar a {{ r.booking.origin }} →</a>
      </button>

      <div v-else class="flex items-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-[#C9D3CE] py-3 pr-3 pl-4">
        <span class="min-w-0 flex-1">
          <span class="block text-[15px] font-extrabold">{{ r.leg!.from }} → {{ r.leg!.to }}</span>
          <span class="text-[13px] text-slate-500">Según tu ruta · todavía sin cargar</span>
        </span>
        <button
          class="h-9 flex-none rounded-full border-[1.5px] border-brand px-3.5 text-[13px] font-extrabold text-brand hover:bg-brand-soft"
          @click="emit('add', { kind: 'train', origin: r.leg!.from, destination: r.leg!.to, departDate: r.date })"
        >Cargar</button>
      </div>
    </template>

    <p v-if="!rows.length" class="rounded-[20px] bg-white px-5 py-8 text-center text-[15px] text-slate-500 md:bg-rocio">
      Cargá tus vuelos, trenes y buses: aparecen solos en el día que corresponde.
    </p>
  </div>
</template>
