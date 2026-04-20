// 服务端加载历史消息，传递给客户端 ChatUI 组件
import { loadChat } from '@/util/chat-store';
import ChatUI from '@/components/ChatUI';

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialMessages = await loadChat(id);

  return <ChatUI id={id} initialMessages={initialMessages} />;
}
