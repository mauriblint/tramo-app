<script setup lang="ts">
import { computed } from 'vue'

import type { Booking, BookingInput, Stop, Trip } from '@/api'
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, mapsSearch, nights } from '@/bookings'
import { daysBetween, fmtDay, stopForDay } from '@/pinMeta'

/** Hotels tab: which nights are covered, the hotels, and the gaps (with the city prefilled). */
const props = defineProps<{ trip: Trip; stops: Stop[]; bookings: Booking[] }>()
const emit = defineEmits<{ edit: [Booking]; add: [Partial<BookingInput>] }>()

const PALETTE = ['#0A7A55', '#7EE2B8', '#14996B', '#3FB98A', '#086646']

const hotels = computed(() => props.bookings.filter((b) => b.kind === 'hotel'))
const allNights = computed(() => nights(props.trip, props.stops, props.bookings))
const covered = computed(() => allNights.value.filter((n) => n.hotel).length)
const colorOf = (b: Booking) => PALETTE[hotels.value.indexOf(b) % PALETTE.length]!

const addDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

/** Consecutive nights without a hotel in the same city → one "add" row with check-in/out prefilled. */
const gaps = computed(() => {
  const out: { city: string | null; from: string; to: string; count: number }[] = []
  for (const n of allNights.value) {
    if (n.hotel) continue
    const last = out.at(-1)
    if (last && last.city === n.city && addDay(last.to) === n.date) {
      last.to = n.date
      last.count++
    } else out.push({ city: n.city, from: n.date, to: n.date, count: 1 })
  }
  return out.map((g) => ({ ...g, checkOut: addDay(g.to) }))
})

const nightsOf = (b: Booking) => daysBetween(b.checkInDate, b.checkOutDate).length - 1
const cityOf = (b: Booking) => stopForDay(props.stops, b.checkInDate!)?.city ?? null
</script>

<template>
  <div class="flex flex-col gap-3">
    <section v-if="allNights.length" aria-label="Noches cubiertas" class="flex flex-col gap-2.5 rounded-[20px] bg-white px-4 py-3.5 md:bg-rocio">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[15px] font-extrabold">{{ covered }} de {{ allNights.length }} noches con hotel</span>
        <span class="text-xs text-slate-500">{{ fmtDay(allNights[0]!.date, { day: 'numeric', month: 'short' }) }} → {{ fmtDay(trip.endDate!, { day: 'numeric', month: 'short' }) }}</span>
      </div>
      <div class="flex gap-[3px]">
        <span
          v-for="n in allNights"
          :key="n.date"
          class="h-2.5 flex-1 rounded-full"
          :style="{ background: n.hotel ? colorOf(n.hotel) : '#F5C84C' }"
          :title="`${fmtDay(n.date)} · ${n.hotel?.hotelName ?? 'sin hotel'}`"
        />
      </div>
    </section>

    <button
      v-for="h in hotels"
      :key="h.id"
      type="button"
      class="flex flex-col gap-3 rounded-[20px] bg-white px-4 py-3.5 text-left transition hover:shadow-[0_6px_18px_rgba(14,31,24,0.08)] md:bg-rocio"
      @click="emit('edit', h)"
    >
      <span class="flex items-start gap-3">
        <span class="mt-1 h-3 w-3 flex-none rounded-full" :style="{ background: colorOf(h) }" />
        <span class="min-w-0 flex-1">
          <span class="block text-[16px] font-extrabold">{{ h.hotelName }}</span>
          <span class="block text-[13px] text-slate-500">
            <template v-if="cityOf(h)">{{ cityOf(h) }} · </template>{{ nightsOf(h) }} {{ nightsOf(h) === 1 ? 'noche' : 'noches' }}
          </span>
        </span>
        <span v-if="h.reference" class="rounded-lg bg-rocio px-2 py-0.5 text-xs font-extrabold tracking-wide md:bg-white">{{ h.reference }}</span>
      </span>
      <span class="grid grid-cols-2 gap-2">
        <span class="rounded-[14px] bg-rocio px-3 py-2 md:bg-white">
          <span class="block text-[11px] font-bold text-slate-500">Check-in</span>
          <span class="block text-sm font-extrabold">{{ fmtDay(h.checkInDate!) }} · {{ h.checkInTime ?? DEFAULT_CHECK_IN }}</span>
        </span>
        <span class="rounded-[14px] bg-rocio px-3 py-2 md:bg-white">
          <span class="block text-[11px] font-bold text-slate-500">Check-out</span>
          <span class="block text-sm font-extrabold">{{ fmtDay(h.checkOutDate!) }} · {{ h.checkOutTime ?? DEFAULT_CHECK_OUT }}</span>
        </span>
      </span>
      <a
        :href="mapsSearch(h.address || h.hotelName!, h.address ? null : cityOf(h))"
        target="_blank"
        rel="noopener"
        class="self-start text-[13px] font-extrabold text-brand"
        @click.stop
      >Cómo llegar →</a>
    </button>

    <div v-for="g in gaps" :key="g.from" class="flex items-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-[#E3B93A] py-3 pr-3 pl-4">
      <span class="min-w-0 flex-1">
        <span class="block text-[15px] font-extrabold">{{ g.city ?? 'Sin ciudad' }} · {{ fmtDay(g.from, { day: 'numeric', month: 'short' }) }}<template v-if="g.count > 1"> → {{ fmtDay(g.checkOut, { day: 'numeric', month: 'short' }) }}</template></span>
        <span class="text-[13px] text-slate-500">{{ g.count }} {{ g.count === 1 ? 'noche' : 'noches' }} sin hotel</span>
      </span>
      <button
        class="h-9 flex-none rounded-full border-[1.5px] border-brand px-3.5 text-[13px] font-extrabold text-brand hover:bg-brand-soft"
        @click="emit('add', { kind: 'hotel', checkInDate: g.from, checkOutDate: g.checkOut })"
      >Agregar</button>
    </div>
  </div>
</template>
