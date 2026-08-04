/**
 * ============================================================================
 * GERÇEK ZAMANLI DURUM VE PRESENCE YÖNETİMİ (Real-Time State & Presence Store)
 * ============================================================================
 * 
 * Bu modül; kullanıcıların çevrimiçi (online/offline) varlık (presence) durumlarını,
 * ses kanallarındaki anlık katılım ve konuşuyor (`isSpeaking`) bilgilerini,
 * ve dağıtık ortamlar (Redis Cluster) için Socket Rate Limiting mantığını yönetir.
 * 
 * ESNEK MİMARİ (Redis / In-Memory Fallback):
 * - Redis aktifse: ZSET ve HASH yapıları ile multi-node cluster uyumlu çalışır.
 * - Redis kapalıysa: Standalone in-memory Map & Set koleksiyonlarına yumuşak geçiş yapar.
 */

import { Server } from 'socket.io';
import { getRealtimeRedis } from '../realtime/redis';

/** Redis Presence ZSET anahtarı */
const PRESENCE_KEY = 'mesajlasma:presence:online';

/** In-Memory Fallback koleksiyonları (Redis bağlantısı olmadığında kullanılır) */
const fallbackOnlineUsers = new Map<string, Set<string>>();
const fallbackRateEvents = new Map<string, number[]>();

/** Ses kanalı varlık (Voice Presence) veri yapısı */
type VoicePresence = { conversationId: string; channelId: string; userId: string; username: string; isSpeaking: boolean };
const fallbackVoicePresences = new Map<string, VoicePresence & { socketIds: Set<string> }>();

/** Varsayılan presence TTL süresi (3 Saat) */
export const presenceTtlMs = 3 * 60 * 60 * 1000;

/**
 * KULLANICIYI ÇEVRİMİÇİ İŞARETLEME
 * Kullanıcı ilk kez çevrimiçi oluyorsa `true` döner (presence_changed yayını için).
 */
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

/**
 * Kullanıcının çevrimiçi son kullanma süresini (TTL) tazeler (Heartbeat).
 */
export const touchUserPresence = async (userId: string, ttlMs = presenceTtlMs) => {
  const redis = getRealtimeRedis();
  if (redis) await redis.zAdd(PRESENCE_KEY, { score: Date.now() + ttlMs, value: userId });
};

/**
 * Anlık olarak tüm çevrimiçi kullanıcı ID'lerinin listesini döner.
 */
export const getOnlineUserIds = async () => {
  const redis = getRealtimeRedis();
  if (!redis) return [...fallbackOnlineUsers.keys()];
  const now = Date.now();
  await redis.zRemRangeByScore(PRESENCE_KEY, 0, now);
  return redis.zRangeByScore(PRESENCE_KEY, now, '+inf');
};

/**
 * Kullanıcı tamamen bağlantıyı kestiyse (Tüm sekmeleri kapandıysa) çevrimdışı işaretler.
 */
export const markUserOfflineIfDisconnected = async (io: Server, userId: string, socketId: string) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const sockets = fallbackOnlineUsers.get(userId);
    sockets?.delete(socketId);
    if (sockets && sockets.size > 0) return false;
    fallbackOnlineUsers.delete(userId);
    return true;
  }

  // Redis adapter fetchSockets() tüm API instance'larındaki aynı user room'unu kapsar.
  const sockets = await io.in(userId).fetchSockets();
  if (sockets.length > 0) return false;
  await redis.zRem(PRESENCE_KEY, userId);
  return true;
};

/**
 * DAĞITIK SOKET İSTEK SINIRLAYICI (Distributed Socket Rate Limiting)
 * Kullanıcıların soket üzerinden belirli bir eylemi saniyede `maxPerSecond` defadan fazla tetiklemesini engeller.
 */
export const checkDistributedSocketRateLimit = async (userId: string, eventName: string, maxPerSecond: number) => {
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

const voiceSocketKey = (socketId: string) => `mesajlasma:voice:socket:${socketId}`;
const voiceChannelKey = (channelId: string) => `mesajlasma:voice:channel:${channelId}`;
const voiceConversationKey = (conversationId: string) => `mesajlasma:voice:conversation:${conversationId}`;

/** Dahili ses varlığı JSON ayrıştırıcı */
const parseVoicePresence = (value: string | null): VoicePresence | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<VoicePresence>;
    if (
      typeof parsed.conversationId !== 'string' ||
      typeof parsed.channelId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.isSpeaking !== 'boolean'
    ) return null;
    return parsed as VoicePresence;
  } catch {
    return null;
  }
};

