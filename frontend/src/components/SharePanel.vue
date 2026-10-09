<script setup lang="ts">
import { computed, ref } from 'vue'

import { api, type Member, type MemberRole, type Trip } from '@/api'
import { auth } from '@/auth'

/**
 * The "Compartir" section: who's in the trip, why share it, and (for the owner) inviting people and
 * choosing what each one can do. Members can leave.
 */
const props = defineProps<{ trip: Trip; members: Member[] }>()
const emit = defineEmits<{ members: [Member[]]; left: [] }>()

const email = ref('')
const name = ref('')
const role = ref<MemberRole>('editor')
const busy = ref(false)
const error = ref('')
const sent = ref('')

const isOwner = computed(() => props.trip.userId === auth.user?.id)
const others = computed(() => props.members.filter((m) => m.id !== auth.user?.id))
const ROLE_LABEL: Record<MemberRole, string> = { editor: 'Puede editar', viewer: 'Solo ver' }

const initials = (m: Member) =>
  m.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** "Compartido con Lu y Juan" / "Solo vos ves este viaje" */
const status = computed(() => {
  const names = others.value.map((m) => m.name.split(' ')[0])
  if (!names.length) return 'Solo vos ves este viaje'
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`
  return `Compartido con ${list}`
})

async function invite() {
  const e = email.value.trim()
  if (!e) return
  error.value = ''
  sent.value = ''
  busy.value = true
  try {
    emit('members', await api.invite(props.trip.id, e, name.value.trim() || undefined, role.value))
    sent.value = `Le mandamos la invitación a ${e}.`
    email.value = ''
    name.value = ''
    role.value = 'editor'
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function changeRole(m: Member, value: MemberRole) {
  error.value = ''
  try {
    emit('members', await api.setRole(props.trip.id, m.id, value))
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function remove(m: Member) {
  const self = m.id === auth.user?.id
  if (!confirm(self ? '¿Salir de este viaje? Lo vas a volver a ver si te invitan de nuevo.' : `¿Sacar a ${m.name} del viaje?`)) return
  error.value = ''
  try {
    await api.removeMember(props.trip.id, m.id)
    if (self) return emit('left')
    emit(
      'members',
      props.members.filter((x) => x.id !== m.id),
    )
  } catch (err) {
    error.value = (err as Error).message
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Status -->
    <div class="flex items-center gap-3 rounded-[22px] bg-white px-4 py-4 md:bg-rocio">
      <span class="flex flex-none -space-x-2">
        <span
          v-for="m in members.slice(0, 4)"
          :key="m.id"
          class="grid h-10 w-10 place-items-center rounded-full border-2 border-white text-[13px] font-extrabold"
          :class="m.owner ? 'bg-brand text-white' : 'bg-brand-soft text-brand-dark'"
          :title="m.name"
        >{{ initials(m) }}</span>
      </span>
      <span class="min-w-0 flex-1 text-[16px] font-extrabold">{{ status }}</span>
    </div>

    <!-- Why -->
    <ul class="grid gap-2.5 sm:grid-cols-3">
      <li class="rounded-[20px] bg-white px-4 py-3.5 md:bg-rocio">
        <span class="block text-[14px] font-extrabold">Armen el viaje juntos</span>
        <span class="mt-1 block text-[13px] leading-relaxed text-slate-500">Cada uno desde su teléfono: itinerario, ideas y el copiloto.</span>
      </li>
      <li class="rounded-[20px] bg-white px-4 py-3.5 md:bg-rocio">
        <span class="block text-[14px] font-extrabold">Todas las reservas en un lugar</span>
        <span class="mt-1 block text-[13px] leading-relaxed text-slate-500">Cada uno reenvía las suyas{{ auth.inboundAddress ? ` a ${auth.inboundAddress}` : ' por email' }} y caen acá.</span>
      </li>
      <li class="rounded-[20px] bg-white px-4 py-3.5 md:bg-rocio">
        <span class="block text-[14px] font-extrabold">Todo a mano en el viaje</span>
        <span class="mt-1 block text-[13px] leading-relaxed text-slate-500">Vuelos, hoteles y el plan del día para todos, también para la familia que lo sigue.</span>
      </li>
    </ul>

    <!-- Invite (owner) -->
    <form v-if="isOwner" class="flex flex-col gap-3 rounded-[22px] bg-white px-4 py-4 md:border md:border-[#E3EAE6]" @submit.prevent="invite">
      <h2 class="font-display text-[19px] font-bold">Invitar</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <span class="flex flex-col gap-1.5">
          <label for="invite-email" class="text-[13px] font-bold text-slate-600">Email</label>
          <input
            id="invite-email"
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
      </div>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1.5 text-[13px] font-bold text-slate-600">Qué puede hacer</legend>
        <label class="flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] px-4 py-3" :class="role === 'editor' ? 'border-brand bg-brand-soft/40' : 'border-[#DCE3DF]'">
          <input v-model="role" type="radio" value="editor" class="mt-1 accent-[#0A7A55]" />
          <span><b class="block text-[14px]">Puede editar</b><span class="text-[13px] text-slate-500">Para quien viaja con vos: cambia el itinerario, usa el copiloto y suma reservas.</span></span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] px-4 py-3" :class="role === 'viewer' ? 'border-brand bg-brand-soft/40' : 'border-[#DCE3DF]'">
          <input v-model="role" type="radio" value="viewer" class="mt-1 accent-[#0A7A55]" />
          <span><b class="block text-[14px]">Solo ver</b><span class="text-[13px] text-slate-500">Para la familia o amigos que lo siguen: ve todo y puede reenviar sus reservas, pero no cambia nada.</span></span>
        </label>
      </fieldset>
      <button class="btn-primary h-12 text-[15px]" :disabled="busy || !email.trim()">{{ busy ? 'Invitando…' : 'Mandar invitación' }}</button>
      <p v-if="sent" class="text-[14px] font-semibold text-brand-dark">{{ sent }} Le llega un link para entrar directo al viaje.</p>
    </form>

    <!-- People -->
    <section class="flex flex-col gap-1">
      <h2 class="font-display px-1 pb-1 text-[19px] font-bold">Quiénes están</h2>
      <div v-for="m in members" :key="m.id" class="flex items-center gap-3 rounded-2xl px-1 py-2">
        <span class="grid h-10 w-10 flex-none place-items-center rounded-full text-[14px] font-extrabold" :class="m.owner ? 'bg-brand text-white' : 'bg-brand-soft text-brand-dark'">{{ initials(m) }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] font-extrabold">{{ m.name }}<template v-if="m.id === auth.user?.id"> (vos)</template></span>
          <span class="block truncate text-[13px] text-slate-500">{{ m.email }}</span>
        </span>
        <span v-if="m.owner" class="flex-none rounded-full bg-rocio px-2.5 py-1 text-[12px] font-bold text-slate-600 md:bg-white">Creó el viaje</span>
        <template v-else>
          <label v-if="isOwner" class="sr-only" :for="`role-${m.id}`">Permiso de {{ m.name }}</label>
          <select
            v-if="isOwner"
            :id="`role-${m.id}`"
            :value="m.role"
            class="h-9 flex-none rounded-full border-[1.5px] border-[#DCE3DF] bg-white px-3 text-[13px] font-bold outline-none focus:border-brand"
            @change="changeRole(m, ($event.target as HTMLSelectElement).value as MemberRole)"
          >
            <option value="editor">{{ ROLE_LABEL.editor }}</option>
            <option value="viewer">{{ ROLE_LABEL.viewer }}</option>
          </select>
          <span v-else class="flex-none rounded-full bg-rocio px-2.5 py-1 text-[12px] font-bold text-slate-600 md:bg-white">{{ ROLE_LABEL[m.role as MemberRole] }}</span>
          <button
            v-if="isOwner || m.id === auth.user?.id"
            type="button"
            class="h-9 flex-none rounded-full px-3 text-[13px] font-bold text-rose-600 hover:bg-rose-50"
            @click="remove(m)"
          >
            {{ m.id === auth.user?.id ? 'Salir' : 'Sacar' }}
          </button>
        </template>
      </div>
      <p v-if="!isOwner" class="px-1 pt-2 text-[13px] text-slate-500">Solo quien creó el viaje puede invitar o cambiar permisos.</p>
    </section>

    <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
  </div>
</template>
