<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, type GenerationStatus, type Question, type Message, type Pin, type PinDraft, type PinStatus, type Stop, type Trip } from '@/api'
import ChatPanel from '@/components/ChatPanel.vue'
import PinBoard from '@/components/PinBoard.vue'
import PinEditor from '@/components/PinEditor.vue'
import RouteCard from '@/components/RouteCard.vue'
import TripBrief from '@/components/TripBrief.vue'
import ItineraryList from '@/components/ItineraryList.vue'
import TripCover from '@/components/TripCover.vue'
import TripHeader from '@/components/TripHeader.vue'
import { PACE_LABEL, TRAVELERS_LABEL } from '@/tripProfile'
import { daysBetween, emptyDraft, fmtDay } from '@/pinMeta'
import { profileSteps, routeReplies } from '@/tripProfile'

const props = defineProps<{ id: string }>()
const router = useRouter()
const route = useRoute()

const trip = ref<Trip | null>(null)
const stops = ref<Stop[]>([])
const pins = ref<Pin[]>([])
const messages = ref<Message[]>([])
const generation = ref<GenerationStatus | null>(null)
const question = ref<Question | null>(null)
const error = ref('')
const sending = ref(false)
const pendingText = ref('')
const failed = ref(0)
const extractingId = ref<string | null>(null)
const highlightIds = ref<string[]>([])
type Tab = 'chat' | 'plan' | 'ideas'
const tab = ref<Tab>('plan')
/** Planned view: the chat and the ideas open as sheets over the itinerary. */
const sheet = ref<'chat' | 'ideas' | null>(null)
const tripFacts = computed(() => {
  const t = trip.value
  if (!t) return []
  const n = days.value.length
  return [
    t.startDate && t.endDate ? `${fmtDay(t.startDate, { day: 'numeric', month: 'short' })} – ${fmtDay(t.endDate, { day: 'numeric', month: 'short' })}` : null,
    n ? `${n} días` : null,
    stops.value.length ? `${stops.value.length} ${stops.value.length === 1 ? 'ciudad' : 'ciudades'}` : null,
    t.travelers ? TRAVELERS_LABEL[t.travelers] : null,
    t.pace ? `Ritmo ${PACE_LABEL[t.pace].toLowerCase()}` : null,
  ].filter((x): x is string => !!x)
})

// Editor state: either editing an existing pin, creating one, or editing a suggestion before accepting.
type EditorCtx = { kind: 'pin'; pin: Pin } | { kind: 'new' } | { kind: 'suggestion'; message: Message; index: number }
const editor = ref<{ ctx: EditorCtx; draft: PinDraft } | null>(null)
const editingTrip = ref(false)
const tripForm = ref<Partial<Trip>>({})

/** Before the day-by-day exists the screen is a conversation (+ route); afterwards it's the plan. */
const planned = computed(() => !!generation.value?.running || pins.value.some((p) => p.day))
const days = computed(() => daysBetween(trip.value?.startDate ?? null, trip.value?.endDate ?? null))
const ideas = computed(() => pins.value.filter((p) => !p.day))
const cities = computed(() =>
  [...new Set([...stops.value.map((s) => s.city), ...pins.value.map((p) => p.city)].filter((c): c is string => !!c))].sort(),
)

const steps = computed(() => (trip.value ? profileSteps(trip.value, stops.value) : []))
const quick = computed(() =>
  !trip.value
    ? []
    : planned.value
      ? ['¿Qué días están muy cargados?', 'Sumá un buen restaurante por noche', '¿Qué conviene reservar ya?', 'Proponeme alternativas si llueve'].map(
          (label) => ({ label }),
        )
      : routeReplies(stops.value),
)
const routeSummary = computed(() => steps.value.find((s) => s.key === 'ruta')?.value ?? '')
const headerSubtitle = computed(() => {
  const t = trip.value
  if (!t) return null
  if (planned.value) return [routeSummary.value, t.startDate && t.endDate && `${fmtDay(t.startDate)} → ${fmtDay(t.endDate)}`].filter(Boolean).join(' · ')
  return 'Nuevo viaje'
})

onMounted(load)

