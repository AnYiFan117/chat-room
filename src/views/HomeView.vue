<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useRoomStore } from '@/stores/roomStore'

const USERNAME_KEY = 'play-chat-username'
const DEFAULT_USERNAME = '匿名旅人'

const router = useRouter()
const roomStore = useRoomStore()

const username = ref(DEFAULT_USERNAME)
const copyFeedback = ref('')
const joinModalOpen = ref(false)
const joinRoomId = ref('')
const joinError = ref('')
const isLoading = ref(false)
const loadingMessage = ref('')

const APP_VERSION = '0.4.0'
const FULL_TITLE = '欢迎来到 Blow 在线聊天室'

let feedbackTimer: ReturnType<typeof setTimeout> | null = null
let typewriterTimer: ReturnType<typeof setTimeout> | null = null

const displayedTitle = ref('')

const startTypewriter = () => {
  displayedTitle.value = ''
  if (typewriterTimer) {
    clearTimeout(typewriterTimer)
  }
  let index = 0
  const step = () => {
    if (index < FULL_TITLE.length) {
      displayedTitle.value += FULL_TITLE[index]
      index += 1
      typewriterTimer = setTimeout(step, 85)
    }
  }
  step()
}

const ensureUsernameLoaded = () => {
  if (typeof window === 'undefined') return
  const saved = window.localStorage.getItem(USERNAME_KEY)
  username.value = saved && saved.trim().length > 0 ? saved.trim() : DEFAULT_USERNAME
}

const persistUsername = () => {
  if (typeof window === 'undefined') return
  const trimmed = username.value.trim()
  username.value = trimmed.length > 0 ? trimmed : DEFAULT_USERNAME
  window.localStorage.setItem(USERNAME_KEY, username.value)
}

const handleCreateRoom = async () => {
  const roomId = roomStore.createRoom()

  if (typeof window !== 'undefined' && navigator?.clipboard) {
    try {
      await navigator.clipboard.writeText(roomId)
      showFeedback(`房间号 ${roomId} 已复制到剪贴板`)
    } catch (error) {
      console.warn('复制房间号失败: ', error)
      showFeedback(`房间号：${roomId}`)
    }
  } else {
    showFeedback(`房间号：${roomId}`)
  }

  isLoading.value = true
  loadingMessage.value = '正在创建房间…'
  setTimeout(() => {
    isLoading.value = false
    router.push({ name: 'room', params: { roomId } })
  }, 600)
}

const openJoinModal = () => {
  joinModalOpen.value = true
  joinRoomId.value = ''
  joinError.value = ''
}

const closeJoinModal = () => {
  joinModalOpen.value = false
  joinRoomId.value = ''
  joinError.value = ''
}

const handleJoinRoom = () => {
  const roomId = joinRoomId.value.trim().toUpperCase()

  if (!roomId) {
    joinError.value = '请输入房间号'
    return
  }

  roomStore.markRoomKnown(roomId)
  closeJoinModal()

  isLoading.value = true
  loadingMessage.value = '正在加入房间…'
  setTimeout(() => {
    isLoading.value = false
    router.push({ name: 'room', params: { roomId } })
  }, 600)
}

const showFeedback = (message: string) => {
  copyFeedback.value = message
  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
  }
  feedbackTimer = setTimeout(() => {
    copyFeedback.value = ''
    feedbackTimer = null
  }, 3000)
}

onMounted(() => {
  roomStore.ensureLoaded()
  ensureUsernameLoaded()
  startTypewriter()
})

onBeforeUnmount(() => {
  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
  }
  if (typewriterTimer) {
    clearTimeout(typewriterTimer)
  }
})
</script>

