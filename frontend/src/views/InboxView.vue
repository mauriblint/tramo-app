<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { api, type InboxItem, type Trip } from '@/api'
import { auth } from '@/auth'
import BookingSummary from '@/components/BookingSummary.vue'
import { fmtDay } from '@/pinMeta'

/** Forwarded emails we couldn't place on our own: the user picks the trip (account-wide, not per trip). */
const router = useRouter()
const items = ref<InboxItem[]>([])
const trips = ref<Trip[]>([])
/** Chosen trip per email. */
const choice = ref<Record<string, string>>({})
const loaded = ref(false)
const busyId = ref<string | null>(null)
const error = ref('')

const today = new Date().toISOString().slice(0, 10)
const isOpen = (t: Trip) => !t.endDate || t.endDate >= today

/** Ongoing and upcoming trips first (by date), finished ones after. */
const sortedTrips = computed(() =>
  [...trips.value].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (a.startDate ?? '9').localeCompare(b.startDate ?? '9')),
)
const tripLabel = (t: Trip) =>
  t.startDate ? `${t.name} · ${fmtDay(t.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : t.name

onMounted(async () => {
  try {
    const [inbox, all] = await Promise.all([api.inbox(), api.listTrips()])
    items.value = inbox
    trips.value = all.filter((t) => t.destination)
    const open = trips.value.filter(isOpen)
    for (const it of inbox) choice.value[it.id] = it.tripId ?? (open.length === 1 ? open[0]!.id : '')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loaded.value = true
  }
})

/** Once the last one is handled, go where the bookings went (or back to the trips). */
function done(item: InboxItem, tripId?: string) {
  items.value = items.value.filter((x) => x.id !== item.id)
  if (items.value.length) return
  if (!tripId) return router.replace('/plan')
  const tab = item.bookings.every((b) => b.kind === 'hotel') ? 'hoteles' : 'viajes'
  router.replace({ path: `/trips/${tripId}`, query: { tab } })
}

async function add(item: InboxItem) {
  const tripId = choice.value[item.id]
  if (!tripId) return
  error.value = ''
  busyId.value = item.id
  try {
    await api.importInbox(item.id, tripId, item.bookings)
    done(item, tripId)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busyId.value = null
  }
}

async function dismiss(item: InboxItem) {
  error.value = ''
  busyId.value = item.id
  try {
    await api.dismissInbox(item.id)
    done(item)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busyId.value = null
  }
}

const received = (iso: string) => new Date(iso).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="min-h-dvh px-5 py-6 md:py-12">
    <div class="mx-auto flex w-full max-w-xl flex-col gap-5">
      <RouterLink to="/plan" class="flex items-center gap-1 self-start text-sm font-bold text-slate-500 hover:text-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        Mis viajes
      </RouterLink>

      <div>
        <h1 class="font-display text-3xl font-bold md:text-4xl">Reservas por revisar</h1>
        <p class="mt-2 text-[15px] leading-relaxed text-slate-500">
          Recibimos estos emails pero no sabemos con certeza a qué viaje corresponden. Elige el viaje y revisa los datos.
        </p>
      </div>

      <p v-if="error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

      <div v-if="!loaded" class="flex flex-col gap-3" aria-busy="true">
        <span v-for="n in 2" :key="n" class="h-40 animate-pulse rounded-[22px] bg-white" />
      </div>

      <div v-else-if="!items.length" class="rounded-[22px] bg-white p-5 text-[15px] text-slate-500">
        No hay reservas por revisar.
        <template v-if="auth.inboundAddress && auth.user">
          Reenvía tus confirmaciones a <span class="font-bold text-noche select-all">{{ auth.inboundAddress }}</span> desde {{ auth.user.email }} y las agregamos a tu viaje.
        </template>
      </div>

      <article v-for="item in items" :key="item.id" class="flex flex-col gap-4 rounded-[22px] border border-slate-200 bg-white p-4 sm:p-5">
        <div class="min-w-0">
          <div class="truncate text-[16px] font-extrabold">{{ item.subject || 'Email sin asunto' }}</div>
          <div class="text-[13px] text-slate-500">Recibido {{ received(item.receivedAt) }}</div>
        </div>

        <template v-if="item.bookings.length">
          <ul class="flex flex-col gap-2.5">
            <BookingSummary
              v-for="(b, i) in item.bookings"
              :key="i"
              :booking="b"
              :removable="item.bookings.length > 1"
              @remove="item.bookings.splice(i, 1)"
            />
          </ul>
          <p v-if="item.skipped" class="text-[13px] text-slate-500">
            {{ item.skipped }} {{ item.skipped === 1 ? 'reserva no se importó' : 'reservas no se importaron' }} por datos incompletos; puedes cargarlas manualmente.
          </p>

          <label class="flex flex-col gap-1.5">
            <span class="text-[13px] font-bold text-slate-600">Viaje</span>
            <select
              v-model="choice[item.id]"
              class="h-12 rounded-2xl border-[1.5px] border-[#DCE3DF] bg-white px-3.5 text-[15px] outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
            >
              <option value="" disabled>Elige un viaje</option>
              <option v-for="t in sortedTrips" :key="t.id" :value="t.id">{{ tripLabel(t) }}</option>
            </select>
          </label>
          <div class="flex items-center gap-3">
            <button class="btn-primary h-12 flex-1 text-[15px]" :disabled="busyId === item.id || !choice[item.id]" @click="add(item)">
              {{ busyId === item.id ? 'Guardando…' : 'Agregar al viaje' }}
            </button>
            <button type="button" class="h-12 rounded-full px-4 text-sm font-bold text-slate-500 hover:bg-rocio" :disabled="busyId === item.id" @click="dismiss(item)">Descartar</button>
          </div>
        </template>

        <template v-else>
          <p class="rounded-2xl bg-rocio px-4 py-3 text-[14px] text-slate-600">
            {{ item.error ?? (item.skipped ? 'Encontramos reservas pero con datos incompletos; cárgalas manualmente.' : 'No encontramos reservas en este email.') }}
          </p>
          <button type="button" class="h-11 self-start rounded-full px-4 text-sm font-bold text-slate-500 hover:bg-rocio" :disabled="busyId === item.id" @click="dismiss(item)">Descartar</button>
        </template>
      </article>
    </div>
  </div>
</template>
