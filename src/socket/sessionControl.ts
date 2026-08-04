/**
 * ============================================================================
 * SOKET OTURUM KONTROL SERVİSİ (Socket Session Revocation Control)
 * ============================================================================
 * 
 * Bu modül, şifre değiştirme veya hesaptan çıkış (logout) gibi durumlarda
 * kullanıcının tüm sekmelerindeki/cihazlarındaki aktif Socket.IO bağlantılarını
 * anında koparmak için kullanılır.
 */

import { Server } from 'socket.io';

/**
 * Belirtilen kullanıcının tüm sekmelerindeki aktif Socket.IO bağlantılarına
 * `auth:session-revoked` olayı gönderir ve socket bağlantılarını zorla kapatır.
 */
export const disconnectUserSockets = (io: Server | undefined, userId: string, reason = 'session_revoked') => {
  if (!io) return;
  io.in(userId).emit('auth:session-revoked', { reason });
  // Redis adapter varsa bu çağrı diğer tüm API instance'larındaki socketleri de kapatır.
  io.in(userId).disconnectSockets(true);
};