<template>
  <section class="hero">
    <div class="ambient" aria-hidden="true">
      <span class="glow glow-1"></span>
      <span class="glow glow-2"></span>
      <span class="glow glow-3"></span>
    </div>

    <div class="hero-card">
      <div class="hero-header">
        <p class="hero-tagline">实时连接 · 畅聊无阻</p>
        <span class="version-badge">v{{ APP_VERSION }}</span>
      </div>

      <h1>{{ displayedTitle }}<span class="typewriter-cursor">|</span></h1>
      <p class="hero-copy">
        与朋友或团队快速开启一间私密聊天室。无需注册，一个房间号即可开始。
      </p>

      <div class="nickname-field">
        <label for="username-input">你的昵称</label>
        <input
          id="username-input"
          v-model="username"
          type="text"
          placeholder="输入昵称"
          maxlength="24"
          @blur="persistUsername"
          @keyup.enter="persistUsername"
        />
      </div>

      <div class="hero-actions">
        <button class="cta primary" type="button" @click="handleCreateRoom">
          <span class="cta-icon">＋</span>
          <span>创建房间</span>
        </button>
        <button class="cta secondary" type="button" @click="openJoinModal">
          <span class="cta-icon">→</span>
          <span>加入房间</span>
        </button>
      </div>

      <transition name="fade">
        <p v-if="copyFeedback" class="feedback">{{ copyFeedback }}</p>
      </transition>
    </div>
  </section>

  <teleport to="body">
    <div v-if="joinModalOpen" class="modal-mask" @click.self="closeJoinModal">
      <div class="modal-panel">
        <h3>加入房间</h3>
        <p class="modal-copy">输入房间号，与伙伴一键会合。</p>
        <form @submit.prevent="handleJoinRoom">
          <label class="modal-label" for="join-room-input">房间号</label>
          <input
            id="join-room-input"
            v-model="joinRoomId"
            type="text"
            placeholder="例如：ABCD12"
            maxlength="12"
            @input="joinError = ''"
          />
          <p v-if="joinError" class="modal-error">{{ joinError }}</p>
          <div class="modal-actions">
            <button type="button" class="ghost" @click="closeJoinModal">取消</button>
            <button type="submit" class="cta primary">加入房间</button>
          </div>
        </form>
      </div>
    </div>
  </teleport>

  <teleport to="body">
    <div v-if="isLoading" class="modal-mask loading-mask">
      <div class="loading-panel">
        <span class="loading-spinner" aria-hidden="true"></span>
        <p class="loading-message">{{ loadingMessage }}</p>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 80px);
  max-height: calc(100vh - 80px);
  overflow: hidden;
  padding: 1.5rem;
  background:
    radial-gradient(circle at 20% 20%, rgba(52, 211, 153, 0.18) 0%, transparent 35%),
    radial-gradient(circle at 80% 80%, rgba(59, 130, 246, 0.14) 0%, transparent 35%),
    linear-gradient(160deg, #f0fdf4 0%, #ecfdf5 45%, #d1fae5 100%);
  color: #0f172a;
}

.ambient {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.65;
  will-change: transform;
  animation: drift 12s ease-in-out infinite alternate;
}

.glow-1 {
  width: 380px;
  height: 380px;
  top: -8%;
  left: -6%;
  background: radial-gradient(circle, rgba(52, 211, 153, 0.75) 0%, rgba(16, 185, 129, 0.4) 70%);
  animation-delay: 0s;
}

.glow-2 {
  width: 320px;
  height: 320px;
  bottom: -10%;
  right: -4%;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.7) 0%, rgba(37, 99, 235, 0.35) 70%);
  animation-delay: -4s;
}

.glow-3 {
  width: 260px;
  height: 260px;
  top: 45%;
  left: 60%;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.55) 0%, rgba(124, 58, 237, 0.25) 70%);
  animation-delay: -8s;
}

@keyframes drift {
  0% {
    transform: translate(0, 0) scale(1);
  }
  100% {
    transform: translate(40px, -50px) scale(1.15);
  }
}

.hero-card {
  position: relative;
  z-index: 1;
  width: min(560px, 100%);
  padding: clamp(2rem, 5vw, 3rem);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 28px;
  box-shadow:
    0 24px 60px rgba(6, 78, 59, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.hero-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.hero-tagline {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #059669;
}

.version-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #065f46;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

h1 {
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #022c22;
  min-height: 1.1em;
}

.typewriter-cursor {
  display: inline-block;
  width: 0.06em;
  color: #10b981;
  font-weight: 300;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.hero-copy {
  margin: 0;
  font-size: 1rem;
  line-height: 1.6;
  color: #334155;
  max-width: 42ch;
}

.nickname-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nickname-field label {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #475569;
  text-transform: uppercase;
}

.nickname-field input {
  width: 100%;
  padding: 0.9rem 1.1rem;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.7);
  font-size: 1rem;
  color: #0f172a;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

.nickname-field input:focus {
  outline: none;
  border-color: rgba(16, 185, 129, 0.7);
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.hero-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.875rem;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.95rem 1.2rem;
  border-radius: 14px;
  font-weight: 700;
  font-size: 0.95rem;
  border: none;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    filter 0.2s ease;
}

.cta-icon {
  font-size: 1.1rem;
  font-weight: 500;
  opacity: 0.9;
}

.cta.primary {
  color: #ffffff;
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.35);
}

.cta.secondary {
  color: #065f46;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(16, 185, 129, 0.35);
}

.cta:hover {
  transform: translateY(-2px);
}

.cta.primary:hover {
  box-shadow: 0 16px 34px rgba(16, 185, 129, 0.42);
}

.cta.secondary:hover {
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.18);
}

.feedback {
  margin: 0;
  font-size: 0.9rem;
  color: #059669;
  font-weight: 600;
  text-align: center;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.modal-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  padding: 1.5rem;
  z-index: 30;
}

.modal-panel {
  width: min(400px, 100%);
  padding: 1.75rem;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 22px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.modal-panel h3 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  color: #022c22;
}

.modal-copy {
  margin: 0;
  font-size: 0.9rem;
  color: #475569;
}

.modal-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #475569;
}

