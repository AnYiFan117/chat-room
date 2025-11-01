// 处理聊天室状态与同步逻辑的 Pinia 仓库
import { acceptHMRUpdate, defineStore } from 'pinia'
import { markRaw } from 'vue'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

// 本地存储曾加入房间 ID 列表的键值
const KNOWN_ROOMS_KEY = 'play-chat-room-ids'
// 默认访客昵称
const DEFAULT_USERNAME = '匿名旅人'

// 用于简单异或加密的固定种子
const SECRET_SEED = 'play-chat-secret-seed'
// 加密消息的前缀标记
const ENCRYPTION_PREFIX = 'enc::v1::'

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

  const bufferCtor = typeof globalThis !== 'undefined' ? (globalThis as { Buffer?: any }).Buffer : undefined
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

  const bufferCtor = typeof globalThis !== 'undefined' ? (globalThis as { Buffer?: any }).Buffer : undefined
  if (bufferCtor) {
    const buffer = bufferCtor.from(value, 'base64')
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
  }

  throw new Error('Base64 decoding is not supported in this environment')
}

// 基于房间 ID 构造伪随机字节流，用于 XOR 加密
const createKeyStream = (roomId: string) => {
  const base = `${SECRET_SEED}:${roomId}`
  let state = 0x6d2b79f5
  for (let index = 0; index < base.length; index += 1) {
    state = (state + base.charCodeAt(index)) >>> 0
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d)) >>> 0
  }

  if (state === 0) {
    state = 0x6d2b79f5
  }

  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state >>>= 0
    state ^= state << 5
    state >>>= 0
    return state & 0xff
  }
}

// 将明文与伪随机流 XOR，得到密文字节
const xorBytes = (roomId: string, source: Uint8Array): Uint8Array => {
  const nextByte = createKeyStream(roomId)
  const result = new Uint8Array(source.length)
  source.forEach((value, index) => {
    result[index] = value ^ nextByte()
  })
  return result
}

// 对聊天内容进行加密并附加标记
const encryptContent = (roomId: string, content: string): string => {
  if (content.length === 0) return content
  const encoded = encodeUtf8(content)
  const transformed = xorBytes(roomId, encoded)
  return `${ENCRYPTION_PREFIX}${toBase64(transformed)}`
}

// 解密聊天内容，失败时给出提示文本
const decryptContent = (roomId: string, payload: string): string => {
  if (!payload.startsWith(ENCRYPTION_PREFIX)) return payload
  try {
    const raw = payload.slice(ENCRYPTION_PREFIX.length)
    const bytes = fromBase64(raw)
    const decoded = xorBytes(roomId, bytes)
    return decodeUtf8(decoded)
  } catch (error) {
    console.warn('解密消息失败', error)
    return '[消息解密失败]'
  }
}

// 消息类型分为普通聊天与系统通知
type MessageType = 'chat' | 'system'

// 聊天消息的存储结构
export interface RoomMessage {
  id: string
  type: MessageType
  userId: string
  username: string
  content: string
  timestamp: number
  encrypted?: boolean
}

// 聊天室参与者信息
export interface RoomParticipant {
  userId: string
  username: string
  joinedAt: number
}

// 单个房间的运行时会话信息
interface RoomSession {
  roomId: string
  doc: Y.Doc
  provider: WebrtcProvider
  yMessages: Y.Array<RoomMessage>
  messages: RoomMessage[]
  participants: RoomParticipant[]
  hasAnnouncedJoin: boolean
  localJoinedAt: number
  cleanup: () => void
}

// 将房间 ID 规整为大写，避免重复
const normalizeRoomId = (roomId: string) => roomId.trim().toUpperCase()

// 生成随机房间 ID，优先使用浏览器原生 UUID
const generateRoomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 6).replace(/-/g, '').toUpperCase()
  }

  return Math.random().toString(36).slice(-6).toUpperCase()
}

