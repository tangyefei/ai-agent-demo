// ============================================================
// 会话存储工具（文件系统实现，适用于本地开发）
// 生产环境建议替换为 Vercel Postgres 或 Upstash Redis
// ============================================================
import { generateId } from 'ai';
import type { UIMessage } from 'ai';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';

/** 获取会话文件路径，目录不存在时自动创建 */
function getChatFile(id: string): string {
  const chatDir = path.join(process.cwd(), '.chats');
  if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });
  return path.join(chatDir, `${id}.json`);
}

/** 创建新会话，返回唯一 ID */
export async function createChat(): Promise<string> {
  const id = generateId();
  await writeFile(getChatFile(id), '[]');
  return id;
}

/** 加载已有会话的消息列表，不存在时返回空数组 */
export async function loadChat(id: string): Promise<UIMessage[]> {
  try {
    const content = await readFile(getChatFile(id), 'utf8');
    return JSON.parse(content) as UIMessage[];
  } catch {
    return [];
  }
}

/** 持久化会话消息 */
export async function saveChat(id: string, messages: UIMessage[]): Promise<void> {
  await writeFile(getChatFile(id), JSON.stringify(messages, null, 2));
}