async function load() {
  try {
    const data = await api.getTrip(props.id)
    trip.value = data.trip
    stops.value = data.stops
    pins.value = data.pins
    messages.value = data.messages
    generation.value = data.generation
    question.value = data.question
    tab.value = planned.value ? 'plan' : 'chat'
    if (data.generation?.running) startPolling()
    // Coming from the home screen: the first message was typed there.
    const q = typeof route.query.q === 'string' ? route.query.q.trim() : ''
    if (q) {
      router.replace({ query: {} })
      if (!data.messages.some((m) => m.role === 'user')) send(q)
    }
  } catch (e) {
    error.value = (e as Error).message
  }
}

// ---- live generation: poll the trip while days are being written
let pollTimer: ReturnType<typeof setTimeout> | undefined

function startPolling() {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, 1000)
}

async function poll() {
  try {
    const data = await api.getTrip(props.id)
    pins.value = data.pins
    stops.value = data.stops
    generation.value = data.generation
    if (data.generation?.running) return startPolling()
    // Finished: pick up the "Listo" message.
    messages.value = data.messages
  } catch {
    startPolling()
  }
}
onBeforeUnmount(() => clearTimeout(pollTimer))

async function generate() {
  const res = await run(() => api.generate(props.id))
  if (!res) return
  generation.value = res
  tab.value = 'plan'
  startPolling()
}

