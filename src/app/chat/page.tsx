// 访问 /chat 时，自动创建新会话并重定向到 /chat/[id]
import { redirect } from 'next/navigation';
import { createChat } from '@/util/chat-store';

export default async function ChatPage() {
  const id = await createChat();
  redirect(`/chat/${id}`);
}
