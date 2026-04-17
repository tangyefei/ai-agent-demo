import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';

// ============================================================
// Provider 初始化
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

interface WeatherResult {
  location: string;
  condition: string;
  temperature: number;
  humidity: number;
  wind: number;
  feelsLike?: number;
  pressure?: number;
  visibility?: number;
  source: string;
}

async function executeWeatherTool(input: { location: string }): Promise<WeatherResult> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city = input.location.trim().replace(/^["']|["']$/g, '');

  console.log('[function-call] executeWeatherTool called with:', { city, apiKey: apiKey ? apiKey.substring(0, 10) + '...' : 'missing' });

  if (!apiKey) {
    console.log('[function-call] No API key, using mock data');
    const conditions = ['晴朗', '多云', '阴天', '小雨', '雷阵雨', '晴天'];
    return {
      location: city,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      temperature: Math.floor(Math.random() * 30) + 5,
      humidity: Math.floor(Math.random() * 50) + 30,
      wind: Math.floor(Math.random() * 20) + 5,
      source: 'mock',
    };
  }

  try {
    const url = 'https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(city) + '&appid=' + apiKey + '&units=metric';
    console.log('[function-call] Fetching weather from:', url.replace(apiKey, '***'));

    const response = await fetch(url);
    console.log('[function-call] Weather API response status:', response.status);

    const data = await response.json();
    console.log('[function-call] Weather API response data:', JSON.stringify(data).substring(0, 200));

    if (!response.ok) {
      throw new Error(data.message || 'Weather API request failed');
    }

    const weatherCode = data.weather[0]?.id;
    const main = data.weather[0]?.main || 'Unknown';
    const description = data.weather[0]?.description || '';

    return {
      location: data.name + ', ' + (data.sys?.country || ''),
      condition: translateWeatherCondition(weatherCode, main, description),
      temperature: Math.round(data.main?.temp || 0),
      humidity: data.main?.humidity || 0,
      wind: Math.round((data.wind?.speed || 0) * 3.6),
      feelsLike: Math.round(data.main?.feels_like || 0),
      pressure: data.main?.pressure || 0,
      visibility: data.visibility ? Math.round(data.visibility / 1000) : undefined,
      source: 'openweathermap',
    };
  } catch (error) {
    console.error('[function-call] Weather API error:', error);
    throw new Error('天气查询失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

function translateWeatherCondition(code: number, main: string, description: string): string {
  if (code >= 200 && code < 300) return '雷阵雨';
  if (code >= 300 && code < 400) return '毛毛雨';
  if (code >= 500 && code < 600) {
    if (code === 511) return '冻雨';
    if (code >= 502) return '大雨';
    return '小雨';
  }
  if (code >= 600 && code < 700) return '雪天';
  if (code >= 700 && code < 800) return '雾霾';
  if (code === 800) return '晴天';
  if (code === 801) return '少云';
  if (code === 802) return '多云';
  if (code >= 803) return '阴天';
  return description || main;
}

function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'ollama':
      return ollama.chat(modelName || 'llama3.1:latest');
    case 'anthropic':
      return anthropicProvider.chat(modelName || 'MiniMax-M2.7');
    default:
      return openai.chat(modelName || 'MiniMax-M2.7');
  }
}

// ============================================================
// API 路由
// ============================================================

export async function POST(req: Request) {
  try {
    const { prompt, provider = 'anthropic', model = 'MiniMax-M2.7' } = await req.json();

    console.log('[function-call] Received request:', { prompt, provider, model });

    if (!prompt || typeof prompt !== 'string') {
      return new Response(
        JSON.stringify({ error: 'prompt 不能为空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tools = {
      weather: tool({
        description: '获取某个城市的天气信息',
        inputSchema: weatherSchema,
      }),
    };

    // 收集完整响应
    let fullText = '';
    const toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }> = [];
    const toolResults: Array<{
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    }> = [];
    let finishReason = '';

    const modelInstance = getModel(provider, model);
    console.log('[function-call] Model instance created:', provider, model);

    const result = streamText({
      model: modelInstance,
      tools,
      maxSteps: 10,
      prompt,
    });

    console.log('[function-call] Stream started, waiting for chunks...');

    for await (const chunk of result.fullStream) {
      console.log('[function-call] Chunk type:', chunk.type);

      if (chunk.type === 'text-delta') {
        // @ts-ignore - debug
        var delta = chunk.textDelta;
        if (!delta) {
          // @ts-ignore - debug
          delta = chunk.text;
        }
        if (!delta) {
          // @ts-ignore - debug
          delta = chunk.content;
        }
        if (typeof delta !== 'string') {
          delta = '';
        }
        console.log('[function-call] Text delta:', delta);
        fullText += delta;
      } else if (chunk.type === 'tool-call') {
        console.log('[function-call] Tool call detected:', chunk.toolCallId, chunk.toolName, chunk.input);
        toolCalls.push({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: chunk.input as Record<string, unknown>,
        });

        // 手动执行工具
        if (chunk.toolName === 'weather') {
          const input = chunk.input as { location: string };
          console.log('[function-call] Executing weather tool for:', input.location);
          const weatherResult = await executeWeatherTool(input);
          console.log('[function-call] Weather result:', weatherResult);
          toolResults.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input as Record<string, unknown>,
            output: weatherResult,
          });
        }
      } else if (chunk.type === 'finish') {
        finishReason = chunk.finishReason;
      }
    }

    console.log('[function-call] Stream completed. text length:', fullText.length, 'toolCalls:', toolCalls.length, 'toolResults:', toolResults.length);

    return new Response(
      JSON.stringify({
        text: fullText,
        toolCalls,
        toolResults,
        finishReason,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[function-call] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
