<script setup lang="ts">
import { computed } from 'vue'

import BookingLegs from '@/components/BookingLegs.vue'
import { KIND_META, eventDirections, type DayEvent } from '@/bookings'
import { fmtDay } from '@/pinMeta'

/** A booking inside a day: the transport as a fixed dark "ticket", hotel check-in/out as a light row. */
const props = defineProps<{ event: DayEvent; city: string | null }>()

const b = computed(() => props.event.booking)
const directions = computed(() => eventDirections(props.event, props.city))
</script>

<template>
  <!-- Leaving: the whole ticket -->
  <article v-if="event.type === 'depart'" class="flex flex-col gap-3 rounded-[22px] bg-noche p-4 text-white">
    <div class="flex items-center gap-2 text-xs font-bold text-mint-text">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7EE2B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[b.kind].icon" />
      {{ KIND_META[b.kind].label }}<template v-if="b.number"> · {{ b.number }}</template><template v-if="b.carrier"> · {{ b.carrier }}</template>
      <span class="flex-1" />
      <span v-if="b.reference" class="rounded-lg bg-white/10 px-2 py-0.5 font-extrabold tracking-wide text-white">{{ b.reference }}</span>
    </div>
    <div class="flex items-center gap-3">
      <div class="min-w-0">
        <div class="font-display text-[26px] leading-none font-bold">{{ b.departTime ?? '—' }}</div>
        <div class="mt-1 truncate text-[13px] text-mint-text">{{ b.origin }}</div>
      </div>
      <span class="h-0 min-w-6 flex-1 border-t-2 border-dashed border-white/30" />
      <div class="min-w-0 text-right">
        <div class="font-display text-[26px] leading-none font-bold">{{ b.arriveTime ?? '—' }}</div>
        <div class="mt-1 truncate text-[13px] text-mint-text">
          {{ b.destination }}<template v-if="b.arriveDate"> · {{ fmtDay(b.arriveDate, { weekday: 'short', day: 'numeric' }) }}</template>
        </div>
      </div>
    </div>
    <BookingLegs v-if="b.legs.length" :legs="b.legs" :kind="b.kind" dark class="border-t border-white/10 pt-3" />
    <div v-if="b.seat || b.notes" class="text-[13px] text-mint-text">
      <template v-if="b.seat">Asiento {{ b.seat }}</template><template v-if="b.seat && b.notes"> · </template>{{ b.notes }}
    </div>
    <a :href="directions" target="_blank" rel="noopener" class="self-start text-[13px] font-extrabold text-brote">Cómo llegar a {{ b.origin }} →</a>
  </article>

  <!-- Arriving another day, check-in, check-out: one light row -->
  <a v-else :href="directions" target="_blank" rel="noopener" class="flex items-center gap-3 rounded-[18px] bg-brand-soft px-4 py-3 text-brand-dark">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true" v-html="KIND_META[b.kind].icon" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-[14px] font-extrabold">{{ event.label }}</span>
      <span v-if="event.type === 'checkin' && b.reference" class="block text-xs">Reserva {{ b.reference }}</span>
    </span>
    <span class="flex-none text-[13px] font-extrabold">{{ event.type === 'checkin' ? 'desde ' : event.type === 'checkout' ? 'hasta ' : '' }}{{ event.time ?? '' }}</span>
  </a>
</template>
