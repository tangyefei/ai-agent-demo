# POST /api/chat 文本流聊天接口

## 请求

```json
{
  "provider": "openai" | "ollama",
  "model": "MiniMax-M2.7",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

## 响应

Content-Type: `text/plain; charset=utf-8`

返回纯文本流（`toTextStreamResponse()`），兼容 `useChat` 的 `TextStreamChatTransport`。

MiniMax 模型的思考内容以 `` 标签包裹在文本流中，需前端手动解析分离。

## Provider 配置

- **openai**: 通过 `OPENAI_API_KEY` + `OPENAI_BASE_URL` 环境变量配置，兼容 MiniMax 等 OpenAI 兼容服务
- **ollama**: 通过 `OLLAMA_BASE_URL` 环境变量配置，默认 `http://localhost:11434/v1`

## 前端对接

使用 `useChat` + `TextStreamChatTransport`：

```typescript
const transport = new TextStreamChatTransport({
  api: "/api/chat",
  body: { provider: "openai", model: "MiniMax-M2.7" },
});
const { messages, sendMessage, stop, status } = useChat({ transport });
```
