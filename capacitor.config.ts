import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.anyifan.chatroom',
  appName: '聊天室',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
}

export default config
