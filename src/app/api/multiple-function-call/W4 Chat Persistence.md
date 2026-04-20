## 📋 第四周核心开发指南：会话持久化

### 一、整体数据流架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Client)                                                   │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ /chat (新建)    │ →  │ 生成 chatId     │ → 重定向到 /chat/[id] │
│  └─────────────────┘    └─────────────────┘                     │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ /chat/[id]      │ →  │ useChat 加载    │ → 显示历史消息       │
│  └─────────────────┘    │ initialMessages │                     │
│                         └─────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  服务端 (API Route)                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ POST /api/chat                                           │    │
│  │ 1. 接收 { messages, id }                                 │    │
│  │ 2. loadChat(id) → 获取历史消息                            │    │
│  │ 3. 合并新消息 → validateUIMessages()                      │    │
│  │ 4. streamText() → 流式响应                                │    │
│  │ 5. saveChat(id, messages) → 持久化                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  存储层 (Database / File)                                        │
│  • createChat(): 生成新会话 ID，创建空消息数组                    │
│  • loadChat(id): 读取消息数组                                    │
│  • saveChat(id, messages): 写入消息数组                          │
└─────────────────────────────────────────────────────────────────┘
```

### 二、存储层实现（util/chat-store.ts）

官方文档提供了一个基于文件的存储实现作为示例，在实际项目中应替换为数据库（如 Vercel Postgres）。

```typescript
// util/chat-store.ts
import { generateId, UIMessage } from 'ai';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';

// 生成唯一的会话 ID
export async function createChat(): Promise<string> {
  const id = generateId(); // 使用 AI SDK 内置的 ID 生成器
  await writeFile(getChatFile(id), '[]');
  return id;
}

// 加载已有会话的消息
export async function loadChat(id: string): Promise<UIMessage[]> {
  return JSON.parse(await readFile(getChatFile(id), 'utf8'));
}

// 保存消息到会话
export async function saveChat(id: string, messages: UIMessage[]): Promise<void> {
  await writeFile(getChatFile(id), JSON.stringify(messages, null, 2));
}

// 获取会话文件路径
function getChatFile(id: string): string {
  const chatDir = path.join(process.cwd(), '.chats');
  if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
  return path.join(chatDir, `${id}.json`);
}
```

**💡 关于数据库选择的提示**：

| 方案 | 适用场景 | 说明 |
| :--- | :--- | :--- |
| **文件存储** | 本地开发和快速原型 | 官方示例使用，但不适合生产环境 |
| **Vercel Postgres** | 生产环境推荐 | 数据持久化，后续可直接扩展 pgvector 做 RAG |
| **Upstash Redis** | 高并发/缓存场景 | 速度极快，适合作为缓存层 |

> **建议**：第四周优先选择 **Vercel Postgres**，因为第五、六周的 RAG 可以直接复用同一个 Postgres 数据库的 pgvector 扩展，无需引入新的存储系统。

### 三、页面路由实现

#### 3.1 新建会话页面（app/chat/page.tsx）

当用户访问 `/chat` 时，自动创建新会话并重定向到带 ID 的页面。

```typescript
// app/chat/page.tsx
import { redirect } from 'next/navigation';
import { createChat } from '@/util/chat-store';

export default async function Page() {
  const id = await createChat();      // 创建新会话
  redirect(`/chat/${id}`);            // 重定向到 /chat/[id]
}
```

#### 3.2 会话详情页面（app/chat/[id]/page.tsx）

从服务端加载历史消息，并传递给客户端组件。

```typescript
// app/chat/[id]/page.tsx
import { loadChat } from '@/util/chat-store';
import { Chat } from '@/components/chat';

export default async function Page({ params }: { params: { id: string } }) {
  const initialMessages = await loadChat(params.id);
  return <Chat id={params.id} initialMessages={initialMessages} />;
}
```

#### 3.3 客户端聊天组件（components/chat.tsx）

```typescript
// components/chat.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { UIMessage } from 'ai';

interface ChatProps {
  id: string;
  initialMessages: UIMessage[];
}

export function Chat({ id, initialMessages }: ChatProps) {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    id,                                           // 关键：会话 ID
    initialMessages,                              // 从服务端加载的历史消息
    sendExtraMessageFields: true,                 // 保留消息 ID 等额外字段
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>{message.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```

### 四、API 路由实现（app/api/chat/route.ts）

这是最核心的部分，负责加载历史消息、验证消息安全性、调用模型、保存新消息。

```typescript
// app/api/chat/route.ts
import { convertToModelMessages, streamText, UIMessage, validateUIMessages, tool } from 'ai';
import { z } from 'zod';
import { loadChat, saveChat } from '@/util/chat-store';

// 定义工具（与第三周的工具定义一致）
const tools = {
  weather: tool({
    description: '获取指定城市的天气信息',
    parameters: z.object({
      city: z.string().describe('城市名称'),
    }),
    execute: async ({ city }) => {
      // 工具实现
      return { temp: 25, condition: 'Sunny' };
    },
  }),
};

export async function POST(req: Request) {
  const { message, id }: { message: UIMessage; id: string } = await req.json();

  // 1. 从存储中加载历史消息
  const previousMessages = await loadChat(id);

  // 2. 合并历史消息和新消息
  const messages = [...previousMessages, message];

  // 3. 验证消息安全性（防止恶意构造的 tool call）
  const validatedMessages = await validateUIMessages({
    messages,
    tools, // 确保消息中的工具调用与定义的工具匹配
  });

  // 4. 调用模型生成响应
  const result = streamText({
    model: /* 你的模型配置 */,
    messages: convertToModelMessages(validatedMessages),
    tools,
    onFinish: async ({ response }) => {
      // 5. 保存完整的消息历史（包括模型的响应）
      await saveChat(id, [...validatedMessages, ...response.messages]);
    },
  });

  return result.toUIMessageStreamResponse();
}
```

### 五、关键注意事项

#### 5.1 消息验证（必须掌握）

官方文档特别强调：**在服务端处理包含工具调用、自定义元数据的消息时，必须先使用 `validateUIMessages` 进行验证**。这是防止恶意客户端构造非法工具调用的安全措施。

```typescript
const validatedMessages = await validateUIMessages({
  messages,
  tools,           // 只允许调用已定义的工具
  dataPartsSchema, // 可选：验证 data parts
  metadataSchema,  // 可选：验证 metadata
});
```

#### 5.2 sendExtraMessageFields 配置

在 `useChat` 中必须设置 `sendExtraMessageFields: true`，这样才能将消息的 `id` 等字段发送到服务端，否则消息 ID 会丢失，导致保存失败。

#### 5.3 onFinish 回调的时机

`onFinish` 在模型完成响应后触发，是保存消息的**最佳时机**。此时 `response.messages` 包含了完整的模型响应，可以一并持久化。

### 六、验收检查清单

完成第四周任务后，请对照以下清单验证：

- [ ] 访问 `/chat` 自动跳转到 `/chat/[id]`
- [ ] 发送消息后，API 能正确保存消息到存储
- [ ] **刷新页面后，聊天记录完整显示（不丢失）**
- [ ] 新会话使用不同的 `chatId`，互不干扰
- [ ] `validateUIMessages` 已正确配置，防止恶意工具调用
- [ ] `sendExtraMessageFields: true` 已配置

### 七、扩展阅读链接

- [官方文档：Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)
- [Prisma + AI SDK 完整示例](https://www.prisma.io/docs/guides/ai/ai-sdk)
- [Upstash Redis 持久化方案](https://upstash.com/blog/ai-sdk-v5-redis)