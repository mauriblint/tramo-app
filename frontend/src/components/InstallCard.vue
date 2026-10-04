<script setup lang="ts">
import { install, promptInstall } from '@/install'

const emit = defineEmits<{ close: [installed: boolean] }>()

async function installNow() {
  emit('close', await promptInstall())
}
</script>

<template>
  <div class="fixed inset-0 z-[1500] flex items-end justify-center bg-noche/45" @click.self="emit('close', false)">
    <div role="dialog" aria-modal="true" aria-label="Instalar tramo" class="w-full max-w-[440px] overflow-hidden rounded-t-[28px] bg-white">
      <!-- A dashed path that ends in a phone: the trip goes with you -->
      <div class="relative bg-brand">
        <svg viewBox="0 0 440 120" class="block h-[120px] w-full" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
          <path
            v-for="y in [16, 40, 64, 88, 112]"
            :key="y"
            :d="`M-20 ${y} C 80 ${y - 18}, 160 ${y + 20}, 260 ${y - 4} S 420 ${y + 14}, 480 ${y - 8}`"
            stroke="#FFFFFF"
            stroke-opacity="0.09"
            stroke-width="1.5"
          />
          <path d="M60 86 C 120 86, 140 44, 210 52 S 290 80, 318 62" stroke="#FFFFFF" stroke-opacity="0.75" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round" />
          <circle cx="60" cy="86" r="7" fill="#FFFFFF" />
          <circle cx="210" cy="52" r="5" fill="#FFFFFF" fill-opacity="0.85" />
          <rect x="330" y="22" width="44" height="78" rx="11" fill="#FFFFFF" />
          <rect x="336" y="32" width="32" height="58" rx="6" fill="#0A7A55" />
          <circle cx="352" cy="61" r="7" fill="#F5C84C" />
        </svg>
      </div>

      <div class="flex flex-col gap-4 px-6 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div>
          <h2 class="font-display text-[24px] leading-tight font-bold">Llevá tu viaje en el bolsillo</h2>
          <p class="mt-1.5 text-[15px] leading-relaxed text-slate-500">
            Instalá tramo en tu pantalla de inicio: se abre al toque, a pantalla completa, aunque haya poca señal.
          </p>
        </div>

        <template v-if="install.platform === 'ios'">
          <ol class="flex flex-col gap-2.5">
            <li class="flex items-center gap-3 rounded-2xl bg-rocio px-4 py-3">
              <span class="font-display grid h-7 w-7 flex-none place-items-center rounded-full bg-brand text-sm font-bold text-white">1</span>
              <span class="flex-1 text-[15px]">Tocá <b>Compartir</b> en la barra de Safari</span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="ícono Compartir"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" /></svg>
            </li>
            <li class="flex items-center gap-3 rounded-2xl bg-rocio px-4 py-3">
              <span class="font-display grid h-7 w-7 flex-none place-items-center rounded-full bg-brand text-sm font-bold text-white">2</span>
              <span class="flex-1 text-[15px]">Elegí <b>Agregar a inicio</b></span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E1F18" stroke-width="1.8" stroke-linecap="round" aria-label="ícono Agregar a inicio"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
            </li>
          </ol>
          <button class="btn-primary h-[52px] text-base" @click="emit('close', false)">Entendido</button>
          <div class="flex justify-center" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A7A55" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="animate-bounce"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
          </div>
        </template>

        <template v-else>
          <button class="btn-primary h-[52px] text-base" @click="installNow">Instalar tramo</button>
          <button class="text-sm font-semibold text-slate-500" @click="emit('close', false)">Ahora no</button>
        </template>
      </div>
    </div>
  </div>
</template>