// 为每条消息生成唯一 ID
const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
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

// 清洗并解密消息，过滤掉空消息
const sanitizeMessage = (payload: unknown, roomId: string): RoomMessage | null => {
  if (!payload || typeof payload !== 'object') return null
  const message = payload as Partial<RoomMessage>

  const type: MessageType = message.type === 'system' ? 'system' : 'chat'
  const rawContent = typeof message.content === 'string' ? message.content : ''
  const decryptedContent = decryptContent(roomId, rawContent)
  const normalizedContent = decryptedContent.trim()
  if (type === 'chat' && normalizedContent.length === 0) return null
  const wasEncrypted = rawContent.startsWith(ENCRYPTION_PREFIX) || message.encrypted === true

  return {
    id: typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : generateMessageId(),
    type,
    userId: typeof message.userId === 'string' ? message.userId : 'system',
    username: typeof message.username === 'string' && message.username.trim().length > 0 ? message.username : DEFAULT_USERNAME,
    content: normalizedContent,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    encrypted: wasEncrypted,
  }
}

// 将 awareness 中的原始状态转换为参与者信息
const buildParticipant = (payload: unknown): RoomParticipant | null => {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as Record<string, unknown>
  if (!('user' in candidate)) return null

  const user = (candidate as { user?: Record<string, unknown> }).user
  if (!user || typeof user !== 'object') return null

  const id = typeof user.id === 'string' ? user.id : null
  if (!id) return null

  const name = typeof user.name === 'string' && user.name.trim().length > 0 ? user.name.trim() : DEFAULT_USERNAME
  const joinedAt = typeof user.joinedAt === 'number' ? user.joinedAt : Date.now()

  return {
    userId: id,
    username: name,
    joinedAt,
  }
}

