# 聊天室图片发送功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 P2P 聊天室中增加发送图片功能：用户选择本地图片，经压缩后转为 Base64，作为加密消息通过 Yjs + WebRTC 同步给其他 peer。

**Architecture:** 新增 `useImageCompressor` 负责本地图片压缩；扩展 `roomStore` 的消息类型与 `sendImage` action，让图片消息复用现有 XOR 加密与 Yjs 同步通道；在 `RoomView` 增加图片选择、预览、发送与渲染；样式集中在 `RoomView.vue` 的 scoped CSS 中。

**Tech Stack:** Vue 3 + TypeScript + Pinia + Yjs + y-webrtc + Vite + Vitest(jsdom)

---

## File Map

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/composables/useImageCompressor.ts` | 新建 | 校验图片、Canvas 压缩、Base64 输出、大小限制 |
| `src/composables/__tests__/useImageCompressor.spec.ts` | 新建 | 压缩工具的单元测试 |
| `src/stores/roomStore.ts` | 修改 | 扩展 `MessageType` / `RoomMessage`，新增 `sendImage`，复用加密逻辑 |
| `src/views/RoomView.vue` | 修改 | 图片选择按钮、预览、发送、图片消息渲染 |

---

## Task 1: 创建图片压缩 composable

**Files:**
- Create: `src/composables/useImageCompressor.ts`
- Test: `src/composables/__tests__/useImageCompressor.spec.ts`

### Step 1: 写失败测试

创建 `src/composables/__tests__/useImageCompressor.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { compressImage, ImageTooLargeError } from '../useImageCompressor'

describe('useImageCompressor', () => {
  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toThrow('请选择图片文件')
  })
})
```

- [ ] **Step 1: Write the failing test**

Run: `npm run test:unit -- src/composables/__tests__/useImageCompressor.spec.ts`

Expected: FAIL with `compressImage is not defined` 或类似错误。

- [ ] **Step 2: Run test to verify it fails**

### Step 2: 实现最小代码

创建 `src/composables/useImageCompressor.ts`：

```ts
export class ImageTooLargeError extends Error {
  constructor(message = '图片压缩后仍超过大小限制') {
    super(message)
    this.name = 'ImageTooLargeError'
  }
}

export interface CompressImageOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxSize?: number
}

export async function compressImage(
  file: File,
  options: CompressImageOptions = {}
): Promise<string> {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.8,
    maxSize = 2 * 1024 * 1024,
  } = options

  if (!file.type.startsWith('image/')) {
    throw new TypeError('请选择图片文件')
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        let { width, height } = image
        if (width > maxWidth || height > maxHeight) {
          const scale = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('无法创建 canvas 上下文'))
          return
        }
        context.drawImage(image, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('图片压缩失败'))
              return
            }
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('读取图片失败'))
            reader.readAsDataURL(blob)
          },
          'image/jpeg',
          quality
        )
      }
      image.onerror = () => reject(new Error('加载图片失败'))
      image.src = objectUrl
    })

    const base64 = dataUrl.split(',')[1] ?? ''
    const estimatedSize = Math.round((base64.length * 3) / 4)
    if (estimatedSize > maxSize) {
      throw new ImageTooLargeError()
    }

    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
```

- [ ] **Step 3: Write minimal implementation**

### Step 3: 验证基础测试通过

Run: `npm run test:unit -- src/composables/__tests__/useImageCompressor.spec.ts`

Expected: PASS（`rejects non-image files` 通过）。

- [ ] **Step 4: Run test to verify it passes**

### Step 4: 提交

```bash
git add src/composables/useImageCompressor.ts src/composables/__tests__/useImageCompressor.spec.ts
git commit -m "feat: add image compression composable with validation test

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Commit**

---

## Task 2: 扩展 roomStore 支持图片消息

**Files:**
- Modify: `src/stores/roomStore.ts`

### Step 1: 扩展类型与辅助函数

在 `src/stores/roomStore.ts` 中：

1. 将 `MessageType` 改为：

```ts
type MessageType = 'chat' | 'system' | 'image'
```

2. 将 `RoomMessage` 接口改为：

```ts
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
```

3. 在 `generateMessageId` 之后、`readKnownRooms` 之前，新增辅助函数：

