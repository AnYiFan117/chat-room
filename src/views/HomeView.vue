<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

let feedbackTimer: ReturnType<typeof setTimeout> | null = null

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

  router.push({ name: 'room', params: { roomId } })
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
  router.push({ name: 'room', params: { roomId } })
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
})
</script>

<template>
  <section class="hero">
    <div class="hero-content">
      <p class="hero-tagline">实时连接 · 畅聊无阻</p>
      <h1>欢迎来到 Blow 在线聊天室</h1>
      <p class="hero-copy">
        在这里与朋友或团队快速开启对话，分享灵感与想法。无需复杂配置，直接创建或加入房间，开始实时聊天体验。
      </p>

      <div class="username-card">
        <label for="username-input">你的昵称</label>
        <div class="username-input">
          <input
            id="username-input"
            v-model="username"
            type="text"
            placeholder="请输入昵称"
            maxlength="24"
            @blur="persistUsername"
            @keyup.enter="persistUsername"
          />
          <button type="button" class="ghost" @click="persistUsername">保存</button>
        </div>
        <p class="username-hint">昵称将仅保存在本地浏览器中，便于下次快速进入房间。</p>
      </div>

      <div class="hero-actions">
        <button class="cta primary" type="button" @click="handleCreateRoom">创建房间</button>
        <button class="cta secondary" type="button" @click="openJoinModal">加入房间</button>
      </div>

      <transition name="fade">
        <p v-if="copyFeedback" class="feedback">{{ copyFeedback }}</p>
      </transition>
    </div>

    <div class="hero-visual">
      <div class="visual-card">
        <h2>即时协作</h2>
        <p>支持多人在线聊天，稍后将接入消息同步与在线用户列表。</p>
        <ul>
          <li>快速生成房间号</li>
          <li>浏览器记住昵称</li>
          <li>体验清爽界面</li>
        </ul>
      </div>
    </div>
  </section>

  <teleport to="body">
    <div v-if="joinModalOpen" class="modal-mask" @click.self="closeJoinModal">
      <div class="modal-panel">
        <h3>加入已有房间</h3>
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
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  align-items: center;
  gap: clamp(2rem, 6vw, 4rem);
  padding: clamp(2.5rem, 6vw, 4.5rem) clamp(1.5rem, 8vw, 7rem);
  background: linear-gradient(135deg, rgba(236, 253, 245, 0.95), rgba(209, 250, 229, 0.75));
  color: #0f172a;
}

.hero-content {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  color: #0f172a;
}

.hero-tagline {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #047857;
}

h1 {
  margin: 0;
  font-size: clamp(2.5rem, 5vw, 3.6rem);
  line-height: 1.1;
}

.hero-copy {
  margin: 0;
  font-size: 1rem;
  line-height: 1.7;
  color: #374151;
  max-width: 46ch;
}

.username-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  border: 1px solid rgba(59, 130, 246, 0.08);
  box-shadow: 0 18px 40px rgba(15, 118, 110, 0.12);
}

.username-card label {
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.username-input {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.username-input input {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  font-size: 1rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.username-input input:focus {
  outline: none;
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
}

.username-hint {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.95rem 2.2rem;
  border-radius: 999px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.cta.primary {
  color: #fff;
  background: linear-gradient(135deg, #34d399, #10b981);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.35);
}

.cta.secondary {
  color: #047857;
  background: rgba(236, 253, 245, 0.95);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.cta:hover {
  transform: translateY(-2px);
}

.ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.4rem;
  border-radius: 999px;
  font-weight: 600;
  color: #0f172a;
  background: rgba(236, 253, 245, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.ghost:hover {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(190, 242, 100, 0.25);
}

.feedback {
  margin: 0;
  color: #047857;
  font-weight: 600;
}

.hero-visual {
  display: flex;
  align-items: center;
  justify-content: center;
}

.visual-card {
  padding: clamp(2rem, 4vw, 3rem);
  background: rgba(15, 118, 110, 0.92);
  color: #ecfdf5;
  border-radius: 26px;
  box-shadow: 0 22px 45px rgba(15, 118, 110, 0.35);
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.visual-card h2 {
  margin: 0;
  font-size: 1.75rem;
}

.visual-card p {
  margin: 0;
  line-height: 1.6;
}

.visual-card ul {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: rgba(236, 253, 245, 0.8);
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
  backdrop-filter: blur(2px);
  padding: 1.5rem;
  z-index: 30;
}

.modal-panel {
  width: min(420px, 100%);
  padding: 2rem;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-panel h3 {
  margin: 0;
  font-size: 1.5rem;
  color: #0f172a;
}

.modal-copy {
  margin: 0;
  color: #475569;
}

.modal-label {
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.modal-panel input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  font-size: 1rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.modal-panel input:focus {
  outline: none;
  border-color: rgba(16, 185, 129, 0.65);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.24);
}

.modal-error {
  margin: 0;
  color: #dc2626;
  font-weight: 600;
}

.modal-actions {
  margin-top: 0.5rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .hero {
    padding: 2rem 1.5rem;
  }

  .username-input {
    flex-direction: column;
    align-items: stretch;
  }

  .ghost {
    width: 100%;
  }

  .hero-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .cta {
    width: 100%;
  }
}
</style>
