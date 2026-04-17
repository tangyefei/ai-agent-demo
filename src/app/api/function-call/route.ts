import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, tool } from 'ai';
import { z } from 'zod';

// ============================================================
// Provider 初始化（复用 /api/chat 的配置）
// ============================================================

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

// ============================================================
// Tool 定义
// ============================================================

const weatherSchema = z.object({
  location: z.string().describe('要查询天气的城市名称'),
});

async function getWeather({ location }: { location: string }) {
  // 这里可以调用真实的天气 API，如 OpenWeatherMap
  // 为了演示，使用模拟数据
  const conditions = ['晴朗', '多云', '阴天', '小雨', '雷阵雨', '晴天'];
  const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
  const temperature = Math.floor(Math.random() * 30) + 5; // 5-35°C

  return {
    location,
    condition: randomCondition,
    temperature,
    humidity: Math.floor(Math.random() * 50) + 30, // 30-80%
    wind: Math.floor(Math.random() * 20) + 5, // 5-25 km/h
  };
}

// ============================================================
// 模型获取
// ============================================================

function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'ollama':
      return ollama.chat(modelName || 'llama3.1:latest');
    case 'anthropic':
      return anthropicProvider.chat(modelName || 'claude-sonnet-4-20250514');
    default:
      return openai.chat(modelName || 'MiniMax-M2.7');
  }
}

// ============================================================
// API 路由
// ============================================================

export async function POST(req: Request) {
  try {
    const { prompt, provider = 'anthropic', model = 'claude-sonnet-4-20250514' } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return new Response(
        JSON.stringify({ error: 'prompt 不能为空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await generateText({
      model: getModel(provider, model),
      tools: {
        weather: tool({
          description: '获取某个城市的天气信息',
          inputSchema: weatherSchema,
          execute: getWeather,
        }),
      },
      maxSteps: 5,
      prompt,
    });

    // 返回完整结果，包括 tool calls 和文本
    return new Response(
      JSON.stringify({
        text: result.text,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        finishReason: result.finishReason,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
