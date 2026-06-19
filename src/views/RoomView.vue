<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useRoomStore } from '@/stores/roomStore'
import { compressImage, DEFAULT_MAX_IMAGE_SIZE, ImageTooLargeError } from '@/composables/useImageCompressor'

const props = defineProps<{ roomId: string }>()

const USERNAME_KEY = 'play-chat-username'
const USER_ID_KEY = 'play-chat-user-id'
const DEFAULT_USERNAME = '匿名旅人'

const router = useRouter()
const roomStore = useRoomStore()

const username = ref(DEFAULT_USERNAME)
const selfId = ref('')
const activeRoomId = ref('')
const roomMissing = ref(false)
const messageInput = ref('')
const chatWindowRef = ref<HTMLElement | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingImage = ref<{ dataUrl: string; fileName: string; size: number } | null>(null)
const imageError = ref<string | null>(null)
const isCompressing = ref(false)

const normalizedRoomId = computed(() => props.roomId.toUpperCase())

const messages = computed(() => roomStore.getMessages(normalizedRoomId.value))

const participants = computed(() => roomStore.getParticipants(normalizedRoomId.value))

const hasMessages = computed(() => messages.value.length > 0)

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
})

const formatTimestamp = (timestamp: number) => timeFormatter.format(new Date(timestamp))

const ensureUsernameLoaded = () => {
  if (typeof window === 'undefined') return
  const saved = window.localStorage.getItem(USERNAME_KEY)
  username.value = saved && saved.trim().length > 0 ? saved.trim() : DEFAULT_USERNAME
}

const ensureSelfIdentity = () => {
  if (typeof window === 'undefined') return
  let stored = window.localStorage.getItem(USER_ID_KEY)
  if (!stored || stored.trim().length === 0) {
    if (
      typeof crypto !== 'undefined' &&
      'randomUUID' in crypto &&
      typeof crypto.randomUUID === 'function'
    ) {
      stored = crypto.randomUUID()
    } else {
      stored = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }
    window.localStorage.setItem(USER_ID_KEY, stored)
  }
  selfId.value = stored
}

const leaveActiveRoom = () => {
  if (!activeRoomId.value || !selfId.value) return
  roomStore.disconnect(activeRoomId.value, {
    id: selfId.value,
    username: username.value,
  })
  activeRoomId.value = ''
}

const joinRoomFlow = (roomId: string) => {
  ensureUsernameLoaded()
  ensureSelfIdentity()
  roomStore.ensureLoaded()

  if (!selfId.value) return

  let session
  try {
    session = roomStore.connect(roomId, {
      id: selfId.value,
      username: username.value,
    })
  } catch (error) {
    console.warn('加入房间失败', error)
    session = undefined
  }

  if (!session) {
    roomMissing.value = true
    activeRoomId.value = ''
    return
  }

  roomMissing.value = false
  activeRoomId.value = session.roomId
  nextTick(() => scrollChatToBottom('auto'))
}

const handleSendMessage = () => {
  if (roomMissing.value || !activeRoomId.value) return

  if (pendingImage.value) {
    roomStore.sendImage(activeRoomId.value, {
      userId: selfId.value,
      username: username.value,
      dataUrl: pendingImage.value.dataUrl,
      fileName: pendingImage.value.fileName,
      size: pendingImage.value.size,
    })
    pendingImage.value = null
    imageError.value = null
    messageInput.value = ''
    nextTick(() => scrollChatToBottom('smooth'))
    return
  }

  const content = messageInput.value
  roomStore.sendMessage(activeRoomId.value, {
    userId: selfId.value,
    username: username.value,
    content,
  })

  messageInput.value = ''
  nextTick(() => scrollChatToBottom('smooth'))
}

const handleComposerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!messageInput.value.trim() && !pendingImage.value) return
    handleSendMessage()
  }
}

const handlePickImage = () => {
  fileInputRef.value?.click()
}

const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  imageError.value = null
  isCompressing.value = true

  try {
    const dataUrl = await compressImage(file)
    pendingImage.value = {
      dataUrl,
      fileName: file.name,
      size: dataUrl.length,
    }
  } catch (error) {
    if (error instanceof ImageTooLargeError) {
      const limitKb = Math.round(DEFAULT_MAX_IMAGE_SIZE / 1024)
      imageError.value = `图片压缩后仍超过 ${limitKb} KB，请选择更小的图片`
    } else if (error instanceof TypeError) {
      imageError.value = error.message
    } else {
      imageError.value = '读取图片失败，请重试'
    }
    pendingImage.value = null
  } finally {
    isCompressing.value = false
    input.value = ''
  }
}

const clearPendingImage = () => {
  pendingImage.value = null
  imageError.value = null
}

