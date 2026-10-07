<script setup lang="ts">
import type { BookingKind, Leg } from '@/api'
import { transferTime } from '@/bookings'

/** The legs of a journey with connections, with the change between each: for the dark ticket or a light card. */
defineProps<{ legs: Leg[]; kind: BookingKind; dark?: boolean }>()
</script>

<template>
  <ol class="flex flex-col gap-1.5 text-[13px] leading-snug">
    <template v-for="(l, i) in legs" :key="i">
      <li v-if="i > 0" class="flex items-center gap-2 pl-[52px] text-xs font-bold" :class="dark ? 'text-sun' : 'text-[#6B4E00]'">
        {{ kind === 'flight' ? 'Escala' : 'Cambio' }} en {{ l.origin }}<template v-if="transferTime(legs[i - 1]!, l)"> · {{ transferTime(legs[i - 1]!, l) }}</template>
      </li>
      <li class="flex gap-3">
        <span class="w-10 flex-none font-extrabold tabular-nums">{{ l.departTime ?? '—' }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-bold">{{ l.origin }} → {{ l.destination }}<template v-if="l.arriveTime"> · {{ l.arriveTime }}</template></span>
          <span v-if="l.number || l.seat" class="block truncate" :class="dark ? 'text-mint-text' : 'text-slate-500'">
            {{ [l.number, l.seat].filter(Boolean).join(' · ') }}
          </span>
        </span>
      </li>
    </template>
  </ol>
</template>
