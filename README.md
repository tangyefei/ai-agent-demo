# AI Chat

一个基于 Next.js 16 和 Vercel AI SDK 的现代化 AI 聊天应用，支持多种 AI 模型 Provider。

## 功能特性

- **流式对话**：实时流式输出，呈现"打字机"效果
- **多 Provider 支持**：OpenAI、MiniMax、Ollama（本地模型）
- **思考过程展示**：可折叠的 AI 思考过程查看
- **Markdown 渲染**：支持代码高亮的 Markdown 内容展示
- **响应式设计**：适配不同屏幕尺寸

## 技术栈

- **框架**：Next.js 16.2.4 (App Router)
- **语言**：TypeScript
- **AI SDK**：Vercel AI SDK (@ai-sdk/react, @ai-sdk/openai, ai)
- **UI**：React 19.2.4 + CSS Modules
- **Markdown**：react-markdown + rehype-highlight

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env.local` 文件，添加必要的环境变量：

```env
# OpenAI 配置
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1

# MiniMax 配置（可选）
MINIMAX_BASE_URL=https://api.minimax.com/v1

# Ollama 配置（可选，用于本地模型）
OLLAMA_BASE_URL=http://localhost:11434/v1
```

### 3. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 项目结构

```
src/app/
├── api/chat/route.ts    # 聊天 API 路由（POST/GET）
├── layout.tsx           # 根布局
├── page.tsx             # 聊天页面主组件
├── page.module.css      # 页面样式
└── globals.css          # 全局样式
```

## API 接口

### POST /api/chat

流式聊天接口。

**请求体**：
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "model": "MiniMax-M2.7",
  "provider": "openai"
}
```

**响应**：text/plain 流式文本

### GET /api/chat

获取 API 使用信息和支持的模型列表。

## 使用说明

1. 在输入框输入消息，按 Enter 或点击"发送"按钮
2. Shift+Enter 换行
3. AI 思考过程默认折叠，点击"▶ 思考过程"展开查看
4. 支持 Markdown 格式，代码块会自动高亮

## 构建生产版本

```bash
npm run build
npm start
```

## 部署

本项目可部署到 Vercel、Netlify 或任何支持 Node.js 的平台。

```bash
# Vercel 部署
npx vercel deploy
```
