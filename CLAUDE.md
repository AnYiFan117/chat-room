# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

这是一个基于 **Vue 3 + Vite + Pinia + Vue Router** 的 P2P 聊天室前端。
消息不经过中心化的应用服务器，而是通过 **Yjs + y-webrtc** 在浏览器之间直接同步。
用户创建/加入房间后，所有聊天消息、成员在线状态都通过 WebRTC data channel 共享同一个 Yjs document。

## 常用命令

```bash
# 安装依赖
npm install

# 开发服务器（Vite，监听 0.0.0.0）
npm run dev

# 生产构建（同时进行 TypeScript 类型检查）
npm run build

# 仅打包，跳过类型检查
npm run build-only

# TypeScript 类型检查
npm run type-check

# ESLint 自动修复并缓存
npm run lint

# Prettier 格式化 src/
npm run format

# 单元测试（Vitest）
npm run test:unit

# 运行单个单元测试文件
npx vitest run src/composables/__tests__/useImageCompressor.spec.ts

# E2E 测试（Playwright，需先安装浏览器）
npx playwright install
npm run test:e2e
```

## 架构概览

### 1. 前端路由（`src/router/index.ts`）

- `/`：首页 `HomeView.vue`，创建/加入房间、设置昵称
- `/room/:roomId`：聊天室 `RoomView.vue`，实际的消息收发与在线成员展示
- `/contact`：联系页面 `ContactView.vue`

### 2. 状态管理（`src/stores/roomStore.ts`）

核心仓库，承担以下职责：

- 维护每个房间的 `Y.Doc` 与 `WebrtcProvider` 会话
- 通过 `Y.Array<RoomMessage>`（键为 `messages`）同步聊天消息
- 通过 provider 的 `awareness` 广播和感知在线成员
- 对聊天文本做 XOR + base64 加密（系统消息和普通消息），图片消息**不加密**以避免体积膨胀
- 本地 `localStorage` 记录已加入房间列表（`play-chat-room-ids`）

重要实现细节：

- 房间 ID 会被 `normalizeRoomId` 转为大写
- 系统消息（用户加入/离开）由 `recordSystemMessage` 写入
- 图片消息经 `compressImage` 压缩后同步，发送前会检查是否超过 WebRTC 单条消息安全上限（约 240 KB）

### 3. 图片压缩（`src/composables/useImageCompressor.ts`）

- 使用 canvas 将图片缩放并导出为 `image/jpeg`
- 默认限制：最大边 800px，质量 0.7，输出不超过 150 KB
- 超过限制会抛出 `ImageTooLargeError`

### 4. 部署方式

项目构建产物输出到 `dist/`，由 nginx 直接托管静态文件：

```bash
npm run build
systemctl reload nginx   # 在目标服务器上执行
```

当前服务器配置：

- 前端静态资源：`/home/chat-room/dist`
- nginx 监听 `https://8.152.98.245/`，`/signal` 路径代理到本地 y-webrtc 信令服务器 `http://127.0.0.1:23333`
- 信令服务在 `y-signal/server.js` 中启动，与前端是独立进程

### 5. 环境变量

运行时通过 `.env` 注入（已加入 `.gitignore`，**禁止提交真实凭据**）：

- `VITE_SIGNALING_ENDPOINT`：单个信令端点，代码会自动拼接 `?room=ROOM_ID`
- `VITE_ICE_SERVERS`：JSON 数组格式的 STUN/TURN 服务器配置

若未设置，仓库不会自动回退到默认服务器，需要手动配置。

## 版本控制与发布流程

1. **每次代码更新都必须 `git commit`**，不要留未提交的本地改动
2. **较大的内容改动应新建分支**进行修改，完成后再合并或提交
3. **前端页面调整后必须立即构建并部署**，让用户能直观看到效果：
   ```bash
   npm run build
   systemctl reload nginx
   ```
   此规则优先于 `AGENTS.md` 中“不自动编译”的约定，仅在前端 UI 调整场景下执行
4. **每次代码更新都要同步更新版本号**（`src/views/HomeView.vue` 中的 `APP_VERSION`）：
   - **前端样式/界面调整**：更新最后一位，例如 `0.1.0` → `0.1.1`
   - **功能调整**：更新倒数第二位，例如 `0.1.0` → `0.2.0`

## 协作约定（来自 `AGENTS.md`，必须遵守）

1. **用中文回答用户**
2. **执行完用户指令后，不要自动运行 `npm run build` 等编译命令**。应提示用户你修改了哪些地方，让用户自己决定是否编译/部署
   - **例外**：前端页面/UI 调整完成后，按上方“版本控制与发布流程”立即构建部署
3. **不需要测试，除非用户明确要求**

## 常见修改入口

- 调整聊天室 UI/气泡密度 → `src/views/RoomView.vue`
- 调整首页/版本号/创建房间逻辑 → `src/views/HomeView.vue`
- 修改状态同步、加密、消息结构 → `src/stores/roomStore.ts`
- 修改图片压缩参数或错误处理 → `src/composables/useImageCompressor.ts`
- 修改导航/路由 → `src/router/index.ts` 和 `src/App.vue`
- 全局样式 → `src/assets/main.css` 和 `src/assets/base.css`

## 注意事项

- WebRTC SCTP data channel 在 Chromium 中约有 256 KB 的单条消息上限，因此图片消息严禁超过该限制。当前已通过压缩 + 不加密 + 发送前丢弃超大图来规避
- `dist/` 是构建产物，已被 `.gitignore` 忽略；提交代码时只提交 `src/` 等源码
- 项目使用 `npm-run-all2` 并行执行 `type-check` 和 `build-only`，`npm run build` 失败时通常先看 `vue-tsc` 的类型错误
