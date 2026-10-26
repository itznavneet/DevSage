import { api } from "./api";

export type MessageRole = "USER" | "ASSISTANT";

export interface Conversation {
  id: string;
  title: string | null;
  userId: string;
  repositoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  sources: unknown;
  createdAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[];
}

export async function getConversations(repositoryId: string) {
  const response = await api.get<{ conversations: Conversation[] }>(
    `/api/repositories/${encodeURIComponent(repositoryId)}/conversations`,
  );
  return response.data.conversations;
}

export async function createConversation(repositoryId: string, title?: string) {
  const response = await api.post<{ conversation: Conversation }>(
    `/api/repositories/${encodeURIComponent(repositoryId)}/conversations`,
    title ? { title } : {},
  );
  return response.data.conversation;
}

export async function getConversation(conversationId: string) {
  const response = await api.get<{ conversation: ConversationWithMessages }>(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  );
  return response.data.conversation;
}

export async function deleteConversation(conversationId: string) {
  await api.delete(`/api/conversations/${encodeURIComponent(conversationId)}`);
}

export async function saveMessage(
  conversationId: string,
  message: { role: MessageRole; content: string; sources?: unknown },
) {
  const response = await api.post<{ message: ConversationMessage }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    message,
  );
  return response.data.message;
}