```ts
const buildEncryptedMessage = (
  roomId: string,
  partial: Omit<RoomMessage, 'id' | 'timestamp' | 'encrypted'>
): RoomMessage => ({
  id: generateMessageId(),
  ...partial,
  content: encryptContent(roomId, partial.content),
  timestamp: Date.now(),
  encrypted: true,
})
```

4. 修改 `sanitizeMessage`：

```ts
const sanitizeMessage = (payload: unknown, roomId: string): RoomMessage | null => {
  if (!payload || typeof payload !== 'object') return null
  const message = payload as Partial<RoomMessage>

  const type: MessageType =
    message.type === 'system' ? 'system' : message.type === 'image' ? 'image' : 'chat'
  const rawContent = typeof message.content === 'string' ? message.content : ''
  const decryptedContent = decryptContent(roomId, rawContent)
  const normalizedContent = decryptedContent.trim()
  if (type === 'chat' && normalizedContent.length === 0) return null
  const wasEncrypted = rawContent.startsWith(ENCRYPTION_PREFIX) || message.encrypted === true

  return {
    id: typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : generateMessageId(),
    type,
    userId: typeof message.userId === 'string' ? message.userId : 'system',
    username:
      typeof message.username === 'string' && message.username.trim().length > 0
        ? message.username
        : DEFAULT_USERNAME,
    content: normalizedContent,
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    encrypted: wasEncrypted,
    fileName: typeof message.fileName === 'string' ? message.fileName : undefined,
    size: typeof message.size === 'number' ? message.size : undefined,
    width: typeof message.width === 'number' ? message.width : undefined,
    height: typeof message.height === 'number' ? message.height : undefined,
  }
}
```

- [ ] **Step 1: Update types and sanitizer**

### Step 2: 重构 sendMessage 并新增 sendImage

在 actions 中，把 `sendMessage` 替换为：

```ts
sendMessage(roomId: string, payload: { userId: string; username: string; content: string }) {
  const normalizedId = normalizeRoomId(roomId)
  const session = this.sessions[normalizedId]
  if (!session) return

  const trimmedContent = payload.content.trim()
  if (!trimmedContent) return

  session.yMessages.push([
    buildEncryptedMessage(normalizedId, {
      type: 'chat',
      userId: payload.userId,
      username: payload.username.trim().length > 0 ? payload.username.trim() : DEFAULT_USERNAME,
      content: trimmedContent,
    }),
  ])
},
```

并在其后新增：

```ts
sendImage(
  roomId: string,
  payload: { userId: string; username: string; dataUrl: string; fileName?: string; size?: number }
) {
  const normalizedId = normalizeRoomId(roomId)
  const session = this.sessions[normalizedId]
  if (!session) return

  const trimmedDataUrl = payload.dataUrl.trim()
  if (!trimmedDataUrl) return

  session.yMessages.push([
    buildEncryptedMessage(normalizedId, {
      type: 'image',
      userId: payload.userId,
      username: payload.username.trim().length > 0 ? payload.username.trim() : DEFAULT_USERNAME,
      content: trimmedDataUrl,
      fileName: payload.fileName,
      size: payload.size,
    }),
  ])
},
```

- [ ] **Step 2: Add sendImage and refactor sendMessage**

### Step 3: 类型检查

Run: `npm run type-check`

Expected: 0 errors。

- [ ] **Step 3: Run type-check**

### Step 4: 提交

```bash
git add src/stores/roomStore.ts
git commit -m "feat: extend roomStore with image message type and sendImage action

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: Commit**

---

## Task 3: 在 RoomView 中加入图片选择与预览

**Files:**
- Modify: `src/views/RoomView.vue`

### Step 1: 引入压缩工具并添加状态

在 `<script setup>` 顶部添加 import：

```ts
import { compressImage, ImageTooLargeError } from '@/composables/useImageCompressor'
```

在现有 ref 声明后添加：

```ts
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingImage = ref<{ dataUrl: string; fileName: string; size: number } | null>(null)
const imageError = ref<string | null>(null)
const isCompressing = ref(false)
```

- [ ] **Step 1: Add imports and state refs**

### Step 2: 添加图片处理方法

在 `handleComposerKeydown` 之后添加：

```ts
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
      imageError.value = '图片压缩后仍超过 2MB，请选择更小的图片'
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
```

- [ ] **Step 2: Add image picker handlers**

### Step 3: 修改发送逻辑

把 `handleSendMessage` 替换为：

```ts
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
  nextTick(() => scrollChatToBottom('smooth'))
}
```

并修改 `handleComposerKeydown` 为空内容时不发送：

```ts
const handleComposerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!messageInput.value.trim() && !pendingImage.value) return
    handleSendMessage()
  }
}
```

- [ ] **Step 3: Update send logic to handle images**

### Step 4: 添加模板元素

在 `<form class="composer">` 内部的 `<textarea>` 前添加隐藏的文件输入和图片按钮，并在 textarea 上方添加预览条：

```html
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

