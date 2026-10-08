<script setup lang="ts">
import type { Trip } from '@/api'
import TramoLogo from '@/components/TramoLogo.vue'
import type { TripTab } from '@/components/TripTabs.vue'

/** Desktop: the trip's identity and sections, in the same green panel used while creating it. */
defineProps<{ trip: Trip; active: TripTab; ideas: number }>()
defineEmits<{ copilot: []; edit: [] }>()

const ITEMS: { key: TripTab; label: string; icon: string }[] = [
  { key: 'itinerario', label: 'Itinerario', icon: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  {
    key: 'viajes',
    label: 'Viajes',
    icon: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  },
  { key: 'hoteles', label: 'Hoteles', icon: '<path d="M3 19V6M3 14h18v5M21 14a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="11" r="1.6"/>' },
  { key: 'ideas', label: 'Ideas', icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>' },
]
</script>

<template>
  <aside class="flex h-full w-[340px] flex-none flex-col gap-6 overflow-y-auto rounded-[28px] bg-brand p-6 text-white xl:w-[300px]">
    <div class="flex items-center justify-between">
      <RouterLink to="/plan" aria-label="tramo"><TramoLogo :size="28" on-dark /></RouterLink>
      <RouterLink to="/plan" class="text-[13px] font-semibold text-white/90 hover:text-white">Mis viajes</RouterLink>
    </div>

    <div class="flex items-start gap-2">
      <h2 class="font-display min-w-0 flex-1 text-[28px] leading-[1.08] font-bold">{{ trip.name }}</h2>
      <button
        class="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
        aria-label="Editar datos del viaje"
        title="Editar datos del viaje"
        @click="$emit('edit')"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      </button>
    </div>

    <nav aria-label="Secciones del viaje" class="flex flex-col gap-1.5">
      <RouterLink
        v-for="it in ITEMS"
        :key="it.key"
        :to="{ path: `/trips/${trip.id}`, query: it.key === 'itinerario' ? {} : { tab: it.key } }"
        :aria-current="it.key === active ? 'page' : undefined"
        class="flex h-[52px] items-center gap-3 rounded-2xl px-4 text-[15px] transition"
        :class="it.key === active ? 'bg-white font-extrabold text-brand-dark' : 'font-bold text-white hover:bg-white/10'"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          :stroke="it.key === active ? '#0A7A55' : 'currentColor'"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          v-html="it.icon"
        />
        <span class="flex-1">{{ it.label }}</span>
        <span v-if="it.key === 'ideas' && ideas" class="text-xs font-bold" :class="it.key === active ? 'text-slate-400' : 'text-mint-text'">{{ ideas }}</span>
      </RouterLink>
    </nav>

    <span class="flex-1" />

    <!-- On wide screens the copilot has its own column. -->
    <button
      class="flex h-14 items-center gap-3 rounded-full bg-noche pr-2 pl-5 xl:hidden text-left shadow-[0_12px_28px_rgba(14,31,24,0.3)] hover:bg-black"
      @click="$emit('copilot')"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7EE2B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" /></svg>
      <span class="flex-1 text-[15px] font-bold">Hablar con el copiloto</span>
      <span class="grid h-10 w-10 place-items-center rounded-full bg-white text-noche">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </span>
    </button>
  </aside>
</template>
