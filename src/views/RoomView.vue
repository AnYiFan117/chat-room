<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useRoomStore } from '@/stores/roomStore'
import { compressImage, DEFAULT_MAX_IMAGE_SIZE, ImageTooLargeError } from '@/composables/useImageCompressor'
import { getInitialTheme, setTheme, type Theme } from '@/composables/useTheme'
import { setBackInterceptor } from '@/composables/useBackInterceptor'

const props = defineProps<{ roomId: string }>()

const USERNAME_KEY = 'play-chat-username'
const USER_ID_KEY = 'play-chat-user-id'
const DEFAULT_USERNAME = '匿名旅人'
// 二次确认退出提示的保持时长(ms):此窗口内再次返回才真正退出
const EXIT_CONFIRM_WINDOW = 2500
// 判定"已滚到底部"的容差(px)
const BOTTOM_THRESHOLD = 60

const router = useRouter()
const roomStore = useRoomStore()

const username = ref(DEFAULT_USERNAME)
const selfId = ref('')
const activeRoomId = ref('')
const roomMissing = ref(false)
const messageInput = ref('')
const chatWindowRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingImage = ref<{ dataUrl: string; fileName: string; size: number } | null>(null)
const imageError = ref<string | null>(null)
const isCompressing = ref(false)
const membersOpen = ref(false)
const currentTheme = ref<Theme>('light')

// 功能2:二次确认退出
const confirmExitPending = ref(false)
let exitConfirmTimer: ReturnType<typeof setTimeout> | null = null

// 功能3:是否贴底 / 是否显示"回到最新"按钮
const isAtBottom = ref(true)
const showJumpToLatest = ref(false)

const handleToggleTheme = () => {
  const next = currentTheme.value === 'dark' ? 'light' : 'dark'
  setTheme(next)
  currentTheme.value = next
}

const normalizedRoomId = computed(() => props.roomId.toUpperCase())

const messages = computed(() => roomStore.getMessages(normalizedRoomId.value))

const participants = computed(() => roomStore.getParticipants(normalizedRoomId.value))

const hasMessages = computed(() => messages.value.length > 0)

const imagePreviewList = computed(() =>
  messages.value.filter((message) => message.type === 'image').map((message) => message.content),
)

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
    keepComposerFocused()
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
  keepComposerFocused()
  nextTick(() => scrollChatToBottom('smooth'))
}

// 功能1:发送后保持输入框聚焦,避免移动端键盘自动收起
const keepComposerFocused = () => {
  const el = textareaRef.value
  if (!el) return
  // 同步重新聚焦(尽量保留在用户手势上下文内,以便唤起软键盘)
  el.focus({ preventScroll: true })
  // 下一帧兜底:form submit/Enter 处理后若仍失焦再补一次
  nextTick(() => {
    if (document.activeElement !== el) el.focus({ preventScroll: true })
  })
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

const toggleMembers = () => {
  membersOpen.value = !membersOpen.value
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
  } else {
    container.scrollTop = container.scrollHeight
  }
  // 主动滚到底后即视为贴底,隐藏"回到最新"
  isAtBottom.value = true
  showJumpToLatest.value = false
}

// 功能3:监听聊天区滚动,判断是否贴底
const handleChatScroll = () => {
  const container = chatWindowRef.value
  if (!container) return
  const distanceToBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight
  isAtBottom.value = distanceToBottom <= BOTTOM_THRESHOLD
  // 离开底部一定距离才显示按钮,贴底则隐藏
  showJumpToLatest.value = !isAtBottom.value
}

// 功能3:点击"回到最新"
const handleJumpToLatest = () => {
  scrollChatToBottom('smooth')
}

// 功能1+2:清除二次确认提示状态
const clearExitConfirm = () => {
  confirmExitPending.value = false
  if (exitConfirmTimer) {
    clearTimeout(exitConfirmTimer)
    exitConfirmTimer = null
  }
}