.modal-panel input {
  width: 100%;
  padding: 0.8rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.7);
  font-size: 1rem;
  color: #0f172a;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.modal-panel input:focus {
  outline: none;
  border-color: rgba(16, 185, 129, 0.7);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.modal-error {
  margin: 0;
  font-size: 0.85rem;
  color: #dc2626;
  font-weight: 600;
}

.modal-actions {
  margin-top: 0.25rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.2rem;
  border-radius: 12px;
  font-weight: 700;
  font-size: 0.9rem;
  color: #475569;
  background: rgba(241, 245, 249, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.ghost:hover {
  background: rgba(226, 232, 240, 0.9);
  border-color: rgba(148, 163, 184, 0.45);
}

.loading-mask {
  cursor: wait;
}

.loading-panel {
  width: min(260px, 100%);
  padding: 1.75rem;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 22px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(16, 185, 129, 0.2);
  border-top-color: #10b981;
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-message {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: #022c22;
}

@media (max-width: 520px) {
  .hero-actions {
    grid-template-columns: 1fr;
  }

  .hero-card {
    padding: 1.75rem;
  }

  h1 {
    font-size: clamp(1.8rem, 8vw, 2.4rem);
  }
}

html.dark .hero {
  background: linear-gradient(160deg, #064e3b 0%, #0f172a 50%, #020617 100%);
}

html.dark .glow-1 {
  background: radial-gradient(circle, rgba(16, 185, 129, 0.6) 0%, rgba(5, 150, 105, 0.25) 70%);
}

html.dark .glow-2 {
  background: radial-gradient(circle, rgba(59, 130, 246, 0.55) 0%, rgba(37, 99, 235, 0.2) 70%);
}

html.dark .glow-3 {
  background: radial-gradient(circle, rgba(139, 92, 246, 0.45) 0%, rgba(124, 58, 237, 0.15) 70%);
}

html.dark .hero-card {
  background: rgba(15, 23, 42, 0.72);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

html.dark .hero-tagline {
  color: #34d399;
}

html.dark .version-badge {
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(52, 211, 153, 0.25);
}

html.dark h1 {
  color: #f0fdf4;
}

html.dark .typewriter-cursor {
  color: #34d399;
}

html.dark .hero-copy {
  color: #94a3b8;
}

html.dark .nickname-field label {
  color: #94a3b8;
}

html.dark .nickname-field input {
  background: rgba(2, 6, 23, 0.5);
  border-color: rgba(148, 163, 184, 0.2);
  color: #f0fdf4;
}

html.dark .nickname-field input:focus {
  background: rgba(2, 6, 23, 0.7);
  border-color: rgba(52, 211, 153, 0.5);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

html.dark .cta.primary {
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.25);
}

html.dark .cta.secondary {
  color: #a7f3d0;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(52, 211, 153, 0.3);
}

html.dark .cta.secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .feedback {
  color: #34d399;
}

html.dark .modal-panel,
html.dark .loading-panel {
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
}

html.dark .modal-panel h3,
html.dark .loading-message {
  color: #f0fdf4;
}

html.dark .modal-copy {
  color: #94a3b8;
}

html.dark .modal-label {
  color: #94a3b8;
}

html.dark .modal-panel input {
  background: rgba(2, 6, 23, 0.5);
  border-color: rgba(148, 163, 184, 0.2);
  color: #f0fdf4;
}

html.dark .modal-panel input:focus {
  border-color: rgba(52, 211, 153, 0.5);
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

html.dark .ghost {
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(148, 163, 184, 0.2);
}

html.dark .ghost:hover {
  background: rgba(255, 255, 255, 0.12);
}

html.dark .loading-spinner {
  border-color: rgba(52, 211, 153, 0.2);
  border-top-color: #34d399;
}
</style>
