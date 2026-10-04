<script setup lang="ts">
import type { Step } from '@/tripProfile'

defineProps<{ title: string; subtitle?: string | null; steps?: Step[] }>()
defineEmits<{ edit: [] }>()
</script>

<template>
  <header class="rounded-b-[28px] bg-brand px-3 pt-2 pb-4 text-white md:rounded-none md:px-5 md:pb-3">
    <div class="flex items-center gap-1">
      <RouterLink to="/plan" aria-label="Volver" class="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </RouterLink>
      <button class="min-w-0 flex-1 text-left" @click="$emit('edit')">
        <div v-if="subtitle" class="truncate text-[12px] font-semibold text-mint-text">{{ subtitle }}</div>
        <h1 class="font-display truncate text-[22px] leading-tight font-bold md:text-2xl">{{ title }}</h1>
      </button>
      <slot name="right" />
    </div>
    <ol v-if="steps?.length" class="mt-3 grid gap-1.5 px-2" :style="{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }">
      <li v-for="s in steps" :key="s.key" class="flex flex-col gap-1.5">
        <span class="h-1 rounded-full transition-colors duration-500" :class="s.ok ? 'bg-white' : 'bg-white/25'" />
        <span class="text-[11px] font-bold" :class="s.ok ? 'text-white' : 'text-mint-text/80'">{{ s.label }}</span>
      </li>
    </ol>
    <slot />
  </header>
</template>
