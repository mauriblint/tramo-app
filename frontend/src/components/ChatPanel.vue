<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { Message, PinDraft } from '@/api'
import { renderMd } from '@/markdown'
import type { QuickReply } from '@/tripProfile'
import type { Question } from '@/api'
import { TYPE_META } from '@/pinMeta'

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

const preview = (d: PinDraft) => d.body.replace(/[#*_>`]/g, '').slice(0, 140)
</script>

<template>
  <div class="flex h-full flex-col">
    <div ref="scroller" class="flex-1 space-y-4 overflow-y-auto p-3">
      <div v-if="!messages.length && !sending" class="mx-auto mt-8 max-w-md text-center text-slate-600">
        <div class="text-4xl">💬</div>
        <p class="mt-2">Preguntá lo que quieras sobre el viaje, pegá texto de otro chat o una web, o pedí "guardame esto".</p>
      </div>

      <div v-for="m in messages" :key="m.id" :class="m.role === 'user' ? 'flex justify-end' : ''">
        <div
          v-if="m.role === 'user'"
          class="max-w-[85%] rounded-[20px] rounded-tr-md bg-brand px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-white"
        >
          {{ m.content }}
          <div v-if="!simple" class="mt-1 text-right">
            <button class="text-xs text-mint-text hover:text-white" :disabled="extractingId === m.id" @click="emit('extract', m)">
              {{ extractingId === m.id ? 'Extrayendo…' : '📌 Pinear' }}
            </button>
          </div>
        </div>

        <div v-else class="max-w-full">
          <div class="md max-w-[92%] rounded-[20px] rounded-tl-md border border-slate-200 bg-white px-4 py-3" v-html="renderMd(m.content)" />
          <div v-if="!simple" class="mt-1 flex gap-3 px-1">
            <button
              class="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
              :disabled="extractingId === m.id"
              @click="emit('extract', m)"
            >
              {{ extractingId === m.id ? 'Extrayendo pins…' : '📌 Pinear esta respuesta' }}
            </button>
          </div>

          <div v-if="m.suggestions.length" class="mt-2 grid gap-2 sm:grid-cols-2">
            <div
              v-for="(s, i) in m.suggestions"
              :key="i"
              class="rounded-xl border p-2.5 text-sm"
              :class="s.pinId ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-indigo-300 bg-indigo-50/40'"
            >
              <div class="flex items-start gap-1.5">
                <span>{{ TYPE_META[s.draft.type].emoji }}</span>
                <div class="min-w-0 flex-1">
                  <div class="font-semibold">{{ s.draft.title }}</div>
                  <div v-if="s.draft.city" class="text-xs text-slate-500">{{ s.draft.city }}</div>
                </div>
                <button v-if="!s.pinId" class="text-slate-400 hover:text-slate-700" title="Descartar" @click="emit('dismiss', m, i)">
                  ×
                </button>
              </div>
              <p class="mt-1 line-clamp-3 text-slate-600">{{ preview(s.draft) }}</p>
              <div class="mt-2 flex gap-2">
                <template v-if="!s.pinId">
                  <button class="btn-primary px-2.5 py-1 text-xs" @click="emit('accept', m, i)">+ Añadir al trip</button>
                  <button class="btn px-2 py-1 text-xs" @click="emit('editAccept', m, i)">Editar</button>
                </template>
                <span v-else class="text-xs font-medium text-emerald-700">✅ En el trip</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template v-if="sending">
        <div class="flex justify-end">
          <div class="max-w-[85%] rounded-[20px] rounded-tr-md bg-brand/70 px-4 py-3 text-[15px] whitespace-pre-wrap text-white">
            {{ pendingText }}
          </div>
        </div>
        <div class="inline-flex items-center gap-2 rounded-[20px] rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          <span class="animate-pulse">●●●</span> {{ busyLabel ?? 'Pensando (puede estar buscando en la web)…' }}
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
