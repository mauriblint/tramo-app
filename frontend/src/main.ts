import './assets/main.css'

import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import App from './App.vue'
import { api } from './api'
import { auth, fetchMe, openAuth } from './auth'
import { listenForInstallPrompt } from './install'
import InboxView from './views/InboxView.vue'
import LandingView from './views/LandingView.vue'
import PlanView from './views/PlanView.vue'
import TripView from './views/TripView.vue'
import VerifyView from './views/VerifyView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: LandingView, meta: { title: 'tramo · Tu viaje, tramo a tramo' } },
    { path: '/plan', component: PlanView, meta: { title: 'Planificá tu viaje · tramo' } },
    // One route for the trip, a day and an activity: the same TripView stays mounted (data, chat and polling survive navigation).
    { path: '/trips/:id/:section(days|pins)?/:item?', component: TripView, props: true, meta: { auth: true } },
    { path: '/reservas', component: InboxView, meta: { auth: true, title: 'Reservas por revisar · tramo' } },
    { path: '/auth/verify', component: VerifyView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

/** Forwarded emails waiting for a trip are looked at once per visit, when the app opens. */
let inboxChecked = false

router.beforeEach(async (to) => {
  if (!auth.checked) await fetchMe()
  if (to.meta.auth && !auth.user) {
    openAuth('login')
    return '/plan'
  }
  if (auth.user && !inboxChecked) {
    inboxChecked = true
    if (to.path !== '/reservas' && !to.path.startsWith('/auth/')) {
      const waiting = await api.inbox().catch(() => [])
      if (waiting.length) return '/reservas'
    }
  }
  document.title = (to.meta.title as string | undefined) ?? 'tramo'
})

listenForInstallPrompt()
createApp(App).use(router).mount('#app')
