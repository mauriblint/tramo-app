<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { api, type Pin, type Stop, type Trip } from '@/api'
import DayMap, { type DayPoint } from '@/components/DayMap.vue'
import { geocodeCity } from '@/geo'
import { STATUS_META, TIME_META, TYPE_META, dayHeadline, daysBetween, fmtDay, mapsUrl } from '@/pinMeta'

/** One activity: what it is, where, and the few actions you need on the street. */
const props = defineProps<{ trip: Trip; stops: Stop[]; pins: Pin[]; pin: Pin }>()
const emit = defineEmits<{ edit: [Pin]; done: [Pin, boolean]; move: [Pin, string | null]; located: [Pin, Pin] }>()

const allDays = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))
const dayPins = computed(() =>
  props.pin.day ? props.pins.filter((p) => p.day === props.pin.day && p.type !== 'route').sort((a, b) => a.position - b.position) : [],
)
const pos = computed(() => dayPins.value.findIndex((p) => p.id === props.pin.id))
const nextPin = computed(() => dayPins.value[pos.value + 1] ?? null)
const dayTitle = computed(() => (props.pin.day ? dayHeadline(props.pins.filter((p) => p.day === props.pin.day).sort((a, b) => a.position - b.position)).title : ''))

const back = computed(() =>
  props.pin.day
    ? { to: `/trips/${props.trip.id}/days/${props.pin.day}`, label: `Día ${allDays.value.indexOf(props.pin.day) + 1} · ${dayTitle.value}` }
    : { to: `/trips/${props.trip.id}?tab=ideas`, label: 'Ideas' },
)

const eyebrow = computed(() => {
  const p = props.pin
  if (!p.day) return STATUS_META[p.status].label
  return [p.timeOfDay ? TIME_META[p.timeOfDay].label : null, pos.value >= 0 ? `${pos.value + 1} de ${dayPins.value.length}` : null]
    .filter(Boolean)
    .join(' · ')
})

