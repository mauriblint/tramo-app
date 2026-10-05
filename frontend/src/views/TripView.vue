<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, type Booking, type BookingInput, type BookingKind, type GenerationStatus, type Question, type Message, type Pin, type PinDraft, type PinStatus, type Stop, type Trip } from '@/api'
import BookingForm from '@/components/BookingForm.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import HotelList from '@/components/HotelList.vue'
import TransportList from '@/components/TransportList.vue'
import PinBoard from '@/components/PinBoard.vue'
import PinEditor from '@/components/PinEditor.vue'
import RouteCard from '@/components/RouteCard.vue'
import TripBrief from '@/components/TripBrief.vue'
import InstallCard from '@/components/InstallCard.vue'
import DayView from '@/components/DayView.vue'
import ItineraryList from '@/components/ItineraryList.vue'
import PinDetail from '@/components/PinDetail.vue'
import TripSidebar from '@/components/TripSidebar.vue'
import TripTabs, { type TripTab } from '@/components/TripTabs.vue'
import { canOfferInstall, dismissInstall, install } from '@/install'
import TripCover from '@/components/TripCover.vue'
import TripHeader from '@/components/TripHeader.vue'
import { PACE_LABEL, TRAVELERS_LABEL } from '@/tripProfile'
import { daysBetween, emptyDraft, fmtDay } from '@/pinMeta'
import { useTripWeather } from '@/weather'
import { TRANSPORT_KINDS, emptyBooking } from '@/bookings'
import { profileSteps, routeReplies } from '@/tripProfile'

const props = defineProps<{ id: string; section?: string; item?: string }>()
const router = useRouter()
const route = useRoute()

const trip = ref<Trip | null>(null)
const stops = ref<Stop[]>([])
const pins = ref<Pin[]>([])
const bookings = ref<Booking[]>([])
const messages = ref<Message[]>([])
const generation = ref<GenerationStatus | null>(null)
const question = ref<Question | null>(null)
const error = ref('')
const sending = ref(false)
const pendingText = ref('')
const failed = ref(0)
const extractingId = ref<string | null>(null)
const highlightIds = ref<string[]>([])
/** Planned view: the copilot opens as a sheet over whatever you're looking at. */
const sheet = ref<'chat' | null>(null)

// Where you are: the trip (with its tabs), one day, or one activity — all in the URL.
const level = computed<'trip' | 'day' | 'pin'>(() =>
  props.section === 'days' && props.item ? 'day' : props.section === 'pins' && props.item ? 'pin' : 'trip',
)
const tab = computed<TripTab>(() => {
  const t = route.query.tab
  return t === 'transporte' || t === 'hoteles' || t === 'ideas' ? t : 'itinerario'
})
/** The sidebar keeps the section you came from highlighted while you're inside a day or an activity. */
const navTab = computed<TripTab>(() => (level.value === 'trip' ? tab.value : currentPin.value && !currentPin.value.day ? 'ideas' : 'itinerario'))
const SECTION = computed(() => ({
  itinerario: {
    title: 'Itinerario',
    subtitle: [days.value.length && `${days.value.length} días`, stops.value.map((s) => s.city).join(' → ')].filter(Boolean).join(' · '),
    action: 'Agregar actividad',
  },
  transporte: { title: 'Transporte', subtitle: 'Vuelos, trenes y buses', action: 'Agregar transporte' },
  hoteles: { title: 'Hoteles', subtitle: 'Dónde dormís cada noche', action: 'Agregar hotel' },
  ideas: { title: 'Ideas', subtitle: 'Lugares guardados que todavía no tienen día', action: 'Agregar idea' },
}))

// Desktop scrolls inside the white panel: start each screen at the top.
const panel = ref<HTMLElement>()
const isDesktop = ref(typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches)
if (typeof window !== 'undefined') window.matchMedia('(min-width: 768px)').addEventListener('change', (e) => (isDesktop.value = e.matches))
watch(
  () => route.fullPath,
  () => panel.value?.scrollTo({ top: 0 }),
)

