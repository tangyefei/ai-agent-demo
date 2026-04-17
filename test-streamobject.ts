import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { streamObject } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1',
});

const TestSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    name: z.string()
  }))
});

async function test() {
  console.log('Testing partialObjectStream with MiniMax...\n');
  const model = openai.chat('MiniMax-M2.7');

  const result = streamObject({
    model,
    schema: TestSchema,
    prompt: '生成3个物品：苹果、香蕉、橙子',
  });

  let count = 0;
  let hasReceivedData = false;

  for await (const chunk of result.partialObjectStream) {
    count++;
    hasReceivedData = true;
    console.log(`Chunk ${count}:`, JSON.stringify(chunk));
  }

  console.log(`\nTotal chunks received: ${count}`);
  console.log('Received any data during streaming:', hasReceivedData);

  const fullObject = await result.object;
  console.log('Full object:', JSON.stringify(fullObject));
}

test().catch(console.error);
