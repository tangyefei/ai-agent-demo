"use client";

/**
 * StreamingTable 组件：流式表格生成器
 *
 * 功能：用户点击"生成表格"按钮后，通过 AI 模型生成表格数据，
 *       数据以"逐行动画"的方式呈现在表格中（模拟流式效果）。
 *
 * 调用路径：
 *   用户点击按钮 → fetch("/api/table-generate") → 后端调用 AI 模型
 *   → 读取响应流 → JSON.parse → 逐行 setRows（每行间隔 100ms）
 *
 * 注意：由于 MiniMax 等第三方模型不支持 streamObject 的 partialObjectStream，
 *       后端使用 streamText 一次性生成完整 JSON，前端通过 setTimeout 模拟流式效果。
 */

import { useState, useRef, useEffect } from "react";
import { z } from "zod";

// ============================================================
// Schema 定义：使用 Zod 定义表格行的数据结构
// ============================================================

/**
 * 表格行 Schema
 * - id: 商品ID，从1开始递增
 * - name: 商品名称
 * - category: 商品类别（电子产品、服装、食品等）
 * - price: 价格（数字）
 * - stock: 库存数量
 * - status: 状态枚举（有货/缺货/预售中）
 */
const TableRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  stock: z.number(),
  status: z.enum(["有货", "缺货", "预售中"]),
});

/** 默认提示词，用于生成10条商品数据 */
const DEFAULT_PROMPT = "生成一个包含10条商品数据的表格，数据要有创意，包含电子产品、服装、食品等不同类别。";

// ============================================================
// Props 类型定义
// ============================================================

interface StreamingTableProps {
  /** 生成表格的提示词 */
  prompt?: string;
  /** 模型提供商：openai(MiniMax)、anthropic 或 ollama */
  provider?: "openai" | "ollama" | "anthropic";
  /** 模型名称，如 MiniMax-M2.7 或 llama3.1:latest */
  modelName?: string;
}

// ============================================================
// 组件主函数
// ============================================================

