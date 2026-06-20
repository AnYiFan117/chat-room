import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElImage } from 'element-plus'
import 'element-plus/es/components/image/style/css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.component('ElImage', ElImage)

app.mount('#app')
