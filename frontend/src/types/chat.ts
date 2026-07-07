// Backend yanıtlarında kullanılan ortak domain tipleri burada tutulur.
export interface Message {
  id: string;
  content: string;
  senderId: string;
  sender?: { username: string };
  readByIds?: string[];
  conversationId: string;
  conversation?: any;
  createdAt?: string;
  isPinned?: boolean;
  isForwarded?: boolean;
  starredByIds?: string[];
  deletedForIds?: string[];
  replyToId?: string;
  replyTo?: any;
  clientId?: string;
  fileKey?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  editedAt?: string;
  expiresAt?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  readReceiptsOn?: boolean;
  avatarFileKey?: string;
  avatarUrl?: string;
  lastSeenAt?: string;
  isOnline?: boolean;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name?: string;
  adminId?: string;
  createdAt?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isMuted?: boolean;
  disappearingDurationSeconds?: number | null;
  otherUser?: User | null;
  lastMessage?: Message | null;
}
