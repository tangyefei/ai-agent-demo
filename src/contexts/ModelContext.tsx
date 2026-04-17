"use client";

/**
 * ModelContext - 全局模型选择上下文
 *
 * 功能：提供跨页面的 provider 和 model 状态共享
 * - 所有页面共享同一份 provider/model 选择
 * - 选择自动保存到 localStorage
 * - Provider 切换时自动设置默认 model
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// ============================================================
// 类型定义
// ============================================================

type Provider = "openai" | "ollama" | "anthropic";

interface ModelContextValue {
  provider: Provider;
  modelName: string;
  setProvider: (provider: Provider) => void;
  setModelName: (model: string) => void;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_PROVIDER: Provider = "openai";
const DEFAULT_MODEL = "MiniMax-M2.7";

const OLLAMA_DEFAULT_MODEL = "llama3.1:latest";

// ============================================================
// Context 创建
// ============================================================

const ModelContext = createContext<ModelContextValue>({
  provider: DEFAULT_PROVIDER,
  modelName: DEFAULT_MODEL,
  setProvider: () => {},
  setModelName: () => {},
});

// ============================================================
// Provider 组件
// ============================================================

export function ModelProvider({ children }: { children: ReactNode }) {
  const [provider, setProviderState] = useState<Provider>(DEFAULT_PROVIDER);
  const [modelName, setModelNameState] = useState(DEFAULT_MODEL);

  // 初始化：从 localStorage 读取保存的值
  useEffect(() => {
    const savedProvider = localStorage.getItem("provider") as Provider;
    const savedModel = localStorage.getItem("modelName");

    if (savedProvider) {
      setProviderState(savedProvider);
    }
    if (savedModel) {
      setModelNameState(savedModel);
    }
  }, []);

  // 保存到 localStorage
  useEffect(() => {
    localStorage.setItem("provider", provider);
    localStorage.setItem("modelName", modelName);
  }, [provider, modelName]);

  // Provider 切换时自动设置默认 model
  const setProvider = (newProvider: Provider) => {
    setProviderState(newProvider);
    if (newProvider === "ollama") {
      setModelNameState(OLLAMA_DEFAULT_MODEL);
    } else if (newProvider === "anthropic") {
      setModelNameState(DEFAULT_MODEL);
    } else {
      setModelNameState(DEFAULT_MODEL);
    }
  };

  const setModelName = (newModel: string) => {
    setModelNameState(newModel);
  };

  return (
    <ModelContext.Provider value={{ provider, modelName, setProvider, setModelName }}>
      {children}
    </ModelContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useModel() {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error("useModel must be used within a ModelProvider");
  }
  return context;
}
