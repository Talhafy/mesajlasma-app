import { describe, expect, it } from 'vitest';
import type { Server } from 'socket.io';
import {
  checkDistributedSocketRateLimit,
  getConversationVoicePresences,
  getOnlineUserIds,
  joinVoicePresence,
  leaveVoicePresence,
  markUserOfflineIfDisconnected,
  markUserOnline,
  setVoiceSpeaking
} from '../../src/socket/realtimeState';

describe('single-instance realtime fallback', () => {
  it('tracks multi-tab online presence until the final socket disconnects', async () => {
    const userId = 'realtime-user-presence';
    expect(await markUserOnline(userId, 'presence-socket-1')).toBe(true);
    expect(await markUserOnline(userId, 'presence-socket-2')).toBe(false);
    expect(await getOnlineUserIds()).toContain(userId);

    expect(await markUserOfflineIfDisconnected({} as Server, userId, 'presence-socket-1')).toBe(false);
    expect(await markUserOfflineIfDisconnected({} as Server, userId, 'presence-socket-2')).toBe(true);
    expect(await getOnlineUserIds()).not.toContain(userId);
  });

  it('applies a per-user socket event rate limit', async () => {
    const userId = 'realtime-user-rate';
    expect(await checkDistributedSocketRateLimit(userId, 'typing_changed', 2)).toBe(true);
    expect(await checkDistributedSocketRateLimit(userId, 'typing_changed', 2)).toBe(true);
    expect(await checkDistributedSocketRateLimit(userId, 'typing_changed', 2)).toBe(false);
  });

  it('keeps voice state per socket while exposing one presence per user', async () => {
    const presence = {
      conversationId: 'realtime-conversation',
      channelId: 'realtime-channel',
      userId: 'realtime-user-voice',
      username: 'talha',
      isSpeaking: false
    };

    expect(await joinVoicePresence('voice-socket-1', presence, 10_000)).toBe(true);
    expect(await joinVoicePresence('voice-socket-2', presence, 10_000)).toBe(false);
    expect(await getConversationVoicePresences(presence.conversationId)).toEqual([presence]);

    expect(await setVoiceSpeaking('voice-socket-1', true, 10_000)).toMatchObject({ isSpeaking: true });
    expect((await getConversationVoicePresences(presence.conversationId))[0]).toMatchObject({ isSpeaking: true });

    expect(await leaveVoicePresence('voice-socket-1', presence)).toBe(false);
    expect(await leaveVoicePresence('voice-socket-2', presence)).toBe(true);
    expect(await getConversationVoicePresences(presence.conversationId)).toEqual([]);
  });
});
