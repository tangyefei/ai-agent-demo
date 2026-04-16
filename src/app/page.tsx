"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./page.module.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSend() {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isStreaming) return;

    const userMessage: ChatMessage = { role: "user", content: trimmedInput };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");
    setIsStreaming(true);

    const assistantMessage: ChatMessage = { role: "assistant", content: "", reasoning: "" };
    setMessages([...updatedMessages, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "MiniMax-M2.7",
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      let insideThinkTag = false;
      let rawText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            const dataString = line.slice(6);
            if (dataString === "[DONE]") break;

            try {
              const data = JSON.parse(dataString);

              if (currentEvent === "reasoning" && data.text) {
                accumulatedReasoning += data.text;
                console.log("[reasoning]", accumulatedReasoning);
              } else if (currentEvent === "text" && data.text) {
                rawText += data.text;

                // 解析  标签，分离思考内容和回答内容
                const parsed = parseThinkTags(rawText, insideThinkTag);
                accumulatedReasoning = parsed.reasoning;
                accumulatedContent = parsed.content;
                insideThinkTag = parsed.insideThinkTag;

                console.log("[reasoning]", accumulatedReasoning);
                console.log("[content]", accumulatedContent);
              }

              setMessages((prev) => {
                const updated = [...prev];
                const lastMessage = updated[updated.length - 1];
                if (lastMessage?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...lastMessage,
                    content: accumulatedContent,
                    reasoning: accumulatedReasoning,
                  };
                }
                return updated;
              });
            } catch {
              // skip malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => {
        const updated = [...prev];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage?.role === "assistant") {
          updated[updated.length - 1] = {
            ...lastMessage,
            content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2>AI Chat</h2>
      </header>

      <main className={styles.messageList}>
        {messages.length === 0 && (
          <div className={styles.emptyState}>发送消息开始对话 ✨</div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`${styles.messageRow} ${
              message.role === "user" ? styles.userRow : styles.assistantRow
            }`}
          >
            <div
              className={`${styles.bubble} ${
                message.role === "user" ? styles.userBubble : styles.assistantBubble
              }`}
            >
              {message.role === "assistant" && message.reasoning && (
                <ReasoningBlock reasoning={message.reasoning} />
              )}
              <div className={styles.contentText}>
                {message.content || (isStreaming && index === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          </div>
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
          disabled={isStreaming}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={isStreaming || !inputValue.trim()}
        >
          {isStreaming ? "生成中…" : "发送"}
        </button>
      </footer>
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

/**
 * 从流式文本中解析  标签，
 * 将标签内的内容分离为 reasoning，标签外的内容分离为 content。
 * 支持流式场景：标签可能跨多个 chunk 到达。
 */
function parseThinkTags(
  rawText: string,
  wasInsideThinkTag: boolean,
): { reasoning: string; content: string; insideThinkTag: boolean } {
  let reasoning = "";
  let content = "";
  let insideThinkTag = wasInsideThinkTag;
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

  return { reasoning: reasoning.trim(), content: content.trim(), insideThinkTag };
}
