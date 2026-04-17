"use client";

/**
 * ModelSelector - 全局模型选择器组件
 *
 * 功能：在页面顶部提供 provider 和 model 的选择
 * - 使用全局 ModelContext 共享状态
 * - 选择自动保存到 localStorage
 */

import { useModel } from "@/contexts/ModelContext";
import styles from "./ModelSelector.module.css";

export default function ModelSelector() {
  const { provider, modelName, setProvider, setModelName } = useModel();

  return (
    <div className={styles.container}>
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value as "openai" | "ollama" | "anthropic")}
        className={styles.select}
      >
        <option value="openai">MiniMax (OpenAI)</option>
        <option value="anthropic">MiniMax (Anthropic)</option>
        <option value="ollama">Ollama</option>
      </select>

      <input
        type="text"
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
        placeholder="模型名称"
        className={styles.input}
      />
    </div>
  );
}
