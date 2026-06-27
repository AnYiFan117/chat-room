<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'

import { getInitialTheme, initTheme, setTheme, type Theme } from '@/composables/useTheme'
import { runBackInterceptor } from '@/composables/useBackInterceptor'

const currentTheme = ref<Theme>('light')
const router = useRouter()
const route = useRoute()
let backButtonHandle: PluginListenerHandle | null = null

const isRoomPage = computed(() => route.name === 'room')

onMounted(async () => {
  initTheme()
  currentTheme.value = getInitialTheme()

  if (Capacitor.isNativePlatform()) {
    backButtonHandle = await CapacitorApp.addListener('backButton', () => {
      // 先交给当前页面的拦截器(如聊天室的收输入法/二次确认退出)
      if (runBackInterceptor()) return

      if (window.history.length > 1 && router.currentRoute.value.path !== '/') {
        router.back()
      } else {
        CapacitorApp.exitApp()
      }
    })
  }
})

onBeforeUnmount(() => {
  backButtonHandle?.remove()
  backButtonHandle = null
})

const handleToggleTheme = () => {
  const next = currentTheme.value === 'dark' ? 'light' : 'dark'
  setTheme(next)
  currentTheme.value = next
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink class="brand" to="/">Blow</RouterLink>
      <nav class="nav-links">
        <RouterLink class="nav-link" to="/">首页</RouterLink>
        <button
          type="button"
          class="theme-toggle"
          :aria-label="currentTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'"
          @click="handleToggleTheme"
        >
          {{ currentTheme === 'dark' ? '☀️' : '🌙' }}
        </button>
      </nav>
    </header>

    <main class="app-main">
      <RouterView />
    </main>

    <button
      v-if="!isRoomPage"
      type="button"
      class="theme-toggle theme-toggle--floating"
      :aria-label="currentTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'"
      @click="handleToggleTheme"
    >
      {{ currentTheme === 'dark' ? '☀️' : '🌙' }}
    </button>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: auto;
  min-width: 355px;
}

.app-header {
  height: 80px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #ffffff;
  color: #0f172a;
  border-bottom: 1px solid rgba(16, 185, 129, 0.25);
}

.brand {
  font-size: 1.25rem;
  font-weight: 600;
  color: #047857;
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 0.5rem;
  font-weight: 500;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  color: #047857;
  background: rgba(236, 253, 245, 0.95);
  border: 1px solid rgba(16, 185, 129, 0.2);
  text-decoration: none;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.nav-link:hover {
  background: #bbf7d0;
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.25);
}

.nav-link.router-link-exact-active {
  background: #047857;
  color: #ffffff;
  border-color: rgba(16, 185, 129, 0.8);
  box-shadow: 0 8px 18px rgba(14, 116, 144, 0.3);
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.2);
  background: rgba(236, 253, 245, 0.95);
  font-size: 1.1rem;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
}

.theme-toggle:hover {
  background: #bbf7d0;
  border-color: rgba(16, 185, 129, 0.35);
  transform: translateY(-2px);
}

.theme-toggle--floating {
  display: none;
}

@media (max-width: 520px) {
  .app-header {
    display: none;
  }

  .theme-toggle--floating {
    display: inline-flex;
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 0.6rem);
    right: 0.75rem;
    z-index: 100;
    width: 2.2rem;
    height: 2.2rem;
    font-size: 1rem;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
  }
}

.app-main {
  max-height: calc(100vh - 80px);
  min-height: 600px;
  flex: 1;
  background: #ecfdf5;
  overflow: auto;
}

@media (max-width: 520px) {
  .app-main {
    max-height: 100vh;
    min-height: 100vh;
  }
}

html.dark .app-header {
  background: #0f172a;
  color: #e2e8f0;
  border-bottom-color: rgba(74, 222, 128, 0.25);
}

html.dark .brand {
  color: #34d399;
}

html.dark .nav-link {
  color: #34d399;
  background: rgba(6, 78, 59, 0.6);
  border-color: rgba(74, 222, 128, 0.25);
}

html.dark .nav-link:hover {
  background: rgba(16, 185, 129, 0.25);
}

html.dark .nav-link.router-link-exact-active {
  background: #047857;
  color: #ffffff;
}

html.dark .theme-toggle {
  background: rgba(6, 78, 59, 0.6);
  border-color: rgba(74, 222, 128, 0.25);
}

html.dark .theme-toggle:hover {
  background: rgba(16, 185, 129, 0.25);
}

html.dark .app-main {
  background: #0f172a;
}
</style>
