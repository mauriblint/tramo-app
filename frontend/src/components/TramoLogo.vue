<script setup lang="ts">
/** Tramo mark: a dotted route between two stops; the destination is the sun-yellow dot. */
withDefaults(defineProps<{ size?: number; wordmark?: boolean; onDark?: boolean }>(), { size: 32, wordmark: true, onDark: false })
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <svg :width="size" :height="size" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="18" :fill="onDark ? '#FFFFFF' : '#0A7A55'" />
      <path
        d="M16 46 C 22 22, 42 44, 48 18"
        :stroke="onDark ? '#0A7A55' : '#F1F7F3'"
        stroke-width="4"
        stroke-linecap="round"
        stroke-dasharray="1 7"
      />
      <circle cx="16" cy="46" r="6" :fill="onDark ? '#0A7A55' : '#F1F7F3'" />
      <circle cx="48" cy="18" r="7.5" fill="#F5C84C" />
      <circle cx="48" cy="18" r="2.5" :fill="onDark ? '#FFFFFF' : '#0A7A55'" />
    </svg>
    <span v-if="wordmark" class="font-display font-bold" :style="{ fontSize: `${Math.round(size * 0.7)}px` }">tramo</span>
  </span>
</template>
