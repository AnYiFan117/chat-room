# 超级大爆聊天室

## 简介
本网站使用P2P架构，通过房间号建立用户之间的连接。
消息传递使用了Ydoc，通过信令建立p2p,通过turn来传递聊天记录。
如果想要使用本仓库，需要自行配制信令地址和 turn 服务器，并通过环境变量注入。

## 环境变量

1. 在项目根目录创建 `.env` 文件
2. **信令服务器配置**（二选一）：
   - `VITE_SIGNALING_ENDPOINT` - 单个端点（代码会自动添加 `room` 参数），示例：`VITE_SIGNALING_ENDPOINT=wss://signal.example.com/signal`
   - `VITE_SIGNALING_ENDPOINTS` - 多个端点（JSON 数组格式），示例：`VITE_SIGNALING_ENDPOINTS=["wss://signal-1.example/ws","wss://signal-2.example/ws"]`
3. `VITE_ICE_SERVERS` - 以 JSON 数组形式配置 STUN/TURN 服务器及凭据，示例：  
   `VITE_ICE_SERVERS=[{"urls":"stun:your-stun.example:3478"},{"urls":"turn:your-turn.example:3478?transport=tcp","username":"turn-user","credential":"turn-password"}]`
4. `.env` 文件已加入 `.gitignore`，请勿提交真实凭据到仓库
5. 如果未设置环境变量，会自动回退到默认配置：`wss://8.152.98.245/signal` 及 `stun/turn:8.152.98.245:3478`

## 配置步骤

### 1. 安装前端依赖

进入到项目主目录
```
npm install
```

部署
```
npm run build
```

### 2. 在服务器上

部署nginx

...

部署信令服务器

...

部署coturn

...

设置网站证书

...
