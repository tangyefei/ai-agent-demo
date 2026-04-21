// ============================================================
// Next.js API Route: /api/persistent-chat
// ============================================================
// 持久化聊天接口，供 /chat/[id] 页面的 ChatUI 组件使用。
// 与 /api/chat 的区别：
//   - 使用 DefaultChatTransport（JSON 事件流），对应 toUIMessageStreamResponse()
//   - 每次只接收本次新消息（message 单条），历史从存储层加载
//   - 在 onFinish 回调中持久化完整消息列表
// ============================================================

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, convertToModelMessages, validateUIMessages } from 'ai';
import type { UIMessage } from 'ai';
import { saveChat } from '@/util/chat-store';

// ─── Provider 初始化 ─────────────────────────────────────────

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const ollama = createOpenAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

const anthropicProvider = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic',
});

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

// ─── POST /api/persistent-chat ───────────────────────────────
//
// DefaultChatTransport 发送完整的 messages 数组（非单条 message），
// 服务端无需从存储层加载历史——客户端已持有完整上下文。
// 持久化只在 onFinish 中执行（写入 AI 回复后的完整列表）。
export async function POST(req: Request) {
  try {
    // DefaultChatTransport 发送的请求体结构：
    //   { id, messages: UIMessage[], trigger, messageId, ...extraBody }
    // 其中 messages 是客户端当前持有的完整消息数组（含本次用户消息）。
    const {
      messages: uiMessages,
      id,
      model = 'gpt-4o',
      provider = 'openai',
    } = await req.json() as {
      messages: UIMessage[];
      id: string;
      model?: string;
      provider?: string;
    };

    // 安全校验：防止客户端构造非法工具调用（本接口暂未使用工具，传 {} 即可）
    const validatedMessages = await validateUIMessages({
      messages: uiMessages,
      tools: {},
    });

    // 调用 AI 模型生成流式响应
    const result = streamText({
      model: getModel(provider, model),
      messages: await convertToModelMessages(validatedMessages),
    });

    // 返回 UI 消息流，onFinish 在模型回复完成后持久化完整消息列表
    return result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      onFinish: async ({ messages: updatedMessages }) => {
        try {
          console.log('[persistent-chat] onFinish: saving', updatedMessages.length, 'messages for id:', id);
          await saveChat(id, updatedMessages);
          console.log('[persistent-chat] onFinish: saveChat completed');
        } catch (err) {
          console.error('[persistent-chat] onFinish: saveChat FAILED:', err);
        }
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
