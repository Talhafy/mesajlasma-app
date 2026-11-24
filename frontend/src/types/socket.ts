import type { Socket } from 'socket.io-client';
import type { Message, User, Conversation } from './chat';
import type { SyncedHistoryCopy } from '../crypto/accountHistory';

export interface ClientToServerEvents {
  'auth:refresh': (payload: { token: string }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  client_activity: () => void;
  odaya_katil: (conversationId: string, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  typing_changed: (payload: { conversationId: string; isTyping: boolean }) => void;
  voice_recording_changed: (payload: { conversationId: string; isRecording: boolean }) => void;
  'call:invite': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video'; mlsEpoch: number }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:accepted': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:declined': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:ended': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
}

export interface ServerToClientEvents {
  'auth:expired': () => void;
  'auth:session-revoked': (payload: { reason: string }) => void;
  profile_changed: () => void;
  presence_snapshot: (payload: { onlineUserIds: string[] }) => void;
  presence_changed: (payload: { userId: string; isOnline: boolean; lastSeenAt?: string | null }) => void;
  typing_changed: (payload: { conversationId: string; userId: string; username: string; isTyping: boolean }) => void;
  voice_recording_changed: (payload: { conversationId: string; userId: string; username: string; isRecording: boolean }) => void;
  'call:incoming': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video'; mlsEpoch: number; isGroup: boolean; conversationName: string | null; caller: { id: string; username: string } }) => void;
  'call:accepted': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video'; user: { id: string; username: string } }) => void;
  'call:declined': (payload: { callId: string; user?: { username?: string } }) => void;
  'call:ended': (payload: { callId: string }) => void;
  yeni_mesaj_geldi: (message: Message) => void;
  mesajlar_okundu: (payload: { conversationId: string; readByUserId: string; readThroughAt: string }) => void;
  mesaj_guncellendi: (message: Message) => void;
  mesaj_silindi: (payload: { messageId: string; conversationId: string }) => void;
  sohbet_gecmisi_silindi: (payload: { conversationId: string }) => void;
  sohbet_gecmisi_temizlendi: (payload: { conversationId: string; clearedAt: string }) => void;
  account_history_synced: (copies: SyncedHistoryCopy[]) => void;
  account_history_repaired: (event: { messageId: string; conversationId: string; historyDelivery: NonNullable<Message['historyDelivery']> }) => void;
  sohbet_ayarlari_guncellendi: (payload: { conversationId: string; disappearingDurationSeconds: number | null }) => void;
  user_blocked_you: (payload: { blockerId: string }) => void;
  user_unblocked_you: (payload: { blockerId: string }) => void;
  user_blocked_target: (payload: { targetId: string }) => void;
  user_unblocked_target: (payload: { targetId: string }) => void;
  user_directory_changed: () => void;
  grup_olusturuldu: (group: Conversation) => void;
  grup_guncellendi: (group: Conversation) => void;
  yeni_grup_bildirimi: () => void;
  gruptan_atildi: (payload: { groupId: string; removedUserId: string; removedById?: string; leftAt: string }) => void;
  grup_yonetici_degisti: (payload: { groupId: string; newAdminId: string }) => void;
  grup_uyeleri_eklendi: (payload: { groupId: string; newMembers: User[] }) => void;
  grup_silindi: (payload: { groupId: string }) => void;
  kullanici_silindi: (payload: {
    userId: string;
    conversationIds: string[];
    deletedGroupIds: string[];
    updatedGroups: Array<{ groupId: string; removedUserId: string; newAdminId: string | null }>;
  }) => void;
  // MLS (RFC 9420) E2EE gerçek zamanlı senkronizasyon olayları
  'mls:commit': (payload: {
    id: string;
    conversationId: string;
    epoch: number;
    senderDeviceId: string;
    commitData: string;
    ratchetTree?: string | null;
    createdAt?: string;
  }) => void;
  'mls:welcome': (payload: {
    conversationId: string;
    epoch: number;
    recipientDeviceId: string;
    welcomeData: string;
    ratchetTree?: string | null;
  }) => void;
  'mls:key_package_low': (payload: { deviceId: string; remainingCount: number }) => void;
  'mls:device_registered': (payload: {
    userId: string;
    device: { id: string; deviceName: string; signaturePublicKey: string; createdAt: string };
  }) => void;
  'mls:device_approved': (payload: { userId: string; deviceId: string; conversationIds: string[] }) => void;
  'mls:device_revoked': (payload: {
    userId: string;
    deviceId: string;
    conversationIds?: string[];
  }) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
