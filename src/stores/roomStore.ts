import { acceptHMRUpdate, defineStore } from 'pinia'
import { markRaw } from 'vue'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

const KNOWN_ROOMS_KEY = 'play-chat-room-ids'
const DEFAULT_USERNAME = '匿名旅人'

const FALLBACK_SIGNALING_ENDPOINT = 'ws://8.152.98.245:23333/signal?room=<id>'

const debugLog = (...args: unknown[]) => {
  if (typeof console === 'undefined') return
  const prefix = '[RoomStore]'
  if ((import.meta.env?.MODE ?? import.meta.env?.NODE_ENV) === 'development') {
    console.info(prefix, ...args)
    return
  }
  if (typeof console.debug === 'function') {
    console.debug(prefix, ...args)
    return
  }
  console.info(prefix, ...args)
}

const resolveEnvSignalingEndpoints = (): string[] => {
  const raw =
    import.meta.env.VITE_SIGNALING_ENDPOINTS ?? import.meta.env.VITE_SIGNALING_ENDPOINT ?? ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

const resolveBrowserSignalingEndpoint = (): string | null => {
  if (typeof window === 'undefined' || !window.location) {
    return null
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  if (window.location.host.includes(':')) {
    return `${protocol}://${window.location.host}/signal?room=<id>`
  }

  const fallbackPort = (import.meta.env.VITE_SIGNALING_PORT ?? '').trim()
  if (fallbackPort.length > 0) {
    return `${protocol}://${window.location.hostname}:${fallbackPort}/signal?room=<id>`
  }

  return `${protocol}://${window.location.host}/signal?room=<id>`
}

const SIGNALING_ENDPOINTS = Array.from(
  new Set(
    [
      ...resolveEnvSignalingEndpoints(),
      resolveBrowserSignalingEndpoint(),
      FALLBACK_SIGNALING_ENDPOINT,
    ].filter((item): item is string => typeof item === 'string' && item.length > 0)
  )
)

const SECRET_SEED = 'play-chat-secret-seed'
const ENCRYPTION_PREFIX = 'enc::v1::'

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

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

const xorBytes = (roomId: string, source: Uint8Array): Uint8Array => {
  const nextByte = createKeyStream(roomId)
  const result = new Uint8Array(source.length)
  source.forEach((value, index) => {
    result[index] = value ^ nextByte()
  })
  return result
}

const encryptContent = (roomId: string, content: string): string => {
  if (content.length === 0) return content
  const encoded = encodeUtf8(content)
  const transformed = xorBytes(roomId, encoded)
  return `${ENCRYPTION_PREFIX}${toBase64(transformed)}`
}

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

type MessageType = 'chat' | 'system'

export interface RoomMessage {
  id: string
  type: MessageType
  userId: string
  username: string
  content: string
  timestamp: number
  encrypted?: boolean
}

export interface RoomParticipant {
  userId: string
  username: string
  joinedAt: number
}

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

const normalizeRoomId = (roomId: string) => roomId.trim().toUpperCase()

const resolveSignalingUrls = (roomId: string) =>
  SIGNALING_ENDPOINTS.map((endpoint) => {
    if (endpoint.includes('<id>')) {
      return endpoint.replace('<id>', encodeURIComponent(roomId))
    }
    return endpoint
  })

const generateRoomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 6).replace(/-/g, '').toUpperCase()
  }

  return Math.random().toString(36).slice(-6).toUpperCase()
}

const generateMessageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

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

const persistKnownRooms = (rooms: string[]) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KNOWN_ROOMS_KEY, JSON.stringify(Array.from(new Set(rooms))))
}

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