<p v-if="imageError" class="image-error">{{ imageError }}</p>
```

把原来的 `<textarea>` 和 `<div class="composer-actions">` 替换为带图片按钮的工具栏：

```html
<textarea
  v-model="messageInput"
  rows="3"
  placeholder="输入消息，按 Enter 发送，Shift + Enter 换行"
  @keydown="handleComposerKeydown"
></textarea>

<div class="composer-actions">
  <div class="composer-left">
    <button
      type="button"
      class="image-button"
      :disabled="isCompressing"
      @click="handlePickImage"
    >
      {{ isCompressing ? '压缩中...' : '📎 图片' }}
    </button>
  </div>
  <span class="composer-hint">Enter 发送 · Shift + Enter 换行</span>
  <button type="submit" class="cta primary">发送消息</button>
</div>
```

- [ ] **Step 4: Add file input, preview, and toolbar to template**

### Step 5: 类型检查

Run: `npm run type-check`

Expected: 0 errors。

- [ ] **Step 5: Run type-check**

### Step 6: 提交

```bash
git add src/views/RoomView.vue
git commit -m "feat: add image picker and preview to RoomView

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: Commit**

---

## Task 4: 渲染图片消息并支持点击查看

**Files:**
- Modify: `src/views/RoomView.vue`

### Step 1: 添加打开图片方法

在 `clearPendingImage` 之后添加：

```ts
const openImage = (src: string) => {
  if (typeof window !== 'undefined') {
    window.open(src, '_blank')
  }
}
```

- [ ] **Step 1: Add openImage helper**

### Step 2: 修改消息渲染模板

把 `<li>` 内部的消息体替换为：

```html
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
    <img
      v-if="message.type === 'image'"
      :src="message.content"
      class="message-image"
      alt="聊天图片"
      loading="lazy"
      @click="openImage(message.content)"
    />
    <p v-else class="body">{{ message.content }}</p>
  </div>
</li>
```

- [ ] **Step 2: Render image messages in bubble**

### Step 3: 提交

```bash
git add src/views/RoomView.vue
git commit -m "feat: render image messages and support click-to-open

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 3: Commit**

---

## Task 5: 添加图片相关样式

**Files:**
- Modify: `src/views/RoomView.vue`（scoped style 区域末尾）

在 `</style>` 前添加：

```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.composer-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(236, 253, 245, 0.6);
  border-radius: 14px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.composer-preview img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 10px;
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

.composer-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.image-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.2rem;
  border-radius: 999px;
  font-weight: 600;
  color: #047857;
  background: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.3);
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease;
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
  max-width: min(240px, 60vw);
  max-height: 240px;
  border-radius: 12px;
  cursor: pointer;
  object-fit: cover;
  display: block;
}

@media (max-width: 1090px) {
  .message-image {
    max-width: min(200px, 70vw);
  }
}
```

- [ ] **Step 1: Add image-related CSS**

### Step 2: 提交

```bash
git add src/views/RoomView.vue
git commit -m "style: add image preview and image message styles

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 2: Commit**

---

## Task 6: 补充压缩工具成功路径测试

**Files:**
- Modify: `src/composables/__tests__/useImageCompressor.spec.ts`

### Step 1: 扩展测试并 mock Canvas

完整替换测试文件为：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage, ImageTooLargeError } from '../useImageCompressor'

