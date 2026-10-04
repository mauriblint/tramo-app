<script setup lang="ts">
import { ref, watch } from 'vue'

import type { PinDraft } from '@/api'
import { PIN_STATUSES, PIN_TYPES, STATUS_META, TIMES, TIME_META, TYPE_META, fmtDay } from '@/pinMeta'

const props = defineProps<{ draft: PinDraft; title: string; cities: string[]; days: string[] }>()
const emit = defineEmits<{ save: [PinDraft]; close: []; delete: [] }>()

const d = ref<PinDraft>({ ...props.draft })
const tags = ref(props.draft.tags.join(', '))
watch(
  () => props.draft,
  (v) => {
    d.value = { ...v }
    tags.value = v.tags.join(', ')
  },
)

function save() {
  if (!d.value.title.trim()) return
  emit('save', {
    ...d.value,
    city: d.value.city?.trim() || null,
    url: d.value.url?.trim() || null,
    tags: tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  })
}
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 sm:items-center" @click.self="emit('close')">
    <form
      class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
      @submit.prevent="save"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button type="button" class="text-2xl leading-none text-slate-400" @click="emit('close')">×</button>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <button
          v-for="t in PIN_TYPES"
          :key="t"
          type="button"
          class="chip border"
          :class="d.type === t ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'"
          @click="d.type = t"
        >
          {{ TYPE_META[t].emoji }} {{ TYPE_META[t].label }}
        </button>
      </div>

      <div class="mt-3 space-y-3">
        <input v-model="d.title" class="input font-medium" placeholder="Título" required />
        <textarea v-model="d.body" class="input min-h-32" placeholder="Notas, tips, horarios… (markdown)" />
        <div class="grid grid-cols-2 gap-3">
          <input v-model="d.city" class="input" placeholder="Ciudad / zona" list="pin-cities" />
          <datalist id="pin-cities">
            <option v-for="c in cities" :key="c" :value="c" />
          </datalist>
          <input v-model="tags" class="input" placeholder="tags, separados, por coma" />
        </div>
        <input v-model="d.url" class="input" placeholder="Link (opcional)" type="url" />
        <div v-if="days.length" class="grid grid-cols-2 gap-3">
          <select v-model="d.day" class="input">
            <option :value="null">💡 Sin día (idea)</option>
            <option v-for="(day, i) in days" :key="day" :value="day">Día {{ i + 1 }} · {{ fmtDay(day) }}</option>
          </select>
          <select v-model="d.timeOfDay" class="input" :disabled="!d.day">
            <option :value="null">Cualquier momento</option>
            <option v-for="t in TIMES" :key="t" :value="t">{{ TIME_META[t].emoji }} {{ TIME_META[t].label }}</option>
          </select>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <button
          v-for="s in PIN_STATUSES"
          :key="s"
          type="button"
          class="chip border"
          :class="d.status === s ? 'border-transparent ' + STATUS_META[s].cls + ' ring-2 ring-indigo-300' : 'border-slate-200 text-slate-600'"
          @click="d.status = s"
        >
          {{ STATUS_META[s].emoji }} {{ STATUS_META[s].label }}
        </button>
      </div>

      <div class="mt-5 flex items-center gap-2">
        <button class="btn-primary" :disabled="!d.title.trim()">Guardar</button>
        <button type="button" class="btn" @click="emit('close')">Cancelar</button>
        <slot name="extra" />
      </div>
    </form>
  </div>
</template>