export const useRoomStore = defineStore('room', {
  state: () => ({
    knownRooms: [] as string[],
    sessions: {} as Record<string, RoomSession>,
    initialized: false,
  }),
  getters: {
    getMessages: (state) => (roomId: string) => {
      const normalizedId = normalizeRoomId(roomId)
      return state.sessions[normalizedId]?.messages ?? []
    },
    getParticipants: (state) => (roomId: string) => {
      const normalizedId = normalizeRoomId(roomId)
      return state.sessions[normalizedId]?.participants ?? []
    },
  },
  actions: {
    ensureLoaded() {
      if (this.initialized) return
      this.knownRooms = readKnownRooms()
      this.initialized = true
    },
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
    markRoomKnown(roomId: string) {
      this.ensureLoaded()
      const normalizedId = normalizeRoomId(roomId)
      if (!this.knownRooms.includes(normalizedId)) {
        this.knownRooms.push(normalizedId)
        persistKnownRooms(this.knownRooms)
      }
    },
    hasRoom(roomId: string) {
      this.ensureLoaded()
      const normalizedId = normalizeRoomId(roomId)
      return this.knownRooms.includes(normalizedId)
    },
    connect(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      this.markRoomKnown(normalizedId)

      let session = this.sessions[normalizedId]
      if (!session) {
        debugLog('正在为房间建立新会话', { roomId: normalizedId, user })
        session = this.initializeSession(normalizedId, user)
        this.sessions[normalizedId] = session
      } else {
        debugLog('复用现有会话并更新本地 awareness', { roomId: normalizedId, user })
        setLocalAwareness(session.provider, user, session.localJoinedAt)
      }

      if (!session.hasAnnouncedJoin) {
        this.recordSystemMessage(normalizedId, `欢迎「${user.username.trim() || DEFAULT_USERNAME}」加入`)
        session.hasAnnouncedJoin = true
      }

      return session
    },
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
    sendMessage(roomId: string, payload: { userId: string; username: string; content: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return
      console.log('[Yjs] 发送消息前的状态:', {
        connected: session.provider.connected,
        roomSynced: session.provider.room?.synced,
        webrtcConns: session.provider.room?.webrtcConns.size ?? 0
    })

      const trimmedContent = payload.content.trim()
      if (!trimmedContent) return

      debugLog('发送消息并写入 Yjs 文档', {
        roomId: normalizedId,
        userId: payload.userId,
        previousDocLength: session.yMessages.length,
      })

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
      debugLog('消息写入完成', {
        roomId: normalizedId,
        newDocLength: session.yMessages.length,
      })
    },
    updateLocalUsername(roomId: string, user: { id: string; username: string }) {
      const normalizedId = normalizeRoomId(roomId)
      const session = this.sessions[normalizedId]
      if (!session) return

      debugLog('更新本地 awareness 用户信息', { roomId: normalizedId, user })
      setLocalAwareness(session.provider, user, session.localJoinedAt)
    },
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
      debugLog('记录系统消息', { roomId: normalizedId, content })
    },
    initializeSession(roomId: string, user: { id: string; username: string }) {
      const doc = markRaw(new Y.Doc())
      const provider = markRaw(
        new WebrtcProvider(roomId, doc, {
            signaling: ['wss://8.152.98.245/signal?room='+roomId],
            peerOpts: {
                trickle: true,
                config:{
                    iceTransportPolicy: 'relay',
                iceServers:[
                    // {urls: 'stun:stun.l.google.com:19302'},
                    {urls: 'stun:8.152.98.245:3478', username: 'anyifan', credential: 'askayf010922'},
                    {urls: 'turn:8.152.98.245:3478?transport=tcp', username: 'anyifan', credential: 'askayf010922'},
                    {urls: 'turn:8.152.98.245:3478?transport=udp', username: 'anyifan', credential: 'askayf010922'}

                ]
                }
            }
        })
      )

      const yMessages = markRaw(doc.getArray<RoomMessage>('messages'))
      const store = this

      debugLog('会话初始化完成，绑定 Yjs 资源', {
        roomId,
        currentMessageCount: yMessages.length,
      })

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
          /* replaced later */
        },
      }

      // 详细诊断函数
  const diagnoseConnection = () => {
    const room = provider.room
    if (!room) {
      console.log('[Yjs] 诊断: room 尚未初始化')
      return
    }

    const webrtcConns = room.webrtcConns
    console.log('[Yjs] 完整连接诊断:', {
      roomId,
      roomSynced: room.synced,
      connected: provider.connected,
      webrtcConnsCount: webrtcConns.size,
      bcConnsCount: room.bcConns.size,
      connections: Array.from(webrtcConns.entries()).map(([peerId, conn]) => {
        const peer = conn.peer as RTCPeerConnection
        const dataChannels: string[] = []
        
        // 检查所有数据通道
        if (peer && 'getReceivers' in peer) {
          // 尝试获取数据通道状态
          try {
            // @ts-ignore - 访问内部属性
            const channels = peer._dataChannels || []
            channels.forEach((channel: RTCDataChannel) => {
              dataChannels.push({
                label: channel.label,
                readyState: channel.readyState, // 'connecting' | 'open' | 'closing' | 'closed'
                id: channel.id
              } as any)
            })
          } catch (e) {
            // 忽略访问错误
          }
        }

        return {
          peerId: peerId.substring(0, 12) + '...',
          connected: conn.connected,
          synced: conn.synced,
          closed: conn.closed,
          peerConnectionState: peer?.connectionState,
          peerIceConnectionState: peer?.iceConnectionState,
          peerSignalingState: peer?.signalingState,
          dataChannels: dataChannels.length > 0 ? dataChannels : '无法访问',
          // 检查是否有打开的数据通道
          hasOpenDataChannel: dataChannels.some((ch: any) => ch.readyState === 'open')
        }
      })
    })
  }

  // 定期诊断
  const diagnosisInterval = setInterval(() => {
    diagnoseConnection()
  }, 2000)

  // 监听对等节点变化时也诊断
  provider.on('peers', () => {
    setTimeout(diagnoseConnection, 500) // 延迟一点，等待连接建立
  })

  // 监听同步状态
  provider.on('synced', (event: { synced: boolean }) => {
    console.log('[Yjs] 同步状态变化:', event.synced)
    if (event.synced) {
      diagnoseConnection()
      clearInterval(diagnosisInterval)
    }
  })

      const updateMessages = () => {
        const incoming = yMessages
          .toArray()
          .map((item) => sanitizeMessage(item, roomId))
          .filter((item): item is RoomMessage => item !== null)
          .sort((a, b) => a.timestamp - b.timestamp)

        const currentSession = store.sessions[roomId]
        debugLog('Yjs 消息列表变更', {
          roomId,
          incomingCount: incoming.length,
          hasCurrentSession: Boolean(currentSession),
        })
        if (currentSession) {
          currentSession.messages = incoming
        } else {
          session.messages = incoming
        }
      }

      updateMessages()
      yMessages.observe(updateMessages)

      const awareness = provider.awareness

      const updateParticipants = () => {
        const aggregated: RoomParticipant[] = []
        awareness.getStates().forEach((state) => {
          debugLog('接收到 awareness 状态', { roomId, state })
          const participant = buildParticipant(state)
          if (participant) {
            aggregated.push(participant)
          }
        })

        aggregated.sort((a, b) => a.joinedAt - b.joinedAt)
        const currentSession = store.sessions[roomId]
        debugLog('Awareness 参与者更新', {
          roomId,
          participantCount: aggregated.length,
          participantIds: aggregated.map((item) => item.userId),
        })
        if (currentSession) {
          currentSession.participants = aggregated
        } else {
          session.participants = aggregated
        }
      }

      awareness.on('change', updateParticipants)
      setLocalAwareness(provider, user, session.localJoinedAt)
      updateParticipants()

      debugLog('完成会话初始化流程，已订阅 Yjs 变更', { roomId })

      session.cleanup = () => {
        debugLog('清理会话并销毁资源', { roomId })
        yMessages.unobserve(updateMessages)
        awareness.off('change', updateParticipants)
        provider.destroy()
        doc.destroy()
      }

      return session
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRoomStore, import.meta.hot))
}
