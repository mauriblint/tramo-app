<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Pin, TimeOfDay, Trip } from '@/api'
import { TIMES, TIME_META, daysBetween, fmtDay } from '@/pinMeta'
import { PIN_LOOK, googleMapsSearch, isPlace, oneLine } from '@/pinIcons'

/** Ideas tab: everything saved without a day, to browse and put into the itinerary. New ideas come from the copilot. */
const props = defineProps<{ trip: Trip; pins: Pin[] }>()
const emit = defineEmits<{ ask: [string]; add: []; schedule: [Pin, string, TimeOfDay] }>()

const ideas = computed(() => props.pins.filter((p) => !p.day && p.status !== 'discarded'))

type Kind = 'all' | 'food' | 'place' | 'activity' | 'idea'
const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'food', label: 'Comer' },
  { key: 'place', label: 'Ver' },
  { key: 'activity', label: 'Hacer' },
  { key: 'idea', label: 'Ideas y tips' },
]
const kindOf = (p: Pin): Kind => (p.type === 'food' || p.type === 'place' || p.type === 'activity' ? p.type : 'idea')
const kind = ref<Kind>('all')

/** "Roma - Trastevere" → "Roma": filter by city, not by neighborhood. */
const cityOf = (p: Pin) => p.city?.split(/\s+[-–—·]\s+|,/)[0]?.trim() || null
const cities = computed(() => [...new Set(ideas.value.map(cityOf).filter((c): c is string => !!c))].sort())
const city = ref<string | null>(null)

const shown = computed(() =>
  ideas.value.filter((p) => (kind.value === 'all' || kindOf(p) === kind.value) && (!city.value || cityOf(p) === city.value)),
)
const countKind = (k: Kind) => (k === 'all' ? ideas.value.length : ideas.value.filter((p) => kindOf(p) === k).length)

// ---- ask the copilot
const question = ref('')
function ask(text = question.value) {
  const t = text.trim()
  if (!t) return
  emit('ask', t)
  question.value = ''
}
const EXAMPLES = ['Barrios lindos para caminar', 'Qué comer que sea típico', 'Planes si llueve']

