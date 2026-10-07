<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { api, type Booking, type BookingInput } from '@/api'
import { auth } from '@/auth'
import BookingSummary from '@/components/BookingSummary.vue'

/** Import a booking: paste an email, review what was understood, save it. */
const props = defineProps<{ tripId: string }>()
const emit = defineEmits<{ saved: [Booking[]]; close: [] }>()

const text = ref('')
const found = ref<BookingInput[] | null>(null)
const skipped = ref(0)
const busy = ref(false)
const error = ref('')
const box = ref<HTMLTextAreaElement>()
onMounted(() => nextTick(() => box.value?.focus()))

async function read() {
  error.value = ''
  busy.value = true
  try {
    const res = await api.parseBookings(props.tripId, text.value)
    found.value = res.bookings
    skipped.value = res.skipped
    if (!res.bookings.length)
      error.value = res.skipped
        ? `Se encontró ${res.skipped === 1 ? 'una reserva' : `${res.skipped} reservas`} pero con datos incompletos (${res.problems.join(', ').toLowerCase()}). Intenta de nuevo o cárgala manualmente.`
        : 'No se encontraron reservas en el texto. Verifica que hayas copiado el email completo.'
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

const title = computed(() => (found.value?.length ? `${found.value.length} ${found.value.length === 1 ? 'reserva encontrada' : 'reservas encontradas'}` : 'Importar reserva'))
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
          Copia y pega el email de confirmación de tu vuelo, tren u hospedaje (aerolínea, Booking, Airbnb, etc.). Extraemos los datos de la reserva para que los revises antes de guardarlos.
        </p>
        <label class="sr-only" for="paste-box">Texto del mail</label>
        <textarea
          id="paste-box"
          ref="box"
          v-model="text"
          rows="8"
          placeholder="Email de confirmación"
          class="rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
        <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
        <button class="btn-primary h-12 text-[15px]" :disabled="busy || text.trim().length < 20" @click="read">
          {{ busy ? 'Importando datos…' : 'Importar datos' }}
        </button>
        <p v-if="auth.inboundAddress && auth.user" class="text-center text-[13px] leading-relaxed text-slate-500">
          También puedes reenviar el email a <span class="font-bold text-noche select-all">{{ auth.inboundAddress }}</span> desde {{ auth.user.email }}.
        </p>
      </template>

      <!-- 2 · review -->
      <template v-else>
        <ul class="flex flex-col gap-2.5">
          <BookingSummary v-for="(b, i) in found" :key="i" :booking="b" removable @remove="found!.splice(i, 1)" />
        </ul>
        <p v-if="skipped" class="text-[13px] text-slate-500">
          {{ skipped }} {{ skipped === 1 ? 'reserva no se importó' : 'reservas no se importaron' }} por datos incompletos; puedes cargarlas manualmente.
        </p>
        <p class="text-[13px] text-slate-500">Revisa los datos antes de guardar. Podrás editarlos luego desde la lista.</p>
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
