/**
 * ============================================================================
 * SOCKET.IO GERÇEK ZAMANLI OLAY DİNLEYİCİLERİ (Real-Time Socket Handlers)
 * ============================================================================
 * 
 * Bu dosya; Socket.IO bağlantılarının kimlik doğrulamasını (JWT Handshake),
 * inaktivite zaman aşımını ve modüler soket alt dinleyicilerinin 
 * (`registerChatSocketHandlers`, `registerCallSocketHandlers`)
 * kaydını yönetir.
 */

import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma from '../db';
import { verifyAccessToken } from '../services/authTokens';
import {
  checkDistributedSocketRateLimit,
  getOnlineUserIds,
  markUserOfflineIfDisconnected,
  markUserOnline,
  presenceTtlMs,
  touchUserPresence
} from './realtimeState';
import { registerChatSocketHandlers, type SocketUser } from './handlers/chatHandlers';
import { registerCallSocketHandlers } from './handlers/callHandlers';

/** Soket inaktivite zaman aşımı süresi (3 Saat) */
const SOCKET_INACTIVITY_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * Socket.IO sunucusuna tüm gerçek zamanlı olay dinleyicilerini (handlers) kaydeder.
 */
export const registerSocketHandlers = (io: Server) => {
  // SOCKET HANDSHAKE KIMLIK DOĞRULAMA MIDDLEWARE
  io.use(async (socket, next) => {
    const rawToken = socket.handshake.auth.token || socket.handshake.headers.token;
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (typeof token !== 'string' || !token) return next(new Error('Kimlik doğrulama hatası: Token bulunamadı.'));

    try {
      const decoded = verifyAccessToken(token);
      const userExists = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true } });
      if (!userExists) return next(new Error('Kimlik doğrulama hatası: Kullanıcı bulunamadı.'));

      socket.data.user = {
        userId: decoded.userId,
        username: decoded.username,
        accessTokenExpiresAt: decoded.exp * 1000
      } satisfies SocketUser;
      next();
    } catch {
      next(new Error('Kimlik doğrulama hatası: Geçersiz access token.'));
    }
  });

  // SOKET BAĞLANTISI BAŞLADIĞINDA
  io.on('connection', async (socket) => {
    const currentUser = socket.data.user as SocketUser;
    // İNAKTİVİTE VE TOKEN ZAMAN AŞIMI YÖNETİMİ
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let inactivityDeadlineAt = Date.now() + SOCKET_INACTIVITY_TIMEOUT_MS;
    const remainingSessionMs = () => Math.max(
      0,
      Math.min(inactivityDeadlineAt, currentUser.accessTokenExpiresAt) - Date.now()
    );
    const scheduleSessionTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      const timeoutMs = remainingSessionMs();
      if (timeoutMs <= 0) {
        if (Date.now() >= currentUser.accessTokenExpiresAt) socket.emit('auth:expired');
        socket.disconnect(true);
        return;
      }
      inactivityTimer = setTimeout(() => {
        if (Date.now() >= currentUser.accessTokenExpiresAt) socket.emit('auth:expired');
        socket.disconnect(true);
      }, timeoutMs);
      void touchUserPresence(currentUser.userId, Math.min(presenceTtlMs, timeoutMs));
    };
    const resetInactivityTimer = () => {
      inactivityDeadlineAt = Date.now() + SOCKET_INACTIVITY_TIMEOUT_MS;
      scheduleSessionTimer();
    };
    resetInactivityTimer();

    // Kullanıcı kendi kişisel bildirim odasına alınır
    void socket.join(currentUser.userId);

    logger.info({ event: 'socket.connected', userId: currentUser.userId, socketId: socket.id }, 'Socket connected');

    // Çevrimiçi durum yayını yapılır
    const becameOnline = await markUserOnline(currentUser.userId, socket.id, remainingSessionMs());
    socket.emit('presence_snapshot', { onlineUserIds: await getOnlineUserIds() });
    if (becameOnline) {
      socket.broadcast.emit('presence_changed', { userId: currentUser.userId, isOnline: true, lastSeenAt: null });
    }

    // İSTEMCİ AKTİVİTE TETİKLEYİCİSİ (User Activity Heartbeat)
    socket.on('client_activity', () => {
      resetInactivityTimer();
    });

    // ACCESS TOKEN YENİLEME (Aktif Soket Oturum Süresini Güncelleme)
    socket.on('auth:refresh', async (
      payload: unknown,
      acknowledge?: (result: { ok: boolean; error?: string }) => void
    ) => {
      const token = payload && typeof payload === 'object'
        ? (payload as { token?: unknown }).token
        : null;
      if (typeof token !== 'string' || !token) {
        acknowledge?.({ ok: false, error: 'Geçersiz access token.' });
        return;
      }

      try {
        const withinLimit = await checkDistributedSocketRateLimit(currentUser.userId, 'auth:refresh', 10)
          .catch(() => true);
        if (!withinLimit) {
          logger.warn({ event: 'security.socket_rate_limit', userId: currentUser.userId, eventName: 'auth:refresh' }, 'Socket event rate limit exceeded');
          acknowledge?.({ ok: false, error: 'Çok fazla istek gönderdiniz. Lütfen bekleyin.' });
          return;
        }

        const decoded = verifyAccessToken(token);
        if (decoded.userId !== currentUser.userId) {
          logger.warn({
            event: 'security.socket_refresh_user_mismatch',
            userId: currentUser.userId,
            tokenUserId: decoded.userId,
            socketId: socket.id
          }, 'Socket auth refresh user mismatch');
          acknowledge?.({ ok: false, error: 'Token kullanıcı kimliği ile eşleşmiyor.' });
          return;
        }

        const nextExpiresAt = decoded.exp * 1000;
        if (nextExpiresAt <= Date.now()) {
          acknowledge?.({ ok: false, error: 'Access token süresi dolmuş.' });
          return;
        }

        currentUser.accessTokenExpiresAt = Math.max(currentUser.accessTokenExpiresAt, nextExpiresAt);
        currentUser.username = decoded.username;
        scheduleSessionTimer();
        acknowledge?.({ ok: true });
      } catch (error) {
        logger.warn({ event: 'socket.auth_refresh_failed', err: error, userId: currentUser.userId, socketId: socket.id }, 'Socket auth refresh failed');
        acknowledge?.({ ok: false, error: 'Geçersiz veya süresi dolmuş access token.' });
      }
    });

    // ALT HANDLER'LARIN BAĞLANMASI
    registerChatSocketHandlers(socket, currentUser, resetInactivityTimer);
    registerCallSocketHandlers(io, socket, currentUser, resetInactivityTimer);

    // SOKET KAPANMASI VEYA KOPMASI (Socket Disconnect)
    socket.on('disconnect', async () => {
      logger.info({ event: 'socket.disconnected', userId: currentUser.userId, socketId: socket.id }, 'Socket disconnected');
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (!await markUserOfflineIfDisconnected(io, currentUser.userId, socket.id)) return;
      const lastSeenAt = new Date();
      try {
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
