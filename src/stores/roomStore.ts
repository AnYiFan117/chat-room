// 处理聊天室状态与同步逻辑的 Pinia 仓库
// 传输层：自定义 JSON over WebSocket（消息经服务器中转，不做 P2P）
// 加密层：AES-GCM 端到端加密，密钥由 房间号 + 固定 app salt 经 PBKDF2 派生
import { acceptHMRUpdate, defineStore } from 'pinia'
import { markRaw } from 'vue'

// 本地存储曾加入房间 ID 列表的键值
const KNOWN_ROOMS_KEY = 'play-chat-room-ids'
// 默认访客昵称
const DEFAULT_USERNAME = '匿名旅人'

// 端到端加密参数
const APP_SALT = 'play-chat-app-2026'
const ENCRYPTION_PREFIX = 'aes-gcm::v1::'
const AES_IV_LENGTH = 12
const PBKDF2_ITERATIONS = 100000

// WebSocket 行为参数
const PING_INTERVAL_MS = 25000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 12
// 单条图片消息上限（WebSocket 无 256KB 硬限，但仍留余量，避免滥用与反代压力）
const IMAGE_SAFE_LIMIT = 2 * 1024 * 1024

// 封装浏览器与 Node 环境可能存在差异的编码器
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

// 将字符串编码为 UTF-8 字节数组
const encodeUtf8 = (input: string): Uint8Array => {
  if (textEncoder) {
    return textEncoder.encode(input)
  }
  const escaped = unescape(encodeURIComponent(input))
  const bytes = new Uint8Array(escaped.length)
  for (let index = 0; index < escaped.length; index += 1) {
    bytes[index] = escaped.charCodeAt(index)
  }
  return bytes
}

// 将 UTF-8 字节数组解码为字符串
const decodeUtf8 = (bytes: Uint8Array): string => {
  if (textDecoder) {
    return textDecoder.decode(bytes)
  }
  let ascii = ''
  bytes.forEach((byte) => {
    ascii += String.fromCharCode(byte)
  })
  return decodeURIComponent(escape(ascii))
}

// 将字节数组转换为 Base64 字符串（兼容多环境）
const toBase64 = (data: Uint8Array): string => {
  if (typeof btoa === 'function') {
    let binary = ''
    data.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })
    return btoa(binary)
  }

  const bufferCtor =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof globalThis !== 'undefined' ? (globalThis as { Buffer?: any }).Buffer : undefined
  if (bufferCtor) {
    return bufferCtor.from(data).toString('base64')
  }

  throw new Error('Base64 encoding is not supported in this environment')
}

// 将 Base64 字符串还原为字节数组
const fromBase64 = (value: string): Uint8Array => {
  if (typeof atob === 'function') {
    const binary = atob(value)
    const out = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index)
    }
    return out
  }

  const bufferCtor =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof globalThis !== 'undefined' ? (globalThis as { Buffer?: any }).Buffer : undefined
  if (bufferCtor) {
    const buffer = bufferCtor.from(value, 'base64')
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
  }

  throw new Error('Base64 decoding is not supported in this environment')
}

// 基于 房间号 + 固定 salt 派生 AES-GCM 256 位密钥
const deriveAesKey = async (roomId: string): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encodeUtf8(roomId) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encodeUtf8(`${APP_SALT}:${roomId}`) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// 用 AES-GCM 加密文本，返回 前缀 + base64(iv ‖ 密文)
const encryptContent = async (key: CryptoKey, content: string): Promise<string> => {
  if (content.length === 0) return content
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encodeUtf8(content) as BufferSource,
  )
  const cipherBytes = new Uint8Array(cipher)
  const combined = new Uint8Array(iv.length + cipherBytes.length)
  combined.set(iv, 0)
  combined.set(cipherBytes, iv.length)
  return `${ENCRYPTION_PREFIX}${toBase64(combined)}`
}

