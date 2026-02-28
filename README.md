# bing-AIChat

## 快速开始

deepseek.js   # 深度定制的 API/SSE 封装
gemini.js     # Google Gemini 流式 SDK 封装

在项目根目录创建 `.env.local`（没有 Key 会自动退回 Mock 模式）：

```bash
VITE_DEEPSEEK_API_KEY=your_deepseek_api_key
VITE_DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
VITE_GEMINI_API_KEY=your_gemini_api_key
```

### 1. 克隆仓库

```bash
git clone https://github.com/fox4523/bing-Chat.git
cd bing-Chat
```

### 2. 安装依赖

```bash
npm install
```

### 3. 运行/构建

```bash
npm run dev      # 本地开发，默认 http://localhost:5173
npm run build    # 生产构建，输出 dist/
npm run preview  # 以生产构建预览
```

## 使用说明

- **基本聊天**：输入提问 → 回车/点击发送 → 实时得到流式回复。
- **语音输入**：点击麦克风按钮即可调用浏览器语音识别。
- **模型/主题切换**：主区域右上角可切换 DeepSeek / Gemini（含 2.5 Flash）模型与深浅色，变更会立即反映。
- **会话管理**：侧边栏支持新建、重命名、删除，虚拟列表保证长列表仍流畅。

## 项目结构

```
bing-AIChat/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── Main/
│   │   └── SideBar/
│   ├── config/
│   │   └── deepseek.js   # 深度定制的 API/SSE 封装
│   ├── context/
│   │   └── Context.jsx   # 全局会话/主题/模型管理
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── README.md
├── package.json
└── vite.config.js
```

## 常见问题

### DeepSeek 或 Gemini Key 尚未拿到怎么办？

- 不配置 `.env.local` 也能体验，`src/config/deepseek.js` 和 `src/config/gemini.js` 会自动切换到 Mock 回复并提示如何开通正式 Key。
	如果已经有其中一个 Key，依然可以切换模型体验不同服务。

### 如何扩展更多模拟回复？

- 在 `src/config/api.js` 的 `MOCK_RESPONSES` 中添加新的问答即可，DeepSeek 和 Gemini 都会自动复用同一份模拟回复逻辑。

### 可以接其它 API 吗？

可以，将 `.env.local` 指向新的 SSE 端点，并在 `deepseek.js` 中调整 `headers` / `body` 即可复用流式与重试逻辑。

## 许可证

MIT License