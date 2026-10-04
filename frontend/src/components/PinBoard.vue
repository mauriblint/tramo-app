<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Pin, PinStatus } from '@/api'
import PinCard from '@/components/PinCard.vue'
import { PIN_STATUSES, PIN_TYPES, STATUS_META, TYPE_META } from '@/pinMeta'

const props = defineProps<{ pins: Pin[]; highlightIds: string[]; tripStart: string | null; tripEnd: string | null }>()
const emit = defineEmits<{ edit: [Pin]; add: []; status: [Pin, PinStatus]; located: [Pin, Pin] }>()

type GroupBy = 'city' | 'type' | 'status'
const groupBy = ref<GroupBy>((localStorage.getItem('tp.groupBy') as GroupBy) || 'city')
const setGroup = (g: GroupBy) => {
  groupBy.value = g
  try {
    localStorage.setItem('tp.groupBy', g)
  } catch {}
}

const q = ref('')
const statusFilter = ref<PinStatus | 'active' | 'all'>('active')

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return props.pins.filter((p) => {
    if (statusFilter.value === 'active' && p.status === 'discarded') return false
    if (statusFilter.value !== 'active' && statusFilter.value !== 'all' && p.status !== statusFilter.value) return false
    if (!needle) return true
    return [p.title, p.body, p.city ?? '', ...p.tags].join(' ').toLowerCase().includes(needle)
  })
})

const STATUS_ORDER: PinStatus[] = ['must', 'want', 'idea', 'done', 'discarded']

const groups = computed(() => {
  const map = new Map<string, Pin[]>()
  for (const p of filtered.value) {
    const key =
      groupBy.value === 'city'
        ? p.city || 'Sin ciudad'
        : groupBy.value === 'type'
          ? `${TYPE_META[p.type].emoji} ${TYPE_META[p.type].label}`
          : `${STATUS_META[p.status].emoji} ${STATUS_META[p.status].label}`
    map.set(key, [...(map.get(key) ?? []), p])
  }
  const order = (label: string) => {
    if (groupBy.value === 'type') return PIN_TYPES.findIndex((t) => label.endsWith(TYPE_META[t].label))
    if (groupBy.value === 'status') return STATUS_ORDER.findIndex((s) => label.endsWith(STATUS_META[s].label))
    return label === 'Sin ciudad' ? 1e9 : -(map.get(label)?.length ?? 0)
  }
  // Inside each group: must first, then want, idea, done, discarded.
  return [...map.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([label, pins]) => ({
      label,
      pins: [...pins].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    }))
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="space-y-2 border-b border-slate-200 bg-white/80 p-3 backdrop-blur">
      <div class="flex items-center gap-2">
        <input v-model="q" class="input py-1.5" placeholder="Buscar en pins…" />
        <button class="btn-primary shrink-0 py-1.5" @click="emit('add')">+ Pin</button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-slate-500">Agrupar:</span>
        <button
          v-for="g in [
            ['city', 'Ciudad'],
            ['type', 'Tipo'],
            ['status', 'Estado'],
          ] as const"
          :key="g[0]"
          class="chip border"
          :class="groupBy === g[0] ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'"
          @click="setGroup(g[0])"
        >
          {{ g[1] }}
        </button>
        <span class="mx-1 text-slate-300">|</span>
        <select v-model="statusFilter" class="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs">
          <option value="active">Activos</option>
          <option value="all">Todos</option>
          <option v-for="s in PIN_STATUSES" :key="s" :value="s">{{ STATUS_META[s].emoji }} {{ STATUS_META[s].label }}</option>
        </select>
        <span class="ml-auto text-slate-500">{{ filtered.length }} pins</span>
      </div>
    </div>

    <div class="flex-1 space-y-5 overflow-y-auto p-3">
      <div v-if="!pins.length" class="mt-10 text-center text-slate-500">
        <div class="text-4xl">📌</div>
        <p class="mt-2">Todavía no hay pins.</p>
        <p class="text-sm">Charlá en el chat y tocá <b>Añadir al trip</b>, o creá uno a mano.</p>
      </div>
      <section v-for="g in groups" :key="g.label">
        <h3 class="mb-2 text-sm font-semibold text-slate-600">
          {{ g.label }} <span class="font-normal text-slate-400">· {{ g.pins.length }}</span>
        </h3>
        <div class="space-y-2">
          <PinCard
            v-for="p in g.pins"
            :key="p.id"
            :pin="p"
            :highlight="highlightIds.includes(p.id)"
            :trip-start="tripStart"
            :trip-end="tripEnd"
            @located="(np) => emit('located', p, np)"
            @edit="emit('edit', p)"
            @status="(s) => emit('status', p, s)"
          />
        </div>
      </section>
    </div>
  </div>
</template>
