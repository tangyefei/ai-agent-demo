// ============================================================
// Next.js API Route: /api/chat
// ============================================================
// 这是一个 Next.js 的 "Route Handler"（路由处理器）。
// 文件路径 src/app/api/chat/route.ts 会自动映射为 HTTP 端点 /api/chat。
// 导出的 POST 函数处理 POST 请求，GET 函数处理 GET 请求。
// ============================================================

// @ai-sdk/openai：Vercel AI SDK 的 OpenAI 适配器。
// 它不仅能连接 OpenAI 官方 API，还能连接任何兼容 OpenAI 格式的服务
// （如 MiniMax、Ollama 等），只需修改 baseURL 即可。
import { createOpenAI } from '@ai-sdk/openai';

// @ai-sdk/anthropic：Vercel AI SDK 的 Anthropic 适配器
// 用于连接 MiniMax 提供的 Anthropic 兼容端点（/v1/messages）
import { createAnthropic } from '@ai-sdk/anthropic';

// streamText：Vercel AI SDK 的核心函数，用于调用 AI 模型并获取流式文本响应。
//   - 与 generateText() 的区别：generateText 等待完整结果后一次性返回，
//     streamText 则逐 token 返回，用户可以看到"打字机效果"。
//
// convertToModelMessages：将前端 UIMessage 格式转换为 AI 模型能理解的 ModelMessage 格式。
//   - UIMessage 格式：{ id, role, parts: [{ type: "text", text: "Hello" }] }
//     （前端 useChat Hook 使用的格式，包含 id 和 parts 数组）
//   - ModelMessage 格式：{ role: "user", content: "Hello" }
//     （AI 模型 API 使用的标准格式，简单的 role + content 结构）
import { streamText, convertToModelMessages } from 'ai';

// UIMessage 类型定义，用于 TypeScript 类型标注
import type { UIMessage } from 'ai';

// ============================================================
// Provider 初始化
// ============================================================
// "Provider" 是 AI SDK 中的概念，代表一个 AI 模型服务的连接配置。
// createOpenAI() 创建一个兼容 OpenAI API 格式的 provider 实例。
// 通过修改 baseURL，可以连接不同的 AI 服务（OpenAI、MiniMax、Ollama 等）。

// 云端 Provider：连接 OpenAI 或 MiniMax 等云端 AI 服务。
// apiKey 和 baseURL 通过环境变量配置（.env.local 文件），
// 这样可以在不修改代码的情况下切换不同的 AI 服务。
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

// 本地 Provider：连接本地运行的 Ollama 服务。
// Ollama 是一个可以在本地运行开源 AI 模型（如 Llama、Qwen 等）的工具。
// 它暴露了与 OpenAI 兼容的 API 接口，所以可以复用 createOpenAI() 来连接。
// apiKey 设为 'ollama' 只是一个占位符，Ollama 实际上不需要认证。
const ollama = createOpenAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

// Anthropic 兼容 Provider（MiniMax 提供）
// 使用 @ai-sdk/anthropic 连接 Anthropic 兼容端点（/v1/messages）
const anthropicProvider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic',
});

// ============================================================
// 模型选择
// ============================================================
// 根据前端传入的 provider 参数，选择使用哪个 AI 服务和模型。
//
// 关键点：为什么用 .chat() 而不是直接调用 openai(modelName)？
//   - openai(modelName)：使用 OpenAI 新的 Responses API（/responses 端点）
//   - openai.chat(modelName)：使用传统的 Chat Completions API（/chat/completions 端点）
//   MiniMax、Ollama 等第三方服务只兼容传统的 /chat/completions 端点，
//   不支持 /responses 端点，所以必须用 .chat() 方法。
function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'ollama':
      return ollama.chat(modelName || 'llama3.1:latest');
    case 'anthropic':
      return anthropicProvider.chat(modelName || 'MiniMax-M2.7');
    default:
      return openai.chat(modelName || 'gpt-4o');
  }
}

