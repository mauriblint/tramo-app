<script setup lang="ts">
import { useRouter } from 'vue-router'

import { auth, openAuth } from '@/auth'
import TramoLogo from '@/components/TramoLogo.vue'

const router = useRouter()

const STEPS = [
  { title: 'Contame del viaje', text: 'A dónde, cuándo, con quién y a qué ritmo. Te pregunto lo justo, con respuestas de un toque.' },
  { title: 'Te propongo una ruta', text: 'Ciudades, noches y excursiones en un mapa. “Uno menos en Tokio”, “sumá Nara”: lo ajustamos charlando.' },
  { title: 'Te armo cada día', text: 'Mañana, tarde y noche con lugares reales y el clima. Y durante el viaje, el copiloto sigue ahí.' },
]

function signIn() {
  if (auth.user) router.push('/plan')
  else openAuth('login', () => router.push('/plan'))
}
</script>

<template>
  <div class="min-h-dvh bg-rocio text-noche">
    <header class="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-5">
      <RouterLink to="/" aria-label="tramo"><TramoLogo :size="34" /></RouterLink>
      <nav class="flex items-center gap-2">
        <a href="#como-funciona" class="hidden px-3.5 py-2.5 text-[15px] font-semibold text-slate-700 sm:inline">Cómo funciona</a>
        <button class="inline-flex h-11 items-center rounded-full border-[1.5px] border-noche px-5 text-[15px] font-bold" @click="signIn">
          {{ auth.user ? 'Mis viajes' : 'Entrar' }}
        </button>
      </nav>
    </header>

    <!-- Hero -->
    <section class="mx-auto flex max-w-[1200px] flex-wrap items-center gap-14 px-6 pt-10 pb-20">
      <div class="flex min-w-0 flex-[1_1_460px] flex-col gap-6">
        <span class="inline-flex h-8 items-center gap-2 self-start rounded-full bg-brand-soft px-3.5 text-[13px] font-bold text-brand-dark">
          <span class="h-2 w-2 rounded-full bg-sun" /> Beta privada
        </span>
        <h1 class="font-display text-[clamp(44px,6vw,76px)] leading-none font-bold tracking-[-0.04em]">Tu viaje,<br />tramo a tramo.</h1>
        <p class="max-w-[520px] text-[clamp(17px,1.6vw,20px)] leading-relaxed text-[#3F4B45]">
          Contale a dónde vas y cuándo. Te propongo una ruta, la ajustamos charlando y te armo cada día del viaje.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <RouterLink to="/plan" class="inline-flex h-14 items-center gap-2.5 rounded-full bg-brand px-7 text-[17px] font-bold text-white hover:bg-brand-dark">
            Armar mi viaje
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </RouterLink>
          <span class="text-sm text-[#5B6762]">Sin formularios. Se instala en el teléfono.</span>
        </div>
      </div>

      <!-- Phone showing the app -->
      <div class="flex min-w-0 flex-[1_1_360px] justify-center" aria-hidden="true">
        <div class="h-[640px] w-[320px] rounded-[48px] bg-noche p-3 shadow-[0_40px_80px_rgba(10,122,85,0.22)]">
          <div class="flex h-full flex-col overflow-hidden rounded-[38px] bg-rocio">
            <div class="relative h-[230px] flex-none bg-[#E6EAE7]">
              <svg viewBox="0 0 296 230" class="h-full w-full" fill="none">
                <path d="M210 40 C 240 60, 250 90, 236 120 C 222 150, 190 160, 160 172 C 120 188, 80 196, 40 214 L 0 230 L 0 0 L 296 0 L 296 40 Z" fill="#DADFDC" />
                <path d="M222 70 C 180 96, 150 118, 120 146 S 70 186, 58 196" stroke="#0A7A55" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round" />
              </svg>
              <div class="absolute top-[54px] left-[204px] flex items-center gap-1.5"><span class="phone-pin">1</span><span class="phone-label">Tokio</span></div>
              <div class="absolute top-[132px] left-[106px]"><span class="phone-pin">2</span></div>
              <div class="absolute top-[182px] left-[44px] flex items-center gap-1.5"><span class="phone-pin">3</span><span class="phone-label">Osaka</span></div>
            </div>
            <div class="relative -mt-[18px] flex flex-1 flex-col gap-3 rounded-t-[22px] bg-rocio px-4 pt-[18px]">
              <div>
                <div class="font-display text-[22px] font-bold tracking-tight">Japón en otoño</div>
                <div class="mt-0.5 text-xs text-[#5B6762]">10 – 20 nov · 11 días · En pareja</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="grid h-[22px] w-[22px] place-items-center rounded-full bg-brand text-[11px] font-extrabold text-white">1</span>
                <span class="font-display text-[15px] font-bold">Tokio</span>
              </div>
              <div v-for="d in [{ dow: 'MAR', n: 10, items: ['Paseo por Asakusa', 'Templo Sensō-ji', 'Cena en Ameyoko'] }, { dow: 'MIÉ', n: 11, items: ['Santuario Meiji', 'Omotesandō y cafés'] }]" :key="d.n" class="flex gap-3 rounded-2xl bg-white px-3 py-2.5">
                <div class="w-[30px] text-center">
                  <div class="text-[9px] font-bold text-[#94A39C]">{{ d.dow }}</div>
                  <div class="font-display text-lg leading-none font-bold">{{ d.n }}</div>
                </div>
                <div class="flex flex-col gap-1 text-xs font-semibold"><span v-for="i in d.items" :key="i">{{ i }}</span></div>
              </div>
              <div class="mt-auto mb-3.5 flex h-10 items-center rounded-full bg-noche px-3.5 text-xs text-white/70">Pedile cambios al copiloto…</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section id="como-funciona" class="bg-white px-6 py-[88px]">
      <div class="mx-auto flex max-w-[1200px] flex-col gap-10">
        <h2 class="font-display text-[clamp(32px,4vw,48px)] font-bold tracking-[-0.035em]">Cómo funciona</h2>
        <ol class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
          <li v-for="(s, i) in STEPS" :key="s.title" class="flex flex-col gap-3.5 rounded-3xl bg-rocio p-7">
            <span
              class="font-display grid h-11 w-11 place-items-center rounded-[14px] text-lg font-bold"
              :class="i === 2 ? 'bg-sun text-[#3D2C00]' : 'bg-brand text-white'"
            >{{ i + 1 }}</span>
            <h3 class="text-[21px] font-bold">{{ s.title }}</h3>
            <p class="text-base leading-relaxed text-[#3F4B45]">{{ s.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="px-6 py-[72px]">
      <div class="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-7 rounded-[32px] bg-brand p-[clamp(36px,5vw,64px)] text-white">
        <div class="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <h2 class="font-display text-[clamp(30px,3.6vw,44px)] leading-[1.05] font-bold tracking-[-0.035em]">¿A dónde vamos?</h2>
          <p class="text-[17px] text-mint-text">Tu próximo viaje empieza con un mensaje.</p>
        </div>
        <RouterLink to="/plan" class="inline-flex h-14 items-center gap-2.5 rounded-full bg-white px-7 text-[17px] font-bold text-brand">
          Empezar ahora
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </RouterLink>
      </div>
    </section>

    <footer class="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-3 px-6 pt-2 pb-10 text-sm text-[#5B6762]">
      <span class="flex items-center gap-2"><TramoLogo :size="20" :wordmark="false" /> tramo · trytramo.com</span>
      <span>Hecho viajando.</span>
    </footer>
  </div>
</template>

<style scoped>
.phone-pin {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: #0a7a55;
  border: 2.5px solid #fff;
  box-sizing: border-box;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}
.phone-label {
  background: #fff;
  border-radius: 8px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
}
</style>
