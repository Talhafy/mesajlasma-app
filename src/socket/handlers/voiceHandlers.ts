/**
 * ============================================================================
 * SES KANALLARI SOKET DİNLENİCİLERİ (Voice Presence Socket Handlers)
 * ============================================================================
 * 
 * Bu modül; oyun gruplarındaki ses kanallarına katılım, ayrılma ve konuşuyor
 * (`isSpeaking`) durumlarını Socket.IO üzerinden takip eder.
 */

import { Socket } from 'socket.io';
import prisma from '../../db';
import { requireActiveParticipant } from '../../services/conversationAccess';
import {
  checkDistributedSocketRateLimit,
  getConversationVoicePresences,
  joinVoicePresence,
  leaveVoicePresence,
  setVoiceSpeaking
} from '../realtimeState';
import type { SocketUser } from './chatHandlers';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const registerVoiceSocketHandlers = (
  socket: Socket,
  currentUser: SocketUser,
  resetInactivityTimer: () => void,
  remainingSessionMs: () => number,
  activeVoicePresenceRef: { current: { conversationId: string; channelId: string } | null }
) => {
  /** Kullanıcıyı ses kanalından güvenle çıkaran yardımcı */
  const leaveVoiceChannel = async () => {
    if (!activeVoicePresenceRef.current) return;
    const { conversationId, channelId } = activeVoicePresenceRef.current;
    const userLeftChannel = await leaveVoicePresence(socket.id, {
      conversationId,
      channelId,
      userId: currentUser.userId
    });
    if (userLeftChannel) {
      socket.to(conversationId).emit('game:voice-presence-left', { conversationId, channelId, userId: currentUser.userId });
    }
    activeVoicePresenceRef.current = null;
  };

  // OYUN GRUBU SES VARLIĞI ANLIK GÖRÜNTÜSÜ (Voice Presence Snapshot)
  socket.on('game:voice-presence-snapshot', async (groupId: unknown) => {
    if (typeof groupId !== 'string' || !uuidPattern.test(groupId)) return;
    const membership = await requireActiveParticipant(groupId, currentUser.userId).catch(() => null);
    if (!membership) return;
    socket.emit('game:voice-presence-snapshot', {
      groupId,
      presences: await getConversationVoicePresences(groupId)
    });
  });

  // OYUN GRUBU SES KANALINA KATILMA / AYRILMA (Voice Presence Join/Leave)
  socket.on('game:voice-presence', async (payload: unknown) => {
    resetInactivityTimer();
    if (!await checkDistributedSocketRateLimit(currentUser.userId, 'game:voice-presence', 3) || !payload || typeof payload !== 'object') return;
    const { action, conversationId, channelId } = payload as { action?: unknown; conversationId?: unknown; channelId?: unknown };
    if (action === 'leave') {
      if (typeof channelId === 'string' && activeVoicePresenceRef.current?.channelId !== channelId) return;
      await leaveVoiceChannel();
      return;
    }
    if (action !== 'join' || typeof conversationId !== 'string' || typeof channelId !== 'string' || !uuidPattern.test(conversationId) || !uuidPattern.test(channelId)) return;
    const membership = await requireActiveParticipant(conversationId, currentUser.userId).catch(() => null);
    if (!membership) return;
    const channel = await prisma.gameChannel.findFirst({
      where: { id: channelId, conversationId, type: 'VOICE', conversation: { isGroup: true, isDeleted: false } },
      select: { id: true }
    });
    if (!channel) return;
    if (activeVoicePresenceRef.current?.channelId === channelId && activeVoicePresenceRef.current.conversationId === conversationId) return;
    await leaveVoiceChannel();
    const becamePresent = await joinVoicePresence(socket.id, {
      conversationId,
      channelId,
      userId: currentUser.userId,
      username: currentUser.username,
      isSpeaking: false
    }, remainingSessionMs());
    if (becamePresent) {
      socket.to(conversationId).emit('game:voice-presence-joined', { conversationId, channelId, userId: currentUser.userId, username: currentUser.username, isSpeaking: false });
    }
    activeVoicePresenceRef.current = { conversationId, channelId };
  });

  // SES KANALINDA KONUŞUYOR BİLGİSİ (Voice Speaking Indicator)
  socket.on('game:voice-speaking', async (payload: unknown) => {
    if (!await checkDistributedSocketRateLimit(currentUser.userId, 'game:voice-speaking', 5) || !payload || typeof payload !== 'object' || !activeVoicePresenceRef.current) return;
    const { channelId, isSpeaking } = payload as { channelId?: unknown; isSpeaking?: unknown };
    if (channelId !== activeVoicePresenceRef.current.channelId || typeof isSpeaking !== 'boolean') return;
    const membership = await requireActiveParticipant(
      activeVoicePresenceRef.current.conversationId,
      currentUser.userId
    ).catch(() => null);
    if (!membership) {
      await leaveVoiceChannel();
      return;
    }
    const presence = await setVoiceSpeaking(socket.id, isSpeaking, remainingSessionMs());
    if (!presence) return;
    socket.to(activeVoicePresenceRef.current.conversationId).emit('game:voice-speaking', {
      conversationId: activeVoicePresenceRef.current.conversationId,
      channelId: activeVoicePresenceRef.current.channelId,
      userId: currentUser.userId,
      isSpeaking
    });
  });

  return { leaveVoiceChannel };
};
