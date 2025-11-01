<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useRoomStore } from '@/stores/roomStore'

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
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
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
    handleSendMessage()
  }
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
  }
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
  }
)

watch(
  () => roomMissing.value,
  (missing) => {
    if (missing) return
    nextTick(() => scrollChatToBottom('auto'))
  }
)
</script>

<template>
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
            <span class="member-status">{{ participant.userId === selfId ? '你自己' : '在线' }}</span>
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
                self: message.type === 'chat' && message.userId === selfId,
                other: message.type === 'chat' && message.userId !== selfId,
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
                <p class="body">{{ message.content }}</p>
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
        <textarea
          v-model="messageInput"
          rows="3"
          placeholder="输入消息，按 Enter 发送，Shift + Enter 换行"
          @keydown="handleComposerKeydown"
        ></textarea>
        <div class="composer-actions">
          <span class="composer-hint">Enter 发送 · Shift + Enter 换行</span>
          <button type="submit" class="cta primary">发送消息</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.room-shell {
  min-height: 600px;
  display: grid;
  grid-template-columns: 180px minmax(800px, 1fr);
  grid-template-rows: auto;
  gap: 2rem;
  padding: clamp(1.5rem, 4vw, 3rem);
  box-sizing: border-box;
  align-items: stretch;
  min-width: 0;
}

.room-left {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-height: 0;
  height: 100%;
}

.room-header {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem 2rem;
  background: rgba(236, 253, 245, 0.92);
  border-radius: 18px;
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
  transition: border-color 0.2s ease, background 0.2s ease;
}

.ghost:hover {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(190, 242, 100, 0.2);
}

.sidebar {
  flex: 1;
  min-height: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
  background: #ffffff;
  border-radius: 18px;
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
}

.member-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 1rem;
  border-radius: 14px;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.member-card.self {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(190, 242, 100, 0.2);
}

.member-name {
  font-weight: 600;
  color: #0f172a;
}

.member-status {
  font-size: 0.85rem;
  color: #047857;
}

.sidebar-hint {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
  line-height: 1.5;
}

.chat-panel {
  /* flex: 1 1 0%;*/
  /* min-height: 497px; */
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
  background: #ffffff;
  border-radius: 24px;
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
  gap: 1.5rem;
  scroll-behavior: smooth;
}

.message-list {
  list-style: none;
  margin: 0;
  padding: 50px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
  max-width: min(520px, 90%);
  padding: 0.85rem 1rem;
  border-radius: 16px;
  background: rgba(59, 130, 246, 0.12);
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  box-shadow: 0 12px 28px rgba(59, 130, 246, 0.12);
}

.message.self .message-bubble {
  background: rgba(16, 185, 129, 0.18);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.15);
}

.message-bubble header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: 0.85rem;
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
  white-space: pre-wrap;
  line-height: 1.6;
  color: #0f172a;
}

.message-system {
  align-self: center;
  padding: 0.6rem 1rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #1e293b;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
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
  gap: 0.75rem;
}

.composer textarea {
  width: 100%;
  padding: 0.9rem 1rem;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  resize: none;
  font-size: 1rem;
  line-height: 1.6;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
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
  gap: 1rem;
}

.composer-hint {
  font-size: 0.85rem;
  color: #64748b;
}

.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.9rem 2rem;
  border-radius: 999px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
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
    gap: 1.5rem;
  }

  .room-left {
    display: none;
  }
}
</style>
