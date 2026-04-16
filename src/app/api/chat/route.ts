import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

// 创建 OpenAI / MiniMax provider（通过环境变量配置 baseURL 和 apiKey）
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

// 创建 Ollama provider（本地模型）
const ollama = createOpenAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

// 根据 provider 切换模型
function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'ollama':
      return ollama.chat(modelName || 'llama3.1:latest');
    default:
      // 使用 .chat() 调用 Chat Completions API（/chat/completions），
      // 兼容 MiniMax 等 OpenAI 兼容服务（它们不支持 /responses 端点）
      return openai.chat(modelName || 'gpt-4o');
  }
}

export async function POST(req: Request) {
  try {
    const { messages, model = 'gpt-4o', provider = 'openai' } = await req.json();

    const result = streamText({
      model: getModel(provider, model),
      messages,
    });

    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const part of result.fullStream) {
            let sseEvent: string | null = null;

            switch (part.type) {
              case 'reasoning-delta':
                sseEvent = formatSSE('reasoning', { text: part.text });
                break;
              case 'text-delta':
                sseEvent = formatSSE('text', { text: part.text });
                break;
              case 'error':
                sseEvent = formatSSE('error', { error: String(part.error) });
                break;
            }

            if (sseEvent) {
              controller.enqueue(encoder.encode(sseEvent));
            }
          }
          controller.enqueue(encoder.encode(formatSSE('done', '[DONE]')));
          controller.close();
        } catch (streamError) {
          const errorMessage = streamError instanceof Error ? streamError.message : 'Stream error';
          controller.enqueue(encoder.encode(formatSSE('error', { error: errorMessage })));
          controller.close();
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
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

function formatSSE(event: string, data: unknown): string {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${dataString}\n\n`;
}

// 获取可用模型列表
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
