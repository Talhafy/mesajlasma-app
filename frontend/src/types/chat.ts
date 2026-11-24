// Backend yanıtlarında kullanılan ortak domain tipleri burada tutulur.
export interface Message {
  id: string;
  content: string;
  senderId: string;
  sender?: { username: string };
  readByIds?: string[];
  groupRecipientIds?: string[];
  conversationId: string;
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
  // MLS (RFC 9420) E2EE alanları
  protocolVersion?: number;
  epoch?: number | null;
  senderDeviceId?: string | null;
  ciphertext?: string | null;
  encryptedFileMetadata?: string | null;
  messageType?: string;
  isDeletedForEveryone?: boolean;
  isLocalGroupHistory?: boolean;
  isPriorMembershipMessage?: boolean;
  archivedFileAvailable?: boolean;
  decryptionPending?: boolean;
  accountHistoryCopy?: { version: string; iv: string; payload: string };
  historyDelivery?: {
    version: string;
    iv: string;
    payload: string;
    target: string;
    signature: string;
    signer: string;
    vaultOnly?: boolean;
    key?: string;
    keys?: Record<string, string>;
    deviceKeys?: Record<string, { userId: string; key: string }>;
  };
}

export interface User {
  id: string;
  username: string;
  // Public kullanıcı yanıtlarında e-posta gönderilmez; yalnızca oturum sahibinin profilinde bulunur.
  email?: string;
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
  mlsCurrentEpoch?: number;
  mlsGroupId?: string | null;
  isDeleted?: boolean;
  otherUser?: User | null;
  lastMessage?: Message | null;
  historyClearedAt?: string | null;
  participants?: Array<{ user: User }>;
}

export const isReadOnlyGroup = (conversation: Conversation | null | undefined): boolean =>
  Boolean(conversation?.isGroup && (conversation.isActive === false || conversation.isDeleted));
