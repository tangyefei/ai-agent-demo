"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { UIMessage } from "ai";
import styles from "./page.module.css";

// ─── 配置常量 ───────────────────────────────────────────────

/** 聊天 API 的请求地址 */
const CHAT_API_ENDPOINT = "/api/chat";

/** 默认的模型 Provider（兼容 OpenAI 协议的服务） */
const DEFAULT_PROVIDER = "openai";

/** 默认使用的模型名称 */
const DEFAULT_MODEL = "MiniMax-M2.7";

// ─── 工具函数 ───────────────────────────────────────────────

/**
 * 从文本中解析  ...  标签，将标签内的内容分离为 reasoning，标签外的内容分离为 content。
 *
 * 为什么使用游标遍历而非正则表达式：
 * MiniMax 模型的思考内容以  标签包裹在文本流中输出（而非 AI SDK 的 reasoning-delta 事件）。
 * 在流式传输场景下，  和  标签可能跨多个 chunk 到达，
 * 导致某一时刻文本中存在未闭合的  标签。
 * 游标方案能正确处理这种中间态——未闭合时将剩余文本暂归为 reasoning，
 * 等后续 chunk 到达并闭合标签后，下次调用会重新解析完整文本得到正确结果。
 */
function parseThinkTags(rawText: string): {
  reasoning: string;
  content: string;
} {
  let reasoning = "";
  let content = "";
  let insideThinkTag = false;
  let cursor = 0;

  while (cursor < rawText.length) {
    if (insideThinkTag) {
      const closeIndex = rawText.indexOf("</think>", cursor);
      if (closeIndex === -1) {
        reasoning += rawText.slice(cursor);
        cursor = rawText.length;
      } else {
        reasoning += rawText.slice(cursor, closeIndex);
        insideThinkTag = false;
        cursor = closeIndex + "</think>".length;
      }
    } else {
      const openIndex = rawText.indexOf("<think>", cursor);
      if (openIndex === -1) {
        content += rawText.slice(cursor);
        cursor = rawText.length;
      } else {
        content += rawText.slice(cursor, openIndex);
        insideThinkTag = true;
        cursor = openIndex + "<think>".length;
      }
    }
  }

  return { reasoning: reasoning.trim(), content: content.trim() };
}

/** 从 UIMessage 的 parts 中提取完整文本 */
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

// ─── 主页面组件 ─────────────────────────────────────────────

export default function Home() {
  /**
   * transport 对象必须用 useMemo 缓存，
   * 否则每次渲染都会创建新实例，导致 useChat 重新初始化连接。
   */
  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: CHAT_API_ENDPOINT,
        body: {
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
        },
      }),
    [],
  );

  const { messages, sendMessage, stop, status, setMessages } = useChat({
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  // 消息列表变化时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;

    setSendError(null);
    setInputValue("");

    try {
      await sendMessage({ text: trimmedInput });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "发送失败，请重试";
      setSendError(errorMessage);
      console.error("消息发送失败:", error);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    setMessages([]);
    setSendError(null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2>AI Chat</h2>
        {messages.length > 0 && (
          <button className={styles.clearButton} onClick={handleClear}>
            清空
          </button>
        )}
      </header>

      <main className={styles.messageList}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>发送消息开始对话 ✨</div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {sendError && (
          <div className={styles.errorMessage}>⚠️ {sendError}</div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <footer className={styles.inputBar}>
        <textarea
          className={styles.textarea}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          disabled={isLoading}
        />
        {isLoading ? (
          <button className={styles.stopButton} onClick={stop}>
            停止
          </button>
        ) : (
          <button
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!inputValue.trim()}
          >
            发送
          </button>
        )}
      </footer>
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────────────

/** 单条消息气泡，区分用户消息和 AI 回复，AI 回复支持思考过程折叠和 Markdown 渲染 */
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const rawText = getMessageText(message);

  // 缓存 parseThinkTags 的解析结果，避免每次渲染都重新遍历整段文本
  const { reasoning, content } = useMemo(
    () => (isUser ? { reasoning: "", content: rawText } : parseThinkTags(rawText)),
    [isUser, rawText],
  );

  return (
    <div
      className={`${styles.messageRow} ${
        isUser ? styles.userRow : styles.assistantRow
      }`}
    >
      <div
        className={`${styles.bubble} ${
          isUser ? styles.userBubble : styles.assistantBubble
        }`}
      >
        {!isUser && reasoning && <ReasoningBlock reasoning={reasoning} />}
        <div className={styles.contentText}>
          {isUser ? (
            content
          ) : content ? (
            <MarkdownRenderer content={content} />
          ) : (
            <span className={styles.placeholder}>…</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** AI 思考过程的可折叠展示区域 */
function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={styles.reasoningBlock}>
      <button
        className={styles.reasoningToggle}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={styles.reasoningIcon}>{isExpanded ? "▼" : "▶"}</span>
        <span>思考过程</span>
      </button>
      {isExpanded && (
        <div className={styles.reasoningContent}>{reasoning}</div>
      )}
    </div>
  );
}

/** Markdown 内容渲染器，支持代码高亮 */
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
  );
}
