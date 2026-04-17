'use client';

import { useState } from 'react';
import { useModel } from '@/contexts/ModelContext';
import styles from './page.module.css';

interface FunctionCallResult {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }>;
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

export default function MultipleFunctionCallPage() {
  const { provider, modelName } = useModel();
  const [prompt, setPrompt] = useState('');
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
          {result.text && (
            <div className={styles.section}>
              <div className={styles.label}>AI 回复</div>
              <div className={styles.textContent}>{result.text}</div>
            </div>
          )}

          {result.toolCalls && result.toolCalls.length > 0 && (
            <div className={styles.section}>
              <div className={styles.label}>调用的工具</div>
              {result.toolCalls.map((call, i) => (
                <div key={i} className={styles.toolCall}>
                  <span className={styles.toolName}>{call.toolName}</span>
                  <pre className={styles.args}>
                    {JSON.stringify(call.input, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {result.toolResults && result.toolResults.length > 0 && (
            <div className={styles.section}>
              <div className={styles.label}>工具执行结果</div>
              {result.toolResults.map((tr, i) => (
                <div key={i} className={styles.toolResult}>
                  <span className={styles.toolName}>{tr.toolName}</span>
                  <pre className={styles.resultContent}>
                    {JSON.stringify(tr.output, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}

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
