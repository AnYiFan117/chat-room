/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_ENDPOINT?: string
  readonly VITE_SIGNALING_ENDPOINTS?: string
  readonly VITE_SIGNALING_PORT?: string
  readonly VITE_ICE_SERVERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
