<script setup lang="ts">
export type TripTab = 'itinerario' | 'viajes' | 'hoteles' | 'ideas'

defineProps<{ tripId: string; active: TripTab; ideas: number }>()

const TABS: { key: TripTab; label: string }[] = [
  { key: 'itinerario', label: 'Itinerario' },
  { key: 'viajes', label: 'Viajes' },
  { key: 'hoteles', label: 'Hoteles' },
  { key: 'ideas', label: 'Ideas' },
]
</script>

<template>
  <nav aria-label="Secciones del viaje" class="no-scrollbar flex gap-6 overflow-x-auto border-b border-[#DCE3DF] px-1 sm:gap-7">
    <RouterLink
      v-for="t in TABS"
      :key="t.key"
      :to="{ path: `/trips/${tripId}`, query: t.key === 'itinerario' ? {} : { tab: t.key } }"
      replace
      :aria-current="t.key === active ? 'page' : undefined"
      class="-mb-px flex h-[50px] flex-none items-center gap-1.5 border-b-[3px] px-0.5 text-[15px]"
      :class="t.key === active ? 'border-brand font-extrabold text-brand' : 'border-transparent font-bold text-slate-500 hover:text-noche'"
    >
      {{ t.label }}
      <span v-if="t.key === 'ideas' && ideas" class="text-xs font-bold text-slate-400">{{ ideas }}</span>
    </RouterLink>
  </nav>
</template>
