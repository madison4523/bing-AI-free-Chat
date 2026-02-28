# bing-AI-Chat（DeepSeek）

一个前端 AI 聊天应用（React + Vite），支持 **DeepSeek** 流式输出、**会话管理**、**语音输入**、**深浅色主题**。

为避免把 API Key 打包进前端，本项目使用 **Express 代理服务器**在服务端转发请求：浏览器只请求 `/proxy/*`，Key 永远不会出现在 DevTools 里。

## UI 预览

![UI Demo 0](./public/ui0.png)
![UI Demo 1](./public/ui1.png)
![UI Demo 2](./public/ui2.png)

### 交互亮点

- **侧边栏会话**：新建 / 重命名 / 删除，长列表使用虚拟滚动保持流畅。
- **主区域对话**：流式输出（边生成边显示），支持中断。
- **模型切换**：DeepSeek Chat / DeepSeek Reasoner 随时切换。
- **主题切换**：深色/浅色。
- **语音输入**：麦克风按钮调用浏览器语音识别。

## 架构说明

```text
Browser (React UI)
    |
    |  POST /proxy/*
    v
Vite Dev Server (dev proxy)
    |
    |  forward to http://localhost:3001
    v
Express Proxy (server/proxy.js)
    |
    `---> DeepSeek API (SSE)
```

- 前端：`src/config/deepseek.js` 只请求相对路径 `/proxy/deepseek/...`
- 服务端：`server/proxy.js` 从环境变量读取 Key，转发到上游 API

## 快速开始

### 环境要求

- Node.js **18+**（推荐 20+；`server/proxy.js` 使用内置 `fetch`）

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

- `DEEPSEEK_API_KEY`：DeepSeek Key（服务端使用，不会暴露到浏览器）
- `PROXY_PORT`：代理端口（默认 3001）
- `VITE_USE_MOCK`：是否强制 Mock 模式（`true/false`）

### 3) 本地开发（两个终端）

```bash
# 终端 A：启动代理服务
npm run dev:server

# 终端 B：启动前端
npm run dev
```

打开：<http://localhost:5173/>

## 数据存储

会话数据存储在 **IndexedDB**（避免 localStorage 5MB 限制）。

## 项目结构

```text
AI-Chat/
├─ server/
│  └─ proxy.js          # Express 代理（隐藏 API Key）
├─ src/
│  ├─ components/
│  │  ├─ Main/
│  │  ├─ SideBar/
│  │  └─ VoiceRecorder/
│  ├─ config/
│  │  ├─ api.js         # 重试/Mock/错误处理工具
│  │  ├─ deepseek.js    # DeepSeek SSE 封装（走 /proxy）
│  │  └─ db.js          # IndexedDB 封装
│  └─ context/
│     └─ Context.jsx
├─ .env.example
├─ vite.config.js
└─ package.json
```

## 常见问题

### 没有 Key 能跑吗？

可以。在 `.env` 里设置 `VITE_USE_MOCK=true`，前端会使用 Mock 回复，不请求真实 API。

### 为什么需要 Express 代理？

Vite 会把 `VITE_` 前缀的环境变量注入到浏览器包里，直接在前端调用 API 会导致 Key 泄露。
因此 Key 只放在服务端，通过 `/proxy/*` 转发请求。

## License

MIT
