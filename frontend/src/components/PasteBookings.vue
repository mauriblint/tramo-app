<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { api, type Booking, type BookingInput } from '@/api'
import { DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, KIND_META } from '@/bookings'
import { fmtDay } from '@/pinMeta'

/** "Pegá tu confirmación": paste an email, review what was understood, save it. */
const props = defineProps<{ tripId: string }>()
const emit = defineEmits<{ saved: [Booking[]]; close: [] }>()

const text = ref('')
const found = ref<BookingInput[] | null>(null)
const skipped = ref(0)
const busy = ref(false)
const error = ref('')
const box = ref<HTMLTextAreaElement>()
onMounted(() => nextTick(() => box.value?.focus()))

const day = (d: string | null) => (d ? fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ')

/** "Tren Hakutaka 562 · vie 16 oct 10:15 → 13:08" */
function when(b: BookingInput) {
  const name = join(KIND_META[b.kind].label, b.number)
  const leave = join(day(b.departDate), b.departTime)
  const arrive = b.arriveTime ? join(b.arriveDate && day(b.arriveDate), b.arriveTime) : ''
  return `${name} · ${leave}${arrive ? ` → ${arrive}` : ''}`
}

async function read() {
  error.value = ''
  busy.value = true
  try {
    const res = await api.parseBookings(props.tripId, text.value)
    found.value = res.bookings
    skipped.value = res.skipped
    if (!res.bookings.length)
      error.value = res.skipped
        ? `Encontré ${res.skipped === 1 ? 'una reserva' : `${res.skipped} reservas`} pero con datos incompletos (${res.problems.join(', ').toLowerCase()}). Probá de nuevo o cargala a mano.`
        : 'No encontré reservas en ese texto. ¿Pegaste el mail completo?'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function saveAll() {
  if (!found.value?.length) return
  error.value = ''
  busy.value = true
  const saved: Booking[] = []
  try {
    for (const b of found.value) saved.push(await api.createBooking(props.tripId, b))
    emit('saved', saved)
  } catch (e) {
    error.value = (e as Error).message
    if (saved.length) emit('saved', saved)
  } finally {
    busy.value = false
  }
}

const title = computed(() => (found.value?.length ? `Encontré ${found.value.length} ${found.value.length === 1 ? 'reserva' : 'reservas'}` : 'Pegá tu confirmación'))
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-end justify-center bg-noche/45 sm:items-center sm:p-4" @click.self="emit('close')">
    <div class="flex max-h-[92dvh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:px-6">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-[22px] font-bold">{{ title }}</h2>
        <button type="button" aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full bg-rocio" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <!-- 1 · paste -->
      <template v-if="!found?.length">
        <p class="text-[15px] leading-relaxed text-slate-500">
          Copiá el mail de la aerolínea, del tren o del hotel (Booking, Airbnb…) y pegalo acá. Saco los datos y los revisás antes de guardar.
        </p>
        <label class="sr-only" for="paste-box">Texto del mail</label>
        <textarea
          id="paste-box"
          ref="box"
          v-model="text"
          rows="8"
          placeholder="Pegá acá el mail de confirmación…"
          class="rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
        <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
        <button class="btn-primary h-12 text-[15px]" :disabled="busy || text.trim().length < 20" @click="read">
          {{ busy ? 'Leyendo el mail…' : 'Leer mail' }}
        </button>
      </template>

      <!-- 2 · review -->
      <template v-else>
        <ul class="flex flex-col gap-2.5">
          <li v-for="(b, i) in found" :key="i" class="flex gap-3 rounded-[18px] bg-rocio px-4 py-3">
            <span class="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl bg-white">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[b.kind].icon" />
            </span>
            <span class="min-w-0 flex-1 text-[14px] leading-snug">
              <template v-if="b.kind === 'hotel'">
                <span class="block font-extrabold">{{ b.hotelName }}</span>
                <span class="block text-slate-600">{{ join(day(b.checkInDate), b.checkInTime ?? DEFAULT_CHECK_IN) }} → {{ join(day(b.checkOutDate), b.checkOutTime ?? DEFAULT_CHECK_OUT) }}</span>
                <span v-if="b.address" class="block truncate text-slate-500">{{ b.address }}</span>
              </template>
              <template v-else>
                <span class="block font-extrabold">{{ b.origin }} → {{ b.destination }}</span>
                <span class="block text-slate-600">{{ when(b) }}</span>
                <span v-if="b.seat" class="block text-slate-500">Asiento {{ b.seat }}</span>
              </template>
              <span v-if="b.reference" class="mt-1 inline-block rounded-md bg-white px-1.5 text-xs font-extrabold tracking-wide">{{ b.reference }}</span>
              <span v-if="b.notes" class="mt-1 block text-xs text-slate-500">{{ b.notes }}</span>
            </span>
            <button type="button" aria-label="Quitar" class="grid h-8 w-8 flex-none place-items-center rounded-full text-slate-400 hover:bg-white hover:text-rose-600" @click="found!.splice(i, 1)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </li>
        </ul>
        <p v-if="skipped" class="text-[13px] text-slate-500">
          {{ skipped }} {{ skipped === 1 ? 'reserva quedó afuera' : 'reservas quedaron afuera' }} por datos incompletos: podés cargarlas a mano.
        </p>
        <p class="text-[13px] text-slate-500">Revisalas: después podés editar cualquiera desde la lista.</p>
        <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
        <div class="flex items-center gap-3">
          <button class="btn-primary h-12 flex-1 text-[15px]" :disabled="busy" @click="saveAll">
            {{ busy ? 'Guardando…' : found.length === 1 ? 'Guardar' : `Guardar las ${found.length}` }}
          </button>
          <button type="button" class="h-12 rounded-full px-4 text-sm font-bold text-slate-500 hover:bg-rocio" :disabled="busy" @click="found = null">Volver</button>
        </div>
      </template>
    </div>
  </div>
</template>
