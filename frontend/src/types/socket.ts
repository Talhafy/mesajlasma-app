import type { Socket } from 'socket.io-client';
import type { Message, User, Conversation, GameChannel } from './chat';

export interface ClientToServerEvents {
  client_activity: () => void;
  'game:voice-presence-snapshot': (groupId: string) => void;
  'game:voice-presence': (payload: { action: 'join' | 'leave'; conversationId: string; channelId: string }) => void;
  'game:voice-speaking': (payload: { channelId: string; isSpeaking: boolean }) => void;
  odaya_katil: (conversationId: string, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  typing_changed: (payload: { conversationId: string; isTyping: boolean; gameChannelId?: string | null }) => void;
  voice_recording_changed: (payload: { conversationId: string; isRecording: boolean }) => void;
  'call:invite': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:accepted': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:declined': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
  'call:ended': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video' }, acknowledge?: (result: { ok: boolean; error?: string }) => void) => void;
}

export interface ServerToClientEvents {
  presence_snapshot: (payload: { onlineUserIds: string[] }) => void;
  presence_changed: (payload: { userId: string; isOnline: boolean; lastSeenAt?: string | null }) => void;
  'game:voice-presence-snapshot': (payload: { groupId: string; presences: Array<{ conversationId: string; channelId: string; userId: string; username: string; isSpeaking: boolean }> }) => void;
  'game:voice-presence-joined': (payload: { conversationId: string; channelId: string; userId: string; username: string; isSpeaking: boolean }) => void;
  'game:voice-presence-left': (payload: { conversationId: string; channelId: string; userId: string }) => void;
  'game:voice-speaking': (payload: { conversationId: string; channelId: string; userId: string; isSpeaking: boolean }) => void;
  typing_changed: (payload: { conversationId: string; userId: string; username: string; isTyping: boolean; gameChannelId: string | null }) => void;
  voice_recording_changed: (payload: { conversationId: string; userId: string; username: string; isRecording: boolean }) => void;
  'call:incoming': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video'; isGroup: boolean; conversationName: string | null; caller: { id: string; username: string } }) => void;
  'call:accepted': (payload: { conversationId: string; callId: string; callType: 'audio' | 'video'; user: { id: string; username: string } }) => void;
  'call:declined': (payload: { callId: string; user?: { username?: string } }) => void;
  'call:ended': (payload: { callId: string }) => void;
  yeni_mesaj_geldi: (message: Message) => void;
  mesajlar_okundu: (payload: { conversationId: string; readByUserId: string }) => void;
  mesaj_guncellendi: (message: Message) => void;
  mesaj_silindi: (payload: { messageId: string; conversationId: string }) => void;
  sohbet_ayarlari_guncellendi: (payload: { conversationId: string; disappearingDurationSeconds: number | null }) => void;
  user_blocked_you: (payload: { blockerId: string }) => void;
  user_unblocked_you: (payload: { blockerId: string }) => void;
  user_blocked_target: (payload: { targetId: string }) => void;
  user_unblocked_target: (payload: { targetId: string }) => void;
  kullanici_eklendi: (user: User) => void;
  grup_olusturuldu: (group: Conversation) => void;
  grup_guncellendi: (group: Conversation) => void;
  yeni_grup_bildirimi: () => void;
  gruptan_atildi: (payload: { groupId: string; removedUserId: string; removedById?: string }) => void;
  grup_yonetici_degisti: (payload: { groupId: string; newAdminId: string }) => void;
  grup_uyeleri_eklendi: (payload: { groupId: string; newMembers: User[] }) => void;
  grup_silindi: (payload: { groupId: string }) => void;
  kullanici_silindi: (payload: {
    userId: string;
    conversationIds: string[];
    deletedGroupIds: string[];
    updatedGroups: Array<{ groupId: string; removedUserId: string; newAdminId: string | null }>;
  }) => void;
  'game:message': (message: Message) => void;
  'game:channel-created': (channel: GameChannel) => void;
  'game:channel-updated': (channel: GameChannel) => void;
  'game:channels-reordered': (payload: { groupId: string; channels: GameChannel[] }) => void;
  'game:channel-deleted': (payload: { channelId: string; groupId: string }) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