const openImage = (src: string) => {
  if (typeof window === 'undefined') return
  if (!src.startsWith('data:image/')) return
  window.open(src, '_blank')
}

const handleBackToLobby = () => {
  leaveActiveRoom()
  router.push('/')
}

const scrollChatToBottom = (behavior: ScrollBehavior = 'auto') => {
  const container = chatWindowRef.value
  if (!container) return
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: container.scrollHeight, behavior })
    return
  }
  container.scrollTop = container.scrollHeight
}

onMounted(() => {
  ensureUsernameLoaded()
  ensureSelfIdentity()
  joinRoomFlow(normalizedRoomId.value)
})

onBeforeUnmount(() => {
  leaveActiveRoom()
})

watch(
  () => normalizedRoomId.value,
  (nextId, prevId) => {
    if (prevId && prevId !== '') {
      leaveActiveRoom()
    }
    joinRoomFlow(nextId)
  },
)

watch(username, (nextName) => {
  if (!activeRoomId.value || roomMissing.value || !selfId.value) return
  roomStore.updateLocalUsername(activeRoomId.value, {
    id: selfId.value,
    username: nextName,
  })
})

watch(
  () => messages.value.length,
  () => {
    if (roomMissing.value) return
    nextTick(() => {
      scrollChatToBottom('smooth')
    })
  },
)

watch(
  () => roomMissing.value,
  (missing) => {
    if (missing) return
    nextTick(() => scrollChatToBottom('auto'))
  },
)
</script>

<template>
  <div class="room-decoration" aria-hidden="true">
    <span class="orb orb-1"></span>
    <span class="orb orb-2"></span>
    <span class="orb orb-3"></span>
  </div>
  <div class="room-shell">
    <div class="room-left">
      <header class="room-header">
        <div class="room-meta">
          <p class="room-tag">房间号</p>
          <h2>{{ normalizedRoomId }}</h2>
        </div>

        <div class="room-user">
          <span class="user-label">当前用户</span>
          <span class="user-name">{{ username }}</span>
        </div>

        <button type="button" class="ghost" @click="handleBackToLobby">离开房间</button>
      </header>

      <section class="sidebar">
        <h2>在线成员</h2>
        <div v-if="!roomMissing && participants.length" class="member-list">
          <div
            v-for="participant in participants"
            :key="participant.userId"
            class="member-card"
            :class="{ self: participant.userId === selfId }"
          >
            <span class="member-name">{{ participant.username }}</span>
            <span class="member-status">{{
              participant.userId === selfId ? '你自己' : '在线'
            }}</span>
          </div>
        </div>
        <p v-else-if="roomMissing" class="sidebar-hint">未找到该房间，返回大厅重新加入。</p>
        <p v-else class="sidebar-hint">暂无其他成员加入，邀请好友一起畅聊。</p>
      </section>
    </div>

    <div class="chat-panel">
      <div ref="chatWindowRef" class="chat-window">
        <template v-if="roomMissing">
          <div class="chat-missing">
            <h2>房间不存在</h2>
            <p>请返回大厅重新确认房间号，或创建一个新的房间。</p>
            <button type="button" class="ghost" @click="handleBackToLobby">返回大厅</button>
          </div>
        </template>
        <template v-else>
          <ul v-if="hasMessages" class="message-list">
            <li
              v-for="message in messages"
              :key="message.id"
              class="message"
              :class="{
                self: message.type !== 'system' && message.userId === selfId,
                other: message.type !== 'system' && message.userId !== selfId,
                system: message.type === 'system',
              }"
            >
              <div v-if="message.type === 'system'" class="message-system">
                <span>{{ message.content }}</span>
                <time>{{ formatTimestamp(message.timestamp) }}</time>
              </div>
              <div v-else class="message-bubble">
                <header>
                  <span class="author">{{ message.username }}</span>
                  <time>{{ formatTimestamp(message.timestamp) }}</time>
                </header>
                <img
                  v-if="message.type === 'image'"
                  :src="message.content"
                  class="message-image"
                  alt="聊天图片"
                  title="点击查看大图"
                  loading="lazy"
                  tabindex="0"
                  @click="openImage(message.content)"
                />
                <p v-else class="body">{{ message.content }}</p>
              </div>
            </li>
          </ul>
          <div v-else class="chat-empty">
            <h3>开始第一条对话</h3>
            <p>欢迎来到聊天室，发送一条消息或等待好友加入，随时开始互动。</p>
          </div>
        </template>
      </div>

      <form v-if="!roomMissing" class="composer" @submit.prevent="handleSendMessage">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="visually-hidden"
          @change="handleFileChange"
        />

        <div v-if="pendingImage" class="composer-preview">
          <img :src="pendingImage.dataUrl" alt="图片预览" />
          <div class="preview-meta">
            <span class="preview-name">{{ pendingImage.fileName }}</span>
            <span class="preview-size">{{ Math.round(pendingImage.size / 1024) }} KB</span>
          </div>
          <button type="button" class="ghost preview-close" @click="clearPendingImage">取消</button>
        </div>

        <p v-if="imageError" class="image-error" aria-live="polite">{{ imageError }}</p>

        <textarea
          v-model="messageInput"
          rows="2"
          placeholder="输入消息，按 Enter 发送，Shift + Enter 换行"
          @keydown="handleComposerKeydown"
        ></textarea>

        <div class="composer-actions">
          <div class="composer-left">
            <button
              type="button"
              class="image-button"
              :disabled="isCompressing"
              @click="handlePickImage"
            >
              {{ isCompressing ? '压缩中...' : '📎 图片' }}
            </button>
          </div>
          <span class="composer-hint">Enter 发送 · Shift + Enter 换行</span>
          <button type="submit" class="cta primary">发送消息</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.room-decoration {
  position: fixed;
  inset: 80px 0 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.35;
  animation: float 18s ease-in-out infinite;
}