// 解密 AES-GCM 内容，失败时给出提示文本
const decryptContent = async (key: CryptoKey, payload: string): Promise<string> => {
  if (!payload.startsWith(ENCRYPTION_PREFIX)) return payload
  try {
    const combined = fromBase64(payload.slice(ENCRYPTION_PREFIX.length))
    const iv = combined.slice(0, AES_IV_LENGTH)
    const cipher = combined.slice(AES_IV_LENGTH)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    )
    return decodeUtf8(new Uint8Array(plain))
  } catch (error) {
    console.warn('解密消息失败', error)
    return '[消息解密失败]'
  }
}

// 消息类型分为普通聊天、系统通知与图片
type MessageType = 'chat' | 'system' | 'image'

// 聊天消息的存储结构
export interface RoomMessage {
  id: string
  type: MessageType
  userId: string
  username: string
  content: string
  timestamp: number
  encrypted?: boolean
  fileName?: string
  size?: number
  width?: number
  height?: number
}

// 聊天室参与者信息
export interface RoomParticipant {
  userId: string
  username: string
  joinedAt: number
}

// 网络层用的 presence 结构
interface Presence {
  userId: string
  username: string
  joinedAt: number
}

// 单个房间的运行时会话信息
interface RoomSession {
  roomId: string
  ws: WebSocket | null
  cryptoKey: CryptoKey | null
  messages: RoomMessage[]
  participants: RoomParticipant[]
  hasAnnouncedJoin: boolean
  localJoinedAt: number
  localUser: Presence
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  pingTimer: ReturnType<typeof setInterval> | null
  closedByUser: boolean
  cleanup: () => void
}

// 将房间 ID 规整为大写，避免重复
const normalizeRoomId = (roomId: string) => roomId.trim().toUpperCase()

// 生成随机房间 ID，优先使用浏览器原生 UUID
const generateRoomId = () => {
  if (
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID().slice(0, 6).replace(/-/g, '').toUpperCase()
  }

  return Math.random().toString(36).slice(-6).toUpperCase()
}

// 为每条消息生成唯一 ID
const generateMessageId = () => {
  if (
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// 从 localStorage 读取已知房间列表
const readKnownRooms = (): string[] => {
  if (typeof window === 'undefined') return []
  const cache = window.localStorage.getItem(KNOWN_ROOMS_KEY)
  if (!cache) return []

  try {
    const parsed = JSON.parse(cache)
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string').map(normalizeRoomId)
    }

    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed).map(normalizeRoomId)
    }
  } catch (error) {
    console.warn('解析房间列表失败', error)
  }

  return []
}

// 将房间列表同步至 localStorage
const persistKnownRooms = (rooms: string[]) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KNOWN_ROOMS_KEY, JSON.stringify(Array.from(new Set(rooms))))
}

// 校验并规整一条消息的字段（不含解密，解密在外层异步完成后传入 decryptedContent）
const sanitizeMessage = (payload: unknown, decryptedContent: string): RoomMessage | null => {
  if (!payload || typeof payload !== 'object') return null
  const message = payload as Partial<RoomMessage>

  const type: MessageType =
    message.type === 'system' ? 'system' : message.type === 'image' ? 'image' : 'chat'
  const normalizedContent = decryptedContent.trim()
  if (type === 'chat' && normalizedContent.length === 0) return null

  return {
    id:
      typeof message.id === 'string' && message.id.trim().length > 0
        ? message.id
        : generateMessageId(),
    type,
    userId: typeof message.userId === 'string' ? message.userId : 'system',
    username:
      typeof message.username === 'string' && message.username.trim().length > 0
        ? message.username
        : DEFAULT_USERNAME,
    content: normalizedContent,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    encrypted: message.encrypted === true,
    fileName: typeof message.fileName === 'string' ? message.fileName : undefined,
    size: typeof message.size === 'number' ? message.size : undefined,
    width: typeof message.width === 'number' ? message.width : undefined,
    height: typeof message.height === 'number' ? message.height : undefined,
  }
}

// 将服务器下发的 presence 转换为参与者信息
const buildParticipant = (payload: unknown): RoomParticipant | null => {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Record<string, unknown>
  const id = typeof candidate.userId === 'string' ? candidate.userId : null
  if (!id) return null
  const name =
    typeof candidate.username === 'string' && candidate.username.trim().length > 0
      ? candidate.username.trim()
      : DEFAULT_USERNAME
  const joinedAt = typeof candidate.joinedAt === 'number' ? candidate.joinedAt : Date.now()
  return { userId: id, username: name, joinedAt }
}

