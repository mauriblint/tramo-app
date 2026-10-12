import './assets/main.css'

import { createApp } from 'vue'
import { START_LOCATION, createRouter, createWebHistory } from 'vue-router'

import App from './App.vue'
import { api } from './api'
import { auth, fetchMe, openAuth } from './auth'
import { isStandalone, listenForInstallPrompt } from './install'
import { enablePullToRefresh, watchForUpdates } from './pwa'
import { lastPath, rememberPath } from './resume'
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
    { path: '/bookings', component: InboxView, meta: { auth: true, title: 'Reservas por revisar · tramo' } },
    { path: '/auth/verify', component: VerifyView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

/** Forwarded emails waiting for a trip are looked at once per visit, when the app opens. */
let inboxChecked = false

router.beforeEach(async (to, from) => {
  if (!auth.checked) await fetchMe()
  if (to.meta.auth && !auth.user) {
    openAuth('login')
    return '/plan'
  }
  if (auth.user && !inboxChecked) {
    inboxChecked = true
    if (to.path !== '/bookings' && !to.path.startsWith('/auth/')) {
      const waiting = await api.inbox().catch(() => [])
      if (waiting.length) return '/bookings'
    }
  }
  // Opening the app (or a reload after a deploy) at its start page, already signed in: the installed app goes
  // back to the trip screen you were on; the web goes to your trips instead of the landing.
  if (from === START_LOCATION && auth.user && (to.path === '/' || (to.path === '/plan' && isStandalone()))) {
    const resume = isStandalone() ? lastPath() : null
    if (resume && resume !== to.fullPath) return resume
    if (to.path === '/') return '/plan'
  }
  document.title = (to.meta.title as string | undefined) ?? 'tramo'
})

router.afterEach((to) => {
  if (to.path.startsWith('/trips/') || to.path === '/plan' || to.path === '/bookings') rememberPath(to.fullPath)
})

listenForInstallPrompt()
watchForUpdates()
createApp(App).use(router).mount('#app')
enablePullToRefresh()