export default function StreamingTable({
  prompt = DEFAULT_PROMPT,
  provider = "openai",
  modelName = "MiniMax-M2.7",
}: StreamingTableProps) {
  // ---------- 状态管理 ----------
  const [rows, setRows] = useState<z.infer<typeof TableRowSchema>[]>([]); // 表格数据行
  const [isGenerating, setIsGenerating] = useState(false); // 是否正在生成
  const [error, setError] = useState<string | null>(null); // 错误信息

  // ---------- Refs ----------
  const tableEndRef = useRef<HTMLDivElement>(null); // 表格底部引用，用于滚动到底部
  const abortControllerRef = useRef<AbortController | null>(null); // 中断控制器，用于取消请求

  // ---------- 副作用：自动滚动到底部 ----------
  /**
   * 当 rows 变化时，自动滚动到表格底部
   * 这样新行出现时，用户可以看到最新的内容
   */
  useEffect(() => {
    tableEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rows]);

  // ============================================================
  // 生成表格数据
  // ============================================================

  /**
   * 点击"生成表格"按钮后调用此函数
   *
   * 流程：
   * 1. 调用后端 API /api/table-generate
   * 2. 读取响应体（JSON 格式）
   * 3. 逐行添加到表格中（每行间隔 100ms，模拟流式效果）
   */
  async function handleGenerate() {
    // 防止重复点击
    if (isGenerating) return;

    // 重置状态
    setRows([]);
    setError(null);
    setIsGenerating(true);

    // 创建 AbortController，用于用户点击"停止"按钮时取消请求
    abortControllerRef.current = new AbortController();

    try {
      // ---------- 调用后端 API ----------
      const response = await fetch("/api/table-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider, modelName }),
        signal: abortControllerRef.current.signal, // 关联 AbortController
      });

      // ---------- 检查响应状态 ----------
      if (!response.ok) {
        // 尝试解析错误信息
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `请求失败: ${response.status}`);
      }

      // ---------- 读取响应体流 ----------
      /**
       * response.body 是 ReadableStream<Uint8Array> 类型
       * 表示响应体是一个可读的字节流
       */
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("无法读取响应流");
      }

      // ---------- 流式读取响应内容 ----------
      const decoder = new TextDecoder(); // 将 Uint8Array 转换为字符串
      let buffer = ""; // 缓冲区，存储已读取但尚未处理的文本

      // 循环读取直到流结束
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 流已结束，退出循环
          break;
        }

        /**
         * decoder.decode() 将字节流解码为字符串
         * { stream: true } 表示这是流式解码，允许处理不完整的 UTF-8 字符
         */
        buffer += decoder.decode(value, { stream: true });
      }

      console.log('[DEBUG] Received buffer:', buffer);

      // ---------- 解析 JSON 并逐行显示 ----------
      const data = JSON.parse(buffer);

      if (data.rows) {
        // 遍历每一行数据
        for (const row of data.rows) {
          /**
           * setTimeout 间隔 100ms，实现"逐行动画"效果
           * 每次 setRows 会触发 React 重新渲染
           */
          setRows(prev => [...prev, row]);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else if (data.error) {
        // 后端返回了错误信息
        setError(data.error);
      }
    } catch (err) {
      // ---------- 错误处理 ----------
      if (err instanceof Error && err.name === "AbortError") {
        // 用户主动取消请求
        setError("请求已取消");
      } else {
        // 其他错误
        setError(err instanceof Error ? err.message : "生成失败");
      }
    } finally {
      // 无论成功还是失败，都要重置生成状态
      setIsGenerating(false);
    }
  }

  // ============================================================
  // 停止生成
  // ============================================================

  /**
   * 点击"停止"按钮时调用
   * 通过 AbortController 中断 fetch 请求
   */
  function handleStop() {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
  }

  // ============================================================
  // 渲染 UI
  // ============================================================

  return (
    <div style={styles.container}>
      {/* ---------- 头部：标题 + 操作按钮 ---------- */}
      <div style={styles.header}>
        <h3 style={styles.title}>流式表格生成器</h3>

        {/* 根据状态显示"生成"或"停止"按钮 */}
        {isGenerating ? (
          <button onClick={handleStop} style={styles.stopButton}>
            停止
          </button>
        ) : (
          <button onClick={handleGenerate} style={styles.generateButton}>
            生成表格
          </button>
        )}
      </div>

      {/* ---------- 错误提示 ---------- */}
      {error && <div style={styles.error}>{error}</div>}

      {/* ---------- 表格 ---------- */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          {/* 表头 */}
          <thead>
            <tr style={styles.theadRow}>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>商品名称</th>
              <th style={styles.th}>类别</th>
              <th style={styles.th}>价格</th>
              <th style={styles.th}>库存</th>
              <th style={styles.th}>状态</th>
            </tr>
          </thead>

          {/* 表体 */}
          <tbody>
            {/* 渲染所有数据行 */}
            {rows.map((row) => (
              <tr key={row.id} style={styles.tbodyRow}>
                <td style={styles.td}>{row.id}</td>
                <td style={styles.td}>{row.name}</td>
                <td style={styles.td}>{row.category}</td>
                {/* 价格格式化：保留两位小数 */}
                <td style={styles.td}>¥{row.price.toFixed(2)}</td>
                <td style={styles.td}>{row.stock}</td>
                {/* 状态标签：根据状态显示不同颜色 */}
                <td style={styles.td}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      backgroundColor:
                        row.status === "有货"
                          ? "#d4edda"
                          : row.status === "缺货"
                          ? "#f8d7da"
                          : "#fff3cd",
                      color:
                        row.status === "有货"
                          ? "#155724"
                          : row.status === "缺货"
                          ? "#721c24"
                          : "#856404",
                    }}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}

            {/* 加载中提示 */}
            {isGenerating && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ ...styles.td, textAlign: "center", color: "#999" }}
                >
                  等待生成数据...
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 滚动锚点 */}
        <div ref={tableEndRef} />
      </div>

      {/* ---------- 动画样式 ---------- */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// 样式定义
// ============================================================

/**
 * 内联样式对象
 * 使用 Record<string, React.CSSProperties> 类型确保类型安全
 */
const styles: Record<string, React.CSSProperties> = {
  // ---------- 容器 ----------
  container: {
    padding: "20px",
    maxWidth: "1620px",
    margin: "0 auto",
  },

  // ---------- 头部 ----------
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    margin: 0,
  },

  // ---------- 按钮 ----------
  generateButton: {
    padding: "10px 20px",
    backgroundColor: "#007aff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    cursor: "pointer",
  },
  stopButton: {
    padding: "10px 20px",
    backgroundColor: "#ff3b30",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    cursor: "pointer",
  },

  // ---------- 错误提示 ----------
  error: {
    padding: "12px",
    backgroundColor: "#fff2f0",
    border: "1px solid #ffccc7",
    borderRadius: "8px",
    color: "#cf1322",
    marginBottom: "16px",
    fontSize: "14px",
  },

  // ---------- 表格容器 ----------
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #e5e5e5",
    borderRadius: "8px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
  },

  // ---------- 表头 ----------
  theadRow: {
    backgroundColor: "#f6f8fa",
  },
  th: {
    padding: "12px 16px",
    textAlign: "left",
    fontWeight: 600,
    borderBottom: "1px solid #e5e5e5",
  },

  // ---------- 表体行 ----------
  tbodyRow: {
    animation: "fadeIn 0.3s ease-out", // 淡入动画
  },
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e5e5",
  },

  // ---------- 状态标签 ----------
  statusBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 500,
  },
};
