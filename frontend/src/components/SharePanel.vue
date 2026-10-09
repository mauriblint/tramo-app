<script setup lang="ts">
import { computed, ref } from 'vue'

import { api, type Member, type MemberRole, type Trip } from '@/api'
import { auth } from '@/auth'

/**
 * The "Compartir" section. Nobody invited yet: a brand block that sells sharing. Otherwise: the people
 * in the trip, where the owner changes permissions or removes someone and a member can leave.
 * Inviting itself opens from the section's "Invitar" button.
 */
const props = defineProps<{ trip: Trip; members: Member[] }>()
const emit = defineEmits<{ members: [Member[]]; left: []; invite: [] }>()

const error = ref('')
const isOwner = computed(() => props.trip.userId === auth.user?.id)
const shared = computed(() => props.members.length > 1)
const ROLE_LABEL: Record<MemberRole, string> = { editor: 'Puede editar', viewer: 'Solo ver' }

const initials = (m: Member) =>
  m.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

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
    <!-- Nobody yet: why it's worth it -->
    <section v-if="!shared" class="relative overflow-hidden rounded-[28px] bg-brand px-6 pt-7 pb-7 text-white md:px-9 md:pt-9">
      <!-- Routes joining at one point: travelling together -->
      <svg viewBox="0 0 520 170" class="w-full max-w-[520px]" fill="none" aria-hidden="true">
        <path d="M18 140 C 110 140, 150 70, 262 84" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="2.5" stroke-dasharray="4 7" stroke-linecap="round" />
        <path d="M30 26 C 120 20, 170 96, 262 84" stroke="#7EE2B8" stroke-opacity="0.85" stroke-width="2.5" stroke-dasharray="4 7" stroke-linecap="round" />
        <path d="M262 84 C 352 72, 400 132, 500 50" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="2.5" stroke-dasharray="4 7" stroke-linecap="round" />
        <circle cx="18" cy="140" r="9" fill="#FFFFFF" />
        <circle cx="30" cy="26" r="9" fill="#7EE2B8" />
        <circle cx="262" cy="84" r="11" fill="#FFFFFF" />
        <circle cx="500" cy="50" r="16" fill="#F5C84C" fill-opacity="0.3" />
        <circle cx="500" cy="50" r="8" fill="#F5C84C" />
      </svg>
      <h2 class="font-display mt-4 max-w-[520px] text-[32px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[40px]">Viajen juntos, en un mismo plan</h2>
      <ul class="mt-5 flex max-w-[560px] flex-col gap-3 text-[15px] leading-relaxed text-mint-text">
        <li class="flex gap-3">
          <span class="mt-2 h-2 w-2 flex-none rounded-full bg-sun" />
          <span><b class="text-white">Arman el itinerario juntos</b>, cada uno desde su teléfono, con el copiloto.</span>
        </li>
        <li class="flex gap-3">
          <span class="mt-2 h-2 w-2 flex-none rounded-full bg-sun" />
          <span><b class="text-white">Todas las reservas en un lugar:</b> cada uno reenvía las suyas{{ auth.inboundAddress ? ` a ${auth.inboundAddress}` : ' por email' }} y caen acá.</span>
        </li>
        <li class="flex gap-3">
          <span class="mt-2 h-2 w-2 flex-none rounded-full bg-sun" />
          <span><b class="text-white">La familia lo sigue</b> con "Solo ver": dónde están hoy, vuelos y hoteles, sin tocar nada.</span>
        </li>
      </ul>
      <button
        v-if="isOwner"
        class="mt-7 inline-flex h-13 items-center gap-2.5 rounded-full bg-white px-6 py-3.5 text-[16px] font-extrabold text-brand hover:bg-white/90"
        @click="emit('invite')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M19 8v6M16 11h6" /></svg>
        Invitar a alguien
      </button>
    </section>

    <!-- The people in the trip -->
    <section v-else class="flex flex-col">
      <div
        v-for="m in members"
        :key="m.id"
        class="flex items-center gap-3 border-b border-[#EEF2EF] px-1 py-3 last:border-b-0"
      >
        <span class="grid h-10 w-10 flex-none place-items-center rounded-full text-[14px] font-extrabold" :class="m.owner ? 'bg-brand text-white' : 'bg-brand-soft text-brand-dark'">{{ initials(m) }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] font-extrabold">{{ m.name }}<template v-if="m.id === auth.user?.id"> (vos)</template></span>
          <span class="block truncate text-[13px] text-slate-500">{{ m.email }}</span>
        </span>
        <span v-if="m.owner" class="flex-none rounded-full bg-rocio px-2.5 py-1 text-[12px] font-bold text-slate-600">Creó el viaje</span>
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
          <span v-else class="flex-none rounded-full bg-rocio px-2.5 py-1 text-[12px] font-bold text-slate-600">{{ ROLE_LABEL[m.role as MemberRole] }}</span>
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
    </section>

    <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
  </div>
</template>