// 更新本地 awareness，广播自身信息给其他 peer
const setLocalAwareness = (
  provider: WebrtcProvider,
  user: { id: string; username: string },
  joinedAt: number
) => {
  const trimmedName = user.username.trim().length > 0 ? user.username.trim() : DEFAULT_USERNAME
  provider.awareness.setLocalStateField('user', {
    id: user.id,
    name: trimmedName,
    joinedAt,
  })
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
    // 连接房间，必要时创建新的会话
    connect(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      this.markRoomKnown(normalizedId)

      let session = this.sessions[normalizedId]
      if (!session) {
        session = this.initializeSession(normalizedId, user)
        this.sessions[normalizedId] = session
      } else {
        setLocalAwareness(session.provider, user, session.localJoinedAt)
      }

      if (!session.hasAnnouncedJoin) {
        this.recordSystemMessage(normalizedId, `欢迎「${user.username.trim() || DEFAULT_USERNAME}」加入`)
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
        this.recordSystemMessage(normalizedId, `「${user.username.trim() || DEFAULT_USERNAME}」已离开`)
        session.hasAnnouncedJoin = false
      }

      session.cleanup()
      delete this.sessions[normalizedId]
    },
    // 推送聊天消息到房间
    sendMessage(roomId: string, payload: { userId: string; username: string; content: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      const trimmedContent = payload.content.trim()
      if (!trimmedContent) return

      session.yMessages.push([
        {
          id: generateMessageId(),
          type: 'chat',
          userId: payload.userId,
          username: payload.username.trim().length > 0 ? payload.username.trim() : DEFAULT_USERNAME,
          content: encryptContent(normalizedId, trimmedContent),
          timestamp: Date.now(),
          encrypted: true,
        },
      ])
    },
    // 切换本地昵称并广播
    updateLocalUsername(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      setLocalAwareness(session.provider, user, session.localJoinedAt)
    },
    // 记录系统消息，例如用户进出提示
    recordSystemMessage(roomId: string, content: string) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      session.yMessages.push([
        {
          id: generateMessageId(),
          type: 'system',
          userId: 'system',
          username: '系统',
          content: encryptContent(normalizedId, content),
          timestamp: Date.now(),
          encrypted: true,
        },
      ])
    },
    // 从环境变量解析 ICE 服务器配置
    getIceServers(): RTCIceServer[] {
      const envValue = import.meta.env.VITE_ICE_SERVERS
      if (envValue) {
        try {
          // 预期格式：JSON 数组字符串
          const parsed = JSON.parse(envValue)
          if (Array.isArray(parsed)) {
            return parsed.filter((item): item is RTCIceServer => 
              item && typeof item === 'object' && 'urls' in item
            )
          }
        } catch (error) {
          console.warn('解析 VITE_ICE_SERVERS 失败', error)
        }
      }
      return []
    },
    // 从环境变量构建 signaling 端点
    getSignalingEndpoints(roomId: string): string[] {
      const endpoint = import.meta.env.VITE_SIGNALING_ENDPOINT

      if (endpoint) {
        // 单个端点，自动添加房间参数
        return [`${endpoint}?room=${roomId}`]
      }
      return []
    },
    // 初始化房间会话：构造 Yjs 文档与 WebRTC 连接
    initializeSession(roomId: string, user: { id: string; username: string }) {
      // 每个房间维护独立的 Yjs 文档
      const doc = markRaw(new Y.Doc())
      
      // 从环境变量读取 ICE 服务器配置
      const iceServers = this.getIceServers()
      
      // 从环境变量读取 signaling 端点
      const signaling = this.getSignalingEndpoints(roomId)

      // 创建 WebRTC 提供者，用于同步 Yjs 文档
      const provider = markRaw(
        new WebrtcProvider(roomId, doc, {
          signaling,
          peerOpts: {
            trickle: true,
            config: {
              iceTransportPolicy: 'relay',
              iceServers
            }
          }
        })
      )

      // 共享的消息数组
      const yMessages = markRaw(doc.getArray<RoomMessage>('messages'))
      // 存储引用，用于回调中访问
      const store = this

      const session: RoomSession = {
        roomId,
        doc,
        provider,
        yMessages,
        messages: [],
        participants: [],
        hasAnnouncedJoin: false,
        localJoinedAt: Date.now(),
        cleanup: () => {
          /* 会在下方替换为真正的清理逻辑 */
        },
      }


      // 将远端消息同步到 store，并保证按时间排序
      const updateMessages = () => {
        const incoming = yMessages
          .toArray()
          .map((item) => sanitizeMessage(item, roomId))
          .filter((item): item is RoomMessage => item !== null)
          .sort((a, b) => a.timestamp - b.timestamp)

        const currentSession = store.sessions[roomId]
        if (currentSession) {
          currentSession.messages = incoming
        } else {
          session.messages = incoming
        }
      }

      updateMessages()
      // 监听 Yjs 数组变化，实时更新消息列表
      yMessages.observe(updateMessages)

      const awareness = provider.awareness

      // 根据 awareness 列表更新参与者信息
      const updateParticipants = () => {
        const aggregated: RoomParticipant[] = []
        awareness.getStates().forEach((state) => {
          const participant = buildParticipant(state)
          if (participant) {
            aggregated.push(participant)
          }
        })

        aggregated.sort((a, b) => a.joinedAt - b.joinedAt)
        const currentSession = store.sessions[roomId]
        if (currentSession) {
          currentSession.participants = aggregated
        } else {
          session.participants = aggregated
        }
      }

      awareness.on('change', updateParticipants)
      // 首次连接时广播自身状态
      setLocalAwareness(provider, user, session.localJoinedAt)
      updateParticipants()

      session.cleanup = () => {
        // 解绑监听，防止内存泄露
        yMessages.unobserve(updateMessages)
        awareness.off('change', updateParticipants)
        provider.destroy()
        doc.destroy()
      }

      return session
    },
  },
})

// 支持 Vite 热更新，便于开发阶段调试
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot))
}
