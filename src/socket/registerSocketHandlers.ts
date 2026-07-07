import { Server } from 'socket.io';
import prisma from '../db';
import { verifyAccessToken } from '../services/authTokens';

interface SocketUser {
  userId: string;
  username: string;
}

// Bir kullanıcının birden fazla sekmesi olabileceği için socket kimlikleri küme halinde tutulur.
const onlineSockets = new Map<string, Set<string>>();
const SOCKET_INACTIVITY_TIMEOUT_MS = 1 * 60 * 1000;

export const registerSocketHandlers = (io: Server) => {
  // Socket el sıkışması yalnızca kısa ömürlü access token kabul eder.
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
        username: decoded.username
      } satisfies SocketUser;
      next();
    } catch {
      next(new Error('Kimlik doğrulama hatası: Geçersiz access token.'));
    }
  });

  io.on('connection', (socket) => {
    const currentUser = socket.data.user as SocketUser;

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
    void socket.join(currentUser.userId);

    socket.emit('presence_snapshot', { onlineUserIds: [...onlineSockets.keys()] });
    socket.broadcast.emit('presence_changed', { userId: currentUser.userId, isOnline: true, lastSeenAt: null });

    socket.on('client_activity', () => {
      resetInactivityTimer();
    });

    socket.on('odaya_katil', async (
      conversationId: unknown,
      acknowledge?: (result: { ok: boolean; error?: string }) => void
    ) => {
      resetInactivityTimer();
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

        const membership = await prisma.participant.findUnique({
          where: { userId_conversationId: { userId: currentUser.userId, conversationId: cleanId } },
          select: { id: true }
        });
        if (!membership) {
          console.warn(`Güvenlik uyarısı: Kullanıcı (${currentUser.userId}) yetkisiz odaya (${cleanId}) katılmaya çalıştı.`);
          acknowledge?.({ ok: false, error: 'Bu sohbet odasına katılma yetkiniz yok.' });
          return;
        }

        await socket.join(cleanId);
        acknowledge?.({ ok: true });
      } catch (error) {
        console.error('Socket oda katılım hatası:', error);
        acknowledge?.({ ok: false, error: 'Sohbet odasına katılınamadı.' });
      }
    });

    socket.on('typing_changed', async (payload: unknown) => {
      resetInactivityTimer();
      if (!payload || typeof payload !== 'object') return;
      const { conversationId, isTyping } = payload as { conversationId?: unknown; isTyping?: unknown };
      if (typeof conversationId !== 'string' || typeof isTyping !== 'boolean') return;

      try {
        const membership = await prisma.participant.findUnique({
          where: { userId_conversationId: { userId: currentUser.userId, conversationId } },
          select: { id: true }
        });
        if (!membership) return;

        socket.to(conversationId).emit('typing_changed', {
          conversationId,
          userId: currentUser.userId,
          username: currentUser.username,
          isTyping
        });
      } catch (error) {
        console.error('Yazıyor durumu gönderilemedi:', error);
      }
    });

    socket.on('disconnect', async () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      const sockets = onlineSockets.get(currentUser.userId);
      sockets?.delete(socket.id);
      if (sockets && sockets.size > 0) return;

      onlineSockets.delete(currentUser.userId);
      const lastSeenAt = new Date();
      try {
        await prisma.user.update({ where: { id: currentUser.userId }, data: { lastSeenAt } });
      } catch (error) {
        console.error('Son görülme güncellenemedi:', error);
      }

      socket.broadcast.emit('presence_changed', {
        userId: currentUser.userId,
        isOnline: false,
        lastSeenAt: lastSeenAt.toISOString()
      });
    });
  });
};
