<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, type Booking, type BookingInput, type BookingKind, type GenerationStatus, type TimeOfDay, type Question, type Message, type Pin, type PinDraft, type PinStatus, type Stop, type Trip } from '@/api'
import BookingForm from '@/components/BookingForm.vue'
import DateRangePicker from '@/components/DateRangePicker.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import CopilotDock from '@/components/CopilotDock.vue'
import HotelList from '@/components/HotelList.vue'
import IdeasBoard from '@/components/IdeasBoard.vue'
import PasteBookings from '@/components/PasteBookings.vue'
import TransportList from '@/components/TransportList.vue'
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
/** The copilot dock (column or bottom sheet); other screens can open it. */
const dock = ref<InstanceType<typeof CopilotDock>>()

// Where you are: the trip (with its tabs), one day, or one activity — all in the URL.
const level = computed<'trip' | 'day' | 'pin'>(() =>
  props.section === 'days' && props.item ? 'day' : props.section === 'pins' && props.item ? 'pin' : 'trip',
)
const tab = computed<TripTab>(() => {
  const t = route.query.tab
  return t === 'viajes' || t === 'hoteles' || t === 'ideas' ? t : 'itinerario'
})
/** The sidebar keeps the section you came from highlighted while you're inside a day or an activity. */
const navTab = computed<TripTab>(() => (level.value === 'trip' ? tab.value : currentPin.value && !currentPin.value.day ? 'ideas' : 'itinerario'))
const SECTION: Record<TripTab, { title: string; action: string }> = {
  itinerario: { title: 'Itinerario', action: 'Agregar actividad' },
  viajes: { title: 'Viajes', action: 'Agregar viaje' },
  hoteles: { title: 'Hoteles', action: 'Agregar hotel' },
  ideas: { title: 'Ideas', action: 'Agregar idea' },
}
/** Itinerary header pills: short facts that stay readable however many stops the trip has. */
const itineraryPills = computed(() => {
  const t = trip.value
  return [
    days.value.length ? `${days.value.length} días` : null,
    stops.value.length ? `${stops.value.length} ${stops.value.length === 1 ? 'ciudad' : 'ciudades'}` : null,
  ].filter((x): x is string => !!x)
})

// Desktop scrolls inside the white panel: start each screen at the top.
const panel = ref<HTMLElement>()
const isDesktop = ref(typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches)
if (typeof window !== 'undefined') window.matchMedia('(min-width: 768px)').addEventListener('change', (e) => (isDesktop.value = e.matches))
watch(
  () => route.fullPath,
  () => panel.value?.scrollTo({ top: 0 }),
)

const currentPin = computed(() => (level.value === 'pin' ? (pins.value.find((p) => p.id === props.item) ?? null) : null))
// Placeholder dates have no real weather to show.
const weather = useTripWeather(computed(() => (trip.value?.datesTentative ? null : trip.value)), stops)
/** "julio · a confirmar" / "10 nov → 24 nov" */
const datesLabel = computed(() => {
  const t = trip.value
  if (!t?.startDate || !t.endDate) return null
  if (t.datesTentative) return t.whenHint ? `${t.whenHint} · fechas a confirmar` : 'Fechas a confirmar'
  return `${fmtDay(t.startDate, { day: 'numeric', month: 'short' })} → ${fmtDay(t.endDate, { day: 'numeric', month: 'short' })}`
})

