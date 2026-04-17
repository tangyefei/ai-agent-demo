import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const ollama = createOpenAI({
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
});

const MovieReviewSchema = z.object({
  score: z.number().min(1).max(10).describe('电影评分 1-10'),
  sentiment: z.enum(['positive', 'neutral', 'negative']).describe('情感倾向'),
  keywords: z.array(z.string()).describe('关键词列表'),
});

function extractJsonFromText(text: string): object | null {
  // 尝试提取 JSON：先去掉思考块，再找 JSON 对象
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

async function analyzeReview(reviewText: string, provider = 'openai', modelName = 'MiniMax-M2.7') {
  const model = provider === 'ollama' ? ollama.chat(modelName) : openai.chat(modelName);

  const result = await streamText({
    model,
    messages: [
      {
        role: 'user',
        content: `严格只输出一个JSON对象，不要输出任何思考过程或markdown格式。JSON格式：{"score":数字,"sentiment":"positive|neutral|negative","keywords":["关键词1","关键词2"]}

影评内容：${reviewText}`,
      },
    ],
  });

  const text = await result.text;

  console.log('原始输出:', text);

  const json = extractJsonFromText(text);
  if (json) {
    console.log('✅ 提取的JSON:', JSON.stringify(json, null, 2));
    // 用 Zod 验证
    const validated = MovieReviewSchema.parse(json);
    console.log('✅ Zod 验证通过:', validated);
    return validated;
  } else {
    console.log('❌ 无法从输出中提取有效JSON');
    return null;
  }
}

const reviews = [
  '这部科幻电影视觉效果震撼，剧情紧凑有深度，配乐也相当出色。虽然有些桥段略显老套，但整体观影体验非常棒，值得推荐！',
  '太失望了，电影节奏拖沓，剧情无聊透顶，演员演技尴尬，看得我想提前离场。',
  '还行吧，中规中矩的一部电影，没有太出彩的地方但也没有明显硬伤，可以用来打发时间。',
];

async function main() {
  for (const review of reviews) {
    console.log('\n' + '='.repeat(50));
    console.log('影评:', review);
    await analyzeReview(review);
  }
}

main();