describe('useImageCompressor', () => {
  const originalImage = global.Image
  const originalGetContext = global.HTMLCanvasElement.prototype.getContext
  const originalToBlob = global.HTMLCanvasElement.prototype.toBlob

  beforeEach(() => {
    global.Image = class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      src = ''
      width = 100
      height = 100
      constructor() {
        setTimeout(() => this.onload?.(), 0)
      }
    } as unknown as typeof Image

    global.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    global.HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      const blob = new Blob(['compressed-image-bytes'], { type: 'image/jpeg' })
      callback(blob)
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob
  })

  afterEach(() => {
    global.Image = originalImage
    global.HTMLCanvasElement.prototype.getContext = originalGetContext
    global.HTMLCanvasElement.prototype.toBlob = originalToBlob
    vi.restoreAllMocks()
  })

  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toThrow('请选择图片文件')
  })

  it('returns a jpeg data URL for valid images', async () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file)
    expect(result).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('throws ImageTooLargeError when maxSize is exceeded', async () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file, { maxSize: 1 })).rejects.toBeInstanceOf(ImageTooLargeError)
  })
})
```

- [ ] **Step 1: Expand compressor tests with canvas mocks**

### Step 2: 运行测试

Run: `npm run test:unit -- src/composables/__tests__/useImageCompressor.spec.ts`

Expected: 3 tests PASS。

- [ ] **Step 2: Run tests**

### Step 3: 提交

```bash
git add src/composables/__tests__/useImageCompressor.spec.ts
git commit -m "test: cover image compression success and size limit paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 3: Commit**

---

## Task 7: 运行全量检查

### Step 1: 类型检查

Run: `npm run type-check`

Expected: 0 errors。

- [ ] **Step 1: Run type-check**

### Step 2: 单元测试

Run: `npm run test:unit -- --run`

Expected: 所有测试通过。

- [ ] **Step 2: Run unit tests**

### Step 3: 代码格式化

Run: `npm run format`

Expected: 无文件变更（或仅格式化变更）。

- [ ] **Step 3: Run format**

### Step 4: Lint

Run: `npm run lint`

Expected: 0 errors。

- [ ] **Step 4: Run lint**

### Step 5: 提交（如有格式化变更）

```bash
git add -A
git commit -m "chore: format and lint fixes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Commit formatting changes**

---

## Task 8: 本地端到端验证

### Step 1: 启动开发服务器

Run: `npm run dev`

Expected: 服务器在 `http://localhost:5173` 启动。

- [ ] **Step 1: Start dev server**

### Step 2: 双标签页互发图片

1. 在浏览器打开两个标签页，都访问 `http://localhost:5173`
2. 标签页 A 创建房间
3. 标签页 B 加入同一房间
4. 标签页 A 点击 📎 选择一张 JPG 图片并发送
5. 标签页 B 应能看到图片消息
6. 标签页 B 也发送一张图片，标签页 A 应能收到
7. 选择一张超过 2MB 的大图，应看到“图片压缩后仍超过 2MB”提示

- [ ] **Step 2: Manual cross-tab image send verification**

### Step 3: 停止开发服务器

按 `Ctrl + C` 停止 dev server。

- [ ] **Step 3: Stop dev server**

---

## Plan Self-Review

**Spec coverage check:**
- ✅ 图片压缩 → Task 1
- ✅ `sendImage` action → Task 2
- ✅ RoomView 图片选择/预览/发送 → Task 3
- ✅ 图片消息渲染 → Task 4
- ✅ 样式 → Task 5
- ✅ 错误处理 → Task 3
- ✅ 测试 → Task 1 + Task 6
- ✅ 本地验证 → Task 8

**Placeholder scan:**
- 无 TBD/TODO
- 无 "add appropriate error handling" 等模糊描述
- 每个步骤包含完整代码或命令

**Type consistency check:**
- `MessageType` 在 Task 2 中扩展为 `'chat' | 'system' | 'image'`，后续 `sanitizeMessage` 与 `sendImage` 均使用该类型
- `RoomMessage` 新增的 `fileName` / `size` / `width` / `height` 字段在 `sanitizeMessage` 与 `sendImage` 中一致
- `compressImage` 返回 `Promise<string>`，与 `RoomView` 中 `pendingImage.dataUrl` 类型一致

**Risk note:**
jsdom 中没有真实 Canvas。Task 6 的测试通过 mock `HTMLCanvasElement.prototype.toBlob` 绕过，实际压缩逻辑依赖浏览器环境，最终效果需通过 Task 8 手工验证。
