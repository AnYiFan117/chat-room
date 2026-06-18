# 聊天室图片发送功能设计文档

## 背景

当前 `chat-room` 是一个基于 Vue 3 + Yjs + WebRTC 的 P2P 浏览器端聊天室。消息以 JSON 形式经 XOR 加密后存入 Yjs 共享数组，在各 peer 之间直接同步。用户希望在聊天中发送图片。

## 目标

在不引入后端/外部存储的前提下，让聊天室用户能够发送图片，并与其他 peer 同步显示。

## 非目标

- 不支持发送视频、音频或其他文件类型
- 不支持图片长期云端存储或历史记录漫游
- 不支持图片编辑、滤镜、标注
- 不引入第三方图床或对象存储服务

## 技术约束

- 项目为纯 P2P 架构，所有消息必须能放入 Yjs 文档并通过 WebRTC 同步
- 单张图片不能无限制膨胀 Yjs 文档，必须进行压缩和大小限制
- 继续复用现有 XOR 加密机制

## 方案选择

采用 **方案 B：图片压缩后 Base64 存入 Yjs**。

- 最长边限制 1200px
- JPEG 质量 0.8
- 压缩后单张上限 2MB

该方案保留 P2P 架构，不依赖外部服务，同时控制 Yjs 文档大小。

## 数据模型

当前消息结构扩展为联合类型：

```ts
interface BaseMessage {
  id: string
  sender: string
  userId: string
  createdAt: number
}

interface ChatMessage extends BaseMessage {
  type: 'chat'
  text: string
}

interface SystemMessage extends BaseMessage {
  type: 'system'
  text: string
}

interface ImageMessage extends BaseMessage {
  type: 'image'
  content: string        // data:image/jpeg;base64,...
  fileName?: string
  size?: number          // 原始文件字节数
  width?: number
  height?: number
}

type Message = ChatMessage | SystemMessage | ImageMessage
```

图片消息和文字消息走同一条加密通道：整条消息 JSON 序列化后使用现有 XOR 加密，再写入 `yMessages`。

## 模块设计

### 1. useImageCompressor composable

新增文件：`src/composables/useImageCompressor.ts`

职责：
- 校验文件类型是否为图片
- 加载图片并等比缩放
- 使用 canvas 压缩为 JPEG
- 转换为 Base64 data URL
- 如果压缩后超过大小限制，抛出错误

公开函数：

```ts
export class ImageTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageTooLargeError'
  }
}

export async function compressImage(
  file: File,
  options?: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
    maxSize?: number
  }
): Promise<string>
```

默认参数：
- maxWidth: 1200
- maxHeight: 1200
- quality: 0.8
- maxSize: 2 * 1024 * 1024 (2MB)

### 2. roomStore 扩展

修改文件：`src/stores/roomStore.ts`

新增 action：

```ts
async function sendImage(roomId: string, file: File, user: UserInfo): Promise<void>
```

流程：
1. 调用 `compressImage(file)` 获得 Base64
2. 构造 `ImageMessage`
3. 调用现有 `sendMessage` 内部的加密/写入逻辑

为减少重复，将现有消息写入逻辑抽离为内部辅助函数：

```ts
function pushMessage(roomId: string, message: Message): void
```

`sendMessage` 和 `sendImage` 都调用 `pushMessage`。

### 3. RoomView UI 扩展

修改文件：`src/views/RoomView.vue`

新增交互：
- 输入区左侧增加 📎 图片选择按钮
- 隐藏的原生 `<input type="file" accept="image/*">`
- 选择图片后显示预览条（缩略图 + 文件名 + 大小 + 取消按钮）
- 点击发送或按回车时，如果有预览图则发送图片，否则发送文字
- 消息气泡支持渲染 `ImageMessage`
- 点击图片可放大查看（新标签页打开或 `<dialog>`）

新增状态：

```ts
const pendingImage = ref<{
  dataUrl: string
  fileName: string
  size: number
} | null>(null)
const isCompressing = ref(false)
const imageError = ref<string | null>(null)
```

### 4. 样式

新增/修改：`src/assets/main.css` 或 `RoomView.vue` scoped style

- 图片消息气泡内图片最大宽度 240px，圆角 8px
- 预览条固定在输入框上方，高度约 80px
- 错误提示红色小字
- 响应式：移动端图片宽度自适应

## 错误处理

| 场景 | 行为 |
|------|------|
| 选择非图片文件 | 提示“请选择图片文件” |
| 文件读取失败 | 提示“读取图片失败，请重试” |
| 压缩后超过 2MB | 提示“图片压缩后仍超过 2MB，请选择更小的图片” |
| 图片消息渲染失败 | 显示“图片加载失败”占位 |
| 发送时未连接房间 | 复用现有错误提示 |

## 安全与隐私

- 图片消息与文字消息使用相同的 XOR 加密，密钥派生自 `SECRET_SEED + roomId`
- 压缩在本地完成，不会把原图上传到任何服务器
- Base64 内容仅通过 WebRTC 数据通道同步

## 测试计划

### 单元测试

新增/修改：`src/components/__tests__/HelloWorld.spec.ts` 或新建 `src/composables/__tests__/useImageCompressor.spec.ts`

- `compressImage` 对有效图片返回 Base64 字符串
- 对非图片文件抛出 `TypeError`
- 对超大图片抛出 `ImageTooLargeError`

### E2E 测试（可选，本次可不做）

- 用户选择图片并发送后，消息列表中出现图片消息

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/composables/useImageCompressor.ts` | 新增 | 图片压缩工具 |
| `src/stores/roomStore.ts` | 修改 | 扩展 Message 类型，新增 sendImage action |
| `src/views/RoomView.vue` | 修改 | 图片选择、预览、渲染、错误提示 |
| `src/assets/main.css` | 修改 | 图片消息与预览条样式 |
| `src/composables/__tests__/useImageCompressor.spec.ts` | 新增 | 压缩工具单元测试 |

## 实现顺序

1. 实现 `useImageCompressor.ts`
2. 扩展 `roomStore.ts` 的 Message 类型和 `sendImage` action
3. 在 `RoomView.vue` 中加入图片选择、预览、发送、渲染
4. 补充 CSS 样式
5. 编写单元测试
6. 本地验证：打开两个浏览器标签页，互发图片

## 风险与后续优化

- Yjs 文档会随着图片数量增长而变大，后续可考虑：限制单 room 图片总数、提供“清空历史”功能
- 大图片同步可能在弱网环境下变慢，后续可加入发送进度提示
- 当前加密为简单 XOR，不是端到端强加密；安全要求提高时需替换
