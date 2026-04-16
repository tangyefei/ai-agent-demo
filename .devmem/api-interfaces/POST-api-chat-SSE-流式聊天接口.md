# POST /api/chat SSE 流式聊天接口

## 请求

```json
{
  "provider": "openai" | "ollama",
  "model": "MiniMax-M2.7",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

## 响应

Content-Type: `text/event-stream`

### SSE 事件类型

| 事件 | data 格式 | 说明 |
|------|-----------|------|
| `reasoning` | `{"text": "..."}` | 模型思考过程（逐 delta） |
| `text` | `{"text": "..."}` | 模型回答内容（逐 delta） |
| `error` | `{"error": "..."}` | 错误信息 |
| `done` | `[DONE]` | 流结束标志 |

## Provider 配置

- **openai**: 通过 `OPENAI_API_KEY` + `OPENAI_BASE_URL` 环境变量配置，兼容 MiniMax 等 OpenAI 兼容服务
- **ollama**: 通过 `OLLAMA_BASE_URL` 环境变量配置，默认 `http://localhost:11434/v1`
