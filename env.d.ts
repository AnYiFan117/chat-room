/// <reference types="vite/client" />

interface ImportMetaEnv {
  // WebSocket 消息中转端点（代码自动追加 ?room=ROOM_ID）
  readonly VITE_SIGNALING_ENDPOINT?: string
  // @deprecated 旧 WebRTC 架构的 ICE 服务器配置，WebSocket 中转架构已不再使用
  readonly VITE_ICE_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
