import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { z } from 'zod';

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

const TableRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  status: z.enum(['有货', '缺货', '预售中']),
});

function extractJson(text: string): z.infer<typeof TableRowSchema>[] {
  // 去掉思考块
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // 提取 JSON 数组
  const jsonMatch = withoutThinking.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const rows = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(rows)) return [];

    // 验证每行
    for (const row of rows) {
      TableRowSchema.parse(row);
    }
    return rows;
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { prompt, provider = 'openai', modelName = 'MiniMax-M2.7' } = await req.json();

    const model = (() => {
      switch (provider) {
        case 'ollama':
          return ollama.chat(modelName);
        case 'anthropic':
          return anthropicProvider.chat(modelName);
        default:
          return openai.chat(modelName);
      }
    })();

    const result = await streamText({
      model,
      system: '你是一个数据生成器。只输出JSON数组，不要输出任何思考过程或解释。',
      messages: [
        {
          role: 'user',
          content: `生成一个包含10条商品数据的JSON数组。数据要求：
- id 从 1 开始递增
- name: 有创意的商品名称
- category: 类别（电子产品、服装、食品、家居、图书等）
- price: 价格数字
- stock: 库存数字
- status: "有货"、"缺货" 或 "预售中"

只输出JSON数组，不要有任何其他内容。`,
        },
      ],
    });

    const text = await result.text;
    console.log('[DEBUG] Generated text:', text?.substring(0, 500));

    const rows = extractJson(text);
    console.log('[DEBUG] Extracted rows:', rows.length);

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: '无法解析有效数据，请重试' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ rows }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[DEBUG] POST error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
