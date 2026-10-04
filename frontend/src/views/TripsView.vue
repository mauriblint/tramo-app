<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, type Trip } from '@/api'
import TramoLogo from '@/components/TramoLogo.vue'
import { fmtDay } from '@/pinMeta'

const router = useRouter()
const trips = ref<Trip[]>([])
const text = ref('')
const starting = ref(false)
const error = ref('')

const SUGGESTIONS = ['Japón en noviembre, 2 semanas', 'Una semana en Italia en familia', 'No sé a dónde, sorprendeme']
const STEPS = [
  { title: 'Contame del viaje', sub: 'Destino, fechas o vuelos, quiénes van' },
  { title: 'Te propongo una ruta', sub: 'Ciudades y noches; la ajustamos charlando' },
  { title: 'Te armo cada día', sub: 'Y lo seguimos afinando en el chat' },
]

onMounted(async () => {
  try {
    // Drafts abandoned before saying where they're going are just noise.
    trips.value = (await api.listTrips()).filter((t) => t.destination)
  } catch (e) {
    error.value = (e as Error).message
  }
})

/** The first message starts the trip: create it and hand the text to the trip chat. */
async function start(msg = text.value) {
  const q = msg.trim()
  if (!q || starting.value) return
  starting.value = true
  try {
    const t = await api.createTrip({})
    router.push({ path: `/trips/${t.id}`, query: { q } })
  } catch (e) {
    error.value = (e as Error).message
    starting.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    start()
  }
}
</script>

<template>
  <div class="min-h-dvh md:flex md:gap-4 md:p-4">
    <!-- Brand panel -->
    <section
      class="flex flex-col gap-7 rounded-b-[32px] bg-brand px-6 pt-5 pb-8 text-white md:flex-1 md:justify-between md:rounded-[28px] md:px-10 md:py-8"
    >
      <div class="flex h-11 items-center justify-between">
        <TramoLogo :size="30" on-dark />
        <a v-if="trips.length" href="#mis-viajes" class="text-sm font-semibold text-white/90 hover:text-white">Mis viajes</a>
      </div>

      <div class="flex flex-col gap-6">
        <svg viewBox="0 0 420 110" class="w-full max-w-[420px]" fill="none" aria-hidden="true">
          <path
            d="M16 86 C 100 86, 110 24, 210 38 S 330 96, 400 28"
            stroke="#FFFFFF"
            stroke-opacity="0.55"
            stroke-width="2.5"
            stroke-dasharray="4 7"
            stroke-linecap="round"
          />
          <circle cx="16" cy="86" r="8" fill="#FFFFFF" />
          <circle cx="210" cy="38" r="8" fill="#FFFFFF" fill-opacity="0.85" />
          <circle cx="400" cy="28" r="14" fill="#F5C84C" fill-opacity="0.3" />
          <circle cx="400" cy="28" r="7" fill="#F5C84C" />
        </svg>
        <div>
          <h1 class="font-display text-[40px] leading-[1.02] font-bold md:text-[64px]">Empezá tu<br />próximo viaje</h1>
          <p class="mt-3 max-w-md text-[15px] text-mint-text md:text-lg">Todo charlando, sin formularios. Vos contás, yo propongo, y lo afinamos juntos.</p>
        </div>
      </div>

      <ol class="hidden gap-3 md:grid md:grid-cols-3">
        <li v-for="(s, i) in STEPS" :key="s.title" class="rounded-2xl bg-white/10 p-3.5">
          <div class="text-xs font-bold text-mint-text">Paso {{ i + 1 }}</div>
          <div class="mt-1 font-bold">{{ s.title }}</div>
        </li>
      </ol>
    </section>

    <!-- Start -->
    <section class="flex flex-col gap-5 px-5 py-6 md:flex-1 md:justify-center md:px-10">
      <ol class="flex flex-col gap-3 md:hidden">
        <li v-for="(s, i) in STEPS" :key="s.title" class="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-3.5">
          <span class="grid h-9 w-9 flex-none place-items-center rounded-xl bg-brand-soft font-bold text-brand-dark">{{ i + 1 }}</span>
          <span class="flex flex-col">
            <span class="text-[15px] font-bold">{{ s.title }}</span>
            <span class="text-[13px] text-slate-500">{{ s.sub }}</span>
          </span>
        </li>
      </ol>

      <div class="mx-auto flex w-full max-w-xl flex-col gap-4">
        <h2 class="font-display hidden text-4xl font-bold md:block">¿A dónde vamos?</h2>
        <form class="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_12px_32px_rgba(14,31,24,0.07)]" @submit.prevent="start()">
          <label for="first-msg" class="sr-only">Contame de tu viaje</label>
          <textarea
            id="first-msg"
            v-model="text"
            rows="3"
            class="w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-slate-400"
            placeholder="¿A dónde vamos? Ej: Japón en noviembre con mi pareja…"
            @keydown="onKey"
          />
          <div class="flex justify-end">
            <button class="btn-primary h-11 px-5 text-[15px]" :disabled="!text.trim() || starting">
              {{ starting ? 'Arrancando…' : 'Empezar' }}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in SUGGESTIONS"
            :key="s"
            class="h-9 rounded-full border border-slate-300 bg-white/60 px-3.5 text-[13px] font-medium text-slate-700 hover:border-brand hover:text-brand"
            @click="start(s)"
          >
            {{ s }}
          </button>
        </div>
        <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

        <section v-if="trips.length" id="mis-viajes" class="mt-4 flex flex-col gap-2.5">
          <h3 class="text-sm font-bold text-slate-600">Mis viajes</h3>
          <RouterLink
            v-for="t in trips"
            :key="t.id"
            :to="`/trips/${t.id}`"
            class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-brand"
          >
            <span class="min-w-0">
              <span class="block truncate font-bold">{{ t.name }}</span>
              <span class="block truncate text-[13px] text-slate-500">
                <template v-if="t.startDate && t.endDate">{{ fmtDay(t.startDate) }} → {{ fmtDay(t.endDate) }}</template>
                <template v-else>Borrador</template>
                <template v-if="t.destination"> · {{ t.destination }}</template>
              </span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </RouterLink>
        </section>
      </div>
    </section>
  </div>
</template>
