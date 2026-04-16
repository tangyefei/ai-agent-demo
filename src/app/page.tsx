"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { UIMessage } from "ai";
import styles from "./page.module.css";

/**
 * 从文本中解析  标签，
 * 将标签内的内容分离为 reasoning，标签外的内容分离为 content。
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

export default function Home() {
  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: "/api/chat",
        body: {
          provider: "openai",
          model: "MiniMax-M2.7",
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSend() {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;
    setInputValue("");
    await sendMessage({ text: trimmedInput });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    setMessages([]);
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

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const rawText = getMessageText(message);
  const { reasoning, content } = isUser
    ? { reasoning: "", content: rawText }
    : parseThinkTags(rawText);

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

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
  );
}
