/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 单个 signaling 端点（自动添加 room 参数）
  readonly VITE_SIGNALING_ENDPOINT?: string
  // ICE 服务器配置（JSON 数组字符串，如 [{"urls": "stun:...", ...}]）
  readonly VITE_ICE_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