/** Belirtilen ses kanalındaki aktif katılımcıları Redis'ten getirir */
const getRedisChannelPresences = async (channelId: string) => {
  const redis = getRealtimeRedis();
  if (!redis) return [];
  const socketIds = await redis.sMembers(voiceChannelKey(channelId));
  if (socketIds.length === 0) return [];
  const values = await redis.mGet(socketIds.map(voiceSocketKey));
  const staleSocketIds: string[] = [];
  const byUser = new Map<string, VoicePresence>();
  values.forEach((value, index) => {
    const presence = parseVoicePresence(value);
    if (!presence) {
      staleSocketIds.push(socketIds[index]);
      return;
    }
    const existing = byUser.get(presence.userId);
    byUser.set(presence.userId, existing ? { ...presence, isSpeaking: existing.isSpeaking || presence.isSpeaking } : presence);
  });
  if (staleSocketIds.length > 0) await redis.sRem(voiceChannelKey(channelId), staleSocketIds);
  return [...byUser.values()];
};

/**
 * SES KANALINA KATILMA (Join Voice Presence)
 */
export const joinVoicePresence = async (socketId: string, presence: VoicePresence, ttlMs: number) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const key = `${presence.channelId}:${presence.userId}`;
    const existing = fallbackVoicePresences.get(key);
    const isNewUser = !existing;
    if (existing) existing.socketIds.add(socketId);
    else fallbackVoicePresences.set(key, { ...presence, socketIds: new Set([socketId]) });
    return isNewUser;
  }

  const currentPresences = await getRedisChannelPresences(presence.channelId);
  const isNewUser = !currentPresences.some((item) => item.userId === presence.userId);
  const payload = JSON.stringify(presence);
  await redis.multi()
    .set(voiceSocketKey(socketId), payload, { PX: ttlMs })
    .sAdd(voiceChannelKey(presence.channelId), socketId)
    .pExpire(voiceChannelKey(presence.channelId), ttlMs)
    .sAdd(voiceConversationKey(presence.conversationId), presence.channelId)
    .pExpire(voiceConversationKey(presence.conversationId), ttlMs)
    .exec();
  return isNewUser;
};

/** Ses kanalı varlık süresini tazeleyici */
export const touchVoicePresence = async (socketId: string, ttlMs: number) => {
  const redis = getRealtimeRedis();
  if (redis) await redis.pExpire(voiceSocketKey(socketId), ttlMs);
};

/**
 * SES KANALINDAN AYRILMA (Leave Voice Presence)
 */
export const leaveVoicePresence = async (socketId: string, presence: Pick<VoicePresence, 'conversationId' | 'channelId' | 'userId'>) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    const key = `${presence.channelId}:${presence.userId}`;
    const current = fallbackVoicePresences.get(key);
    current?.socketIds.delete(socketId);
    if (current && current.socketIds.size > 0) return false;
    fallbackVoicePresences.delete(key);
    return true;
  }

  await redis.multi().del(voiceSocketKey(socketId)).sRem(voiceChannelKey(presence.channelId), socketId).exec();
  const remaining = await getRedisChannelPresences(presence.channelId);
  const userStillPresent = remaining.some((item) => item.userId === presence.userId);
  if (remaining.length === 0) {
    await redis.sRem(voiceConversationKey(presence.conversationId), presence.channelId);
  }
  return !userStillPresent;
};

/**
 * KONUŞUYOR DURUMUNU GÜNCELLEME (Voice Speaking Indicator)
 */
export const setVoiceSpeaking = async (socketId: string, isSpeaking: boolean, ttlMs: number) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    for (const presence of fallbackVoicePresences.values()) {
      if (!presence.socketIds.has(socketId) || presence.isSpeaking === isSpeaking) continue;
      presence.isSpeaking = isSpeaking;
      return presence;
    }
    return null;
  }

  const presence = parseVoicePresence(await redis.get(voiceSocketKey(socketId)));
  if (!presence || presence.isSpeaking === isSpeaking) return null;
  const next = { ...presence, isSpeaking };
  await redis.set(voiceSocketKey(socketId), JSON.stringify(next), { PX: ttlMs });
  return next;
};

/**
 * BİR GRUPTAKİ TÜM SES KANALLARININ ANLIK KATILIMCI BİLGİLERİNİ GETİRİR
 */
export const getConversationVoicePresences = async (conversationId: string) => {
  const redis = getRealtimeRedis();
  if (!redis) {
    return [...fallbackVoicePresences.values()]
      .filter((presence) => presence.conversationId === conversationId)
      .map(({ socketIds, ...presence }) => presence);
  }

  const channelIds = await redis.sMembers(voiceConversationKey(conversationId));
  const channels = await Promise.all(channelIds.map(getRedisChannelPresences));
  return channels.flat().filter((presence) => presence.conversationId === conversationId);
};

