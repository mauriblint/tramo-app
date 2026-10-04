import './assets/main.css'

import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import App from './App.vue'
import TripsView from './views/TripsView.vue'
import TripView from './views/TripView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: TripsView },
    { path: '/trips/:id', component: TripView, props: true },
  ],
})

createApp(App).use(router).mount('#app')
