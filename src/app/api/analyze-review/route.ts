import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const ollama = createOpenAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

const anthropic = createOpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic',
});

const MovieReviewSchema = z.object({
  score: z.number().min(1).max(10).describe('电影评分 1-10'),
  sentiment: z.enum(['positive', 'neutral', 'negative']).describe('情感倾向'),
  keywords: z.array(z.string()).describe('关键词列表'),
});

function extractJsonFromText(text: string): object | null {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const jsonMatch = withoutThinking.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
  return null;
}

function getModel(provider: string, modelName: string) {
  switch (provider) {
    case 'ollama':
      return ollama.chat(modelName || 'llama3.1:latest');
    case 'anthropic':
      return anthropic.chat(modelName || 'MiniMax-M2.7');
    default:
      return openai.chat(modelName || 'MiniMax-M2.7');
  }
}

export async function POST(req: Request) {
  try {
    const { reviewText, provider = 'ollama', model = 'llama3.1:latest' } = await req.json();

    if (!reviewText || typeof reviewText !== 'string' || reviewText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: '影评内容不能为空' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await generateText({
      model: getModel(provider, model),
      messages: [
        {
          role: 'user',
          content: `严格只输出一个JSON对象，不要输出任何思考过程或markdown格式。

分析以下影评，返回包含评分、情感倾向和关键词的JSON：
{"score":数字,"sentiment":"positive|neutral|negative","keywords":["关键词1","关键词2"]}

影评内容：${reviewText}`,
        },
      ],
    });

    const text = result.text;
    const json = extractJsonFromText(text);

    if (json) {
      // 使用 safeParse 而非 parse，自定义错误信息指出缺失字段
      const validated = MovieReviewSchema.safeParse(json);
      if (validated.success) {
        return new Response(
          JSON.stringify({ success: true, data: validated.data }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } else {
        // 提取缺失的字段名
        const missingFields = validated.error.issues.map(e => e.path.join('.') || 'unknown');
        return new Response(
          JSON.stringify({
            error: '返回数据格式不完整',
            missingFields,
            received: json,
          }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: '无法从输出中提取有效JSON', raw: text }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
