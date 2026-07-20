//Socket.IO tabanlı gerçek zamanlı (real-time) iletişim için gerekenler.

import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma from '../db';
import { verifyAccessToken } from '../services/authTokens';
import { requireActiveParticipant } from '../services/conversationAccess';

interface SocketUser {
  userId: string;
  username: string;
}

type CallType = 'audio' | 'video';
type CallSignalStatus = 'accepted' | 'declined' | 'ended';

interface CallSignalPayload {
  conversationId?: unknown;
  callId?: unknown;
  callType?: unknown;
}

// Bir kullanıcının birden fazla sekmesi olabileceği için socket kimlikleri küme halinde tutulur.
// Bir kullanıcının birden fazla sekmesi olabilir.
// Map değeri Set olduğu için aynı userId'ye ait bütün socket bağlantılarını takip ederiz.
// Kullanıcı ancak son sekmesi de kapanınca çevrimdışı kabul edilir.
const onlineSockets = new Map<string, Set<string>>();
type VoicePresence = { conversationId: string; channelId: string; userId: string; username: string; isSpeaking: boolean; socketIds: Set<string> };
const voicePresences = new Map<string, VoicePresence>();
// Socket ömrü access token refresh'e değil gerçek kullanıcı aktivitesine bağlıdır.
// Frontend mouse/klavye gibi aktivitelerde client_activity gönderir; uzun inaktivitede socket kapatılır.
const SOCKET_INACTIVITY_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Çağrı eventleri socket üzerinden geldiği için payload mutlaka elle doğrulanır.
// Burada zod değil küçük bir guard kullanıyoruz; geçersiz id/tür gelirse event reddedilir.
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

// Her soket bağlantısı için event başına son istek zamanlarını takip ederiz.
// Bu sayede spam botları veya manipüle edilmiş client'ların sunucuyu/odaları yormasını engelleriz.
const socketEventTimestamps = new Map<string, Record<string, number[]>>();

const checkSocketRateLimit = (socketId: string, eventName: string, maxPerSecond: number): boolean => {
  const now = Date.now();
  let userEvents = socketEventTimestamps.get(socketId);
  if (!userEvents) {
    userEvents = {};
    socketEventTimestamps.set(socketId, userEvents);
  }

  const timestamps = userEvents[eventName] || [];
  const validTimestamps = timestamps.filter((ts) => now - ts < 1000);

  if (validTimestamps.length >= maxPerSecond) {
    return false;
  }

  validTimestamps.push(now);
  userEvents[eventName] = validTimestamps;
  return true;
};

