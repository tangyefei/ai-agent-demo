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
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1',
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

// 天气查询
const weatherSchema = z.object({
  location: z.string().describe('要查询天气的城市名称'),
});

interface WeatherResult extends Record<string, unknown> {
  location: string;
  condition: string;
  temperature: number;
  humidity: number;
  wind: number;
  feelsLike?: number;
  source: string;
}

async function executeWeatherTool(input: { location: string }): Promise<WeatherResult> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city = input.location.trim().replace(/^["']|["']$/g, '');

  console.log('[multiple-function-call] executeWeatherTool called with:', { city });

  if (!apiKey) {
    console.log('[multiple-function-call] No API key, using mock data');
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
    const response = await fetch(url);
    const data = await response.json();

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
      source: 'openweathermap',
    };
  } catch (error) {
    console.error('[multiple-function-call] Weather API error:', error);
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

// 汇率查询
const exchangeRateSchema = z.object({
  fromCurrency: z.string().describe('源货币代码，如 CNY、USD、JPY'),
  toCurrency: z.string().describe('目标货币代码'),
  amount: z.number().describe('要转换的金额'),
});

interface ExchangeRateResult extends Record<string, unknown> {
  from: string;
  to: string;
  amount: number;
  result: number;
  rate: number;
  source: string;
}

async function executeExchangeRateTool(input: { fromCurrency: string; toCurrency: string; amount: number }): Promise<ExchangeRateResult> {
  console.log('[multiple-function-call] executeExchangeRateTool called with:', input);

  // Mock 汇率数据（基于 2024 年近似值）
  const rates: Record<string, Record<string, number>> = {
    CNY: { JPY: 20.5, USD: 0.14, EUR: 0.13, GBP: 0.11, KRW: 190 },
    USD: { CNY: 7.2, JPY: 150, EUR: 0.92, GBP: 0.79, KRW: 1350 },
    JPY: { CNY: 0.049, USD: 0.0067, EUR: 0.0061, GBP: 0.0053, KRW: 9.0 },
    EUR: { CNY: 7.8, USD: 1.09, JPY: 165, GBP: 0.86, KRW: 1470 },
    GBP: { CNY: 9.1, USD: 1.27, JPY: 190, EUR: 1.16, KRW: 1710 },
    KRW: { CNY: 0.0053, USD: 0.00074, JPY: 0.11, EUR: 0.00068, GBP: 0.00059 },
  };

  const fromUpper = input.fromCurrency.toUpperCase();
  const toUpper = input.toCurrency.toUpperCase();
  const rate = rates[fromUpper]?.[toUpper] || 1;
  const result = input.amount * rate;

  console.log('[multiple-function-call] Exchange rate result:', { from: fromUpper, to: toUpper, amount: input.amount, result, rate });

  return {
    from: fromUpper,
    to: toUpper,
    amount: input.amount,
    result: Math.round(result * 100) / 100,
    rate: Math.round(rate * 10000) / 10000,
    source: 'mock',
  };
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

    console.log('[multiple-function-call] Received request:', { prompt, provider, model });

    if (!prompt || typeof prompt !== 'string') {
      return new Response(
        JSON.stringify({ error: 'prompt 不能为空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 定义工具
    const tools = {
      weather: tool({
        description: '获取某个城市的天气信息',
        inputSchema: weatherSchema,
      }),
      exchangeRate: tool({
        description: '货币汇率转换计算',
        inputSchema: exchangeRateSchema,
      }),
    };

    // 收集结果
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
    let usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null = null;

    const modelInstance = getModel(provider, model);

    const result = streamText({
      model: modelInstance,
      tools,
      maxSteps: 10,
      prompt,
    });

    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') {
        let delta = '';
        // @ts-ignore - 尝试多种可能的字段名
        delta = chunk.textDelta || chunk.text || chunk.content || '';
        if (typeof delta !== 'string') delta = '';
        fullText += delta;
      } else if (chunk.type === 'tool-call') {
        toolCalls.push({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: chunk.input as Record<string, unknown>,
        });

        // 执行工具
        if (chunk.toolName === 'weather') {
          const input = chunk.input as { location: string };
          const weatherResult = await executeWeatherTool(input);
          toolResults.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input as Record<string, unknown>,
            output: weatherResult,
          });
        } else if (chunk.toolName === 'exchangeRate') {
          const input = chunk.input as { fromCurrency: string; toCurrency: string; amount: number };
          const exchangeResult = await executeExchangeRateTool(input);
          toolResults.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input as Record<string, unknown>,
            output: exchangeResult,
          });
        }
      } else if (chunk.type === 'finish') {
        finishReason = chunk.finishReason;
        // @ts-ignore - usage 信息
        if (chunk.usage) {
          // @ts-ignore
          usage = chunk.usage;
        }
      }
    }

    console.log('[multiple-function-call] Stream completed. text length:', fullText.length, 'toolCalls:', toolCalls.length, 'toolResults:', toolResults.length);

    return new Response(
      JSON.stringify({
        text: fullText,
        toolCalls,
        toolResults,
        finishReason,
        usage,
        toolCallCount: toolCalls.length,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[multiple-function-call] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