const currentPin = computed(() => (level.value === 'pin' ? (pins.value.find((p) => p.id === props.item) ?? null) : null))
const weather = useTripWeather(trip, stops)

// The copilot gets the current day or activity as context, so "cambiá esto" knows what "esto" is.
const copilotContext = computed(() => {
  if (level.value === 'day' && props.item) return `el día ${days.value.indexOf(props.item) + 1} (${fmtDay(props.item)})`
  const p = currentPin.value
  if (p) return p.day ? `“${p.title}” (día ${days.value.indexOf(p.day) + 1}, ${fmtDay(p.day)})` : `“${p.title}”`
  return null
})
const copilotPlaceholder = computed(() =>
  level.value === 'day' ? 'Cambiá algo de este día…' : level.value === 'pin' ? 'Preguntá algo de este lugar…' : 'Pedile cambios al copiloto…',
)
function sendFromCopilot(text: string, patch?: Partial<Trip>, structured?: boolean) {
  send(copilotContext.value && !structured ? `Sobre ${copilotContext.value}: ${text}` : text, patch, structured)
}
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

// Offer "Add to Home Screen" once the itinerary is ready: that's when having it on the phone pays off.
const showInstall = ref(false)
const forcedInstall = typeof route.query.install === 'string' ? route.query.install : null
watch(
  () => planned.value && !generation.value?.running,
  (ready) => {
    if (!ready) return
    if (forcedInstall === 'ios' || forcedInstall === 'android') install.platform = forcedInstall
    if (forcedInstall || canOfferInstall()) setTimeout(() => (showInstall.value = true), 1500)
  },
)
function closeInstall() {
  showInstall.value = false
  dismissInstall()
}

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
    bookings.value = data.bookings
    messages.value = data.messages
    generation.value = data.generation
    question.value = data.question
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

// ---- bookings (flights, trains, buses, hotels): loaded by hand, shown in the itinerary
const bookingForm = ref<{ initial: BookingInput; editing: Booking | null; kinds: BookingKind[] } | null>(null)
const bookingBusy = ref(false)
const bookingError = ref('')
const bookingPlaces = computed(() => [...new Set([...stops.value.map((s) => s.city), ...bookings.value.flatMap((b) => [b.origin, b.destination])].filter((x): x is string => !!x))])

function openBooking(prefill: Partial<BookingInput> = {}) {
  const kind = prefill.kind ?? (tab.value === 'hoteles' ? 'hotel' : 'flight')
  bookingError.value = ''
  bookingForm.value = { initial: emptyBooking(kind, prefill), editing: null, kinds: kind === 'hotel' ? ['hotel'] : TRANSPORT_KINDS }
}
function editBooking(b: Booking) {
  bookingError.value = ''
  bookingForm.value = { initial: { ...b }, editing: b, kinds: b.kind === 'hotel' ? ['hotel'] : TRANSPORT_KINDS }
}
async function saveBooking(input: BookingInput) {
  const f = bookingForm.value
  if (!f) return
  bookingBusy.value = true
  bookingError.value = ''
  try {
    if (f.editing) {
      const res = await api.updateBooking(props.id, f.editing.id, input)
      bookings.value = bookings.value.map((b) => (b.id === res.id ? res : b))
    } else {
      bookings.value = [...bookings.value, await api.createBooking(props.id, input)]
    }
    bookingForm.value = null
  } catch (e) {
    bookingError.value = (e as Error).message
  } finally {
    bookingBusy.value = false
  }
}
async function deleteBooking() {
  const b = bookingForm.value?.editing
  if (!b || !confirm('¿Borrar esta reserva?')) return
  await run(() => api.deleteBooking(props.id, b.id))
  bookings.value = bookings.value.filter((x) => x.id !== b.id)
  bookingForm.value = null
}