function flash(ids: string[]) {
  highlightIds.value = ids
  setTimeout(() => (highlightIds.value = []), 4000)
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  error.value = ''
  try {
    return await fn()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function send(text: string, patch?: Partial<Trip>, structured = false) {
  const wasPlanned = planned.value
  sending.value = true
  pendingText.value = text
  const res = await run(() => api.chat(props.id, text, patch, structured))
  sending.value = false
  if (!res) {
    failed.value++
    return
  }
  messages.value.push(res.userMessage, res.assistantMessage)
  trip.value = res.trip
  stops.value = res.stops
  pins.value = res.pins
  generation.value = res.generation
  question.value = res.question
  flash(res.changedPinIds)
  if (res.generation?.running) startPolling()
  // Generation just started from the chat: on mobile jump to the plan to watch it.
  if (!wasPlanned && planned.value) tab.value = 'plan'
}

function replaceMessage(m: Message) {
  const i = messages.value.findIndex((x) => x.id === m.id)
  if (i >= 0) messages.value[i] = m
}

async function extract(m: Message) {
  extractingId.value = m.id
  const res = await run(() => api.extract(props.id, m.id))
  extractingId.value = null
  if (res) replaceMessage(res)
}

async function accept(m: Message, index: number, override?: PinDraft) {
  const res = await run(() => api.acceptSuggestion(props.id, m.id, index, override))
  if (!res) return
  replaceMessage(res.message)
  pins.value.push(res.pin)
  flash([res.pin.id])
}

async function dismiss(m: Message, index: number) {
  const res = await run(() => api.dismissSuggestion(props.id, m.id, index))
  if (res) replaceMessage(res)
}

async function clearChat() {
  if (!confirm('¿Empezar una conversación nueva? El viaje no se borra.')) return
  await run(() => api.clearChat(props.id))
  messages.value = []
}

async function setStatus(p: Pin, status: PinStatus) {
  const res = await run(() => api.updatePin(props.id, p.id, { status }))
  if (res) Object.assign(p, res)
}

function openNew(day: string | null = null) {
  const draft = emptyDraft()
  draft.day = day
  editor.value = { ctx: { kind: 'new' }, draft }
}

async function saveEditor(draft: PinDraft) {
  const ed = editor.value
  if (!ed) return
  if (ed.ctx.kind === 'pin') {
    const pin = ed.ctx.pin
    const res = await run(() => api.updatePin(props.id, pin.id, draft))
    if (res) Object.assign(pin, res)
  } else if (ed.ctx.kind === 'new') {
    const res = await run(() => api.createPin(props.id, draft))
    if (res) {
      pins.value.push(res)
      flash([res.id])
    }
  } else {
    await accept(ed.ctx.message, ed.ctx.index, draft)
  }
  editor.value = null
}

async function deleteEditingPin() {
  const ed = editor.value
  if (ed?.ctx.kind !== 'pin' || !confirm('¿Borrar este ítem?')) return
  const id = ed.ctx.pin.id
  await run(() => api.deletePin(props.id, id))
  pins.value = pins.value.filter((p) => p.id !== id)
  editor.value = null
}

function openTripEditor() {
  if (!trip.value) return
  tripForm.value = { ...trip.value }
  editingTrip.value = true
}

async function saveTrip() {
  const res = await run(() => api.updateTrip(props.id, tripForm.value))
  if (res) trip.value = res
  editingTrip.value = false
}

async function deleteTrip() {
  if (!confirm('¿Borrar el viaje completo?')) return
  await run(() => api.deleteTrip(props.id))
  router.push('/')
}

const editorTitle = computed(() =>
  !editor.value ? '' : editor.value.ctx.kind === 'pin' ? 'Editar' : editor.value.ctx.kind === 'new' ? 'Agregar al viaje' : 'Añadir al viaje',
)
</script>

<template>
  <div class="flex h-dvh flex-col">
    <p v-if="error" class="flex items-start gap-2 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      <span class="flex-1">{{ error }}</span>
      <button aria-label="Cerrar" @click="error = ''">×</button>
    </p>

    <!-- ============ Onboarding: conversation + route ============ -->
    <div v-if="trip && !planned" class="flex min-h-0 flex-1 flex-col md:flex-row md:gap-4 md:p-4">
      <TripHeader
        class="md:hidden"
        :title="trip.name === 'Nuevo viaje' ? 'Contame del viaje' : trip.name"
        :subtitle="headerSubtitle"
        :steps="steps"
        @edit="openTripEditor"
      />
      <TripBrief class="hidden w-[380px] flex-none md:flex" :trip="trip" :stops="stops" :steps="steps" :busy="sending" @generate="generate" />

      <section class="flex min-h-0 flex-1 flex-col md:rounded-[28px] md:bg-white">
        <ChatPanel
          class="mx-auto min-h-0 w-full max-w-2xl flex-1"
          simple
          :messages="messages"
          :sending="sending"
          :pending-text="pendingText"
          :extracting-id="extractingId"
          :failed="failed"
          :quick="quick"
          :question="question"
          :busy-label="question?.id === 'interests' ? 'Pensando una ruta para ustedes…' : 'Pensando…'"
          :placeholder="stops.length ? 'Pedí cambios a la ruta…' : 'Respondé o contame más…'"
          @send="send"
          @extract="extract"
          @accept="(m, i) => accept(m, i)"
          @edit-accept="(m, i) => (editor = { ctx: { kind: 'suggestion', message: m, index: i }, draft: { ...m.suggestions[i]!.draft } })"
          @dismiss="dismiss"
          @clear="clearChat"
        >
          <template #above-input>
            <RouteCard v-if="stops.length" class="mb-3 md:hidden" compact :trip="trip" :stops="stops" :busy="sending" @generate="generate" />
          </template>
        </ChatPanel>
      </section>
    </div>

    <!-- ============ Planned: map cover + day by day ============ -->
    <div v-else-if="trip" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-[600px] pb-32">
        <div class="relative h-[340px] md:mt-4 md:overflow-hidden md:rounded-[28px]">
          <TripCover :stops="stops" :destination="trip.destination" />
          <div class="absolute inset-x-0 top-0 z-[500] flex items-center justify-between p-3">
            <RouterLink to="/" aria-label="Volver" class="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow-md hover:bg-white">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E1F18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </RouterLink>
            <div class="flex gap-2">
              <button class="h-11 rounded-full bg-white/95 px-4 text-sm font-bold shadow-md hover:bg-white" @click="sheet = 'ideas'">
                Ideas<span v-if="ideas.length" class="text-slate-500"> · {{ ideas.length }}</span>
              </button>
              <button aria-label="Editar viaje" class="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow-md hover:bg-white" @click="openTripEditor">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E1F18" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
              </button>
            </div>
          </div>
        </div>

        <section class="relative z-[600] -mt-7 rounded-t-[28px] bg-rocio px-5 pt-6">
          <h1 class="font-display text-[30px] leading-[1.05] font-bold">{{ trip.name }}</h1>
          <p class="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[14px] text-slate-600">
            <template v-for="(f, i) in tripFacts" :key="f">
              <span v-if="i" class="text-slate-300">·</span>
              <span>{{ f }}</span>
            </template>
          </p>

          <div v-if="generation?.running" class="mt-5 rounded-2xl bg-brand-soft px-4 py-3">
            <div class="flex justify-between text-sm font-semibold text-brand-dark">
              <span>Armando tu itinerario…</span>
              <span class="tabular-nums">{{ generation.doneDays.length }} / {{ generation.totalDays }}</span>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
              <div
                class="h-full rounded-full bg-brand transition-all duration-500"
                :style="{ width: `${(100 * generation.doneDays.length) / Math.max(1, generation.totalDays)}%` }"
              />
            </div>
          </div>

          <ItineraryList
            class="mt-7"
            :trip="trip"
            :stops="stops"
            :pins="pins"
            :generation="generation"
            :highlight-ids="highlightIds"
            @edit="(p) => (editor = { ctx: { kind: 'pin', pin: p }, draft: { ...p } })"
          />
        </section>
      </div>

      <!-- Copilot bar -->
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[700] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          class="pointer-events-auto mx-auto flex h-14 w-full max-w-[568px] items-center gap-3 rounded-full bg-noche pr-2 pl-5 text-left text-white shadow-[0_12px_28px_rgba(14,31,24,0.3)]"
          @click="sheet = 'chat'"
        >
          <span class="flex-1 truncate text-[15px] text-white/70">Pedile cambios al copiloto…</span>
          <span class="grid h-10 w-10 place-items-center rounded-full bg-white text-noche">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </button>
      </div>

      <!-- Sheets -->
      <div v-if="sheet" class="fixed inset-0 z-[900] flex items-end justify-center bg-noche/30" @click.self="sheet = null">
        <div class="flex h-[88dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-[28px] bg-rocio shadow-2xl">
          <div class="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 class="font-display text-lg font-bold">{{ sheet === 'chat' ? 'Copiloto' : 'Ideas sin día' }}</h2>
            <button aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full hover:bg-white" @click="sheet = null">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <ChatPanel
            v-if="sheet === 'chat'"
            class="min-h-0 flex-1"
            :messages="messages"
            :sending="sending"
            :pending-text="pendingText"
            :extracting-id="extractingId"
            :failed="failed"
            :quick="quick"
            placeholder="Pedile cambios al copiloto…"
            @send="send"
            @extract="extract"
            @accept="(m, i) => accept(m, i)"
            @edit-accept="(m, i) => (editor = { ctx: { kind: 'suggestion', message: m, index: i }, draft: { ...m.suggestions[i]!.draft } })"
            @dismiss="dismiss"
            @clear="clearChat"
          />
          <div v-else class="min-h-0 flex-1 overflow-y-auto">
            <PinBoard
              :pins="ideas"
              :highlight-ids="highlightIds"
              :trip-start="trip.startDate"
              :trip-end="trip.endDate"
              @add="openNew(null)"
              @edit="(p) => (editor = { ctx: { kind: 'pin', pin: p }, draft: { ...p } })"
              @status="setStatus"
              @located="(p, np) => Object.assign(p, np)"
            />
          </div>
        </div>
      </div>
    </div>

    <PinEditor
      v-if="editor"
      :draft="editor.draft"
      :title="editorTitle"
      :cities="cities"
      :days="days"
      @save="saveEditor"
      @close="editor = null"
    >
      <template v-if="editor.ctx.kind === 'pin'" #extra>
        <button type="button" class="ml-auto text-sm text-rose-600 hover:underline" @click="deleteEditingPin">Borrar</button>
      </template>
    </PinEditor>

    <div v-if="editingTrip" class="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 sm:items-center" @click.self="editingTrip = false">
      <form class="w-full max-w-lg space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" @submit.prevent="saveTrip">
        <h2 class="text-lg font-semibold">Viaje</h2>
        <input v-model="tripForm.name" class="input" placeholder="Nombre" required />
        <input v-model="tripForm.destination" class="input" placeholder="Destino" />
        <div class="grid grid-cols-2 gap-3">
          <input v-model="tripForm.startDate" type="date" class="input" />
          <input v-model="tripForm.endDate" type="date" class="input" />
        </div>
        <textarea v-model="tripForm.notes" class="input min-h-32" placeholder="Ficha: vuelos, viajeros, intereses, ritmo…" />
        <div class="flex items-center gap-2">
          <button class="btn-primary">Guardar</button>
          <button type="button" class="btn" @click="editingTrip = false">Cancelar</button>
          <button type="button" class="ml-auto text-sm text-rose-600 hover:underline" @click="deleteTrip">Borrar viaje</button>
        </div>
      </form>
    </div>
  </div>
</template>
