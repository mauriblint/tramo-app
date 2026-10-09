<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

import { api, type Member, type MemberRole, type Trip } from '@/api'

/** Invite someone to the trip: email, name (optional) and what they can do. They get a link that opens it. */
const props = defineProps<{ trip: Trip }>()
const emit = defineEmits<{ invited: [Member[], string]; close: [] }>()

const email = ref('')
const name = ref('')
const role = ref<MemberRole>('editor')
const busy = ref(false)
const error = ref('')
const field = ref<HTMLInputElement>()
onMounted(() => nextTick(() => field.value?.focus()))

async function invite() {
  const e = email.value.trim()
  if (!e) return
  error.value = ''
  busy.value = true
  try {
    emit('invited', await api.invite(props.trip.id, e, name.value.trim() || undefined, role.value), e)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-end justify-center bg-noche/45 sm:items-center sm:p-4" @click.self="emit('close')">
    <form
      class="flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:px-6"
      @submit.prevent="invite"
    >
      <div class="flex items-center justify-between">
        <h2 class="font-display text-[22px] font-bold">Invitar al viaje</h2>
        <button type="button" aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full bg-rocio" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p class="-mt-1 text-[14px] leading-relaxed text-slate-500">Le llega un email con un link que lo deja adentro del viaje. Si no tiene cuenta, se la creamos.</p>

      <span class="flex flex-col gap-1.5">
        <label for="invite-email" class="text-[13px] font-bold text-slate-600">Email</label>
        <input
          id="invite-email"
          ref="field"
          v-model="email"
          type="email"
          required
          placeholder="nombre@email.com"
          class="h-12 rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 text-[16px] outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
      </span>
      <span class="flex flex-col gap-1.5">
        <label for="invite-name" class="text-[13px] font-bold text-slate-600">Nombre <i class="font-medium text-slate-400 not-italic">(opcional)</i></label>
        <input
          id="invite-name"
          v-model="name"
          placeholder="Cómo se llama"
          class="h-12 rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 text-[16px] outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
      </span>

      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1.5 text-[13px] font-bold text-slate-600">Qué puede hacer</legend>
        <label class="flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] px-4 py-3" :class="role === 'editor' ? 'border-brand bg-brand-soft/40' : 'border-[#DCE3DF]'">
          <input v-model="role" type="radio" value="editor" class="mt-1 accent-[#0A7A55]" />
          <span><b class="block text-[14px]">Puede editar</b><span class="text-[13px] text-slate-500">Para quien viaja con vos: cambia el itinerario, usa el copiloto y suma reservas.</span></span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] px-4 py-3" :class="role === 'viewer' ? 'border-brand bg-brand-soft/40' : 'border-[#DCE3DF]'">
          <input v-model="role" type="radio" value="viewer" class="mt-1 accent-[#0A7A55]" />
          <span><b class="block text-[14px]">Solo ver</b><span class="text-[13px] text-slate-500">Para la familia o amigos que lo siguen: ve todo y reenvía sus reservas, pero no cambia nada.</span></span>
        </label>
      </fieldset>

      <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
      <button class="btn-primary h-12 text-[15px]" :disabled="busy || !email.trim()">{{ busy ? 'Invitando…' : 'Mandar invitación' }}</button>
    </form>
  </div>
</template>
