<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { auth, closeAuth, peekPending, startLogin, verifyCode } from '@/auth'
import TramoLogo from '@/components/TramoLogo.vue'

const name = ref('')
const email = ref('')
const code = ref('')
const busy = ref(false)
const error = ref('')
const codeInput = ref<HTMLInputElement>()

const m = computed(() => auth.modal)
const sent = computed(() => m.value.step === 'sent')
const login = computed(() => m.value.mode === 'login')
const pending = computed(() => (m.value.open ? peekPending() : null))

// Topographic-ish background lines for the header.
const topo = Array.from({ length: 8 }, (_, i) => 18 + i * 24)

watch(
  () => m.value.open,
  (open) => {
    if (open) {
      error.value = ''
      code.value = ''
    }
  },
)
watch(sent, async (s) => {
  if (s) {
    await nextTick()
    codeInput.value?.focus()
  }
})

async function submitForm() {
  error.value = ''
  if (!email.value.trim() || (!login.value && !name.value.trim())) {
    error.value = login.value ? 'Escribí tu email' : 'Completá tu nombre y email'
    return
  }
  busy.value = true
  try {
    await startLogin(email.value.trim(), login.value ? undefined : name.value.trim())
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function submitCode() {
  const c = code.value.replace(/\D/g, '')
  if (c.length !== 6) {
    error.value = 'Son 6 números'
    return
  }
  error.value = ''
  busy.value = true
  try {
    await verifyCode(c)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

// Paste/autofill of the full code signs in right away.
watch(code, (v) => {
  if (v.replace(/\D/g, '').length === 6 && !busy.value) submitCode()
})

function resend() {
  m.value.step = 'form'
  submitForm()
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="m.open"
      class="fixed inset-0 z-[2000] flex items-end justify-center bg-noche/55 sm:items-center sm:p-4"
      @click.self="closeAuth"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="sent ? 'Revisá tu email' : login ? 'Entrar' : 'Crear cuenta'"
        class="w-full max-w-[440px] overflow-hidden rounded-t-[28px] bg-white shadow-[0_30px_80px_rgba(14,31,24,0.35)] sm:rounded-[28px]"
      >
        <!-- Header: a dashed path toward the destination (an envelope travels it once the email is sent) -->
        <div class="relative overflow-hidden bg-brand">
          <svg viewBox="0 0 440 170" class="block h-[150px] w-full sm:h-[170px]" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
            <path
              v-for="y in topo"
              :key="y"
              :d="`M-20 ${y} C 80 ${y - 22}, 160 ${y + 26}, 260 ${y - 6} S 420 ${y + 18}, 480 ${y - 10}`"
              stroke="#FFFFFF"
              stroke-opacity="0.09"
              stroke-width="1.5"
            />
            <path
              :d="`M34 108 C 100 108, 110 58, 190 64 S 290 104, ${sent ? 300 : 330} ${sent ? 52 : 46}`"
              stroke="#FFFFFF"
              stroke-opacity="0.75"
              stroke-width="2.5"
              stroke-dasharray="2 9"
              stroke-linecap="round"
              class="path-draw"
            />
            <circle cx="34" cy="108" r="8" fill="#FFFFFF" />
            <circle cx="190" cy="64" r="6" fill="#FFFFFF" fill-opacity="0.85" />
            <template v-if="sent">
              <g transform="translate(312 52)" class="envelope">
                <rect x="-18" y="-13" width="36" height="26" rx="6" fill="#FFFFFF" />
                <path d="M-18 -9 L0 4 L18 -9" stroke="#0A7A55" stroke-width="2.4" stroke-linejoin="round" />
              </g>
              <circle cx="358" cy="40" r="14" fill="#F5C84C" fill-opacity="0.3" />
              <circle cx="358" cy="40" r="7" fill="#F5C84C" />
            </template>
            <template v-else>
              <circle cx="330" cy="46" r="18" fill="#F5C84C" fill-opacity="0.28" />
              <circle cx="330" cy="46" r="9" fill="#F5C84C" />
              <circle cx="330" cy="46" r="3.5" fill="#0A7A55" />
            </template>
          </svg>
          <TramoLogo class="absolute top-4 left-6 text-white" :size="26" on-dark />
          <button
            aria-label="Cerrar"
            class="absolute top-3.5 right-3.5 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            @click="closeAuth"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div v-if="pending && !sent" class="absolute right-6 bottom-4 left-6 flex">
            <span class="inline-flex h-[30px] max-w-full items-center gap-1.5 overflow-hidden rounded-full bg-white/15 px-3 text-[13px] font-semibold whitespace-nowrap text-white">
              <span class="h-[7px] w-[7px] flex-none rounded-full bg-sun" />
              <span class="truncate">“{{ pending }}”</span>
            </span>
          </div>
        </div>

        <!-- Form -->
        <form v-if="!sent" class="flex flex-col gap-4 px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="submitForm">
          <div>
            <h2 class="font-display text-[26px] leading-tight font-bold">{{ login ? '¡Hola de nuevo!' : '¡Arranquemos!' }}</h2>
            <p class="mt-1.5 text-[15px] leading-relaxed text-slate-500">
              {{
                login
                  ? 'Te mandamos un link a tu email para entrar. Sin contraseñas.'
                  : 'Creá tu cuenta en segundos y armamos el viaje juntos. Sin contraseñas: te mandamos un link a tu email.'
              }}
            </p>
          </div>
          <label v-if="!login" class="flex flex-col gap-1.5">
            <span class="text-[13px] font-bold text-slate-600">Nombre</span>
            <input v-model="name" autocomplete="given-name" placeholder="Cómo te llamás" class="auth-input" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[13px] font-bold text-slate-600">Email</span>
            <input v-model="email" type="email" inputmode="email" autocomplete="email" placeholder="tu@email.com" class="auth-input" />
          </label>
          <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
          <button class="btn-primary h-[54px] text-base" :disabled="busy">
            {{ busy ? 'Enviando…' : 'Enviarme el link' }}
            <svg v-if="!busy" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <p class="text-center text-sm text-slate-500">
            <template v-if="login">¿Primera vez? <button type="button" class="font-bold text-brand" @click="m.mode = 'signup'">Creá tu cuenta</button></template>
            <template v-else>¿Ya tenés cuenta? <button type="button" class="font-bold text-brand" @click="m.mode = 'login'">Entrá con tu email</button></template>
          </p>
        </form>

        <!-- Sent: link or code -->
        <form v-else class="flex flex-col gap-4 px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="submitCode">
          <div>
            <h2 class="font-display text-[26px] leading-tight font-bold">Revisá tu email</h2>
            <p class="mt-1.5 text-[15px] leading-relaxed text-slate-500">
              Te mandamos un link a <b class="text-noche">{{ m.email }}</b>. Tocalo, o escribí acá el código que viene en el mail.
            </p>
          </div>
          <label class="sr-only" for="auth-code">Código de 6 dígitos</label>
          <input
            id="auth-code"
            ref="codeInput"
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="······"
            class="auth-input h-16 text-center font-display text-3xl tracking-[0.5em]"
          />
          <p v-if="error" class="text-sm font-semibold text-rose-600">{{ error }}</p>
          <button class="btn-primary h-[54px] text-base" :disabled="busy">{{ busy ? 'Entrando…' : 'Entrar y armar mi viaje' }}</button>
          <div class="flex justify-between text-sm">
            <button type="button" class="font-bold text-brand" :disabled="busy" @click="resend">Reenviar email</button>
            <button type="button" class="text-slate-500" @click="m.step = 'form'">Cambiar email</button>
          </div>
          <p v-if="pending" class="rounded-2xl bg-rocio px-3.5 py-3 text-[13px] leading-snug text-slate-600">
            Tu mensaje queda guardado: apenas entres, el viaje arranca desde ahí.
          </p>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.auth-input {
  height: 50px;
  border-radius: 14px;
  border: 1.5px solid #dce3df;
  background: #fff;
  padding: 0 16px;
  font-size: 16px;
  color: #0e1f18;
  outline: none;
}
.auth-input:focus {
  border-color: #0a7a55;
  box-shadow: 0 0 0 4px #e3f5ec;
}
.path-draw {
  animation: dash 1.2s linear infinite;
}
@keyframes dash {
  to {
    stroke-dashoffset: -22;
  }
}
.envelope {
  animation: arrive 0.8s ease-out;
}
@keyframes arrive {
  from {
    transform: translate(190px, 64px);
    opacity: 0;
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
