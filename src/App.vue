<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

import { getInitialTheme, initTheme, setTheme, type Theme } from '@/composables/useTheme'

const currentTheme = ref<Theme>('light')

onMounted(() => {
  initTheme()
  currentTheme.value = getInitialTheme()
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
      <RouterLink class="brand" to="/">超级大爆聊天室</RouterLink>
      <nav class="nav-links">
        <RouterLink class="nav-link" to="/">首页</RouterLink>
        <RouterLink class="nav-link" to="/contact">联系我</RouterLink>
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

.app-main {
  max-height: calc(100vh - 80px);
  min-height: 600px;
  flex: 1;
  background: #ecfdf5;
  overflow: auto;
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
