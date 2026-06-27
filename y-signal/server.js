// 房间消息中转服务：按 room 进行广播（不落库、不持久化）
// 协议为自定义 JSON over WebSocket：
//   Client -> Server: join / chat / presence / ping
//   Server -> Client: participants / chat / pong
// 消息内容(content)在客户端已用 AES-GCM 端到端加密，服务器只透传密文。
const WebSocket = require('ws')
const http = require('http')
const url = require('url')

const wsReadyStateConnecting = WebSocket.CONNECTING
const wsReadyStateOpen = WebSocket.OPEN
const pingIntervalMs = 30000

const wss = new WebSocket.Server({ noServer: true })

// roomId -> Set<conn>
const rooms = new Map()

const sendJson = (conn, payload) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    conn.close()
    return
  }
  try {
    conn.send(JSON.stringify(payload))
  } catch (error) {
    conn.close()
  }
}

// 规整房间号，与前端保持一致（大写、去空格）
const normalizeRoomId = (roomId) =>
  typeof roomId === 'string' ? roomId.trim().toUpperCase() : ''

// 收集房间内所有参与者（按加入时间排序）
const collectParticipants = (roomId) => {
  const room = rooms.get(roomId)
  if (!room) return []
  const list = []
  room.forEach((conn) => {
    if (conn.presence && typeof conn.presence.userId === 'string') {
      list.push({
        userId: conn.presence.userId,
        username: conn.presence.username,
        joinedAt: conn.presence.joinedAt,
      })
    }
  })
  list.sort((a, b) => a.joinedAt - b.joinedAt)
  return list
}

// 向房间内所有连接广播在线成员列表
const broadcastParticipants = (roomId) => {
  const room = rooms.get(roomId)
  if (!room) return
  const participants = collectParticipants(roomId)
  const payload = JSON.stringify({ type: 'participants', roomId, participants })
  room.forEach((conn) => {
    if (conn.readyState === wsReadyStateOpen || conn.readyState === wsReadyStateConnecting) {
      try {
        conn.send(payload)
      } catch (error) {
        conn.close()
      }
    }
  })
}

// 把某个连接从其房间移除，必要时广播更新或清理空房间
const removeFromRoom = (conn) => {
  const roomId = conn.roomId
  if (!roomId) return
  const room = rooms.get(roomId)
  conn.roomId = null
  if (!room) return
  room.delete(conn)
  if (room.size === 0) {
    rooms.delete(roomId)
    console.log(`[signal] room ${roomId} emptied and removed`)
  } else {
    broadcastParticipants(roomId)
    console.log(`[signal] client left room ${roomId}, remaining=${room.size}`)
  }
}

// 处理 join：登记 presence，加入房间，广播在线列表
const handleJoin = (conn, message) => {
  const roomId = normalizeRoomId(message.roomId)
  const presence = message.presence
  if (!roomId || !presence || typeof presence.userId !== 'string') return

  // 若该连接已在别的房间，先退出
  if (conn.roomId && conn.roomId !== roomId) {
    removeFromRoom(conn)
  }

  conn.roomId = roomId
  conn.presence = {
    userId: presence.userId,
    username: typeof presence.username === 'string' ? presence.username : '',
    joinedAt: typeof presence.joinedAt === 'number' ? presence.joinedAt : Date.now(),
  }

  if (!rooms.has(roomId)) rooms.set(roomId, new Set())
  rooms.get(roomId).add(conn)

  broadcastParticipants(roomId)
  console.log(
    `[signal] ${conn.presence.username}(${conn.presence.userId}) joined room ${roomId}, total=${rooms.get(roomId).size}`,
  )
}

// 处理 chat：把密文消息转发给同房间的其他人（发送者本地已乐观显示）
const handleChat = (conn, message) => {
  const roomId = conn.roomId
  if (!roomId) return
  const room = rooms.get(roomId)
  if (!room) return
  const payload = message.payload
  if (!payload || typeof payload !== 'object') return

  const outgoing = JSON.stringify({ type: 'chat', roomId, payload })
  room.forEach((receiver) => {
    if (receiver === conn) return // 不回显给自己
    if (receiver.readyState === wsReadyStateOpen || receiver.readyState === wsReadyStateConnecting) {
      try {
        receiver.send(outgoing)
      } catch (error) {
        receiver.close()
      }
    }
  })
}

// 处理 presence 更新（如改昵称）
const handlePresence = (conn, message) => {
  const roomId = conn.roomId
  if (!roomId) return
  const presence = message.presence
  if (!presence || typeof presence.userId !== 'string') return
  conn.presence = {
    userId: presence.userId,
    username: typeof presence.username === 'string' ? presence.username : '',
    joinedAt:
      typeof presence.joinedAt === 'number'
        ? presence.joinedAt
        : conn.presence
          ? conn.presence.joinedAt
          : Date.now(),
  }
  broadcastParticipants(roomId)
}

wss.on('connection', (conn) => {
  conn.roomId = null
  conn.presence = null

  let closed = false
  let pongReceived = true

  const pingTimer = setInterval(() => {
    if (!pongReceived) {
      conn.close()
      clearInterval(pingTimer)
      return
    }
    pongReceived = false
    try {
      conn.ping()
    } catch (error) {
      conn.close()
    }
  }, pingIntervalMs)

  conn.on('pong', () => {
    pongReceived = true
  })

  conn.on('close', () => {
    clearInterval(pingTimer)
    removeFromRoom(conn)
    closed = true
  })

  conn.on('message', (raw) => {
    if (closed) return
    let message
    try {
      const text = typeof raw === 'string' ? raw : raw.toString()
      if (text.length === 0) return
      message = JSON.parse(text)
    } catch (error) {
      return
    }

    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'ping':
        sendJson(conn, { type: 'pong' })
        return
      case 'join':
        handleJoin(conn, message)
        return
      case 'chat':
        handleChat(conn, message)
        return
      case 'presence':
        handlePresence(conn, message)
        return
      case 'leave':
        removeFromRoom(conn)
        return
      default:
        return
    }
  })
})

// 健康检查 + WebSocket 升级（仅 /signal 路径）
const srv = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
  }
  res.writeHead(404)
  res.end()
})

srv.on('upgrade', (request, socket, head) => {
  if (request.url && request.url.startsWith('/signal')) {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  } else {
    socket.destroy()
  }
})

const PORT = process.env.PORT || 23333
srv.listen(PORT, () =>
  console.log(`Room relay server ready on port ${PORT} (proxy /signal to this service)`),
)