// ---- put into a day
const days = computed(() => daysBetween(props.trip.startDate, props.trip.endDate))
const scheduling = ref<string | null>(null)
const pickedDay = ref('')
function startScheduling(p: Pin) {
  scheduling.value = p.id
  pickedDay.value = days.value[0] ?? ''
}
function schedule(p: Pin, t: TimeOfDay) {
  if (!pickedDay.value) return
  emit('schedule', p, pickedDay.value, t)
  scheduling.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Ask the copilot -->
    <form class="flex h-14 items-center gap-3 rounded-full border-[1.5px] border-[#DCE3DF] bg-white pr-1.5 pl-4 shadow-[0_8px_24px_rgba(14,31,24,0.06)] focus-within:border-brand" @submit.prevent="ask()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></svg>
      <label for="ideas-ask" class="sr-only">Pedile ideas al copiloto</label>
      <input
        id="ideas-ask"
        v-model="question"
        autocomplete="off"
        placeholder="Pedile ideas al copiloto…"
        class="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
      />
      <button aria-label="Preguntar" class="grid h-11 w-11 flex-none place-items-center rounded-full bg-brand text-white hover:bg-brand-dark disabled:bg-slate-300" :disabled="!question.trim()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>

    <!-- Empty -->
    <div v-if="!ideas.length" class="flex flex-col items-center gap-3 rounded-[22px] bg-white px-6 py-10 text-center md:bg-rocio">
      <span class="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PIN_LOOK.idea.icon" />
      </span>
      <h2 class="font-display text-xl font-bold">Todavía no guardaste ideas</h2>
      <p class="max-w-[380px] text-[15px] leading-relaxed text-slate-500">Pedile recomendaciones al copiloto y tocá el pin en las que te gusten. También podés decirle “guardá esto”.</p>
      <div class="flex flex-wrap justify-center gap-2">
        <button v-for="e in EXAMPLES" :key="e" class="h-9 rounded-full border-[1.5px] border-brand px-3.5 text-[13px] font-bold text-brand hover:bg-brand-soft" @click="ask(e)">{{ e }}</button>
      </div>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        <template v-for="k in KINDS" :key="k.key">
          <button
            v-if="k.key === 'all' || countKind(k.key)"
            class="h-9 flex-none rounded-full border-[1.5px] px-3.5 text-[13px]"
            :class="kind === k.key ? 'border-brand bg-brand font-extrabold text-white' : 'border-[#DCE3DF] bg-white font-bold text-slate-600 hover:border-brand'"
            :aria-pressed="kind === k.key"
            @click="kind = k.key"
          >
            {{ k.label }} <span class="opacity-70">{{ countKind(k.key) }}</span>
          </button>
        </template>
        <template v-if="cities.length > 1">
          <span class="mx-1 w-px flex-none bg-[#DCE3DF]" />
          <button
            v-for="c in cities"
            :key="c"
            class="h-9 flex-none rounded-full border-[1.5px] px-3.5 text-[13px]"
            :class="city === c ? 'border-noche bg-noche font-extrabold text-white' : 'border-[#DCE3DF] bg-white font-bold text-slate-600 hover:border-noche'"
            :aria-pressed="city === c"
            @click="city = city === c ? null : c"
          >
            {{ c }}
          </button>
        </template>
      </div>

      <!-- Cards -->
      <div class="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <article v-for="p in shown" :key="p.id" class="flex min-w-0 flex-col gap-2.5 rounded-[18px] bg-white p-3 md:bg-rocio">
          <div class="flex items-center gap-3">
            <span class="grid h-10 w-10 flex-none place-items-center rounded-xl" :style="{ background: PIN_LOOK[p.type].bg }">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" :stroke="PIN_LOOK[p.type].fg" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PIN_LOOK[p.type].icon" />
            </span>
            <RouterLink :to="`/trips/${trip.id}/pins/${p.id}`" class="min-w-0 flex-1">
              <span class="block truncate text-[15px] font-extrabold">{{ p.title }}</span>
              <span v-if="p.body" class="block truncate text-[13px] text-slate-600">{{ oneLine(p.body) }}</span>
              <span v-if="isPlace(p.type)" class="block truncate text-xs text-slate-500">{{ p.city ?? '' }}</span>
              <span v-else class="block text-xs font-bold text-[#6B4E00]">Idea · sin lugar</span>
            </RouterLink>
            <a
              v-if="isPlace(p.type)"
              :href="googleMapsSearch(p)"
              target="_blank"
              rel="noopener"
              :aria-label="`Ver ${p.title} en Google Maps`"
              title="Ver en Google Maps"
              class="grid h-9 w-9 flex-none place-items-center rounded-full border-[1.5px] border-[#DCE3DF] bg-white hover:border-brand"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
            </a>
            <button
              v-if="days.length"
              :aria-label="`Poner ${p.title} en un día`"
              title="Poner en un día"
              class="grid h-9 w-9 flex-none place-items-center rounded-full border-[1.5px] bg-white"
              :class="scheduling === p.id ? 'border-brand' : 'border-[#DCE3DF] hover:border-brand'"
              @click="scheduling === p.id ? (scheduling = null) : startScheduling(p)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            </button>
          </div>

          <!-- Put it into a day: pick the day, then the moment -->
          <div v-if="scheduling === p.id" class="flex flex-col gap-2 rounded-[14px] bg-rocio p-2.5 md:bg-white">
            <label class="flex items-center gap-2 text-[13px] font-bold">
              <span class="flex-none">Día</span>
              <select v-model="pickedDay" class="h-9 min-w-0 flex-1 rounded-xl border-[1.5px] border-[#DCE3DF] bg-white px-2 text-[14px] outline-none focus:border-brand">
                <option v-for="(d, i) in days" :key="d" :value="d">Día {{ i + 1 }} · {{ fmtDay(d) }}</option>
              </select>
            </label>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="t in TIMES"
                :key="t"
                class="h-9 rounded-xl bg-brand text-[13px] font-bold text-white hover:bg-brand-dark"
                @click="schedule(p, t)"
              >
                {{ TIME_META[t].label }}
              </button>
            </div>
          </div>
        </article>
      </div>
      <p v-if="!shown.length" class="text-center text-sm text-slate-500">Nada con ese filtro.</p>
    </template>

    <button class="self-center text-[13px] font-bold text-slate-500 hover:text-brand" @click="emit('add')">+ Agregar una idea a mano</button>
  </div>
</template>
