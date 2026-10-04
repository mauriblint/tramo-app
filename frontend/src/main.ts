import './assets/main.css'

import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import App from './App.vue'
import { auth, fetchMe, openAuth } from './auth'
import { listenForInstallPrompt } from './install'
import LandingView from './views/LandingView.vue'
import PlanView from './views/PlanView.vue'
import TripView from './views/TripView.vue'
import VerifyView from './views/VerifyView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: LandingView, meta: { title: 'tramo · Tu viaje, tramo a tramo' } },
    { path: '/plan', component: PlanView, meta: { title: 'Planificá tu viaje · tramo' } },
    { path: '/trips/:id', component: TripView, props: true, meta: { auth: true } },
    { path: '/auth/verify', component: VerifyView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  if (!auth.checked) await fetchMe()
  if (to.meta.auth && !auth.user) {
    openAuth('login')
    return '/plan'
  }
  document.title = (to.meta.title as string | undefined) ?? 'tramo'
})

listenForInstallPrompt()
createApp(App).use(router).mount('#app')
