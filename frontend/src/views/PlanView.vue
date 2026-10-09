<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, type Trip } from '@/api'
import { auth, fetchMe, logout, openAuth, savePending, takePending } from '@/auth'
import TramoLogo from '@/components/TramoLogo.vue'
import { fmtDay, localToday } from '@/pinMeta'

const router = useRouter()
const trips = ref<Trip[]>([])
/** Forwarded emails still waiting for the user to pick their trip. */
const toReview = ref(0)
/** Avoid flashing the empty-state composer before the list arrives. */
const loaded = ref(false)
/** With trips, the composer stays folded until "Nuevo viaje". */
const composing = ref(false)
const box = ref<HTMLTextAreaElement>()
const text = ref('')
const starting = ref(false)
const error = ref('')

const SUGGESTIONS = ['Japón en noviembre, 2 semanas', 'Una semana en Italia en familia', 'No sé a dónde, sorprendeme']
const STEPS = [
  { title: 'Contame del viaje', sub: 'Destino, fechas o vuelos, quiénes van' },
  { title: 'Te propongo una ruta', sub: 'Ciudades y noches; la ajustamos charlando' },
  { title: 'Te armo cada día', sub: 'Y lo seguimos afinando en el chat' },
]

async function loadTrips() {
  if (!auth.user) {
    loaded.value = true
    return
  }
  try {
    // Drafts abandoned before saying where they're going are just noise.
    trips.value = (await api.listTrips()).filter((t) => t.destination)
    api.inbox().then((l) => (toReview.value = l.length), () => {})
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loaded.value = true
  }
}

const today = localToday()
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000)

/** "En curso", "Faltan 12 días", "Terminado"… */
function statusOf(t: Trip): { label: string; tone: 'now' | 'soon' | 'past' | 'draft' } {
  if (!t.startDate || !t.endDate) return { label: 'Sin fechas', tone: 'draft' }
  if (t.datesTentative) return { label: 'Fechas a confirmar', tone: 'draft' }
  if (t.startDate <= today && today <= t.endDate) return { label: 'En curso', tone: 'now' }
  if (t.endDate < today) return { label: 'Terminado', tone: 'past' }
  const n = daysUntil(t.startDate)
  return { label: n === 1 ? 'Mañana' : `Faltan ${n} días`, tone: 'soon' }
}
const RANK = { now: 0, soon: 1, draft: 2, past: 3 } as const

/** Ongoing first, then the next ones by date, drafts, and finished trips last. */
const sortedTrips = computed(() =>
  [...trips.value].sort((a, b) => {
    const ra = RANK[statusOf(a).tone]
    const rb = RANK[statusOf(b).tone]
    if (ra !== rb) return ra - rb
    return ra === 3 ? (b.startDate ?? '').localeCompare(a.startDate ?? '') : (a.startDate ?? '9').localeCompare(b.startDate ?? '9')
  }),
)
const hasTrips = computed(() => trips.value.length > 0)

async function newTrip() {
  composing.value = true
  await nextTick()
  box.value?.focus()
}

onMounted(async () => {
  if (!auth.checked) await fetchMe()
  // Back from the email link: pick up the message typed before signing up.
  const pending = auth.user ? takePending() : null
  if (pending) return begin(pending)
  loadTrips()
})

/** The first message starts the trip; without an account, sign up first and keep the message. */
function start(msg = text.value) {
  const q = msg.trim()
  if (!q || starting.value) return
  if (!auth.user) {
    savePending(q)
    openAuth('signup', () => begin(takePending() ?? q))
    return
  }
  begin(q)
}

async function signOut() {
  await logout()
  trips.value = []
  composing.value = false
}