// Pinia 仓库：负责管理房间会话、消息与参与者状态
export const useRoomStore = defineStore('room', {
  state: () => ({
    // 已知房间 ID 列表（存本地）
    knownRooms: [] as string[],
    // 房间 ID 对应的实时会话
    sessions: {} as Record<string, RoomSession>,
    // 避免重复初始化的标记
    initialized: false,
  }),
  getters: {
    // 返回指定房间的消息（若未连接则为空数组）
    getMessages: (state) => (roomId: string) => {
      const normalizedId = normalizeRoomId(roomId)
      return state.sessions[normalizedId]?.messages ?? []
    },
    // 返回指定房间当前感知到的参与者列表
    getParticipants: (state) => (roomId: string) => {
      const normalizedId = normalizeRoomId(roomId)
      return state.sessions[normalizedId]?.participants ?? []
    },
  },
  actions: {
    // 确保本地房间列表只初始化一次
    ensureLoaded() {
      if (this.initialized) return
      this.knownRooms = readKnownRooms()
      this.initialized = true
    },
    // 创建并记住一个新的房间 ID
    createRoom() {
      this.ensureLoaded()
      let roomId = generateRoomId()

      while (this.knownRooms.includes(roomId)) {
        roomId = generateRoomId()
      }

      this.knownRooms.push(roomId)
      persistKnownRooms(this.knownRooms)
      return roomId
    },
    // 将房间加入已知列表，避免重复提示
    markRoomKnown(roomId: string) {
      this.ensureLoaded()
      const normalizedId = normalizeRoomId(roomId)
      if (!this.knownRooms.includes(normalizedId)) {
        this.knownRooms.push(normalizedId)
        persistKnownRooms(this.knownRooms)
      }
    },
    // 检查本地是否已记录某个房间
    hasRoom(roomId: string) {
      this.ensureLoaded()
      const normalizedId = normalizeRoomId(roomId)
      return this.knownRooms.includes(normalizedId)
    },
    // 从环境变量构建 WebSocket 中转地址
    getRelayEndpoint(roomId: string): string | null {
      const endpoint = import.meta.env.VITE_SIGNALING_ENDPOINT
      if (!endpoint) return null
      return `${endpoint}?room=${roomId}`
    },
    // 连接房间，必要时创建新的会话
    async connect(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      this.markRoomKnown(normalizedId)

      let session = this.sessions[normalizedId]
      if (!session) {
        session = await this.initializeSession(normalizedId, user)
        this.sessions[normalizedId] = session
      } else {
        this.updateLocalUsername(normalizedId, user)
      }

      if (!session.hasAnnouncedJoin) {
        this.recordSystemMessage(
          normalizedId,
          `欢迎「${user.username.trim() || DEFAULT_USERNAME}」加入`,
        )
        session.hasAnnouncedJoin = true
      }

      return session
    },
    // 离开房间时移除会话并发送系统消息
    disconnect(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      if (session.hasAnnouncedJoin) {
        this.recordSystemMessage(
          normalizedId,
          `「${user.username.trim() || DEFAULT_USERNAME}」已离开`,
        )
        session.hasAnnouncedJoin = false
      }

      session.cleanup()
      delete this.sessions[normalizedId]
    },
    // 向会话的 WebSocket 发送一条 JSON 消息（连接未就绪则忽略）
    sendToServer(session: RoomSession, message: Record<string, unknown>) {
      const ws = session.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify(message))
      } catch (error) {
        console.warn('发送消息失败', error)
      }
    },
    // 将一条消息追加到本地列表（按 id 去重并保持时间排序）
    appendMessage(roomId: string, message: RoomMessage) {
      const session = this.sessions[roomId]
      if (!session) return
      if (session.messages.some((item) => item.id === message.id)) return
      const next = [...session.messages, message].sort((a, b) => a.timestamp - b.timestamp)
      session.messages = next
    },
    // 推送聊天消息到房间（本地乐观显示 + 转发给其他人）
    sendMessage(roomId: string, payload: { userId: string; username: string; content: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session || !session.cryptoKey) return

      const trimmedContent = payload.content.trim()
      if (!trimmedContent) return

      const username =
        payload.username.trim().length > 0 ? payload.username.trim() : DEFAULT_USERNAME
      const id = generateMessageId()
      const timestamp = Date.now()

      // 本地立即显示明文
      this.appendMessage(normalizedId, {
        id,
        type: 'chat',
        userId: payload.userId,
        username,
        content: trimmedContent,
        timestamp,
        encrypted: true,
      })

      // 加密后转发给其他人
      void encryptContent(session.cryptoKey, trimmedContent).then((cipher) => {
        this.sendToServer(session, {
          type: 'chat',
          roomId: normalizedId,
          payload: {
            id,
            type: 'chat',
            userId: payload.userId,
            username,
            content: cipher,
            timestamp,
            encrypted: true,
          },
        })
      })
    },
    sendImage(
      roomId: string,
      payload: {
        userId: string
        username: string
        dataUrl: string
        fileName?: string
        size?: number
      },
    ) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      const trimmedDataUrl = payload.dataUrl.trim()
      if (!trimmedDataUrl) return

      // 图片本身已是 base64 Data URL，再走 AES-GCM 加密会膨胀且无明显收益，
      // 因此图片消息以原 Data URL 同步，不加密。
      if (trimmedDataUrl.length > IMAGE_SAFE_LIMIT) {
        console.warn('图片超过单条消息安全上限，丢弃发送', trimmedDataUrl.length)
        return
      }

      const username =
        payload.username.trim().length > 0 ? payload.username.trim() : DEFAULT_USERNAME
      const message: RoomMessage = {
        id: generateMessageId(),
        type: 'image',
        userId: payload.userId,
        username,
        content: trimmedDataUrl,
        timestamp: Date.now(),
        encrypted: false,
        fileName: payload.fileName,
        size: payload.size,
      }

      // 本地立即显示
      this.appendMessage(normalizedId, message)
      // 转发给其他人
      this.sendToServer(session, { type: 'chat', roomId: normalizedId, payload: message })
    },
    // 切换本地昵称并广播
    updateLocalUsername(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      const username = user.username.trim().length > 0 ? user.username.trim() : DEFAULT_USERNAME
      session.localUser = {
        userId: user.id,
        username,
        joinedAt: session.localJoinedAt,
      }
      this.sendToServer(session, {
        type: 'presence',
        roomId: normalizedId,
        presence: session.localUser,
      })
    },
    // 记录系统消息（本地生成、本地加密、不走网络）
    recordSystemMessage(roomId: string, content: string) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      // 系统消息仅本地展示，直接以明文 append（encrypted 标记为 true 仅表示语义上属于加密体系）
      this.appendMessage(normalizedId, {
        id: generateMessageId(),
        type: 'system',
        userId: 'system',
        username: '系统',
        content,
        timestamp: Date.now(),
        encrypted: true,
      })
    },
    // 处理服务器下发的一条消息
    handleServerMessage(roomId: string, raw: unknown) {
      if (!raw || typeof raw !== 'object') return
      const message = raw as Record<string, unknown>
      const session = this.sessions[roomId]
      if (!session) return

      if (message.type === 'pong') return

      if (message.type === 'participants') {
        const list = Array.isArray(message.participants) ? message.participants : []
        const aggregated: RoomParticipant[] = []
        list.forEach((item) => {
          const participant = buildParticipant(item)
          if (participant) aggregated.push(participant)
        })
        aggregated.sort((a, b) => a.joinedAt - b.joinedAt)
        session.participants = aggregated
        return
      }

      if (message.type === 'chat') {
        const payload = message.payload
        if (!payload || typeof payload !== 'object') return
        const key = session.cryptoKey
        const rawContent =
          typeof (payload as Partial<RoomMessage>).content === 'string'
            ? (payload as Partial<RoomMessage>).content!
            : ''
        const isEncrypted = rawContent.startsWith(ENCRYPTION_PREFIX)

        const finish = (decrypted: string) => {
          const sanitized = sanitizeMessage(payload, decrypted)
          if (sanitized) this.appendMessage(roomId, sanitized)
        }

        if (isEncrypted && key) {
          void decryptContent(key, rawContent).then(finish)
        } else {
          // 图片等未加密内容直接使用
          finish(rawContent)
        }
      }
    },
    // 初始化房间会话：建立 WebSocket 连接与加密密钥
    async initializeSession(roomId: string, user: { id: string; username: string }) {
      const username = user.username.trim().length > 0 ? user.username.trim() : DEFAULT_USERNAME
      const localJoinedAt = Date.now()

      // 注意：session 必须保持响应式（messages/participants 驱动 UI），
      // 不能整体 markRaw；ws/cryptoKey 等非响应式对象单独存放即可。
      const session: RoomSession = {
        roomId,
        ws: null,
        cryptoKey: null,
        messages: [],
        participants: [],
        hasAnnouncedJoin: false,
        localJoinedAt,
        localUser: { userId: user.id, username, joinedAt: localJoinedAt },
        reconnectAttempt: 0,
        reconnectTimer: null,
        pingTimer: null,
        closedByUser: false,
        cleanup: () => {},
      }

      // 派生加密密钥（一次，缓存到会话）
      try {
        session.cryptoKey = markRaw(await deriveAesKey(roomId))
      } catch (error) {
        console.warn('派生加密密钥失败', error)
      }

      const endpoint = this.getRelayEndpoint(roomId)

      const sendJoin = () => {
        this.sendToServer(session, {
          type: 'join',
          roomId,
          presence: session.localUser,
        })
      }

      const startPing = () => {
        if (session.pingTimer) clearInterval(session.pingTimer)
        session.pingTimer = setInterval(() => {
          this.sendToServer(session, { type: 'ping' })
        }, PING_INTERVAL_MS)
      }

      const scheduleReconnect = () => {
        if (session.closedByUser) return
        if (session.reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
          console.warn(`[relay ${roomId}] 重连次数耗尽，停止重连`)
          return
        }
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** session.reconnectAttempt,
          RECONNECT_MAX_MS,
        )
        session.reconnectAttempt += 1
        session.reconnectTimer = setTimeout(connectWs, delay)
      }

      const connectWs = () => {
        if (session.closedByUser || !endpoint) return
        let ws: WebSocket
        try {
          ws = new WebSocket(endpoint)
        } catch (error) {
          console.warn(`[relay ${roomId}] 建立连接失败`, error)
          scheduleReconnect()
          return
        }
        session.ws = markRaw(ws)

        ws.onopen = () => {
          console.log(`[relay ${roomId}] connected`)
          session.reconnectAttempt = 0
          sendJoin()
          startPing()
        }

        ws.onmessage = (event) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(typeof event.data === 'string' ? event.data : '')
          } catch {
            return
          }
          this.handleServerMessage(roomId, parsed)
        }

        ws.onclose = () => {
          if (session.pingTimer) {
            clearInterval(session.pingTimer)
            session.pingTimer = null
          }
          if (!session.closedByUser) {
            console.log(`[relay ${roomId}] disconnected, scheduling reconnect`)
            scheduleReconnect()
          }
        }

        ws.onerror = () => {
          // onerror 后通常紧跟 onclose，由 onclose 统一处理重连
          try {
            ws.close()
          } catch {
            /* ignore */
          }
        }
      }

      session.cleanup = () => {
        session.closedByUser = true
        if (session.reconnectTimer) {
          clearTimeout(session.reconnectTimer)
          session.reconnectTimer = null
        }
        if (session.pingTimer) {
          clearInterval(session.pingTimer)
          session.pingTimer = null
        }
        const ws = session.ws
        if (ws) {
          ws.onopen = null
          ws.onmessage = null
          ws.onclose = null
          ws.onerror = null
          try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close()
            }
          } catch {
            /* ignore */
          }
          session.ws = null
        }
        session.cryptoKey = null
      }

      if (!endpoint) {
        console.warn(`[relay ${roomId}] 未配置 VITE_SIGNALING_ENDPOINT，无法连接`)
      } else {
        connectWs()
      }

      return session
    },
  },
})

// 支持 Vite 热更新，便于开发阶段调试
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot))
}
