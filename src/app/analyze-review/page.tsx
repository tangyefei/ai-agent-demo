'use client';

import { useState } from 'react';
import { useModel } from '@/contexts/ModelContext';
import styles from './page.module.css';

interface AnalysisResult {
  score: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  keywords: string[];
}

export default function AnalyzeReviewPage() {
  const { provider, modelName } = useModel();
  const [review, setReview] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!review.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/analyze-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewText: review, provider, model: modelName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '分析失败');
      } else {
        setResult(data.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsLoading(false);
    }
  };

  const sentimentLabels = {
    positive: '积极',
    neutral: '中性',
    negative: '消极',
  };

  const sentimentColors = {
    positive: '#22c55e',
    neutral: '#eab308',
    negative: '#ef4444',
  };

  return (
    <div className={styles.page}>
      <div className={styles.currentModel}>
        当前模型: {provider} / {modelName}
      </div>

      <h1 className={styles.title}>影评情感分析</h1>

      <div className={styles.inputSection}>
        <textarea
          className={styles.textarea}
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="请输入一段电影评论..."
          rows={5}
          disabled={isLoading}
        />
        <button
          className={styles.analyzeButton}
          onClick={handleAnalyze}
          disabled={!review.trim() || isLoading}
        >
          {isLoading ? '分析中...' : '开始分析'}
        </button>
      </div>

      {error && (
        <div className={styles.error}>{error}</div>
      )}

      {result && (
        <div className={styles.result}>
          <div className={styles.scoreSection}>
            <span className={styles.label}>评分</span>
            <span className={styles.score}>{result.score}</span>
            <span className={styles.scoreMax}>/10</span>
          </div>

          <div className={styles.sentimentSection}>
            <span className={styles.label}>情感倾向</span>
            <span
              className={styles.sentimentBadge}
              style={{ backgroundColor: sentimentColors[result.sentiment] }}
            >
              {sentimentLabels[result.sentiment]}
            </span>
          </div>

          <div className={styles.keywordsSection}>
            <span className={styles.label}>关键词</span>
            <div className={styles.keywords}>
              {result.keywords.map((kw, i) => (
                <span key={i} className={styles.keyword}>{kw}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
