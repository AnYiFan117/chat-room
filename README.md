# Blow Chat Room

[![Vue 3](https://img.shields.io/badge/Vue-3.5-%2342b883?logo=vue.js)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-%23646CFF?logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-%233178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

一个基于 **Vue 3 + WebRTC + Yjs** 的浏览器端 P2P 聊天室。无需后端服务器，通过房间号即可在浏览器之间建立加密连接，支持文字、图片实时同步。

> **P2P 架构**：消息不经过中心服务器，直接在用户浏览器之间传输。

## ✨ 特性

- 🔗 **房间号连接**：创建或加入房间，一键开始聊天
- 💬 **文字消息**：实时同步，支持用户名与在线成员列表
- 🖼️ **图片消息**：本地压缩后发送，单图最大 2MB
- 🔒 **房间级加密**：消息使用 XOR 流密码加密，密钥由房间号派生
- 🌐 **纯浏览器端**：无需数据库、无需后端服务
- 📱 **响应式布局**：适配桌面与移动设备

## 🚀 快速开始

### 环境要求

- Node.js `^20.19.0 || >=22.12.0`
- npm 或 pnpm

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/AnYiFan117/chat-room.git
cd chat-room

# 2. 安装依赖
npm ci

# 3. 配置环境变量（可选，详见下方配置说明）
cp .env.example .env

# 4. 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

### 构建生产版本

```bash
npm run build
```

构建产物位于 `dist/` 目录。

## ⚙️ 配置说明

在项目根目录创建 `.env` 文件：

```bash
# WebRTC 信令服务器（二选一）
VITE_SIGNALING_ENDPOINT=wss://your-server.com/signal
# 或同时配置多个
# VITE_SIGNALING_ENDPOINTS=["wss://signal-1.example/ws","wss://signal-2.example/ws"]

# STUN/TURN 服务器（JSON 数组）
VITE_ICE_SERVERS=[{"urls":"stun:your-server.com:3478"},{"urls":"turn:your-server.com:3478?transport=tcp","username":"user","credential":"pass"}]
```

> ⚠️ `.env` 已加入 `.gitignore`，请勿将真实凭据提交到仓库。
>
> 如果未配置，将回退到默认的公共信令/TURN 地址，仅建议用于体验，不适合生产环境。

## 🖥️ 生产部署

本项目的生产部署需要以下三个组件：

1. **前端静态资源**：由 Nginx 托管
2. **WebRTC 信令服务器**：用于初始的 peer 发现与 SDP 交换
3. **Coturn 服务器**：用于 NAT 穿透与中继

### 推荐部署架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Nginx     │────▶│   Signaling │     │   Coturn    │
│  (HTTPS)    │     │  (WebSocket)│     │  (TURN)     │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│  浏览器用户  │
│  P2P 直连   │
└─────────────┘
```

### 部署步骤概要

```bash
# 1. 构建
npm ci
npm run build

# 2. 上传 dist/ 到服务器 /var/www/chat-room/dist

# 3. 部署信令服务器（例如 y-webrtc 自带服务）
# 4. 部署并配置 Coturn
# 5. 配置 Nginx + SSL
# 6. 设置环境变量后重新构建
```

### Nginx 配置示例

```nginx
server {
    listen 443 ssl http2;
    server_name your-server.com;

    ssl_certificate /etc/letsencrypt/live/your-server.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-server.com/privkey.pem;

    root /var/www/chat-room/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /signal {
        proxy_pass http://localhost:4444;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

> 更详细的部署步骤（信令服务器、Coturn、SSL 证书）可参考上方架构说明自行扩展。

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Composition API |
| 构建工具 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router |
| P2P 同步 | Yjs + y-webrtc |
| 样式 | 原生 CSS |
| 测试 | Vitest + Playwright |

## 📁 项目结构

```
chat-room/
├── src/
│   ├── assets/           # 静态样式与资源
│   ├── components/       # 可复用组件
│   ├── composables/      # 组合式函数
│   ├── router/           # 路由配置
│   ├── stores/           # Pinia 状态
│   └── views/            # 页面视图
├── e2e/                  # Playwright 端到端测试
├── public/               # 公共资源
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig*.json
```

## 🧪 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run preview` | 本地预览生产构建 |
| `npm run test:unit` | 运行 Vitest 单元测试 |
| `npm run test:e2e` | 运行 Playwright 端到端测试 |
| `npm run lint` | 运行 ESLint |
| `npm run format` | 运行 Prettier |

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交改动：`git commit -m "feat: add something"`
4. 推送分支：`git push origin feat/your-feature`
5. 创建 Pull Request

提交信息建议遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

## ⚠️ 已知限制

- 图片消息以 Base64 形式存储在 Yjs 文档中，单房间图片过多会增大文档体积
- 当前加密为简单的 XOR 流密码，适合普通聊天场景；高安全需求场景请替换为更强的端到端加密方案
- 生产环境必须自行部署信令服务器和 TURN 服务器

## 📄 许可证

[MIT](./LICENSE)

---

如果这个项目对你有帮助，欢迎 ⭐ Star！