const directions = computed(() => {
  const p = props.pin
  if (p.geoStatus === 'ok' && p.lat != null && p.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
  return mapsUrl(p) ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.title, p.city].filter(Boolean).join(', '))}`
})

// ---- map
const center = ref<{ lat: number; lng: number } | null>(null)
const points = computed<DayPoint[]>(() => {
  const p = props.pin
  return p.geoStatus === 'ok' && p.lat != null && p.lng != null ? [{ n: Math.max(1, pos.value + 1), lat: p.lat, lng: p.lng }] : []
})
async function locate() {
  const p = props.pin
  if (p.geoStatus === null && ['place', 'food', 'activity'].includes(p.type)) {
    try {
      emit('located', p, await api.locatePin(p.tripId, p.id))
    } catch {
      // fine without a map
    }
  }
  if (!points.value.length && p.city) center.value = await geocodeCity(p.city, props.trip.destination)
}
onMounted(locate)
watch(() => props.pin.id, locate)

// ---- move to another day
const moving = ref(false)
function onMove(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  moving.value = false
  emit('move', props.pin, v === 'none' ? null : v)
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2.5 px-3 pt-3 pb-3 md:px-0 md:pt-0">
      <RouterLink :to="back.to" class="flex h-11 min-w-0 items-center gap-1 rounded-full bg-white pr-4 pl-2 text-sm font-extrabold md:bg-rocio">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        <span class="truncate">{{ back.label }}</span>
      </RouterLink>
      <span class="flex-1" />
      <button class="h-11 flex-none rounded-full bg-white px-4 text-sm font-extrabold md:bg-rocio" @click="emit('edit', pin)">Editar</button>
    </div>

    <div class="relative h-[200px] md:h-[220px] md:overflow-hidden md:rounded-t-[28px]">
      <DayMap :points="points" :center="center" :zoom="15" />
    </div>

    <section class="relative z-[600] -mt-7 flex flex-col gap-4 rounded-t-[28px] bg-rocio px-4 pt-6 pb-6 md:rounded-[28px] md:px-5">
      <div class="flex flex-col gap-2 px-1">
        <span v-if="eyebrow" class="text-[13px] font-extrabold tracking-wide text-brand uppercase">{{ eyebrow }}</span>
        <h1 class="font-display text-[30px] leading-[1.05] font-bold tracking-tight md:text-[34px]">{{ pin.title }}</h1>
        <p v-if="pin.body" class="text-[16px] leading-relaxed whitespace-pre-line text-[#3F4B45]">{{ pin.body }}</p>
      </div>

      <div class="flex flex-wrap gap-2 px-1">
        <a :href="directions" target="_blank" rel="noopener" class="inline-flex h-11 items-center gap-2 rounded-full bg-brand pr-[18px] pl-3.5 text-sm font-extrabold text-white hover:bg-brand-dark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" /></svg>
          Cómo llegar
        </a>
        <button
          class="inline-flex h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-extrabold"
          :class="pin.status === 'done' ? 'border-brand bg-brand-soft text-brand-dark' : 'border-[#DCE3DF] bg-white'"
          @click="emit('done', pin, pin.status !== 'done')"
        >
          <svg v-if="pin.status === 'done'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {{ pin.status === 'done' ? 'Hecho' : 'Marcar como hecho' }}
        </button>
        <label v-if="moving" class="inline-flex h-11 items-center rounded-full border-[1.5px] border-brand bg-white px-3">
          <span class="sr-only">Mover a</span>
          <select class="bg-transparent text-sm font-extrabold outline-none" :value="pin.day ?? 'none'" @change="onMove">
            <option v-for="(d, i) in allDays" :key="d" :value="d">Día {{ i + 1 }} · {{ fmtDay(d) }}</option>
            <option value="none">Sin día (a Ideas)</option>
          </select>
        </label>
        <button v-else class="inline-flex h-11 items-center rounded-full border-[1.5px] border-[#DCE3DF] bg-white px-4 text-sm font-extrabold" @click="moving = true">
          {{ pin.day ? 'Mover a otro día' : 'Ponerle día' }}
        </button>
      </div>

      <div class="rounded-[22px] bg-white px-5 py-1">
        <div v-if="pin.day" class="flex items-start gap-3.5 border-b border-[#EEF2EF] py-3.5 last:border-0">
          <span class="grid h-9 w-9 flex-none place-items-center rounded-xl bg-rocio">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div><div class="text-xs font-bold text-slate-500">Cuándo</div><div class="text-[15px] font-bold">{{ fmtDay(pin.day, { weekday: 'long', day: 'numeric', month: 'long' }) }}<template v-if="pin.timeOfDay"> · {{ TIME_META[pin.timeOfDay].label.toLowerCase() }}</template></div></div>
        </div>
        <div v-if="pin.city" class="flex items-start gap-3.5 border-b border-[#EEF2EF] py-3.5 last:border-0">
          <span class="grid h-9 w-9 flex-none place-items-center rounded-xl bg-rocio">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          </span>
          <div><div class="text-xs font-bold text-slate-500">Dónde</div><div class="text-[15px] font-bold">{{ pin.city }}<span v-if="pin.geoStatus === 'approx'" class="font-medium text-slate-500"> · ubicación aproximada</span></div></div>
        </div>
        <div class="flex items-start gap-3.5 border-b border-[#EEF2EF] py-3.5 last:border-0">
          <span class="grid h-9 w-9 flex-none place-items-center rounded-xl bg-rocio text-base">{{ TYPE_META[pin.type].emoji }}</span>
          <div>
            <div class="text-xs font-bold text-slate-500">Tipo</div>
            <div class="text-[15px] font-bold">{{ TYPE_META[pin.type].label }}<template v-if="pin.tags.length"> · {{ pin.tags.join(', ') }}</template></div>
          </div>
        </div>
        <div v-if="pin.url" class="flex items-start gap-3.5 py-3.5">
          <span class="grid h-9 w-9 flex-none place-items-center rounded-xl bg-rocio">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
          </span>
          <div class="min-w-0"><div class="text-xs font-bold text-slate-500">Link</div><a :href="pin.url" target="_blank" rel="noopener" class="block truncate text-[15px] font-bold">{{ pin.url }}</a></div>
        </div>
      </div>

      <RouterLink
        v-if="nextPin"
        :to="`/trips/${trip.id}/pins/${nextPin.id}`"
        replace
        class="flex items-center justify-end gap-1 px-1 text-sm font-extrabold text-brand"
      >
        Siguiente: {{ nextPin.title }}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </RouterLink>
    </section>
  </div>
</template>
