/**
 * ============================================================================
 * WEBRTC SESLİ / GÖRÜNTÜLÜ ARAMA SOKET DİNLENİCİLERİ (Call Socket Handlers)
 * ============================================================================
 * 
 * Bu modül; WebRTC arama davetleri (`call:invite`), kabul etme (`call:accepted`),
 * reddetme (`call:declined`) ve sonlandırma (`call:ended`) sinyallerini yönetir.
 */

import { Server, Socket } from 'socket.io';
import { logger } from '../../config/logger';
import prisma from '../../db';
import { requireActiveParticipant } from '../../services/conversationAccess';
import type { SocketUser } from './chatHandlers';

type CallType = 'audio' | 'video';
type CallSignalStatus = 'accepted' | 'declined' | 'ended';

interface CallSignalPayload {
  conversationId?: unknown;
  callId?: unknown;
  callType?: unknown;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseCallPayload = (payload: unknown): { conversationId: string; callId: string; callType: CallType } | null => {
  if (!payload || typeof payload !== 'object') return null;
  const { conversationId, callId, callType } = payload as CallSignalPayload;

  if (
    typeof conversationId !== 'string' ||
    typeof callId !== 'string' ||
    !uuidPattern.test(conversationId) ||
    !uuidPattern.test(callId) ||
    (callType !== 'audio' && callType !== 'video')
  ) {
    return null;
  }

  return { conversationId, callId, callType };
};

export const registerCallSocketHandlers = (
  io: Server,
  socket: Socket,
  currentUser: SocketUser,
  resetInactivityTimer: () => void
) => {
  /** Çağrı yanıt/sonlandırma sinyali yayıcı dahili fonksiyon */
  const emitCallSignal = async (
    payload: unknown,
    status: CallSignalStatus,
    acknowledge?: (result: { ok: boolean; error?: string }) => void
  ) => {
    resetInactivityTimer();
    const call = parseCallPayload(payload);
    if (!call) {
      acknowledge?.({ ok: false, error: 'Geçersiz çağrı bilgisi.' });
      return;
    }

    try {
      const membership = await requireActiveParticipant(
        call.conversationId,
        currentUser.userId
      ).catch(() => null);
      if (!membership) {
        acknowledge?.({ ok: false, error: 'Bu sohbet için çağrı yetkiniz yok.' });
        return;
      }

      const participants = await prisma.participant.findMany({
        where: { conversationId: call.conversationId, isActive: true },
        select: { userId: true }
      });
      const targetUserIds = participants
        .map((participant) => participant.userId)
        .filter((userId) => userId !== currentUser.userId);

      const payloadBase = {
        conversationId: call.conversationId,
        callId: call.callId,
        callType: call.callType,
        user: {
          id: currentUser.userId,
          username: currentUser.username
        }
      };

      targetUserIds.forEach((userId) => {
        io.to(userId).emit(`call:${status}`, payloadBase);
      });

      logger.info({
        event: `call.${status}`,
        userId: currentUser.userId,
        conversationId: call.conversationId,
        callId: call.callId,
        callType: call.callType,
        targetCount: targetUserIds.length
      }, 'Call signal emitted');

      acknowledge?.({ ok: true });
    } catch (error) {
      logger.error({
        event: `call.${status}_failed`,
        err: error,
        userId: currentUser.userId,
        roomId: call.conversationId
      }, 'Call signal failed');
      acknowledge?.({ ok: false, error: 'Çağrı bildirimi iletilemedi.' });
    }
  };

  // WEBRTC ÇAĞRI BAŞLATMA / DAVET (Call Invite)
  socket.on('call:invite', async (
    payload: unknown,
    acknowledge?: (result: { ok: boolean; error?: string }) => void
  ) => {
    resetInactivityTimer();
    const call = parseCallPayload(payload);
    if (!call) {
      acknowledge?.({ ok: false, error: 'Geçersiz çağrı bilgisi.' });
      return;
    }

    try {
      const membership = await requireActiveParticipant(
        call.conversationId,
        currentUser.userId
      ).catch(() => null);
      if (!membership) {
        acknowledge?.({ ok: false, error: 'Bu sohbet için çağrı yetkiniz yok.' });
        return;
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: call.conversationId,
          isDeleted: false
        },
        select: {
          id: true,
          isGroup: true,
          name: true,
          participants: {
            where: { isActive: true },
            select: { userId: true }
          }
        }
      });
      if (!conversation) {
        acknowledge?.({ ok: false, error: 'Bu sohbet için çağrı yetkiniz yok.' });
        return;
      }

      const targetUserIds = conversation.participants
        .map((participant) => participant.userId)
        .filter((userId) => userId !== currentUser.userId);

      const payloadBase = {
        conversationId: call.conversationId,
        callId: call.callId,
        callType: call.callType,
        isGroup: conversation.isGroup,
        conversationName: conversation.name,
        caller: {
          id: currentUser.userId,
          username: currentUser.username
        }
      };

      targetUserIds.forEach((userId) => {
        io.to(userId).emit('call:incoming', payloadBase);
      });

      logger.info({
        event: 'call.invited',
        userId: currentUser.userId,
        conversationId: call.conversationId,
        callId: call.callId,
        callType: call.callType,
        targetCount: targetUserIds.length
      }, 'Call invite emitted');

      acknowledge?.({ ok: true });
    } catch (error) {
      logger.error({ event: 'call.invite_failed', err: error, userId: currentUser.userId, roomId: call.conversationId }, 'Call invite failed');
      acknowledge?.({ ok: false, error: 'Çağrı başlatılamadı.' });
    }
  });

  // ÇAĞRI KABUL EDİLDİ (Call Accepted)
  socket.on('call:accepted', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    void emitCallSignal(payload, 'accepted', acknowledge);
  });

  // ÇAĞRI REDDEDİLDİ (Call Declined)
  socket.on('call:declined', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    void emitCallSignal(payload, 'declined', acknowledge);
  });

  // ÇAĞRI SONLANDIRILDI (Call Ended)
  socket.on('call:ended', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    void emitCallSignal(payload, 'ended', acknowledge);
  });
};
