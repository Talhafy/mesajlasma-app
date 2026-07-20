// Backend yanıtlarında kullanılan ortak domain tipleri burada tutulur.
export interface Message {
  id: string;
  content: string;
  senderId: string;
  sender?: { username: string };
  readByIds?: string[];
  conversationId: string;
  gameChannelId?: string | null;
  conversation?: Conversation;
  createdAt?: string;
  isPinned?: boolean;
  isForwarded?: boolean;
  starredByIds?: string[];
  deletedForIds?: string[];
  replyToId?: string;
  replyTo?: Message;
  clientId?: string;
  fileKey?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  editedAt?: string;
  expiresAt?: string;
  isOffline?: boolean;
}

export type GameChannelType = 'TEXT' | 'VOICE';

export interface GameChannel {
  id: string;
  conversationId: string;
  createdById: string;
  name: string;
  type: GameChannelType;
  position: number;
  maxParticipants?: number | null;
  createdAt: string;
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
  isBlocked?: boolean;
  blockedByOther?: boolean;
  isActive?: boolean;
  leftAt?: string | null;
  leftReason?: string | null;
  joinedAt?: string | null;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name?: string;
  adminId?: string;
  avatarFileKey?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isMuted?: boolean;
  isActive?: boolean;
  leftAt?: string | null;
  disappearingDurationSeconds?: number | null;
  isDeleted?: boolean;
  otherUser?: User | null;
  lastMessage?: Message | null;
  participants?: Array<{ user: User }>;
}

export interface ScheduledMessage {
  id: string;
  conversationId: string;
  clientId?: string;
  content: string;
  sendAt: string;
  fileKey?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  createdAt?: string;
}
