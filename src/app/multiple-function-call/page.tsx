'use client';

import { useState, useMemo } from 'react';
import { useModel } from '@/contexts/ModelContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import styles from './page.module.css';

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'toolCall'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'toolResult'; toolCallId: string; toolName: string; input: Record<string, unknown>; output: Record<string, unknown> };

interface FunctionCallResult {
  events: StreamEvent[];
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  toolCallCount: number;
}

// 支持 tool calling 的 provider
const TOOL_CALLING_SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'ollama'];

/** 从文本中解析 <think>...</think> 标签 */
function parseThinkTags(rawText: string): { reasoning: string; content: string } {
  let reasoning = '';
  let content = '';
  let insideThinkTag = false;
  let cursor = 0;

  while (cursor < rawText.length) {
    if (insideThinkTag) {
      const closeIndex = rawText.indexOf('</think>', cursor);
      if (closeIndex === -1) {
        reasoning += rawText.slice(cursor);
        cursor = rawText.length;
      } else {
        reasoning += rawText.slice(cursor, closeIndex);
        insideThinkTag = false;
        cursor = closeIndex + '</think>'.length;
      }
    } else {
      const openIndex = rawText.indexOf('<think>', cursor);
      if (openIndex === -1) {
        content += rawText.slice(cursor);
        cursor = rawText.length;
      } else {
        content += rawText.slice(cursor, openIndex);
        insideThinkTag = true;
        cursor = openIndex + '<think>'.length;
      }
    }
  }

  return { reasoning: reasoning.trim(), content: content.trim() };
}

/** 思考过程折叠块 */
function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className={styles.reasoningBlock}>
      <button className={styles.collapseToggle} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={styles.collapseIcon}>{isExpanded ? '▼' : '▶'}</span>
        <span>思考过程</span>
      </button>
      {isExpanded && (
        <div className={styles.reasoningContent}>{reasoning}</div>
      )}
    </div>
  );
}

/** 工具调用折叠块 */
function ToolCallBlock({ toolName, input }: { toolName: string; input: Record<string, unknown> }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className={styles.toolCallBlock}>
      <button className={styles.collapseToggle} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={styles.collapseIcon}>{isExpanded ? '▼' : '▶'}</span>
        <span>调用工具：</span>
        <span className={styles.toolBadge}>{toolName}</span>
      </button>
      {isExpanded && (
        <pre className={styles.codeBlock}>{JSON.stringify(input, null, 2)}</pre>
      )}
    </div>
  );
}

/** 工具结果折叠块 */
function ToolResultBlock({ toolName, output }: { toolName: string; output: Record<string, unknown> }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className={styles.toolResultBlock}>
      <button className={styles.collapseToggle} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={styles.collapseIcon}>{isExpanded ? '▼' : '▶'}</span>
        <span>工具结果：</span>
        <span className={styles.toolBadge + ' ' + styles.toolBadgeGreen}>{toolName}</span>
      </button>
      {isExpanded && (
        <pre className={styles.codeBlock}>{JSON.stringify(output, null, 2)}</pre>
      )}
    </div>
  );
}

/** Markdown 渲染器（支持 GFM 表格 + 代码高亮） */
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className={styles.markdownContent}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** 文本事件渲染（含思考过程解析） */
function TextEventBlock({ content }: { content: string }) {
  const { reasoning, content: text } = useMemo(() => parseThinkTags(content), [content]);
  return (
    <div className={styles.section}>
      <div className={styles.label}>AI 回复</div>
      {reasoning && <ReasoningBlock reasoning={reasoning} />}
      {text && <MarkdownRenderer content={text} />}
    </div>
  );
}

export default function MultipleFunctionCallPage() {
  const { provider, modelName } = useModel();
  const [prompt, setPrompt] = useState('帮我查一下 Tokyo 天气，再算算 1000 人民币能换多少日元');
  const [result, setResult] = useState<FunctionCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isToolCallingSupported = TOOL_CALLING_SUPPORTED_PROVIDERS.includes(provider);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/multiple-function-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, provider, model: modelName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '调用失败');
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.currentModel}>
        当前模型: {provider} / {modelName}
      </div>

      <h1 className={styles.title}>多工具调用示例</h1>

      {!isToolCallingSupported && (
        <div className={styles.warning}>
          当前选择的模型（{provider}）不支持 Tool Calling 功能，请切换到 OpenAI、Anthropic 或 Ollama 模型
        </div>
      )}

      <div className={styles.inputSection}>
        <textarea
          className={styles.textarea}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：帮我查一下东京天气，再算算 1000 人民币能换多少日元"
          rows={3}
          disabled={isLoading}
        />
        <button
          className={styles.submitButton}
          onClick={handleSubmit}
          disabled={!prompt.trim() || isLoading || !isToolCallingSupported}
        >
          {isLoading ? '调用中...' : '发送'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <div className={styles.result}>
          {result.events.map((event, i) => {
            if (event.type === 'text') {
              return <TextEventBlock key={i} content={event.content} />;
            }
            if (event.type === 'toolCall') {
              return <ToolCallBlock key={i} toolName={event.toolName} input={event.input} />;
            }
            if (event.type === 'toolResult') {
              return <ToolResultBlock key={i} toolName={event.toolName} output={event.output} />;
            }
            return null;
          })}

          <div className={styles.finishReason}>
            结束原因: {result.finishReason}
          </div>

          <div className={styles.stats}>
            <div className={styles.statsItem}>
              <span>已调用工具次数：</span>
              <span className={styles.statsValue}>{result.toolCallCount}</span>
            </div>
            <div className={styles.statsItem}>
              <span>预估 Token 消耗：</span>
              <span className={styles.statsValue}>
                {result.usage
                  ? `${result.usage.totalTokens} (Prompt: ${result.usage.promptTokens}, Completion: ${result.usage.completionTokens})`
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