.orb-1 {
  width: 300px;
  height: 300px;
  top: 10%;
  left: 5%;
  background: rgba(52, 211, 153, 0.45);
  animation-delay: 0s;
}

.orb-2 {
  width: 260px;
  height: 260px;
  bottom: 15%;
  right: 5%;
  background: rgba(59, 130, 246, 0.4);
  animation-delay: -6s;
}

.orb-3 {
  width: 180px;
  height: 180px;
  top: 45%;
  left: 50%;
  background: rgba(16, 185, 129, 0.35);
  animation-delay: -12s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-24px) scale(1.05);
  }
}

.room-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-rows: auto;
  gap: 1rem;
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
  box-sizing: border-box;
  align-items: stretch;
  min-width: 0;
}

.room-left {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  height: 100%;
}

.room-header {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  background: rgba(236, 253, 245, 0.92);
  border-radius: 16px;
  border: 1px solid rgba(16, 185, 129, 0.18);
  flex-shrink: 0;
}

.room-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.room-tag {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #047857;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 2.8rem);
  color: #0f172a;
}

.room-user {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 0.4rem;
}

.user-label {
  font-size: 0.85rem;
  color: #64748b;
}

.user-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #0f172a;
}

.ghost {
  align-self: flex-start;
  padding: 0.7rem 1.5rem;
  border-radius: 999px;
  font-weight: 600;
  color: #0f172a;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.ghost:hover {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(190, 242, 100, 0.2);
}

.sidebar {
  flex: 1;
  min-height: auto;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
}

.sidebar h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #0f172a;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow: auto;
}

.member-card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem;
  border-radius: 12px;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.member-card.self {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(190, 242, 100, 0.2);
}

.member-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #0f172a;
}

.member-status {
  font-size: 0.75rem;
  color: #047857;
}

.sidebar-hint {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.5;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: #ffffff;
  border-radius: 20px;
  border: 1px solid rgba(226, 232, 240, 0.86);
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
  box-sizing: border-box;
  overflow: hidden;
}

.chat-window {
  flex: 1 1 0%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  scroll-behavior: smooth;
}

