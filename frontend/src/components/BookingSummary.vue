<script setup lang="ts">
import type { BookingInput } from '@/api'
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, KIND_META } from '@/bookings'
import { fmtDay } from '@/pinMeta'

/** A booking read from an email, as a compact row to review before saving (optionally removable). */
defineProps<{ booking: BookingInput; removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()

const day = (d: string | null) => (d ? fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ')

/** "Tren Hakutaka 562 · vie 16 oct 10:15 → 13:08" */
function when(b: BookingInput) {
  const name = join(KIND_META[b.kind].label, b.number)
  const leave = join(day(b.departDate), b.departTime)
  const arrive = b.arriveTime ? join(b.arriveDate && day(b.arriveDate), b.arriveTime) : ''
  return `${name} · ${leave}${arrive ? ` → ${arrive}` : ''}`
}
</script>

<template>
  <li class="flex gap-3 rounded-[18px] bg-rocio px-4 py-3">
    <span class="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl bg-white">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[booking.kind].icon" />
    </span>
    <span class="min-w-0 flex-1 text-[14px] leading-snug">
      <template v-if="booking.kind === 'hotel'">
        <span class="block font-extrabold">{{ booking.hotelName }}</span>
        <span class="block text-slate-600">{{ join(day(booking.checkInDate), booking.checkInTime ?? DEFAULT_CHECK_IN) }} → {{ join(day(booking.checkOutDate), booking.checkOutTime ?? DEFAULT_CHECK_OUT) }}</span>
        <span v-if="booking.address" class="block truncate text-slate-500">{{ booking.address }}</span>
      </template>
      <template v-else>
        <span class="block font-extrabold">{{ booking.origin }} → {{ booking.destination }}</span>
        <span class="block text-slate-600">{{ when(booking) }}</span>
        <span v-if="booking.seat" class="block text-slate-500">Asiento {{ booking.seat }}</span>
      </template>
      <span v-if="booking.reference" class="mt-1 inline-block rounded-md bg-white px-1.5 text-xs font-extrabold tracking-wide">{{ booking.reference }}</span>
      <span v-if="booking.notes" class="mt-1 block text-xs text-slate-500">{{ booking.notes }}</span>
    </span>
    <button v-if="removable" type="button" aria-label="Quitar" class="grid h-8 w-8 flex-none place-items-center rounded-full text-slate-400 hover:bg-white hover:text-rose-600" @click="emit('remove')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </li>
</template>