async function movePin(p: Pin, day: string | null) {
  const res = await run(() => api.updatePin(props.id, p.id, { day }))
  if (res) Object.assign(p, res)
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
  if (level.value === 'pin') router.back()
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
  router.push('/plan')
}

const editorTitle = computed(() =>
  !editor.value ? '' : editor.value.ctx.kind === 'pin' ? 'Editar' : editor.value.ctx.kind === 'new' ? 'Agregar al viaje' : 'Añadir al viaje',
)
</script>

<template>
  <div :class="trip && planned ? '' : 'flex h-dvh flex-col'">
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

    <!-- ============ Planned: trip → day → activity, one narrow column ============ -->
    <!-- Phone: one column (map, sheet, tabs). Desktop: the green trip sidebar + one white panel showing one thing at a time. -->
    <div v-else-if="trip" class="min-h-dvh bg-rocio pb-32 md:flex md:h-dvh md:min-h-0 md:gap-4 md:p-4">
      <TripSidebar class="hidden md:flex" :trip="trip" :facts="tripFacts" :active="navTab" :ideas="ideas.length" @copilot="sheet = 'chat'" @edit="openTripEditor" />

      <div ref="panel" class="md:min-w-0 md:flex-1 md:overflow-y-auto md:rounded-[28px] md:bg-white">
      <div class="mx-auto w-full max-w-[720px] md:max-w-[800px] md:px-8 md:py-7">
        <template v-if="level === 'trip'">
          <!-- Desktop section header -->
          <div class="mb-5 hidden items-end justify-between gap-4 md:flex">
            <div class="min-w-0">
              <h1 class="font-display text-[30px] leading-tight font-bold">{{ SECTION[tab].title }}</h1>
              <p class="mt-0.5 text-[14px] text-slate-500">{{ SECTION[tab].subtitle }}</p>
            </div>
            <button class="btn-primary h-11 flex-none px-5" @click="tab === 'transporte' || tab === 'hoteles' ? openBooking() : openNew(null)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              {{ SECTION[tab].action }}
            </button>
          </div>

          <div v-if="tab === 'itinerario' || !isDesktop" class="relative h-[300px] md:h-[260px] md:overflow-hidden md:rounded-[24px]">
            <TripCover :stops="stops" :destination="trip.destination" />
            <div class="absolute inset-x-0 top-0 z-[500] flex items-center justify-between p-3 md:hidden">
              <RouterLink to="/plan" aria-label="Mis viajes" class="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow-md hover:bg-white">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E1F18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              </RouterLink>
              <button aria-label="Editar viaje" class="grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow-md hover:bg-white" @click="openTripEditor">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E1F18" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
              </button>
            </div>
          </div>

          <section class="relative z-[600] -mt-7 flex flex-col gap-5 rounded-t-[28px] bg-rocio px-4 pt-6 pb-6 md:mt-6 md:rounded-none md:bg-transparent md:p-0">
            <div class="px-1 md:hidden">
              <h1 class="font-display text-[32px] leading-[1.04] font-bold md:text-[38px]">{{ trip.name }}</h1>
              <p class="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[15px] text-slate-500">
                <template v-for="(f, i) in tripFacts" :key="f">
                  <span v-if="i" class="text-slate-300">·</span>
                  <span>{{ f }}</span>
                </template>
              </p>
            </div>

            <TripTabs class="md:hidden" :trip-id="trip.id" :active="tab" :ideas="ideas.length" />

            <template v-if="tab === 'itinerario'">
              <div v-if="generation?.running" class="rounded-2xl bg-brand-soft px-4 py-3">
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
              <ItineraryList :trip="trip" :stops="stops" :pins="pins" :generation="generation" :highlight-ids="highlightIds" :weather="weather" />
            </template>

            <div v-else-if="tab === 'ideas'" class="-mx-4 md:mx-0 md:overflow-hidden md:rounded-[22px] md:bg-rocio">
              <PinBoard
                :pins="ideas"
                :highlight-ids="highlightIds"
                :trip-start="trip.startDate"
                :trip-end="trip.endDate"
                @add="openNew(null)"
                @edit="(p) => router.push(`/trips/${trip!.id}/pins/${p.id}`)"
                @status="setStatus"
                @located="(p, np) => Object.assign(p, np)"
              />
            </div>

            <template v-else>
              <button
                class="flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed border-[#9FC9B4] text-[15px] font-bold text-brand-dark hover:bg-white md:hidden"
                @click="openBooking()"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {{ SECTION[tab].action }}
              </button>
              <TransportList v-if="tab === 'transporte'" :trip="trip" :stops="stops" :bookings="bookings" @edit="editBooking" @add="openBooking" />
              <HotelList v-else :trip="trip" :stops="stops" :bookings="bookings" @edit="editBooking" @add="openBooking" />
            </template>
          </section>
        </template>

        <DayView
          v-else-if="level === 'day'"
          :trip="trip"
          :stops="stops"
          :pins="pins"
          :day="item!"
          :weather="weather"
          @located="(p, np) => Object.assign(p, np)"
          @add="openNew"
        />

        <PinDetail
          v-else-if="currentPin"
          :trip="trip"
          :stops="stops"
          :pins="pins"
          :pin="currentPin"
          @edit="(p) => (editor = { ctx: { kind: 'pin', pin: p }, draft: { ...p } })"
          @done="(p, done) => setStatus(p, done ? 'done' : 'want')"
          @move="movePin"
          @located="(p, np) => Object.assign(p, np)"
        />
      </div>
      </div>

      <!-- Copilot bar: it knows which day or activity you're looking at -->
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[700] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:hidden">
        <button
          class="pointer-events-auto mx-auto flex h-14 w-full max-w-[720px] items-center gap-3 rounded-full bg-noche pr-2 pl-5 text-left text-white shadow-[0_12px_28px_rgba(14,31,24,0.3)]"
          @click="sheet = 'chat'"
        >
          <span class="flex-1 truncate text-[15px] text-white/70">{{ copilotPlaceholder }}</span>
          <span class="grid h-10 w-10 place-items-center rounded-full bg-white text-noche">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </button>
      </div>

      <div v-if="sheet" class="fixed inset-0 z-[900] flex items-end justify-center bg-noche/30" @click.self="sheet = null">
        <div class="flex h-[88dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-[28px] bg-rocio shadow-2xl">
          <div class="flex items-center justify-between px-5 pt-4 pb-2">
            <div class="min-w-0">
              <h2 class="font-display text-lg font-bold">Copiloto</h2>
              <p v-if="copilotContext" class="truncate text-[13px] text-slate-500">Sobre {{ copilotContext }}</p>
            </div>
            <button aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full hover:bg-white" @click="sheet = null">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <ChatPanel
            class="min-h-0 flex-1"
            :messages="messages"
            :sending="sending"
            :pending-text="pendingText"
            :extracting-id="extractingId"
            :failed="failed"
            :quick="quick"
            :placeholder="copilotPlaceholder"
            @send="sendFromCopilot"
            @extract="extract"
            @accept="(m, i) => accept(m, i)"
            @edit-accept="(m, i) => (editor = { ctx: { kind: 'suggestion', message: m, index: i }, draft: { ...m.suggestions[i]!.draft } })"
            @dismiss="dismiss"
            @clear="clearChat"
          />
        </div>
      </div>
    </div>

    <InstallCard v-if="showInstall" @close="closeInstall" />

    <BookingForm
      v-if="bookingForm"
      :key="bookingForm.editing?.id ?? 'new'"
      :initial="bookingForm.initial"
      :editing="bookingForm.editing"
      :kinds="bookingForm.kinds"
      :places="bookingPlaces"
      :busy="bookingBusy"
      :error="bookingError"
      @save="saveBooking"
      @delete="deleteBooking"
      @close="bookingForm = null"
    />

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