// 功能1+2:系统返回手势的拦截处理
// 返回 true 表示本次返回已被处理(不退出房间)
const handleBackIntercept = (): boolean => {
  const el = textareaRef.value
  const inputFocused = !!el && document.activeElement === el

  // 第一次返回:若输入法聚焦则收起;并弹出"再次返回退出"提示
  if (!confirmExitPending.value) {
    if (inputFocused) el.blur()
    confirmExitPending.value = true
    if (exitConfirmTimer) clearTimeout(exitConfirmTimer)
    exitConfirmTimer = setTimeout(() => {
      confirmExitPending.value = false
      exitConfirmTimer = null
    }, EXIT_CONFIRM_WINDOW)
    return true
  }

  // 第二次返回(提示窗口内):放行,真正退出房间
  clearExitConfirm()
  return false
}

onMounted(() => {
  ensureUsernameLoaded()
  ensureSelfIdentity()
  currentTheme.value = getInitialTheme()
  joinRoomFlow(normalizedRoomId.value)
  setBackInterceptor(handleBackIntercept)
})

onBeforeUnmount(() => {
  setBackInterceptor(null)
  clearExitConfirm()
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
  (nextLen, prevLen) => {
    if (roomMissing.value) return
    nextTick(() => {
      // 功能3:仅在贴底时自动跟随最新消息;否则保留位置并提示有新消息
      if (isAtBottom.value) {
        scrollChatToBottom('smooth')
      } else if (nextLen > (prevLen ?? 0)) {
        showJumpToLatest.value = true
      }
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
      <header class="mobile-room-header">
        <div class="mobile-room-meta">
          <span class="mobile-room-id">{{ normalizedRoomId }}</span>
          <span v-if="!roomMissing" class="mobile-room-status">
            <span class="status-dot" aria-hidden="true"></span>
            {{ participants.length }} 人在线
          </span>
        </div>
        <div class="mobile-room-actions">
          <button
            type="button"
            class="icon-button"
            aria-label="在线成员"
            @click="toggleMembers"
          >
            👥
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="currentTheme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'"
            @click="handleToggleTheme"
          >
            {{ currentTheme === 'dark' ? '☀️' : '🌙' }}
          </button>
        </div>
      </header>

      <header class="chat-header">
        <div class="chat-header-meta">
          <span class="chat-header-room">{{ normalizedRoomId }}</span>
          <span v-if="participants.length" class="chat-header-count">{{ participants.length }} 人在线</span>
        </div>
        <button type="button" class="ghost members-toggle" @click="toggleMembers">
          成员
        </button>
      </header>

      <div ref="chatWindowRef" class="chat-window" @scroll="handleChatScroll">
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
                <el-image
                  v-if="message.type === 'image'"
                  :src="message.content"
                  :preview-src-list="imagePreviewList"
                  :initial-index="imagePreviewList.indexOf(message.content)"
                  fit="cover"
                  class="message-image"
                  alt="聊天图片"
                  title="点击放大预览"
                  :preview-teleported="true"
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

      <transition name="fade-jump">
        <button
          v-if="showJumpToLatest && !roomMissing"
          type="button"
          class="jump-latest"
          aria-label="回到最新消息"
          @click="handleJumpToLatest"
        >
          <span class="jump-latest-arrow" aria-hidden="true">↓</span>
          最新消息
        </button>
      </transition>

      <transition name="fade-toast">
        <div v-if="confirmExitPending" class="exit-confirm-toast" role="status">
          再次左滑返回即可退出房间
        </div>
      </transition>

      <aside class="mobile-members" :class="{ open: membersOpen }" aria-label="在线成员">
        <div class="mobile-members-header">
          <h2>在线成员</h2>
          <button type="button" class="ghost" @click="toggleMembers">关闭</button>
        </div>
        <div v-if="participants.length" class="member-list">
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
        <p v-else class="sidebar-hint">暂无其他成员加入，邀请好友一起畅聊。</p>
      </aside>

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

        <div class="composer-row">
          <button
            type="button"
            class="image-button"
            :disabled="isCompressing"
            aria-label="发送图片"
            @click="handlePickImage"
          >
            {{ isCompressing ? '…' : '📎' }}
          </button>
          <textarea
            ref="textareaRef"
            v-model="messageInput"
            rows="1"
            placeholder="输入消息…"
            @keydown="handleComposerKeydown"
          ></textarea>
          <button type="submit" class="cta primary send-button">发送</button>
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
  filter: blur(70px);
  opacity: 0.55;
  animation: float 18s ease-in-out infinite;
}

.orb-1 {
  width: 360px;
  height: 360px;
  top: 8%;
  left: 3%;
  background: rgba(52, 211, 153, 0.55);
  animation-delay: 0s;
}

.orb-2 {
  width: 320px;
  height: 320px;
  bottom: 12%;
  right: 3%;
  background: rgba(59, 130, 246, 0.5);
  animation-delay: -6s;
}

.orb-3 {
  width: 240px;
  height: 240px;
  top: 42%;
  left: 50%;
  background: rgba(16, 185, 129, 0.45);
  animation-delay: -12s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-28px) scale(1.06);
  }
}

.room-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-rows: auto;
  gap: 1rem;
  width: min(1400px, 96%);
  max-width: 1400px;
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
  position: relative;
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

.chat-header {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.chat-header-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.chat-header-room {
  font-size: 1.1rem;
  font-weight: 800;
  color: #022c22;
  letter-spacing: 0.04em;
}

.chat-header-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.members-toggle {
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
}

.mobile-members {
  display: none;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 240px;
  z-index: 10;
  background: #ffffff;
  border-left: 1px solid rgba(226, 232, 240, 0.86);
  box-shadow: -12px 0 36px rgba(15, 23, 42, 0.1);
  flex-direction: column;
  padding: 1rem;
  transform: translateX(100%);
  transition: transform 0.25s ease;
}

.mobile-members.open {
  transform: translateX(0);
}

.mobile-members-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.mobile-members-header h2 {
  margin: 0;
  font-size: 1rem;
  color: #0f172a;
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
  gap: 0.25rem;
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
  padding: 0.3rem 0.7rem;
  border-radius: 14px;
  background: rgba(59, 130, 246, 0.12);
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
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
  font-size: 0.72rem;
  line-height: 1.1;
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
  line-height: 1.35;
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

.composer-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
}

.composer textarea {
  width: 100%;
  padding: 0.55rem 0.875rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  resize: none;
  font-size: 0.9375rem;
  line-height: 1.4;
  height: 2.4rem;
  overflow: hidden;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.composer textarea:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
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

.send-button {
  height: 2.4rem;
  padding: 0 1rem;
  font-size: 0.9rem;
}

@media (max-width: 1090px) {
  .room-shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .room-left {
    display: none;
  }

  .chat-header,
  .mobile-members {
    display: flex;
  }
}

html.dark .chat-header {
  border-bottom-color: rgba(74, 222, 128, 0.15);
}

html.dark .chat-header-room {
  color: #f0fdf4;
}

html.dark .chat-header-count {
  color: #34d399;
  background: rgba(16, 185, 129, 0.15);
}

html.dark .mobile-members {
  background: rgba(15, 23, 42, 0.95);
  border-left-color: rgba(74, 222, 128, 0.15);
}

html.dark .mobile-members-header h2 {
  color: #f0fdf4;
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

.image-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: 999px;
  font-size: 1.1rem;
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
  display: block;
}

.message-image :deep(.el-image__inner) {
  max-width: 100%;
  max-height: 200px;
  border-radius: 10px;
  object-fit: cover;
  display: block;
}

.message-image:hover :deep(.el-image__inner) {
  opacity: 0.92;
}

.message-image:focus :deep(.el-image__inner) {
  outline: 2px solid rgba(59, 130, 246, 0.6);
  outline-offset: 2px;
}

@media (max-width: 1090px) {
  .message-image {
    max-width: min(160px, 65vw);
  }

  .message-image :deep(.el-image__inner) {
    max-height: 160px;
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
  background: rgba(16, 185, 129, 0.45);
}

html.dark .orb-2 {
  background: rgba(59, 130, 246, 0.45);
}

html.dark .orb-3 {
  background: rgba(52, 211, 153, 0.38);
}

.mobile-room-header {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: calc(env(safe-area-inset-top, 0px) + 0.5rem) 0.875rem 0.5rem;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid rgba(16, 185, 129, 0.2);
  position: sticky;
  top: 0;
  z-index: 5;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.mobile-room-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.mobile-room-id {
  font-size: 1rem;
  font-weight: 700;
  color: #022c22;
  letter-spacing: 0.04em;
}

.mobile-room-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: #059669;
}

.status-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
}

.mobile-room-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  border-radius: 999px;
  font-size: 1rem;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: #047857;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.icon-button:hover {
  background: rgba(190, 242, 100, 0.3);
  border-color: rgba(16, 185, 129, 0.45);
}

html.dark .mobile-room-header {
  background: rgba(15, 23, 42, 0.92);
  border-bottom-color: rgba(74, 222, 128, 0.18);
}

html.dark .mobile-room-id {
  color: #f0fdf4;
}

html.dark .mobile-room-status {
  color: #34d399;
}

html.dark .status-dot {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18);
}

html.dark .icon-button {
  background: rgba(6, 78, 59, 0.5);
  border-color: rgba(74, 222, 128, 0.25);
  color: #34d399;
}

html.dark .icon-button:hover {
  background: rgba(16, 185, 129, 0.25);
}

@media (max-width: 520px) {
  .room-decoration {
    display: none;
  }

  .room-shell {
    width: 100%;
    padding: 0;
    gap: 0;
  }

  .chat-panel {
    padding: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    gap: 0;
    height: 100vh;
    height: 100dvh;
  }

  .chat-header {
    display: none;
  }

  .mobile-room-header {
    display: flex;
  }

  .chat-window {
    padding: 0.5rem 0.5rem 0;
  }

  .message-list {
    padding: 0.5rem 0.25rem;
  }

  .composer {
    padding: 0.5rem 0.625rem calc(env(safe-area-inset-bottom, 0px) + 0.625rem);
    background: rgba(255, 255, 255, 0.96);
    border-top: 1px solid rgba(16, 185, 129, 0.15);
  }

  .send-button {
    padding: 0 0.85rem;
    font-size: 0.85rem;
  }
}

html.dark .composer {
  background: transparent;
}

@media (max-width: 520px) {
  html.dark .composer {
    background: rgba(15, 23, 42, 0.94);
    border-top-color: rgba(74, 222, 128, 0.15);
  }
}

/* 功能3:回到最新消息悬浮按钮 */
.jump-latest {
  position: absolute;
  right: 1rem;
  bottom: 5.5rem;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.3);
  background: rgba(255, 255, 255, 0.97);
  color: #047857;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
  transition:
    transform 0.2s ease,
    background 0.2s ease;
}

.jump-latest:hover {
  transform: translateY(-2px);
  background: rgba(236, 253, 245, 0.98);
}

.jump-latest-arrow {
  font-size: 0.95rem;
  line-height: 1;
}

html.dark .jump-latest {
  background: rgba(30, 41, 59, 0.97);
  border-color: rgba(74, 222, 128, 0.3);
  color: #34d399;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
}

.fade-jump-enter-active,
.fade-jump-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-jump-enter-from,
.fade-jump-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* 功能2:二次确认退出悬浮提示(非弹窗,自动消失) */
.exit-confirm-toast {
  position: absolute;
  left: 50%;
  bottom: 5.5rem;
  transform: translateX(-50%);
  z-index: 9;
  max-width: 80%;
  padding: 0.55rem 1.1rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
  color: #f8fafc;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.28);
  pointer-events: none;
}

html.dark .exit-confirm-toast {
  background: rgba(226, 232, 240, 0.92);
  color: #0f172a;
}

.fade-toast-enter-active,
.fade-toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.fade-toast-enter-from,
.fade-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (max-width: 520px) {
  .jump-latest {
    bottom: 4.75rem;
  }

  .exit-confirm-toast {
    bottom: 4.75rem;
  }
}
</style>
