"use client";

// ============================================================
// ChatUI — 持久化聊天页面的客户端组件
//
// 与原 page.tsx 的主要变化：
//   1. 移除 TextStreamChatTransport（改用默认 DefaultChatTransport）
//   2. useChat 接收 id + initialMessages（来自服务端）
//   3. sendMessage 第二参数传入 { body: { provider, model } }
//   4. API 返回 toUIMessageStreamResponse()，客户端自动解析
// ============================================================

import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import styles from "./ChatUI.module.css";
import StreamingTable from "@/components/StreamingTable";
import ModelSelector from "@/components/ModelSelector";
import { useModel } from "@/contexts/ModelContext";

// ─── 工具函数 ───────────────────────────────────────────────

/**
 * 从文本中解析 <think>...</think> 标签。
 * 游标遍历方案可正确处理流式场景下标签跨 chunk 到达的中间态。
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

// ─── Props ──────────────────────────────────────────────────

interface ChatUIProps {
  /** 会话唯一 ID，由服务端生成并从 URL 中读取 */
  id: string;
  /** 服务端从存储层加载的历史消息 */
  initialMessages: UIMessage[];
}

// ─── 主组件 ─────────────────────────────────────────────────

export default function ChatUI({ id, initialMessages }: ChatUIProps) {
  const { provider, modelName } = useModel();
  const [activeTab, setActiveTab] = useState<"chat" | "table">("chat");

  /**
   * 使用 DefaultChatTransport 指向持久化接口 /api/persistent-chat。
   * provider / model 通过每次 sendMessage 的 body 动态传递，会与 transport 默认 body 合并。
   * transport 必须用 useMemo 缓存，避免每次渲染都重新初始化连接。
   */
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/persistent-chat" }),
    [],
  );

  /**
   * messages: initialMessages 只在首次创建时生效（服务端历史回显）。
   */
  const { messages, sendMessage, stop, status, setMessages, error, clearError } = useChat({
    id,
    messages: initialMessages,
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  // 消息列表变化时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;

    if (error) clearError();
    setInputValue("");

    try {
      await sendMessage(
        { text: trimmedInput },
        { body: { provider, model: modelName } },
      );
    } catch (err) {
      console.error("消息发送失败:", err);
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
    if (error) clearError();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2>AI Chat</h2>
        <div className={styles.headerControls}>
          <ModelSelector />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setActiveTab("chat")}
              className={activeTab === "chat" ? styles.tabButtonActive : styles.tabButton}
            >
              聊天
            </button>
            <button
              onClick={() => setActiveTab("table")}
              className={activeTab === "table" ? styles.tabButtonActive : styles.tabButton}
            >
              表格生成
            </button>
          </div>
          {messages.length > 0 && activeTab === "chat" && (
            <button className={styles.clearButton} onClick={handleClear}>
              清空
            </button>
          )}
        </div>
      </header>

      {activeTab === "table" ? (
        <StreamingTable provider={provider} modelName={modelName} />
      ) : (
        <>
          <main className={styles.messageList}>
            {messages.length === 0 && (
              <div className={styles.emptyState}>发送消息开始对话 ✨</div>
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {error && (
              <div className={styles.errorMessage}>⚠️ {error.message}</div>
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
        </>
      )}
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────────────

/** 单条消息气泡，区分用户消息和 AI 回复，AI 回复支持思考过程折叠和 Markdown 渲染 */
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const rawText = getMessageText(message);

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