async function begin(q: string) {
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
  <div class="min-h-dvh md:flex md:items-start md:gap-4 md:p-4">
    <!-- Brand panel: stays put on desktop while the right side scrolls -->
    <section
      class="flex flex-col rounded-b-[32px] bg-brand px-6 pt-5 text-white md:sticky md:top-4 md:h-[calc(100dvh-2rem)] md:flex-1 md:justify-between md:overflow-hidden md:rounded-[28px] md:px-10 md:py-8"
      :class="hasTrips && !composing ? 'gap-4 pb-6 md:gap-7' : 'gap-7 pb-8'"
    >
      <div class="flex h-11 items-center justify-between">
        <TramoLogo :size="30" on-dark />
        <div class="flex items-center gap-4 text-sm font-semibold">
          <button v-if="auth.user" class="text-white/70 hover:text-white" :title="auth.user.email" @click="signOut">Salir</button>
          <button v-else-if="auth.checked" class="text-white/90 hover:text-white" @click="openAuth('login', loadTrips)">Entrar</button>
        </div>
      </div>

      <div class="flex flex-col gap-6">
        <svg viewBox="0 0 420 110" class="w-full max-w-[420px]" :class="hasTrips && !composing ? 'hidden md:block' : ''" fill="none" aria-hidden="true">
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
        <!-- Starting a new one: back to the invitation -->
        <div v-if="hasTrips && !composing">
          <h1 class="font-display text-[40px] leading-[1.02] font-bold md:text-[64px]">Hola{{ auth.user ? `, ${auth.user.name.split(' ')[0]}` : '' }}</h1>
          <p class="mt-3 max-w-md text-[15px] text-mint-text md:text-lg">Seguí armando tus viajes o empezá uno nuevo.</p>
        </div>
        <div v-else>
          <h1 class="font-display text-[40px] leading-[1.02] font-bold md:text-[64px]">Empezá tu<br />próximo viaje</h1>
          <p class="mt-3 max-w-md text-[15px] text-mint-text md:text-lg">Todo charlando, sin formularios. Vos contás, yo propongo, y lo afinamos juntos.</p>
        </div>
      </div>

      <ol v-if="!hasTrips || composing" class="hidden gap-3 md:grid md:grid-cols-3">
        <li v-for="(s, i) in STEPS" :key="s.title" class="rounded-2xl bg-white/10 p-3.5">
          <div class="text-xs font-bold text-mint-text">Paso {{ i + 1 }}</div>
          <div class="mt-1 font-bold">{{ s.title }}</div>
        </li>
      </ol>
      <span v-else class="hidden md:block" />
    </section>

    <!-- Right side: your trips, or how to start the first one -->
    <section class="flex flex-col gap-5 px-5 py-6 md:min-h-[calc(100dvh-2rem)] md:flex-1 md:justify-center md:px-10">
      <div v-if="!loaded" class="mx-auto flex w-full max-w-xl flex-col gap-3" aria-busy="true">
        <span v-for="n in 3" :key="n" class="h-20 animate-pulse rounded-2xl bg-white" />
      </div>

      <!-- With trips: the list first, a new one on demand -->
      <div v-else-if="hasTrips && !composing" class="mx-auto flex w-full max-w-xl flex-col gap-4 md:py-6">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-display text-3xl font-bold md:text-4xl">Mis viajes</h2>
          <button class="btn-primary h-11 px-5 text-[15px]" @click="newTrip">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Nuevo viaje
          </button>
        </div>

        <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

        <RouterLink v-if="toReview" to="/bookings" class="flex items-center gap-3 rounded-[18px] bg-sun-soft px-4 py-3 text-[#6B4E00] hover:bg-sun/40">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          <span class="min-w-0 flex-1 text-[14px] font-extrabold">
            {{ toReview === 1 ? 'Tenés 1 email con reservas por revisar' : `Tenés ${toReview} emails con reservas por revisar` }}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="flex-none" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </RouterLink>

        <RouterLink
          v-for="t in sortedTrips"
          :key="t.id"
          :to="`/trips/${t.id}`"
          class="group flex items-center gap-4 rounded-[22px] border border-slate-200 bg-white px-4 py-4 transition hover:border-brand hover:shadow-[0_8px_24px_rgba(14,31,24,0.07)]"
          :class="statusOf(t).tone === 'past' ? 'opacity-75' : ''"
        >
          <span
            class="grid h-12 w-12 flex-none place-items-center rounded-2xl"
            :class="statusOf(t).tone === 'now' ? 'bg-sun' : statusOf(t).tone === 'past' ? 'bg-rocio' : 'bg-brand-soft'"
          >
            <svg width="24" height="24" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M16 46 C 22 22, 42 44, 48 18" :stroke="statusOf(t).tone === 'now' ? '#3D2C00' : '#0A7A55'" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 8" /><circle cx="16" cy="46" r="7" :fill="statusOf(t).tone === 'now' ? '#3D2C00' : '#0A7A55'" /><circle cx="48" cy="18" r="8.5" :fill="statusOf(t).tone === 'now' ? '#FFFFFF' : '#F5C84C'" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[17px] font-extrabold">
              {{ t.name }}
              <span v-if="t.userId !== auth.user?.id" class="ml-1 rounded-full bg-brand-soft px-2 py-0.5 align-middle text-[11px] font-extrabold text-brand-dark">Compartido</span>
            </span>
            <span class="block truncate text-[13px] text-slate-500">
              <template v-if="t.datesTentative">{{ [t.whenHint, t.lengthDays && `~${t.lengthDays} días`].filter(Boolean).join(' · ') || t.destination }}</template>
              <template v-else-if="t.startDate && t.endDate">{{ fmtDay(t.startDate, { day: 'numeric', month: 'short' }) }} → {{ fmtDay(t.endDate, { day: 'numeric', month: 'short', year: 'numeric' }) }}</template>
              <template v-else>{{ t.destination }}</template>
              <span class="font-bold sm:hidden" :class="statusOf(t).tone === 'now' ? 'text-[#6B4E00]' : statusOf(t).tone === 'soon' ? 'text-brand-dark' : ''"> · {{ statusOf(t).label }}</span>
            </span>
          </span>
          <span
            class="hidden flex-none rounded-full px-2.5 py-1 text-xs font-extrabold sm:inline"
            :class="{
              'bg-sun-soft text-[#6B4E00]': statusOf(t).tone === 'now',
              'bg-brand-soft text-brand-dark': statusOf(t).tone === 'soon',
              'bg-rocio text-slate-500': statusOf(t).tone === 'past' || statusOf(t).tone === 'draft',
            }"
          >{{ statusOf(t).label }}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" class="flex-none group-hover:stroke-brand" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </RouterLink>
      </div>

      <!-- No trips yet, or "Nuevo viaje": the big start -->
      <template v-else>
        <button
          v-if="hasTrips"
          class="mx-auto flex w-full max-w-xl items-center gap-1 text-sm font-bold text-slate-500 hover:text-brand"
          @click="composing = false"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          Mis viajes
        </button>
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
              ref="box"
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
              v-for="sg in SUGGESTIONS"
              :key="sg"
              class="h-9 rounded-full border border-slate-300 bg-white/60 px-3.5 text-[13px] font-medium text-slate-700 hover:border-brand hover:text-brand"
              @click="start(sg)"
            >
              {{ sg }}
            </button>
          </div>
          <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>
        </div>
      </template>
    </section>
  </div>
</template>