export const registerSocketHandlers = (io: Server) => {
  // Socket handshake HTTP route'lardan geçmez; bu yüzden JWT doğrulaması burada ayrıca yapılır.
  // Refresh token socket için kabul edilmez, sadece kısa ömürlü access token kullanılabilir.
  // Socket el sıkışması yalnızca kısa ömürlü access token kabul eder.
  io.use(async (socket, next) => {
    const rawToken = socket.handshake.auth.token || socket.handshake.headers.token;
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (typeof token !== 'string' || !token) return next(new Error('Kimlik doğrulama hatası: Token bulunamadı.'));

    try {
      const decoded = verifyAccessToken(token);
      // Token geçerli olsa bile kullanıcı DB'de silinmiş olabilir.
      // Bu kontrol silinmiş hesapların eski access token ile socket açmasını engeller.
      const userExists = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true } });
      if (!userExists) return next(new Error('Kimlik doğrulama hatası: Kullanıcı bulunamadı.'));

      socket.data.user = {
        userId: decoded.userId,
        username: decoded.username
      } satisfies SocketUser;
      next();
    } catch {
      next(new Error('Kimlik doğrulama hatası: Geçersiz access token.'));
    }
  });

  io.on('connection', (socket) => {
    const currentUser = socket.data.user as SocketUser;
    let activeVoicePresence: { conversationId: string; channelId: string } | null = null;

    const leaveVoiceChannel = () => {
      if (!activeVoicePresence) return;
      const { conversationId, channelId } = activeVoicePresence;
      const key = `${channelId}:${currentUser.userId}`;
      const presence = voicePresences.get(key);
      presence?.socketIds.delete(socket.id);
      if (!presence || presence.socketIds.size === 0) {
        voicePresences.delete(key);
        socket.to(conversationId).emit('game:voice-presence-left', { conversationId, channelId, userId: currentUser.userId });
      }
      activeVoicePresence = null;
    };

    // Her bağlantı kendi inactivity timer'ını taşır.
    // Kullanıcı aynı hesabı iki sekmede açtıysa bir sekmenin inactive olması diğerini kapatmaz.
    // Socket yaşam süresi access token yenilemesine değil, gerçek kullanıcı aktivitesine bağlıdır.
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        socket.disconnect(true);
      }, SOCKET_INACTIVITY_TIMEOUT_MS);
    };
    resetInactivityTimer();

    const userSockets = onlineSockets.get(currentUser.userId) || new Set<string>();
    userSockets.add(socket.id);
    onlineSockets.set(currentUser.userId, userSockets);
    // Her kullanıcı kendi userId odasına alınır.
    // Sidebar yenilemeleri, çağrı davetleri ve kişisel bildirimler bu odaya gönderilebilir.
    void socket.join(currentUser.userId);

    logger.info({ event: 'socket.connected', userId: currentUser.userId, socketId: socket.id }, 'Socket connected');
    // Yeni bağlanan client mevcut online kullanıcıları tek seferde alır.
    // Sonraki değişiklikler presence_changed eventleriyle akar.
    socket.emit('presence_snapshot', { onlineUserIds: [...onlineSockets.keys()] });
    socket.broadcast.emit('presence_changed', { userId: currentUser.userId, isOnline: true, lastSeenAt: null });

    socket.on('client_activity', () => {
      // Frontend görünür kullanıcı aktivitesi algıladığında bunu yollar.
      // Böylece sadece token refresh olduğu için kullanıcı sonsuza kadar online görünmez.
      resetInactivityTimer();
    });

    socket.on('game:voice-presence-snapshot', async (groupId: unknown) => {
      if (typeof groupId !== 'string' || !uuidPattern.test(groupId)) return;
      const membership = await requireActiveParticipant(groupId, currentUser.userId).catch(() => null);
      if (!membership) return;
      socket.emit('game:voice-presence-snapshot', {
        groupId,
        presences: [...voicePresences.values()].filter((presence) => presence.conversationId === groupId).map(({ socketIds, ...presence }) => presence)
      });
    });

    socket.on('game:voice-presence', async (payload: unknown) => {
      resetInactivityTimer();
      if (!checkSocketRateLimit(socket.id, 'game:voice-presence', 3) || !payload || typeof payload !== 'object') return;
      const { action, conversationId, channelId } = payload as { action?: unknown; conversationId?: unknown; channelId?: unknown };
      if (action === 'leave') {
        if (typeof channelId === 'string' && activeVoicePresence?.channelId !== channelId) return;
        leaveVoiceChannel();
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
      if (activeVoicePresence?.channelId === channelId && activeVoicePresence.conversationId === conversationId) return;
      leaveVoiceChannel();
      const key = `${channelId}:${currentUser.userId}`;
      const existing = voicePresences.get(key);
      if (existing) {
        existing.socketIds.add(socket.id);
      } else {
        voicePresences.set(key, { conversationId, channelId, userId: currentUser.userId, username: currentUser.username, isSpeaking: false, socketIds: new Set([socket.id]) });
        socket.to(conversationId).emit('game:voice-presence-joined', { conversationId, channelId, userId: currentUser.userId, username: currentUser.username, isSpeaking: false });
      }
      activeVoicePresence = { conversationId, channelId };
    });

    socket.on('game:voice-speaking', async (payload: unknown) => {
      if (!checkSocketRateLimit(socket.id, 'game:voice-speaking', 5) || !payload || typeof payload !== 'object' || !activeVoicePresence) return;
      const { channelId, isSpeaking } = payload as { channelId?: unknown; isSpeaking?: unknown };
      if (channelId !== activeVoicePresence.channelId || typeof isSpeaking !== 'boolean') return;
      const membership = await requireActiveParticipant(
        activeVoicePresence.conversationId,
        currentUser.userId
      ).catch(() => null);
      if (!membership) {
        leaveVoiceChannel();
        return;
      }
      const presence = voicePresences.get(`${activeVoicePresence.channelId}:${currentUser.userId}`);
      if (!presence || presence.isSpeaking === isSpeaking) return;
      presence.isSpeaking = isSpeaking;
      socket.to(activeVoicePresence.conversationId).emit('game:voice-speaking', {
        conversationId: activeVoicePresence.conversationId,
        channelId: activeVoicePresence.channelId,
        userId: currentUser.userId,
        isSpeaking
      });
    });

    socket.on('odaya_katil', async (
      conversationId: unknown,
      acknowledge?: (result: { ok: boolean; error?: string }) => void
    ) => {
      resetInactivityTimer();
      if (!checkSocketRateLimit(socket.id, 'odaya_katil', 100)) {
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
        // Kullanıcı odası bildirim içindir; sohbet odalarında ayrıca üyelik aranır.
        if (cleanId === currentUser.userId) {
          await socket.join(cleanId);
          acknowledge?.({ ok: true });
          return;
        }

        // Conversation odasına girmeden önce gerçek katılımcılık kontrolü yapılır.
        // Yetkisiz kullanıcı odaya girerse başka kullanıcıların mesaj/eventlerini dinleyebilir.
        // Kabul/red/bitirme eventleri de konuşma üyeliği gerektirir.
        // Aksi halde kullanıcı başkasının çağrısını manipüle edebilir.
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

    socket.on('typing_changed', async (payload: unknown) => {
      resetInactivityTimer();
      if (!checkSocketRateLimit(socket.id, 'typing_changed', 15)) {
        logger.warn({ event: 'security.socket_rate_limit', userId: currentUser.userId, eventName: 'typing_changed' }, 'Socket event rate limit exceeded');
        return;
      }

      if (!payload || typeof payload !== 'object') return;
      const { conversationId, gameChannelId, isTyping } = payload as { conversationId?: unknown; gameChannelId?: unknown; isTyping?: unknown };
      if (typeof conversationId !== 'string' || typeof isTyping !== 'boolean' || (gameChannelId !== undefined && gameChannelId !== null && typeof gameChannelId !== 'string')) return;

      try {
        // Yazıyor bilgisi de üyelik kontrolünden geçer.
        // Böylece kullanıcı üyesi olmadığı odada "yazıyor" spam'i gönderemez.
        const membership = await requireActiveParticipant(conversationId, currentUser.userId).catch(() => null);
        if (!membership) return;
        if (typeof gameChannelId === 'string') {
          const channel = await prisma.gameChannel.findFirst({ where: { id: gameChannelId, conversationId, type: 'TEXT' }, select: { id: true } });
          if (!channel) return;
        }

        // socket.to(conversationId) gönderen socket hariç odadaki diğer client'lara yollar.
        // Bu yüzden yazan kişi kendi ekranında kendi "yazıyor" bilgisini görmez.
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

    // "Yazıyor..." göstergesiyle aynı prensip: sadece ses kaydı açıp kapatma bilgisini taşır,
    // dosyanın kendisiyle ilgisi yok. Frontend MediaRecorder start/stop anında bunu emit eder.
    socket.on('voice_recording_changed', async (payload: unknown) => {
      resetInactivityTimer();
      if (!checkSocketRateLimit(socket.id, 'voice_recording_changed', 10)) {
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

        // Çağrı sinyali konuşmadaki diğer kullanıcıların kişisel userId odalarına gönderilir.
        // Kullanıcı aktif sohbet odasında olmasa bile çağrı bildirimi alabilir.
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

        // Davet eventinde conversation bilgisi ve katılımcılar tek sorguda alınır.
        // Kullanıcı konuşmanın üyesi değilse call:incoming hiç yayınlanmaz.
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

    socket.on('call:accepted', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
      void emitCallSignal(payload, 'accepted', acknowledge);
    });

    socket.on('call:declined', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
      void emitCallSignal(payload, 'declined', acknowledge);
    });

    socket.on('call:ended', (payload: unknown, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
      void emitCallSignal(payload, 'ended', acknowledge);
    });

    socket.on('disconnect', async () => {
      logger.info({ event: 'socket.disconnected', userId: currentUser.userId, socketId: socket.id }, 'Socket disconnected');
      leaveVoiceChannel();
      socketEventTimestamps.delete(socket.id);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      const sockets = onlineSockets.get(currentUser.userId);
      sockets?.delete(socket.id);
      // Aynı kullanıcı başka sekmede hâlâ bağlıysa offline yayını yapmıyoruz.
      if (sockets && sockets.size > 0) return;

      onlineSockets.delete(currentUser.userId);
      const lastSeenAt = new Date();
      try {
        // Son socket de kapandığında lastSeenAt DB'ye yazılır ve diğer client'lara presence_changed gider.
        await prisma.user.update({ where: { id: currentUser.userId }, data: { lastSeenAt } });
      } catch (error) {
        logger.error({ event: 'socket.last_seen_failed', err: error, userId: currentUser.userId }, 'Last seen update failed');
      }

      socket.broadcast.emit('presence_changed', {
        userId: currentUser.userId,
        isOnline: false,
        lastSeenAt: lastSeenAt.toISOString()
      });
    });
  });
};
