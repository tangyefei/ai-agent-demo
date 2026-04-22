# 使用 useChat 完成带记忆功能的流程和问题

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Client)                                                   │
│  /chat → 创建会话 → 重定向到 /chat/[id]                          │
│  /chat/[id] → loadChat(id) → 渲染 ChatUI(initialMessages)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  API Route                                                       │
│  POST /api/persistent-chat                                       │
│  接收完整 messages 数组 → streamText → onFinish 中 saveChat      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  存储层 (Neon Postgres)                                          │
│  chats 表：id (PK), messages (JSONB), created_at, updated_at     │
└─────────────────────────────────────────────────────────────────┘
```

## 二、核心数据流

### 1. 页面首次加载（恢复历史）

```
用户访问 /chat/[id]
  ↓
chat/[id]/page.tsx (Server Component)
  const initialMessages = await loadChat(id);
  return <ChatUI id={id} initialMessages={initialMessages} />;
  ↓
ChatUI.tsx (Client Component)
  useChat({ id, messages: initialMessages })
  // 历史消息回显到界面
```

### 2. 发送新消息

```
用户在 ChatUI 输入并发送
  ↓
sendMessage({ text: "你好" }, { body: { provider, model } })
  ↓
useChat 内部自动拼接完整消息数组：
  [...messages, { role: "user", content: "你好" }]
  ↓
DefaultChatTransport.sendMessages({
  messages: fullMessages,  // ← 完整数组，不是单条
  id,
  trigger, messageId,
  ...body
})
  ↓
POST /api/persistent-chat
  请求体: { id, messages: [...], provider, model }
  ↓
服务端收到完整上下文 → validateUIMessages → streamText
  ↓
模型拿到完整历史 + 本次消息 → 生成回复
  ↓
toUIMessageStreamResponse({ onFinish })
  onFinish({ messages: updatedMessages }) → saveChat(id, updatedMessages)
```

### 3. 刷新页面

```
页面重新加载 → /chat/[id]/page.tsx → loadChat(id)
  ↓
从 Postgres 读取 messages JSONB → 恢复完整对话
```

## 三、关键问题解析

### 问题 1：saveChat 何时/被谁调用？

**答案**：只在 `api/persistent-chat/route.ts` 的 `onFinish` 回调中调用一次。

```typescript
// api/persistent-chat/route.ts
return result.toUIMessageStreamResponse({
  originalMessages: validatedMessages,
  onFinish: async ({ messages: updatedMessages }) => {
    // AI 回复完成后，将完整对话列表（历史 + 用户消息 + AI回复）写入数据库
    await saveChat(id, updatedMessages);
  },
});
```

**触发时机**：模型流式生成全部 token 完毕后，SDK 调用 `onFinish`，此时 `updatedMessages` 包含完整对话。

### 问题 2：历史消息如何作为上下文发送给模型？

**答案**：不是服务端加载的，而是**客户端携带过来的**。

```typescript
// ChatUI.tsx
const { messages, sendMessage } = useChat({
  id,
  messages: initialMessages,  // 首次从服务端注入历史
});

// 发送时，useChat 内部自动拼接完整数组
sendMessage({ text: "你好" });
// 实际发送给后端的是：
// [...messages, { role: "user", content: "你好" }]
```

**核心要点**：
- `sendMessage` 虽然只传了 `{ text }`，但 `useChat` 内部会自动将当前持有的完整 `messages` 数组通过 `DefaultChatTransport` 发给后端
- 后端收到的请求体是 `{ messages: UIMessage[], id, ... }`（复数数组，不是单条 message）
- 因此后端**无需调用 `loadChat`**，客户端已持有完整上下文
- `loadChat` 只在**页面首次加载**时使用（Server Component 中）

### 问题 3：loadChat 为什么返回 `rows[0]`？

**答案**：PostgreSQL 查询结果总是以**数组**形式返回。

```typescript
// chat-store.ts
export async function loadChat(id: string): Promise<UIMessage[]> {
  const rows = await sql`SELECT messages FROM chats WHERE id = ${id}`;
  // rows 结构：
  //   找到记录：[{ messages: [...] }]
  //   未找到：[]（空数组）
  return ((rows[0] as { messages?: UIMessage[] } | undefined)?.messages ?? []) as UIMessage[];
}
```

**原因**：
- 每个 `chatId` 对应数据库中的**一条记录**
- PostgreSQL 的查询结果格式永远是数组（可能匹配 0、1 或多行）
- `rows[0]` 取第一行（也是唯一一行）
- `?.messages` 安全取出字段
- `?? []` 处理未找到记录的情况（返回空数组而非报错）

## 四、数据库设计

### 表结构

```sql
CREATE TABLE IF NOT EXISTS chats (
  id         VARCHAR(128) PRIMARY KEY,
  messages   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 设计说明

- **id**：会话唯一标识，由 AI SDK 的 `generateId()` 生成
- **messages**：JSONB 类型存储完整 UIMessage[] 数组，与前端格式完全对应
- **created_at / updated_at**：审计用时间戳

## 五、接口签名

`src/util/chat-store.ts` 提供三个核心接口，调用方无需关心底层存储实现：

```typescript
/** 创建新会话，返回唯一 ID */
createChat(): Promise<string>

/** 加载已有会话的消息列表，会话不存在时返回空数组 */
loadChat(id: string): Promise<UIMessage[]>

/** 持久化会话消息（覆盖写入，含 AI 回复后的完整列表） */
saveChat(id: string, messages: UIMessage[]): Promise<void>
```

## 六、注意事项

1. **`DefaultChatTransport` 发送的是完整消息数组**，不是单条消息。文档中某些示例使用 `{ message }` 是误导，实际 SDK 源码发送的是 `{ messages: UIMessage[] }`

2. **客户端持有完整上下文**：页面加载后，所有消息状态由 `useChat` 维护，发送时自动携带完整历史。服务端无需每次查询数据库加载历史

3. **`loadChat` 只在 Server Component 中使用**：用于页面首次加载时从数据库恢复历史。后续交互不需要再调用

4. **`saveChat` 在 `onFinish` 中执行**：确保 AI 回复完成后才持久化，避免只保存用户消息

5. **环境变量配置**：需要配置 `POSTGRES_URL`（连接池）和可选的 `POSTGRES_URL_NON_POOLING`（DDL 建表用）