.message-list {
  list-style: none;
  margin: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.message {
  display: flex;
  flex-direction: column;
}

.message.other {
  align-items: flex-start;
}

.message.self {
  align-items: flex-end;
}

.message-bubble {
  max-width: min(640px, 88%);
  padding: 0.5rem 0.75rem;
  border-radius: 14px;
  background: rgba(59, 130, 246, 0.12);
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  box-shadow: 0 8px 20px rgba(59, 130, 246, 0.1);
}

.message.self .message-bubble {
  background: rgba(16, 185, 129, 0.18);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.message-bubble header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #0369a1;
}

.message.self .message-bubble header {
  color: #047857;
}

.message-bubble .author {
  font-weight: 600;
}

.message-bubble time {
  font-variant-numeric: tabular-nums;
}

.message-bubble .body {
  margin: 0;
  font-size: 0.9375rem;
  white-space: pre-wrap;
  line-height: 1.45;
  color: #0f172a;
}

.message-system {
  align-self: center;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #1e293b;
  font-size: 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.message-system time {
  font-variant-numeric: tabular-nums;
  color: #64748b;
}

.chat-empty {
  text-align: center;
  color: #475569;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.chat-empty h3 {
  margin: 0;
  font-size: 1.4rem;
  color: #0f172a;
}

.chat-missing {
  margin: auto;
  max-width: 420px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  color: #0f172a;
}

.chat-missing h2 {
  margin: 0;
  font-size: 1.6rem;
}

.chat-missing p {
  margin: 0;
  color: #475569;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.composer textarea {
  width: 100%;
  padding: 0.65rem 0.875rem;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  resize: none;
  font-size: 0.9375rem;
  line-height: 1.45;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.composer textarea:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.composer-hint {
  font-size: 0.75rem;
  color: #64748b;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.6rem;
  border-radius: 999px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.cta.primary {
  background: linear-gradient(135deg, #34d399, #10b981);
  color: #ffffff;
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.35);
}

.cta.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(16, 185, 129, 0.4);
}

@media (max-width: 1090px) {
  .room-shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .room-left {
    display: none;
  }
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.composer-preview {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem;
  background: rgba(236, 253, 245, 0.6);
  border-radius: 12px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.composer-preview img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 8px;
}

.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.preview-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-size {
  font-size: 0.8rem;
  color: #64748b;
}

.preview-close {
  flex-shrink: 0;
}

.image-error {
  margin: 0;
  color: #dc2626;
  font-size: 0.85rem;
  font-weight: 600;
}

.composer-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.image-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.55rem 1rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  color: #047857;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.3);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    background 0.2s ease;
}

.image-button:hover:not(:disabled) {
  transform: translateY(-2px);
  background: rgba(190, 242, 100, 0.25);
}

.image-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.message-image {
  max-width: min(200px, 55vw);
  max-height: 200px;
  border-radius: 10px;
  cursor: pointer;
  object-fit: cover;
  display: block;
}

.message-image:hover {
  opacity: 0.92;
}

.message-image:focus {
  outline: 2px solid rgba(59, 130, 246, 0.6);
  outline-offset: 2px;
}

@media (max-width: 1090px) {
  .message-image {
    max-width: min(160px, 65vw);
  }
}

html.dark .room-header {
  background: rgba(6, 78, 59, 0.6);
  border-color: rgba(74, 222, 128, 0.2);
}

html.dark .room-tag {
  color: #34d399;
}

html.dark h1,
html.dark h2,
html.dark .user-name {
  color: #e2e8f0;
}

html.dark .user-label {
  color: #94a3b8;
}

html.dark .ghost {
  color: #e2e8f0;
  background: rgba(6, 78, 59, 0.5);
  border-color: rgba(148, 163, 184, 0.25);
}

html.dark .ghost:hover {
  background: rgba(16, 185, 129, 0.25);
}

html.dark .sidebar {
  background: rgba(30, 41, 59, 0.85);
  border-color: rgba(74, 222, 128, 0.15);
}

html.dark .sidebar h2 {
  color: #e2e8f0;
}

html.dark .member-card {
  background: rgba(6, 78, 59, 0.5);
  border-color: rgba(74, 222, 128, 0.2);
}

html.dark .member-name {
  color: #e2e8f0;
}

html.dark .member-status {
  color: #34d399;
}

html.dark .sidebar-hint {
  color: #94a3b8;
}

html.dark .chat-panel {
  background: rgba(30, 41, 59, 0.85);
  border-color: rgba(74, 222, 128, 0.15);
}

html.dark .chat-empty h3,
html.dark .chat-missing h2 {
  color: #e2e8f0;
}

html.dark .chat-empty p,
html.dark .chat-missing p {
  color: #94a3b8;
}

html.dark .message-bubble {
  background: rgba(59, 130, 246, 0.22);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}

html.dark .message.self .message-bubble {
  background: rgba(16, 185, 129, 0.22);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}

html.dark .message-bubble header {
  color: #7dd3fc;
}

html.dark .message.self .message-bubble header {
  color: #6ee7b7;
}

html.dark .message-bubble .body {
  color: #e2e8f0;
}

html.dark .message-system {
  background: rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
}

html.dark .message-system time {
  color: #94a3b8;
}

html.dark .composer textarea {
  background: rgba(15, 23, 42, 0.7);
  border-color: rgba(148, 163, 184, 0.3);
  color: #e2e8f0;
}

html.dark .composer textarea:focus {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}

html.dark .composer-hint {
  color: #94a3b8;
}

html.dark .image-button {
  color: #34d399;
  background: rgba(6, 78, 59, 0.5);
  border-color: rgba(74, 222, 128, 0.25);
}

html.dark .image-button:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.25);
}

html.dark .composer-preview {
  background: rgba(6, 78, 59, 0.4);
  border-color: rgba(74, 222, 128, 0.2);
}

html.dark .preview-name {
  color: #e2e8f0;
}

html.dark .preview-size {
  color: #94a3b8;
}

html.dark .image-error {
  color: #fca5a5;
}

html.dark .orb-1 {
  background: rgba(16, 185, 129, 0.35);
}

html.dark .orb-2 {
  background: rgba(59, 130, 246, 0.35);
}

html.dark .orb-3 {
  background: rgba(52, 211, 153, 0.28);
}
</style>
