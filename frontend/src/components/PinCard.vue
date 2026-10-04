<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { api, type Pin, type PinStatus } from '@/api'
import MiniMap from '@/components/MiniMap.vue'
import WeatherStrip from '@/components/WeatherStrip.vue'
import { renderMd } from '@/markdown'
import { STATUS_META, TYPE_META, mapsUrl } from '@/pinMeta'
import { useVisible } from '@/useVisible'

const props = defineProps<{ pin: Pin; highlight?: boolean; tripStart: string | null; tripEnd: string | null }>()
const emit = defineEmits<{ edit: []; status: [PinStatus]; located: [Pin] }>()

const root = ref<HTMLElement>()
const visible = useVisible(root)
const open = ref(false)
const locating = ref(false)

const locatable = computed(() => ['place', 'food', 'activity', 'route'].includes(props.pin.type))
const hasGeo = computed(() => props.pin.lat != null && props.pin.lng != null)
const maps = computed(() => mapsUrl(props.pin))
const html = computed(() => renderMd(props.pin.body))
const faded = computed(() => props.pin.status === 'discarded' || props.pin.status === 'done')

// Geocode lazily the first time the card is on screen (also re-runs after the title/city is edited).
watch(
  () => [visible.value, props.pin.geoStatus, props.pin.title, props.pin.city] as const,
  async ([isVisible, status]) => {
    if (!isVisible || status || !locatable.value || locating.value) return
    locating.value = true
    try {
      emit('located', await api.locatePin(props.pin.tripId, props.pin.id))
    } catch {
      // Leave it unlocated; the card still works without a map.
    } finally {
      locating.value = false
    }
  },
  { immediate: true },
)

function nextStatus() {
  // Quick cycle idea → want → must → done → idea (discard lives in the editor).
  const cycle: PinStatus[] = ['idea', 'want', 'must', 'done']
  const i = cycle.indexOf(props.pin.status)
  emit('status', cycle[(i + 1) % cycle.length] ?? 'idea')
}
</script>

<template>
  <article
    ref="root"
    class="overflow-hidden rounded-2xl border bg-white shadow-sm transition"
    :class="[highlight ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200', faded ? 'opacity-60' : '']"
  >
    <!-- Map banner -->
    <div v-if="locatable && pin.geoStatus !== 'none'" class="relative h-32 bg-slate-100">
      <a v-if="hasGeo && visible" :href="maps ?? undefined" target="_blank" rel="noopener" class="absolute inset-0 z-0" title="Abrir en Google Maps">
        <MiniMap :lat="pin.lat!" :lng="pin.lng!" :approx="pin.geoStatus === 'approx'" :emoji="TYPE_META[pin.type].emoji" />
      </a>
      <div v-else class="absolute inset-0 grid place-items-center text-xs text-slate-400">
        <span class="animate-pulse">Buscando ubicación…</span>
      </div>
      <div class="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between p-2">
        <span class="chip bg-white/90 text-slate-700 shadow-sm">{{ TYPE_META[pin.type].emoji }} {{ TYPE_META[pin.type].label }}</span>
        <span v-if="pin.geoStatus === 'approx'" class="chip bg-white/90 text-slate-500 shadow-sm">ubicación aprox.</span>
      </div>
    </div>

    <div class="p-3">
      <div class="flex items-start gap-2">
        <span v-if="!locatable || pin.geoStatus === 'none'" class="text-lg leading-6">{{ TYPE_META[pin.type].emoji }}</span>
        <button class="min-w-0 flex-1 text-left" @click="open = !open">
          <h3 class="leading-6 font-semibold" :class="pin.status === 'discarded' ? 'line-through' : ''">{{ pin.title }}</h3>
          <p v-if="!open && pin.body" class="line-clamp-2 text-sm text-slate-600">{{ pin.body.replace(/[#*_>`-]/g, '') }}</p>
        </button>
        <button class="chip shrink-0" :class="STATUS_META[pin.status].cls" title="Cambiar estado" @click="nextStatus">
          {{ STATUS_META[pin.status].emoji }} {{ STATUS_META[pin.status].label }}
        </button>
      </div>

      <div v-if="open && pin.body" class="md mt-2 text-slate-700" v-html="html" />

      <WeatherStrip v-if="hasGeo && visible" class="mt-2.5" :lat="pin.lat!" :lng="pin.lng!" :start="tripStart" :end="tripEnd" />

      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span v-if="pin.city" class="chip bg-slate-100 text-slate-600">{{ pin.city }}</span>
        <span v-for="t in pin.tags" :key="t" class="text-slate-500">#{{ t }}</span>
        <span class="flex-1" />
        <a v-if="maps" :href="maps" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">Google Maps</a>
        <a v-if="pin.url" :href="pin.url" target="_blank" rel="noopener" class="text-indigo-600 hover:underline">Link</a>
        <button class="text-slate-500 hover:text-slate-800" @click="emit('edit')">Editar</button>
      </div>
    </div>
  </article>
</template>
