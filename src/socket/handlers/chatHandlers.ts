/**
 * ============================================================================
 * SOHBET VE İÇERİK SOKET DİNLENİCİLERİ (Chat Socket Handlers)
 * ============================================================================
 * 
 * Bu modül; sohbet odalarına katılma (`odaya_katil`), yazıyor göstergeleri (`typing_changed`)
 * ve ses kaydı alınıyor göstergelerini (`voice_recording_changed`) yönetir.
 */

import { Socket } from 'socket.io';
import { logger } from '../../config/logger';
import prisma from '../../db';
import { requireActiveParticipant } from '../../services/conversationAccess';
import { checkDistributedSocketRateLimit } from '../realtimeState';

export interface SocketUser {
  userId: string;
  username: string;
  accessTokenExpiresAt: number;
}

export const registerChatSocketHandlers = (
  socket: Socket,
  currentUser: SocketUser,
  resetInactivityTimer: () => void
) => {
  // SOHBET ODASINA KATILMA (Join Conversation Room with Authorization Check)
  socket.on('odaya_katil', async (
    conversationId: unknown,
    acknowledge?: (result: { ok: boolean; error?: string }) => void
  ) => {
    resetInactivityTimer();
    if (!await checkDistributedSocketRateLimit(currentUser.userId, 'odaya_katil', 100)) {
      logger.warn({ event: 'security.socket_rate_limit', userId: currentUser.userId, eventName: 'odaya_katil' }, 'Socket event rate limit exceeded');
      acknowledge?.({ ok: false, error: 'Çok fazla istek gönderdiniz. Lütfen bekleyin.' });
      return;
    }

    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      acknowledge?.({ ok: false, error: 'Geçersiz sohbet kimliği.' });
      return;
    }

    const cleanId = conversationId.trim();
    try {
      if (cleanId === currentUser.userId) {
        await socket.join(cleanId);
        acknowledge?.({ ok: true });
        return;
      }

      // Katılımcılık doğrulaması yapılır
      const membership = await requireActiveParticipant(cleanId, currentUser.userId).catch(() => null);
      if (!membership) {
        logger.warn({ event: 'security.unauthorized_room_join', userId: currentUser.userId, roomId: cleanId }, 'Unauthorized room join attempt');
        acknowledge?.({ ok: false, error: 'Bu sohbet odasına katılma yetkiniz yok.' });
        return;
      }

      await socket.join(cleanId);
      acknowledge?.({ ok: true });
    } catch (error) {
      logger.error({ event: 'socket.room_join_failed', err: error, userId: currentUser.userId, roomId: conversationId }, 'Socket room join failed');
      acknowledge?.({ ok: false, error: 'Sohbet odasına katılınamadı.' });
    }
  });

  // YAZIYOR... GÖSTERGESİ (Typing Indicator)
  socket.on('typing_changed', async (payload: unknown) => {
    resetInactivityTimer();
    if (!await checkDistributedSocketRateLimit(currentUser.userId, 'typing_changed', 15)) {
      logger.warn({ event: 'security.socket_rate_limit', userId: currentUser.userId, eventName: 'typing_changed' }, 'Socket event rate limit exceeded');
      return;
    }

    if (!payload || typeof payload !== 'object') return;
    const { conversationId, gameChannelId, isTyping } = payload as { conversationId?: unknown; gameChannelId?: unknown; isTyping?: unknown };
    if (typeof conversationId !== 'string' || typeof isTyping !== 'boolean' || (gameChannelId !== undefined && gameChannelId !== null && typeof gameChannelId !== 'string')) return;

    try {
      const membership = await requireActiveParticipant(conversationId, currentUser.userId).catch(() => null);
      if (!membership) return;
      if (typeof gameChannelId === 'string') {
        const channel = await prisma.gameChannel.findFirst({ where: { id: gameChannelId, conversationId, type: 'TEXT' }, select: { id: true } });
        if (!channel) return;
      }

      socket.to(conversationId).emit('typing_changed', {
        conversationId,
        userId: currentUser.userId,
        username: currentUser.username,
        isTyping,
        gameChannelId: typeof gameChannelId === 'string' ? gameChannelId : null
      });
    } catch (error) {
      logger.error({ event: 'socket.typing_failed', err: error, userId: currentUser.userId, roomId: conversationId }, 'Typing state delivery failed');
    }
  });

  // SES KAYDI YAPILIYOR GÖSTERGESİ (Voice Recording Indicator)
  socket.on('voice_recording_changed', async (payload: unknown) => {
    resetInactivityTimer();
    if (!await checkDistributedSocketRateLimit(currentUser.userId, 'voice_recording_changed', 10)) {
      logger.warn({ event: 'security.socket_rate_limit', userId: currentUser.userId, eventName: 'voice_recording_changed' }, 'Socket event rate limit exceeded');
      return;
    }

    if (!payload || typeof payload !== 'object') return;
    const { conversationId, isRecording } = payload as { conversationId?: unknown; isRecording?: unknown };
    if (typeof conversationId !== 'string' || typeof isRecording !== 'boolean') return;

    try {
      const membership = await requireActiveParticipant(conversationId, currentUser.userId).catch(() => null);
      if (!membership) return;

      socket.to(conversationId).emit('voice_recording_changed', {
        conversationId,
        userId: currentUser.userId,
        username: currentUser.username,
        isRecording
      });
    } catch (error) {
      logger.error({ event: 'socket.voice_recording_failed', err: error, userId: currentUser.userId, roomId: conversationId }, 'Voice recording state delivery failed');
    }
  });
};