// ============================================================
// POST /api/chat — 流式聊天接口
// ============================================================
// 这是核心的聊天 API。处理流程：
//
// 1. 前端 useChat 的 TextStreamChatTransport 发送 POST 请求
//    请求体格式：{ messages: UIMessage[], model, provider, id, trigger }
//
// 2. 后端将 UIMessage[] 转换为 ModelMessage[]（格式转换）
//
// 3. 调用 streamText() 向 AI 模型发起流式请求
//    AI 模型会逐 token 生成文本，每生成一个词就立即返回
//
// 4. 通过 toTextStreamResponse() 将流式结果编码为 HTTP 响应
//    响应类型是 text/plain，内容是逐步到达的纯文本
//
// 5. 前端 TextStreamChatTransport 接收这个文本流，
//    逐步更新 UIMessage 的 parts，触发 React 重新渲染
export async function POST(req: Request) {
  try {
    // 从请求体中解构参数：
    // - messages：前端 useChat 发送的 UIMessage 数组（包含完整对话历史）
    // - model：要使用的模型名称（如 "MiniMax-M2.7"）
    // - provider：模型服务商（"openai" 或 "ollama"）
    const { messages: uiMessages, model = 'gpt-4o', provider = 'openai' } = await req.json();

    // 格式转换：UIMessage → ModelMessage
    // 前端 useChat 发送的消息是 UIMessage 格式：
    //   { id: "abc", role: "user", parts: [{ type: "text", text: "你好" }] }
    // 但 streamText() 需要 ModelMessage 格式：
    //   { role: "user", content: "你好" }
    // convertToModelMessages() 负责这个转换，它会：
    //   1. 提取 parts 中的文本内容拼接为 content
    //   2. 去掉 id 等前端专用字段
    //   3. 处理多模态内容（如图片、文件等）
    const modelMessages = await convertToModelMessages(uiMessages as UIMessage[]);

    // 调用 AI 模型进行流式文本生成
    // streamText() 不会等待完整结果，而是立即返回一个包含流式数据的对象。
    // 内部流程：
    //   1. 将 ModelMessage 发送给 AI 模型的 /chat/completions 端点
    //   2. AI 模型逐 token 生成文本，通过 SSE 返回
    //   3. AI SDK 将 SSE 解析为内部的流式数据结构
    const result = streamText({
      model: getModel(provider, model),
      messages: modelMessages,
    });

    // 将流式结果转换为 HTTP Response
    // toTextStreamResponse() 会：
    //   1. 创建一个 ReadableStream，将 AI 模型的输出逐块编码为 UTF-8 文本
    //   2. 设置 Content-Type 为 text/plain; charset=utf-8
    //   3. 返回一个标准的 Web Response 对象
    // 前端的 TextStreamChatTransport 会读取这个文本流，
    // 将每个文本块追加到当前 assistant 消息的 parts 中
    return result.toTextStreamResponse();
  } catch (error) {
    // 错误处理：返回 500 状态码和错误信息的 JSON
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

// ============================================================
// GET /api/chat — API 信息接口
// ============================================================
// 一个辅助接口，返回 API 的使用说明和支持的模型列表。
// 主要用于调试和文档目的，在浏览器中直接访问 /api/chat 即可看到。
export async function GET() {
  return new Response(
    JSON.stringify({
      message: 'Chat API is running',
      usage: 'POST to this endpoint with { messages, model, provider }',
      providers: {
        openai: {
          description: 'Cloud OpenAI models',
          models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
          defaultModel: 'gpt-4o',
        },
        ollama: {
          description: 'Local Ollama models',
          baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
          models: ['llama3.1:latest', 'mistral', 'codellama', 'qwen2.5'],
          defaultModel: 'llama3.1:latest',
        },
        minimax: {
          description: 'MiniMax models (OpenAI compatible)',
          baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.com/v1',
          models: ['MiniMax-M2.7'],
          defaultModel: 'MiniMax-M2.7',
        },
      },
      example: {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        messages: [{ role: 'user', content: 'Hello!' }],
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
