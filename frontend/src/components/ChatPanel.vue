<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { Message } from '@/api'
import { renderMd } from '@/markdown'
import type { QuickReply } from '@/tripProfile'
import type { Question } from '@/api'
import CopilotAvatar from '@/components/CopilotAvatar.vue'
import { fmtDay } from '@/pinMeta'
import { PIN_LOOK, googleMapsSearch, isPlace, oneLine } from '@/pinIcons'

const props = defineProps<{
  messages: Message[]
  sending: boolean
  pendingText: string
  extractingId: string | null
  /** Bumped when a send failed so the text goes back into the input. */
  failed: number
  quick?: QuickReply[]
  /** Scripted onboarding question: its buttons take precedence over `quick`. */
  question?: Question | null
  busyLabel?: string
  /** Onboarding: plain conversation, no pin tools. */
  simple?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{
  send: [string, QuickReply['patch']?, boolean?]
  extract: [Message]
  accept: [Message, number]
  editAccept: [Message, number]
  dismiss: [Message, number]
  clear: []
}>()

const text = ref('')
const scroller = ref<HTMLElement>()
const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches


function send(t = text.value, patch?: QuickReply['patch'], structured = false) {
  const v = t.trim()
  if (!v || props.sending) return
  emit('send', v, patch, structured)
  text.value = ''
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isTouch && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

const options = computed<QuickReply[]>(() => props.question?.options ?? props.quick ?? [])
const multi = computed(() => props.question?.kind === 'multi')
const selected = ref<string[]>([])
watch(
  () => props.question?.id,
  () => (selected.value = []),
)

/** A button never discards what the user was typing: both go together. */
function pick(o: QuickReply) {
  const draft = text.value.trim()
  if (draft) send(`${o.label}. ${draft}`, o.patch, false)
  else send(o.label, o.patch, !!o.patch)
}

function toggle(label: string) {
  selected.value = selected.value.includes(label) ? selected.value.filter((l) => l !== label) : [...selected.value, label]
}

function submitMulti() {
  const draft = text.value.trim()
  const picked = selected.value
  const label = picked.length ? picked.join(', ') : 'Un poco de todo'
  const interests = picked.length ? picked.map((l) => l.toLowerCase()) : ['un poco de todo']
  send(draft ? `${label}. ${draft}` : label, { interests }, !draft)
}

async function scrollBottom() {
  await nextTick()
  const el = scroller.value
  if (!el) return
  // Jump on first load (long history), glide for new messages.
  const far = el.scrollHeight - el.scrollTop - el.clientHeight > 1200
  el.scrollTo({ top: el.scrollHeight, behavior: far ? 'auto' : 'smooth' })
}
watch(() => [props.messages.length, props.sending], scrollBottom)
watch(
  () => props.failed,
  () => {
    if (!text.value) text.value = props.pendingText
  },
)
onMounted(scrollBottom)

</script>

<template>
  <div class="flex h-full flex-col">
    <div ref="scroller" class="@container flex-1 space-y-4 overflow-y-auto px-3 pt-3 pb-2">
      <div v-if="!messages.length && !sending" class="mx-auto mt-8 max-w-md text-center text-slate-600">
        <p class="font-display text-xl font-bold text-noche">¿En qué te ayudo?</p>
        <p class="mt-1.5 text-[15px]">Pedime ideas, cambios en el itinerario o lo que quieras saber. Si algo te gusta, decime “guardalo”.</p>
      </div>

      <div v-for="m in messages" :key="m.id" class="flex flex-col gap-1.5">
        <!-- You -->
        <div v-if="m.role === 'user'" class="flex justify-end">
          <div class="max-w-[85%] rounded-[22px] rounded-br-md bg-brand px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white">
            {{ m.content }}
          </div>
        </div>

        <!-- Copilot: its text in one bubble, then every recommendation in its own bubble -->
        <template v-else>
          <div class="flex items-start gap-2.5">
            <CopilotAvatar />
            <div class="md max-w-[92%] min-w-0 rounded-[22px] rounded-tl-md bg-rocio px-4 py-2.5 text-[15px] @2xl:max-w-[75%]" v-html="renderMd(m.content)" />
          </div>
          <div v-for="(sg, i) in m.suggestions" :key="i" class="flex items-start gap-2.5">
            <span class="hidden w-[34px] flex-none @md:block" />
            <div class="flex max-w-[92%] min-w-0 flex-1 items-center gap-3 rounded-[22px] rounded-tl-md bg-rocio py-2.5 pr-2.5 pl-3 @2xl:max-w-[75%]">
              <span class="grid h-10 w-10 flex-none place-items-center rounded-xl" :style="{ background: PIN_LOOK[sg.draft.type].bg }">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" :stroke="PIN_LOOK[sg.draft.type].fg" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PIN_LOOK[sg.draft.type].icon" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[15px] leading-snug font-extrabold">{{ sg.draft.title }}</span>
                <span v-if="sg.draft.body" class="block text-[13px] leading-snug text-slate-600">{{ oneLine(sg.draft.body) }}</span>
                <span v-if="sg.pinId && sg.draft.day" class="block text-xs font-bold text-brand-dark">En el itinerario · {{ fmtDay(sg.draft.day) }}</span>
                <span v-else-if="isPlace(sg.draft.type)" class="block truncate text-xs text-slate-500">{{ sg.draft.city ?? '' }}</span>
                <span v-else class="block text-xs font-bold text-[#6B4E00]">Idea · sin lugar</span>
              </span>
              <a
                v-if="isPlace(sg.draft.type)"
                :href="googleMapsSearch(sg.draft)"
                target="_blank"
                rel="noopener"
                :aria-label="`Ver ${sg.draft.title} en Google Maps`"
                title="Ver en Google Maps"
                class="grid h-9 w-9 flex-none place-items-center rounded-full border-[1.5px] border-[#DCE3DF] bg-white hover:border-brand"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
              </a>
              <span v-if="sg.pinId" title="Guardado" aria-label="Guardado" class="grid h-9 w-9 flex-none place-items-center rounded-full border-[1.5px] border-brand bg-brand-soft">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#075C40" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              </span>
              <button
                v-else-if="!simple"
                :aria-label="`Guardar ${sg.draft.title} en Ideas`"
                title="Guardar en Ideas"
                class="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand text-white hover:bg-brand-dark"
                @click="emit('accept', m, i)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z" /></svg>
              </button>
            </div>
          </div>
        </template>
      </div>

      <template v-if="sending">
        <div class="flex justify-end">
          <div class="max-w-[85%] rounded-[22px] rounded-br-md bg-brand/70 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white">{{ pendingText }}</div>
        </div>
        <div class="flex items-center gap-2.5">
          <CopilotAvatar />
          <span class="inline-flex items-center gap-2 rounded-[22px] rounded-tl-md bg-rocio px-4 py-3 text-sm text-slate-500">
            <span class="flex gap-1" aria-hidden="true">
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
            </span>
            {{ busyLabel ?? 'Pensando…' }}
          </span>
        </div>
      </template>
    </div>

    <form class="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]" @submit.prevent="send()">
      <slot name="above-input" />
      <div v-if="multi && !sending" class="mb-2.5 flex flex-wrap gap-2">
        <button
          v-for="o in options"
          :key="o.label"
          type="button"
          :aria-pressed="selected.includes(o.label)"
          class="h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold"
          :class="selected.includes(o.label) ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand'"
          @click="toggle(o.label)"
        >
          {{ o.label }}
        </button>
        <button type="button" class="h-10 rounded-full bg-noche px-5 text-sm font-bold text-white hover:bg-black" @click="submitMulti">
          {{ selected.length ? 'Listo' : 'Un poco de todo' }}
        </button>
      </div>
      <div v-else-if="options.length && !sending" class="-mx-3 mb-2.5 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <button
          v-for="qp in options"
          :key="qp.label"
          type="button"
          class="h-10 flex-none rounded-full border-[1.5px] border-brand bg-white px-4 text-sm font-semibold whitespace-nowrap text-brand hover:bg-brand-soft"
          @click="pick(qp)"
        >
          {{ qp.label }}
        </button>
      </div>
      <div class="flex items-end gap-2 rounded-[26px] border border-slate-200 bg-white p-1 pl-4">
        <label for="chat-input" class="sr-only">Mensaje</label>
        <textarea
          id="chat-input"
          v-model="text"
          rows="1"
          class="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none field-sizing-content placeholder:text-slate-400"
          :placeholder="placeholder ?? 'Preguntá, pegá texto, o decí “guardame esto”…'"
          @keydown="onKey"
        />
        <button
          aria-label="Enviar"
          class="grid h-11 w-11 flex-none place-items-center rounded-full bg-brand text-white hover:bg-brand-dark disabled:bg-slate-300"
          :disabled="sending || !text.trim()"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
      <div v-if="!simple && messages.length" class="mt-1 flex justify-end px-2">
        <button type="button" class="text-xs text-slate-400 hover:text-slate-600" @click="emit('clear')">
          Nueva conversación (el viaje queda)
        </button>
      </div>
    </form>
  </div>
</template>