// The copilot gets the current day or activity as context, so "cambiá esto" knows what "esto" is.
// `copilotContext` is what the dock shows; `copilotRef` adds the date the model needs to map "este día".
const dayLabel = (d: string) => (trip.value?.datesTentative ? `el Día ${days.value.indexOf(d) + 1}` : `el día ${days.value.indexOf(d) + 1} (${fmtDay(d)})`)
const copilotContext = computed(() => {
  if (level.value === 'day' && props.item) return dayLabel(props.item)
  const p = currentPin.value
  if (p) return p.day ? `“${p.title}” (${dayLabel(p.day)})` : `“${p.title}”`
  return null
})
const copilotRef = computed(() => {
  const d = level.value === 'day' ? props.item : currentPin.value?.day
  return copilotContext.value && d ? `${copilotContext.value} [${d}]` : copilotContext.value
})
const copilotPlaceholder = computed(() =>
  level.value === 'day' ? 'Cambiá algo de este día…' : level.value === 'pin' ? 'Preguntá algo de este lugar…' : 'Pedile cambios al copiloto…',
)
function sendFromCopilot(text: string, patch?: Partial<Trip>, structured?: boolean) {
  send(text, patch, structured, structured ? null : copilotRef.value)
}
const tripFacts = computed(() => {
  const t = trip.value
  if (!t) return []
  const n = days.value.length
  return [
    datesLabel.value,
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
const planned = computed(() => !!trip.value?.freeform || !!generation.value?.running || pins.value.some((p) => p.day))

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
    : trip.value.freeform && !pins.value.some((p) => p.day)
      ? ['Proponeme una ruta', 'Ideas para arrancar', '¿Qué conviene reservar ya?'].map((label) => ({ label }))
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
  if (planned.value) return [routeSummary.value, datesLabel.value].filter(Boolean).join(' · ')
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

let refreshing = false
async function refreshLive() {
  if (refreshing) return
  refreshing = true
  try {
    const data = await api.getTrip(props.id)
    if (!sending.value) return
    stops.value = data.stops
    pins.value = data.pins
    generation.value = data.generation
  } catch {
    // the answer will bring it anyway
  } finally {
    refreshing = false
  }
}

async function generate() {
  const res = await run(() => api.generate(props.id))
  if (!res) return
  generation.value = res
  startPolling()
}

/** "Armar este día" (and the city, for a day that has none yet). */
async function buildDays(day: string, city: string | null) {
  const res = await run(() => api.generateDays(props.id, [day], city))
  if (!res) return
  generation.value = res.generation
  stops.value = res.stops
  startPolling()
}

/** A description typed in an empty day goes to the copilot, which knows the day (it opens so you see the answer). */
function askAboutDay(text: string) {
  dock.value?.open('half')
  sendFromCopilot(text)
}

/** Short confirmation at the top (e.g. after moving the dates). */
const notice = ref('')
function notify(text: string) {
  notice.value = text
  setTimeout(() => (notice.value = ''), 7000)
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

async function send(text: string, patch?: Partial<Trip>, structured = false, context: string | null = null) {
  sending.value = true
  pendingText.value = text
  // The copilot may start building days before it finishes answering: show the stays and skeletons as they happen.
  const live = setInterval(refreshLive, 1500)
  const res = await run(() => api.chat(props.id, text, patch, structured, context))
  clearInterval(live)
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
const pasting = ref(false)
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

/** From the Ideas tab: ask the copilot (it opens so you see the answer arrive). */
function askCopilot(text: string) {
  dock.value?.open('half')
  send(text)
}

async function schedulePin(p: Pin, day: string, timeOfDay: TimeOfDay) {
  const res = await run(() => api.updatePin(props.id, p.id, { day, timeOfDay }))
  if (!res) return
  Object.assign(p, res)
  flash([p.id])
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

// Moving the start keeps the length: the return date follows (change it after if the trip got longer or shorter).
watch(
  () => tripForm.value.startDate,
  (start, old) => {
    const end = tripForm.value.endDate
    if (!editingTrip.value || !start || !old || !end || start === old) return
    const shift = Date.parse(start) - Date.parse(old)
    tripForm.value.endDate = new Date(Date.parse(end) + shift).toISOString().slice(0, 10)
  },
)

async function saveTrip() {
  editingTrip.value = false
  await patchTrip(tripForm.value)
}

// ---- trip dates from the itinerary header
const pickingDates = ref(false)
const savingDates = ref(false)
/** The dates button: "Poner fechas" while they're placeholders, "9 oct → 22 oct" once real. */
const datesButton = computed(() => {
  const t = trip.value
  if (!t?.startDate || !t.endDate || t.datesTentative) return null
  return `${fmtDay(t.startDate, { day: 'numeric', month: 'short' })} → ${fmtDay(t.endDate, { day: 'numeric', month: 'short' })}`
})
async function saveDates(startDate: string, endDate: string) {
  savingDates.value = true
  await patchTrip({ startDate, endDate })
  savingDates.value = false
  pickingDates.value = false
}

/** Save trip fields; new dates move the plan along, so then reload it and say what moved. */
async function patchTrip(patch: Partial<Trip>) {
  const before = trip.value
  const res = await run(() => api.updateTrip(props.id, patch))
  if (!res) return
  if (res.startDate === before?.startDate && res.endDate === before?.endDate) {
    trip.value = res
    return
  }
  // New dates: the plan moved along with them.
  const data = await run(() => api.getTrip(props.id))
  if (data) {
    trip.value = data.trip
    stops.value = data.stops
    pins.value = data.pins
  }
  const parts = [
    res.moved ? `Moví todo el plan ${Math.abs(res.moved)} ${Math.abs(res.moved) === 1 ? 'día' : 'días'} ${res.moved > 0 ? 'para adelante' : 'para atrás'}.` : null,
    res.toIdeas ? `${res.toIdeas} ${res.toIdeas === 1 ? 'actividad quedó' : 'actividades quedaron'} fuera de las fechas: ${res.toIdeas === 1 ? 'está' : 'están'} en Ideas.` : null,
  ].filter(Boolean)
  if (parts.length) notify(parts.join(' '))
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
    <p v-if="notice" class="fixed inset-x-3 top-3 z-[1100] mx-auto flex max-w-lg items-start gap-2 rounded-2xl bg-noche px-4 py-3 text-sm font-semibold text-white shadow-xl" role="status">
      <span class="flex-1">{{ notice }}</span>
      <button aria-label="Cerrar" @click="notice = ''">×</button>
    </p>
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
    <div v-else-if="trip" class="min-h-dvh bg-rocio pb-40 md:flex md:h-dvh md:min-h-0 md:gap-4 md:p-4">
      <TripSidebar class="hidden md:flex" :trip="trip" :facts="tripFacts" :active="navTab" :ideas="ideas.length" @copilot="dock?.open()" @edit="openTripEditor" />

      <div ref="panel" class="md:min-w-0 md:flex-1 md:overflow-y-auto md:rounded-[28px] md:bg-white">
      <div class="mx-auto w-full max-w-[720px] md:max-w-[800px] md:px-8 md:pt-7 md:pb-36 xl:pb-7">
        <template v-if="level === 'trip'">
          <!-- Desktop section header -->
          <div class="mb-5 hidden items-center justify-between gap-4 md:flex">
            <div class="min-w-0">
              <h1 class="font-display text-[30px] leading-tight font-bold">{{ SECTION[tab].title }}</h1>
              <div v-if="tab === 'itinerario' && itineraryPills.length" class="mt-2 flex flex-wrap gap-1.5">
                <span v-for="p in itineraryPills" :key="p" class="inline-flex h-7 items-center rounded-full bg-rocio px-3 text-[13px] font-bold text-slate-600">{{ p }}</span>
              </div>
            </div>
            <div class="flex flex-none items-center gap-2">
            <button
              v-if="tab === 'viajes' || tab === 'hoteles'"
              class="inline-flex h-11 items-center gap-1.5 rounded-full border-[1.5px] border-[#DCE3DF] px-4 text-sm font-bold hover:border-brand hover:text-brand-dark"
              title="Pegá el mail de confirmación y lo cargo yo"
              @click="pasting = true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /></svg>
              Importar email
            </button>
            <template v-if="tab === 'itinerario'">
              <button v-if="datesButton" class="inline-flex h-11 items-center gap-2 rounded-full bg-rocio px-5 text-[15px] font-extrabold hover:bg-brand-soft" title="Cambiar las fechas" @click="pickingDates = true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                {{ datesButton }}
              </button>
              <button v-else class="btn-primary h-11 flex-none px-5" @click="pickingDates = true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                Poner fechas
              </button>
            </template>
            <button v-else class="btn-primary h-11 flex-none px-5" @click="tab === 'viajes' || tab === 'hoteles' ? openBooking() : openNew(null)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              {{ SECTION[tab].action }}
            </button>
            </div>
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
                  <!-- Real dates: tap them to change them -->
                  <button v-if="f === datesLabel && datesButton" class="font-semibold text-brand-dark underline decoration-dotted underline-offset-4" @click="pickingDates = true">{{ f }}</button>
                  <span v-else>{{ f }}</span>
                </template>
              </p>
            </div>

            <TripTabs class="md:hidden" :trip-id="trip.id" :active="tab" :ideas="ideas.length" />

            <button
              v-if="tab === 'itinerario' && !datesButton"
              class="flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-extrabold text-white md:hidden"
              @click="pickingDates = true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Poner fechas
            </button>

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
              <ItineraryList :trip="trip" :stops="stops" :pins="pins" :bookings="bookings" :generation="generation" :highlight-ids="highlightIds" :weather="weather" />
            </template>

            <IdeasBoard
              v-else-if="tab === 'ideas'"
              :trip="trip"
              :pins="pins"
              @ask="askCopilot"
              @add="openNew(null)"
              @schedule="schedulePin"
            />

            <template v-else>
              <div class="grid grid-cols-2 gap-2 md:hidden">
                <button class="flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-[#DCE3DF] bg-white text-[15px] font-bold" @click="pasting = true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /></svg>
                  Importar email
                </button>
                <button class="btn-primary h-12 text-[15px]" @click="openBooking()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  {{ SECTION[tab].action }}
                </button>
              </div>
              <TransportList v-if="tab === 'viajes'" :trip="trip" :stops="stops" :bookings="bookings" @edit="editBooking" @add="openBooking" />
              <HotelList v-else :trip="trip" :stops="stops" :bookings="bookings" @edit="editBooking" @add="openBooking" />
            </template>
          </section>
        </template>

        <DayView
          v-else-if="level === 'day'"
          :trip="trip"
          :stops="stops"
          :pins="pins"
          :bookings="bookings"
          :day="item!"
          :weather="weather"
          :generation="generation"
          :sending="sending"
          @located="(p, np) => Object.assign(p, np)"
          @add="openNew"
          @generate="buildDays"
          @ask="askAboutDay"
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

      <!-- The copilot, always present: right column on wide screens, bottom bar + sheet elsewhere. It knows the day/activity you're on. -->
      <CopilotDock
        ref="dock"
        :messages="messages"
        :sending="sending"
        :pending-text="pendingText"
        :extracting-id="extractingId"
        :failed="failed"
        :quick="quick"
        :context="copilotContext"
        :placeholder="copilotPlaceholder"
        @send="sendFromCopilot"
        @accept="(m, i) => accept(m, i)"
        @clear="clearChat"
      />
    </div>

    <InstallCard v-if="showInstall" @close="closeInstall" />

    <DateRangePicker
      v-if="pickingDates && trip"
      :start="trip.datesTentative ? null : trip.startDate"
      :end="trip.datesTentative ? null : trip.endDate"
      :keep-days="days.length || trip.lengthDays"
      :busy="savingDates"
      @save="saveDates"
      @close="pickingDates = false"
    />

    <PasteBookings
      v-if="pasting && trip"
      :trip-id="trip.id"
      @saved="(list) => ((bookings = [...bookings, ...list]), (pasting = false))"
      @close="pasting = false"
    />

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
          <input v-model="tripForm.startDate" type="date" class="input" aria-label="Fecha de ida" />
          <input v-model="tripForm.endDate" type="date" class="input" aria-label="Fecha de vuelta" />
        </div>
        <p class="text-[13px] text-slate-500">
          <template v-if="trip?.datesTentative">Son fechas provisorias. Al poner las reales, todo lo que armaste se mueve con ellas.</template>
          <template v-else>Si cambiás la ida, todo el plan se mueve con ella; lo que quede fuera de las fechas pasa a Ideas.</template>
        </p>
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
