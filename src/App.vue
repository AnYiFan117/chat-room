<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink class="brand" to="/">超级大爆聊天室</RouterLink>
      <nav class="nav-links">
        <RouterLink class="nav-link" to="/">首页</RouterLink>
        <RouterLink class="nav-link" to="/contact">联系我</RouterLink>
      </nav>
    </header>

    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
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
  gap: 1rem;
  font-weight: 500;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 1.3rem;
  border-radius: 999px;
  color: #047857;
  background: rgba(236, 253, 245, 0.95);
  border: 1px solid rgba(16, 185, 129, 0.2);
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
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

.app-main {
  flex: 1;
  background: #ecfdf5;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 640px) {
  .app-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
}
</style>
