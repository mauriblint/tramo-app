<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import type { Message } from '@/api'
import ChatPanel from '@/components/ChatPanel.vue'
import CopilotAvatar from '@/components/CopilotAvatar.vue'
import type { QuickReply } from '@/tripProfile'

/**
 * The copilot, always at hand. Wide screens: a column on the right. Elsewhere: a bar at the bottom that
 * shows its last message and opens into a sheet with two heights (half: you still see the trip; full).
 */
const props = defineProps<{
  messages: Message[]
  sending: boolean
  pendingText: string
  extractingId: string | null
  failed: number
  quick: QuickReply[]
  /** "Sobre el día 3 (jue 2 oct)" — what the copilot is looking at. */
  context: string | null
  placeholder: string
}>()
const emit = defineEmits<{
  send: [string, QuickReply['patch']?, boolean?]
  accept: [Message, number]
  clear: []
}>()

// ---- layout mode
const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1280px)') : null
const wide = ref(!!mq?.matches)
const onMq = (e: MediaQueryListEvent) => (wide.value = e.matches)
mq?.addEventListener('change', onMq)
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

const docked = ref(true) // wide screens: column shown (can be hidden)
type SheetState = 'closed' | 'half' | 'full'
const sheet = ref<SheetState>('closed')

function open(state: SheetState = 'half') {
  if (wide.value) docked.value = true
  else if (sheet.value === 'closed' || state === 'full') sheet.value = state
}
defineExpose({ open })

// ---- last message, for the closed bar
const lastLine = computed(() => {
  if (props.sending) return 'Pensando…'
  const last = [...props.messages].reverse().find((m) => m.role === 'assistant')
  if (!last) return 'Pedime ideas o cambios para el viaje'
  const saved = last.suggestions.filter((s) => s.pinId).length
  const plain = last.content.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
  return saved && !plain ? `Guardé ${saved} en el viaje` : plain
})

// Closed bar: a quick message opens the sheet so you see the answer arrive.
const quickText = ref('')
function sendQuick() {
  const v = quickText.value.trim()
  if (!v || props.sending) return
  emit('send', v)
  quickText.value = ''
  sheet.value = 'half'
}

// ---- drag the sheet between heights
let startY: number | null = null
function onDown(e: PointerEvent) {
  startY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onUp(e: PointerEvent) {
  if (startY == null) return
  const dy = e.clientY - startY
  startY = null
  if (Math.abs(dy) < 8) {
    sheet.value = sheet.value === 'half' ? 'full' : 'half'
    return
  }
  if (dy < -50) sheet.value = 'full'
  else if (dy > 50) sheet.value = sheet.value === 'full' ? 'half' : 'closed'
}
</script>

<template>
  <!-- Wide: a column on the right -->
  <aside
    v-if="wide && docked"
    aria-label="Copiloto"
    class="flex h-full w-[380px] flex-none flex-col overflow-hidden rounded-[28px] bg-white"
  >
    <header class="flex items-center gap-2.5 border-b border-[#EEF2EF] py-3.5 pr-3.5 pl-4">
      <CopilotAvatar />
      <div class="min-w-0 flex-1">
        <div class="font-display text-[17px] font-bold">Copiloto</div>
        <div class="truncate text-xs text-slate-500">{{ context ? `Sobre ${context}` : 'Sobre tu viaje' }}</div>
      </div>
      <button aria-label="Ocultar copiloto" title="Ocultar" class="grid h-9 w-9 place-items-center rounded-full bg-rocio hover:bg-brand-soft" @click="docked = false">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </header>
    <ChatPanel
      class="min-h-0 flex-1"
      :messages="messages"
      :sending="sending"
      :pending-text="pendingText"
      :extracting-id="extractingId"
      :failed="failed"
      :quick="quick"
      :placeholder="placeholder"
      @send="(t, p, s) => emit('send', t, p, s)"
      @accept="(m, i) => emit('accept', m, i)"
      @clear="emit('clear')"
    />
  </aside>
  <button
    v-else-if="wide"
    class="fixed right-6 bottom-6 z-[700] flex h-14 items-center gap-2.5 rounded-full bg-noche pr-5 pl-2 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(14,31,24,0.3)]"
    @click="docked = true"
  >
    <CopilotAvatar /> Copiloto
  </button>

  <!-- Phones and narrower screens: bar at the bottom + sheet -->
  <template v-else>
    <div
      v-if="sheet === 'closed'"
      class="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[700] mx-auto flex max-w-[720px] flex-col gap-2 rounded-[26px] bg-noche p-2 shadow-[0_14px_32px_rgba(14,31,24,0.35)]"
    >
      <button class="flex items-center gap-2.5 px-1 pt-1 text-left text-white" aria-label="Abrir el copiloto" @click="sheet = 'half'">
        <CopilotAvatar />
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-bold text-brote">Copiloto</span>
          <span class="block truncate text-sm">{{ lastLine }}</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7EE2B8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <form class="flex h-11 items-center gap-2 rounded-full bg-white/10 pr-1 pl-4" @submit.prevent="sendQuick">
        <label for="copilot-quick" class="sr-only">Mensaje al copiloto</label>
        <input
          id="copilot-quick"
          v-model="quickText"
          :placeholder="placeholder"
          autocomplete="off"
          class="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/60"
        />
        <button aria-label="Enviar" class="grid h-9 w-9 flex-none place-items-center rounded-full bg-white text-noche disabled:opacity-40" :disabled="!quickText.trim() || sending">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
    </div>

    <template v-else>
      <div v-if="sheet === 'full'" class="fixed inset-0 z-[880] bg-noche/30" @click="sheet = 'half'" />
      <section
        aria-label="Copiloto"
        class="fixed inset-x-0 bottom-0 z-[890] mx-auto flex max-w-[720px] flex-col rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(14,31,24,0.18)] transition-[height] duration-200"
        :class="sheet === 'full' ? 'h-[calc(100dvh-40px)]' : 'h-[56dvh]'"
      >
        <header class="flex cursor-grab touch-none flex-col gap-2 border-b border-[#EEF2EF] px-4 pt-2 pb-2.5 select-none" @pointerdown="onDown" @pointerup="onUp">
          <span class="h-[5px] w-10 self-center rounded-full bg-[#DCE3DF]" aria-hidden="true" />
          <div class="flex items-center gap-2.5">
            <CopilotAvatar />
            <div class="min-w-0 flex-1">
              <div class="font-display text-base font-bold">Copiloto</div>
              <div class="truncate text-xs text-slate-500">{{ context ? `Sobre ${context}` : 'Sobre tu viaje' }}</div>
            </div>
            <button
              aria-label="Cerrar el copiloto"
              class="grid h-9 w-9 place-items-center rounded-full bg-rocio"
              @pointerdown.stop
              @click="sheet = 'closed'"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
        </header>
        <ChatPanel
          class="min-h-0 flex-1"
          :messages="messages"
          :sending="sending"
          :pending-text="pendingText"
          :extracting-id="extractingId"
          :failed="failed"
          :quick="quick"
          :placeholder="placeholder"
          @send="(t, p, s) => emit('send', t, p, s)"
          @accept="(m, i) => emit('accept', m, i)"
          @clear="emit('clear')"
        />
      </section>
    </template>
  </template>
</template>
