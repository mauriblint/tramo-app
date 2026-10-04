<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { openAuth, verifyToken } from '@/auth'
import TramoLogo from '@/components/TramoLogo.vue'

/** Landing spot of the email link: exchange the token for a session and continue on /plan. */
const route = useRoute()
const router = useRouter()
const error = ref('')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  try {
    await verifyToken(token)
    router.replace('/plan')
  } catch (e) {
    error.value = (e as Error).message
  }
})

function retry() {
  router.replace('/plan')
  openAuth('login')
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-brand px-6 text-white">
    <div class="flex max-w-sm flex-col items-center gap-5 text-center">
      <TramoLogo :size="40" on-dark />
      <template v-if="!error">
        <p class="font-display text-2xl font-bold">Entrando…</p>
        <span class="h-1.5 w-40 overflow-hidden rounded-full bg-white/20"><span class="block h-full w-1/2 animate-pulse rounded-full bg-sun" /></span>
      </template>
      <template v-else>
        <p class="font-display text-2xl font-bold">Ese link ya no sirve</p>
        <p class="text-mint-text">{{ error }}</p>
        <button class="h-12 rounded-full bg-white px-6 font-bold text-brand" @click="retry">Pedir uno nuevo</button>
      </template>
    </div>
  </main>
</template>
