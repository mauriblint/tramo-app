<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, type Member, type Trip } from '@/api'
import { auth } from '@/auth'

/**
 * Who's in the trip. The owner invites by email (the person gets a link that opens the trip and can
 * forward bookings too) and can remove people; a member can leave.
 */
const props = defineProps<{ trip: Trip }>()
const emit = defineEmits<{ close: []; left: [] }>()

const members = ref<Member[]>([])
const email = ref('')
const name = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref('')

const isOwner = computed(() => props.trip.userId === auth.user?.id)
const initials = (m: Member) =>
  m.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

onMounted(async () => {
  try {
    members.value = await api.members(props.trip.id)
  } catch (e) {
    error.value = (e as Error).message
  }
})

async function invite() {
  const e = email.value.trim()
  if (!e) return
  error.value = ''
  sent.value = ''
  busy.value = true
  try {
    members.value = await api.invite(props.trip.id, e, name.value.trim() || undefined)
    sent.value = `Le mandamos la invitación a ${e}.`
    email.value = ''
    name.value = ''
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function remove(m: Member) {
  const self = m.id === auth.user?.id
  if (!confirm(self ? '¿Salir de este viaje? Lo podés volver a ver si te invitan de nuevo.' : `¿Sacar a ${m.name} del viaje?`)) return
  error.value = ''
  try {
    await api.removeMember(props.trip.id, m.id)
    if (self) return emit('left')
    members.value = members.value.filter((x) => x.id !== m.id)
  } catch (err) {
    error.value = (err as Error).message
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-end justify-center bg-noche/45 sm:items-center sm:p-4" @click.self="emit('close')">
    <div class="flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:px-6">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-[22px] font-bold">Compartir viaje</h2>
        <button type="button" aria-label="Cerrar" class="grid h-10 w-10 place-items-center rounded-full bg-rocio" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <ul class="flex flex-col gap-1">
        <li v-for="m in members" :key="m.id" class="flex items-center gap-3 rounded-2xl px-1 py-2">
          <span class="grid h-10 w-10 flex-none place-items-center rounded-full text-[14px] font-extrabold" :class="m.owner ? 'bg-brand text-white' : 'bg-brand-soft text-brand-dark'">{{ initials(m) }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-extrabold">{{ m.name }}<template v-if="m.id === auth.user?.id"> (vos)</template></span>
            <span class="block truncate text-[13px] text-slate-500">{{ m.email }}</span>
          </span>
          <span v-if="m.owner" class="flex-none rounded-full bg-rocio px-2.5 py-1 text-[12px] font-bold text-slate-600">Creó el viaje</span>
          <button
            v-else-if="isOwner || m.id === auth.user?.id"
            type="button"
            class="h-9 flex-none rounded-full px-3 text-[13px] font-bold text-rose-600 hover:bg-rose-50"
            @click="remove(m)"
          >
            {{ m.id === auth.user?.id ? 'Salir' : 'Sacar' }}
          </button>
        </li>
      </ul>

      <form v-if="isOwner" class="flex flex-col gap-3 border-t border-[#E8EEEA] pt-4" @submit.prevent="invite">
        <p class="text-[14px] leading-relaxed text-slate-600">
          Invitá a quien viaja con vos: va a poder ver y armar el viaje, y reenviar sus reservas por email.
        </p>
        <label class="sr-only" for="invite-email">Email</label>
        <input
          id="invite-email"
          v-model="email"
          type="email"
          required
          placeholder="Su email"
          class="h-12 rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 text-[16px] outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
        <label class="sr-only" for="invite-name">Nombre</label>
        <input
          id="invite-name"
          v-model="name"
          placeholder="Su nombre (opcional)"
          class="h-12 rounded-2xl border-[1.5px] border-[#DCE3DF] px-4 text-[16px] outline-none focus:border-brand focus:shadow-[0_0_0_4px_#E3F5EC]"
        />
        <button class="btn-primary h-12 text-[15px]" :disabled="busy || !email.trim()">{{ busy ? 'Invitando…' : 'Invitar' }}</button>
        <p v-if="sent" class="text-[14px] font-semibold text-brand-dark">{{ sent }}</p>
      </form>
      <p v-else class="border-t border-[#E8EEEA] pt-4 text-[14px] text-slate-500">Solo quien creó el viaje puede invitar.</p>

      <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
    </div>
  </div>
</template>
