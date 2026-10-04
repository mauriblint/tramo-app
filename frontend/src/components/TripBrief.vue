<script setup lang="ts">
import type { Stop, Trip } from '@/api'
import RouteCard from '@/components/RouteCard.vue'
import TramoLogo from '@/components/TramoLogo.vue'
import type { Step } from '@/tripProfile'

defineProps<{ trip: Trip; stops: Stop[]; steps: Step[]; busy: boolean }>()
defineEmits<{ generate: [] }>()
</script>

<template>
  <aside class="flex h-full flex-col gap-5 overflow-y-auto rounded-[28px] bg-brand p-6 text-white">
    <div class="flex items-center justify-between">
      <TramoLogo :size="28" on-dark />
      <RouterLink to="/" class="text-[13px] font-semibold text-white/90 hover:text-white">Mis viajes</RouterLink>
    </div>

    <div>
      <div class="text-[13px] font-semibold text-mint-text">{{ stops.length ? 'Ruta propuesta' : 'Nuevo viaje' }}</div>
      <h2 class="font-display mt-1 text-[34px] leading-[1.05] font-bold">{{ trip.name === 'Nuevo viaje' ? 'Contame del viaje' : trip.name }}</h2>
    </div>

    <ul class="flex flex-col gap-2">
      <template v-for="s in steps" :key="s.key">
        <li
          v-if="s.key !== 'ruta'"
          class="flex items-center gap-3 rounded-2xl px-3.5 py-3"
          :class="s.ok ? 'bg-white/10' : 'border-[1.5px] border-dashed border-white/40'"
        >
          <span
            class="grid h-6 w-6 flex-none place-items-center rounded-full"
            :class="s.ok ? 'bg-white' : 'border-2 border-white/60'"
          >
            <svg v-if="s.ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          </span>
          <span class="min-w-0">
            <span class="block text-xs text-mint-text">{{ s.label }}</span>
            <span class="block text-[14px] font-bold whitespace-pre-line">{{ s.value ?? 'Te lo pregunto' }}</span>
          </span>
        </li>
      </template>
    </ul>

    <RouteCard v-if="stops.length" :stops="stops" :trip="trip" :busy="busy" @generate="$emit('generate')" />
    <p v-else class="mt-auto text-[13px] leading-relaxed text-mint-text">Con esto te propongo una ruta: qué ciudades y cuántas noches en cada una.</p>
  </aside>
</template>
