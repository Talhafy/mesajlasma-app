import { Server } from 'socket.io';

export const disconnectUserSockets = (io: Server | undefined, userId: string, reason = 'session_revoked') => {
  if (!io) return;
  io.in(userId).emit('auth:session-revoked', { reason });
  // Redis adapter varsa bu çağrı diğer API instance'larındaki socketleri de kapatır.
  io.in(userId).disconnectSockets(true);
};
