// ============================================================
// 会话存储工具（Neon Postgres 实现）
//
// 迁移自文件系统实现。接口签名保持不变，调用方无需修改。
//
// 环境变量（在 .env.local 中配置）：
//   POSTGRES_URL             — 连接池 URL，日常读写
//   POSTGRES_URL_NON_POOLING — 非连接池 URL，DDL 建表
//
// 表结构（首次调用时自动建表）：
//   chats(id VARCHAR PRIMARY KEY, messages JSONB, created_at, updated_at)
// ============================================================

import { generateId } from 'ai';
import type { UIMessage } from 'ai';
import { neon } from '@neondatabase/serverless';

// ─── 数据库连接 ──────────────────────────────────────────────

/**
 * 获取连接池 SQL 执行器（日常读写用）。
 * 使用函数懒加载，避免模块初始化时 env 变量尚未注入（如 Next.js 的 Edge 场景）。
 */
function getDb() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error('POSTGRES_URL 环境变量未配置');
  return neon(url);
}

/**
 * 获取非连接池 SQL 执行器（DDL 建表用）。
 * 非连接池版本支持 CREATE TABLE 等需要 SET search_path 的语句。
 * 若未配置则回退到连接池 URL。
 */
function getDbDirect() {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('POSTGRES_URL 环境变量未配置');
  return neon(url);
}

// ─── 表初始化 ────────────────────────────────────────────────

/** 幂等建表：第一次调用时创建 chats 表，后续调用直接跳过 */
let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const sql = getDbDirect();
  await sql`
    CREATE TABLE IF NOT EXISTS chats (
      id         VARCHAR(128) PRIMARY KEY,
      messages   JSONB        NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `;
  tableEnsured = true;
}

// ─── 公开接口 ────────────────────────────────────────────────

/** 创建新会话，返回唯一 ID */
export async function createChat(): Promise<string> {
  await ensureTable();
  const id = generateId();
  console.log('[chat-store] createChat:', id);
  const sql = getDb();
  await sql`INSERT INTO chats (id) VALUES (${id})`;
  return id;
}

/** 加载已有会话的消息列表，会话不存在时返回空数组 */
export async function loadChat(id: string): Promise<UIMessage[]> {
  await ensureTable();
  console.log('[chat-store] loadChat:', id);
  const sql = getDb();
  const rows = await sql`SELECT messages FROM chats WHERE id = ${id}`;
  console.log('[chat-store] loadChat result:', rows.length, 'rows');
  return ((rows[0] as { messages?: UIMessage[] } | undefined)?.messages ?? []) as UIMessage[];
}

/** 持久化会话消息（覆盖写入，含 AI 回复后的完整列表） */
export async function saveChat(id: string, messages: UIMessage[]): Promise<void> {
  console.log('[chat-store] saveChat:', id, messages.length, 'messages');
  const sql = getDb();
  // UPSERT：id 不存在时 INSERT，存在时 UPDATE
  await sql`
    INSERT INTO chats (id, messages, created_at, updated_at)
    VALUES (${id}, ${JSON.stringify(messages)}::jsonb, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      messages   = EXCLUDED.messages,
      updated_at = NOW()
  `;
  console.log('[chat-store] saveChat done');
}
