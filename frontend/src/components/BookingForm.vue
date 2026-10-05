<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Booking, BookingInput, BookingKind } from '@/api'
import { KIND_META } from '@/bookings'

/** Manual entry for a flight, train, bus or hotel: the few fields you actually use on the road. */
const props = defineProps<{ initial: BookingInput; editing: Booking | null; kinds: BookingKind[]; places: string[]; busy?: boolean; error?: string }>()
const emit = defineEmits<{ save: [BookingInput]; delete: []; close: [] }>()

const b = ref<BookingInput>({ ...props.initial })
const hotel = computed(() => b.value.kind === 'hotel')
const flight = computed(() => b.value.kind === 'flight')
const more = ref(!!(props.initial.carrier || props.initial.notes || props.initial.arriveDate || props.initial.address))
const localError = ref('')

const title = computed(() => (props.editing ? `Editar ${KIND_META[b.value.kind].label.toLowerCase()}` : hotel.value ? 'Agregar hotel' : 'Agregar transporte'))

function save() {
  localError.value = ''
  const v = b.value
  if (hotel.value) {
    if (!v.hotelName?.trim() || !v.checkInDate || !v.checkOutDate) return (localError.value = 'Completá nombre, check-in y check-out')
    if (v.checkOutDate <= v.checkInDate) return (localError.value = 'El check-out tiene que ser después del check-in')
  } else if (!v.origin?.trim() || !v.destination?.trim() || !v.departDate) {
    return (localError.value = 'Completá desde, hasta y fecha')
  }
  emit('save', { ...v, reference: v.reference?.trim().toUpperCase() || null })
}
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-end justify-center bg-noche/45 sm:items-center sm:p-4" @click.self="emit('close')">
    <form
      class="flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:px-6"
      @submit.prevent="save"
    >
      <div class="flex items-center justify-between">
        <h2 class="font-display text-[22px] font-bold">{{ title }}</h2>
        <button type="button" aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full bg-rocio" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div v-if="kinds.length > 1" role="radiogroup" aria-label="Tipo" class="grid gap-1 rounded-2xl bg-rocio p-1" :style="{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }">
        <button
          v-for="k in kinds"
          :key="k"
          type="button"
          role="radio"
          :aria-checked="b.kind === k"
          class="flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm"
          :class="b.kind === k ? 'bg-white font-extrabold shadow-sm' : 'font-bold text-slate-500'"
          @click="b.kind = k"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="KIND_META[k].icon" />
          {{ KIND_META[k].label }}
        </button>
      </div>

      <datalist id="booking-places">
        <option v-for="p in places" :key="p" :value="p" />
      </datalist>

      <!-- Transport -->
      <template v-if="!hotel">
        <div class="grid grid-cols-2 gap-3">
          <label class="field">
            <span>Desde</span>
            <input v-model="b.origin" list="booking-places" :placeholder="flight ? 'Aeropuerto o ciudad' : 'Estación o ciudad'" required />
          </label>
          <label class="field">
            <span>Hasta</span>
            <input v-model="b.destination" list="booking-places" :placeholder="flight ? 'Aeropuerto o ciudad' : 'Estación o ciudad'" required />
          </label>
          <label class="field">
            <span>Fecha</span>
            <input v-model="b.departDate" type="date" required />
          </label>
          <label class="field">
            <span>Hora de salida <i>(opcional)</i></span>
            <input v-model="b.departTime" type="time" />
          </label>
          <label class="field">
            <span>{{ flight ? 'Nº de vuelo' : b.kind === 'train' ? 'Tren' : 'Empresa / línea' }} <i>(opcional)</i></span>
            <input v-model="b.number" :placeholder="flight ? 'EK 318' : b.kind === 'train' ? 'Nozomi 21' : 'Willer Express'" />
          </label>
          <label class="field">
            <span>Asiento <i>(opcional)</i></span>
            <input v-model="b.seat" :placeholder="flight ? '32A' : 'Coche 7, 7A 7B'" />
          </label>
        </div>
      </template>

      <!-- Hotel -->
      <template v-else>
        <label class="field">
          <span>Nombre</span>
          <input v-model="b.hotelName" placeholder="Hotel Gracery Shinjuku" required />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="field">
            <span>Check-in</span>
            <input v-model="b.checkInDate" type="date" required />
          </label>
          <label class="field">
            <span>Check-out</span>
            <input v-model="b.checkOutDate" type="date" :min="b.checkInDate ?? undefined" required />
          </label>
        </div>
      </template>

      <label class="field">
        <span>Código de reserva <i>(opcional)</i></span>
        <input v-model="b.reference" class="uppercase" placeholder="KX7Q2M" autocapitalize="characters" />
      </label>

      <button v-if="!more" type="button" class="self-start text-sm font-bold text-brand" @click="more = true">+ Más detalles</button>
      <template v-else>
        <div v-if="!hotel" class="grid grid-cols-2 gap-3">
          <label class="field">
            <span>Llegada (fecha) <i>si es otro día</i></span>
            <input v-model="b.arriveDate" type="date" :min="b.departDate ?? undefined" />
          </label>
          <label class="field">
            <span>Hora de llegada</span>
            <input v-model="b.arriveTime" type="time" />
          </label>
          <label class="field col-span-2">
            <span>{{ flight ? 'Aerolínea' : 'Operador' }}</span>
            <input v-model="b.carrier" :placeholder="flight ? 'Emirates' : 'JR Central'" />
          </label>
        </div>
        <template v-else>
          <label class="field">
            <span>Dirección <i>(para "Cómo llegar")</i></span>
            <input v-model="b.address" placeholder="Kabukichō 1-19-1, Shinjuku" />
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="field">
              <span>Hora de check-in</span>
              <input v-model="b.checkInTime" type="time" placeholder="15:00" />
            </label>
            <label class="field">
              <span>Hora de check-out</span>
              <input v-model="b.checkOutTime" type="time" placeholder="11:00" />
            </label>
          </div>
        </template>
        <label class="field">
          <span>Notas</span>
          <textarea v-model="b.notes" rows="2" placeholder="Lo que quieras tener a mano" />
        </label>
      </template>

      <p v-if="localError || error" class="text-sm font-semibold text-rose-600">{{ localError || error }}</p>

      <div class="flex items-center gap-3 pt-1">
        <button class="btn-primary h-12 flex-1 text-[15px]" :disabled="busy">{{ busy ? 'Guardando…' : 'Guardar' }}</button>
        <button v-if="editing" type="button" class="h-12 rounded-full px-4 text-sm font-bold text-rose-600 hover:bg-rose-50" @click="emit('delete')">Borrar</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field > span {
  font-size: 13px;
  font-weight: 700;
  color: #3f4b45;
}
.field > span i {
  font-style: normal;
  font-weight: 500;
  color: #94a39c;
}
.field input,
.field textarea {
  height: 48px;
  min-width: 0;
  border-radius: 14px;
  border: 1.5px solid #dce3df;
  background: #fff;
  padding: 0 14px;
  font-size: 16px;
  color: #0e1f18;
  outline: none;
}
.field textarea {
  height: auto;
  padding: 12px 14px;
  resize: none;
}
.field input:focus,
.field textarea:focus {
  border-color: #0a7a55;
  box-shadow: 0 0 0 4px #e3f5ec;
}
</style>
