import { Server } from 'socket.io';
import { getRealtimeRedis } from '../realtime/redis';

const PRESENCE_KEY = 'mesajlasma:presence:online';
const fallbackOnlineUsers = new Map<string, Set<string>>();
const fallbackRateEvents = new Map<string, number[]>();

export const presenceTtlMs = 3 * 60 * 60 * 1000;

export const markUserOnline = async (userId: string, socketId: string, ttlMs = presenceTtlMs) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const sockets = fallbackOnlineUsers.get(userId) || new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    fallbackOnlineUsers.set(userId, sockets);
    return wasOffline;
  }

  const now = Date.now();
  const priorExpiry = await redis.zScore(PRESENCE_KEY, userId);
  await redis.multi()
    .zRemRangeByScore(PRESENCE_KEY, 0, now)
    .zAdd(PRESENCE_KEY, { score: now + ttlMs, value: userId })
    .exec();
  return priorExpiry === null || Number(priorExpiry) <= now;
};

export const touchUserPresence = async (userId: string, ttlMs = presenceTtlMs) => {
  const redis = getRealtimeRedis();
  if (redis) await redis.zAdd(PRESENCE_KEY, { score: Date.now() + ttlMs, value: userId });
};

export const getOnlineUserIds = async () => {
  const redis = getRealtimeRedis();
  if (!redis) return [...fallbackOnlineUsers.keys()];
  const now = Date.now();
  await redis.zRemRangeByScore(PRESENCE_KEY, 0, now);
  return redis.zRangeByScore(PRESENCE_KEY, now, '+inf');
};

export const markUserOfflineIfDisconnected = async (io: Server, userId: string, socketId: string) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const sockets = fallbackOnlineUsers.get(userId);
    sockets?.delete(socketId);
    if (sockets && sockets.size > 0) return false;
    fallbackOnlineUsers.delete(userId);
    return true;
  }

  const sockets = await io.in(userId).fetchSockets();
  if (sockets.length > 0) return false;
  await redis.zRem(PRESENCE_KEY, userId);
  return true;
};

export const checkDistributedSocketRateLimit = async (
  userId: string,
  eventName: string,
  maxPerSecond: number
) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const key = `${userId}:${eventName}`;
    const now = Date.now();
    const timestamps = (fallbackRateEvents.get(key) || []).filter((timestamp) => now - timestamp < 1000);
    if (timestamps.length >= maxPerSecond) return false;
    timestamps.push(now);
    fallbackRateEvents.set(key, timestamps);
    return true;
  }

  const bucket = Math.floor(Date.now() / 1000);
  const key = `mesajlasma:socket-rate:${eventName}:${userId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.pExpire(key, 1_200);
  return count <= maxPerSecond;
};
