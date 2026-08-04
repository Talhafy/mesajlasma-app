/**
 * ============================================================================
 * CANLI İLETİŞİM REDIS ADAPTÖRÜ (Realtime Socket.IO Redis Adapter)
 * ============================================================================
 * 
 * Bu modül, birden fazla sunucu (Docker / Kubernetes / PM2 Cluster) çalıştığında
 * Socket.IO WebSocket odalarının ve anlık mesajların sunucular arasında
 * Pub/Sub (Yayın/Abone) modeliyle senkronize edilmesini sağlar.
 */

import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { nodeEnv, redisUrl } from '../config/env';
import { logger } from '../config/logger';

/**
 * Tekil bir Redis istemci nesnesi üretir ve hata dinleyicilerini bağlar.
 */
const createRedisClient = () => {
  const client = createClient({ url: redisUrl });
  client.on('error', (error) => {
    logger.error({ event: 'realtime.redis_error', err: error }, 'Redis client error');
  });
  return client;
};

type RedisClient = ReturnType<typeof createRedisClient>;
/** Genel komutlar için kullanılan Redis istemcisi */
let commandClient: RedisClient | null = null;
/** Adaptör Pub/Sub kanalları için kullanılan iki adet Redis istemcisi */
let adapterClients: RedisClient[] = [];

/**
 * Uygulama genelinde kullanılmak üzere aktif Redis komut istemcisini döner.
 */
export const getRealtimeRedis = () => commandClient;

/**
 * Socket.IO sunucusuna Redis Pub/Sub adaptörünü bağlar.
 * Redis URL'si tanımlı değilse veya Redis'e ulaşılamıyorsa tekil sunucu moduna (memory fallback) düşer.
 */
export const configureRealtimeAdapter = async (io: Server) => {
  if (!redisUrl) {
    logger.warn({ event: 'realtime.redis_disabled' }, 'Redis is not configured; using single-instance realtime fallback');
    return false;
  }

  try {
    const command = createRedisClient();
    const pubClient = createRedisClient();
    const subClient = createRedisClient();
    // 3 ayrı bağlantı kurulur: 1 Genel komutlar, 1 Yayın (Publish), 1 Abonelik (Subscribe)
    await Promise.all([command.connect(), pubClient.connect(), subClient.connect()]);
    commandClient = command;
    adapterClients = [pubClient, subClient];
    io.adapter(createAdapter(pubClient, subClient));
    logger.info({ event: 'realtime.redis_connected' }, 'Redis Socket.IO adapter configured');
    return true;
  } catch (error) {
    // Bağlantı başarısız olursa açılan istemcileri kapat
    await Promise.all([
      commandClient?.quit().catch(() => undefined),
      ...adapterClients.map((client) => client.quit().catch(() => undefined))
    ]);
    commandClient = null;
    adapterClients = [];
    if (nodeEnv === 'production') throw error;
    logger.warn({ event: 'realtime.redis_unavailable', err: error }, 'Redis unavailable; using single-instance realtime fallback');
    return false;
  }
};

/**
 * Sunucu kapatılırken (Graceful Shutdown) tüm Redis WebSocket istemci bağlantılarını güvenle sonlandırır.
 */
export const closeRealtimeRedis = async () => {
  const clients = [commandClient, ...adapterClients].filter((client): client is RedisClient => client !== null);
  commandClient = null;
  adapterClients = [];
  await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
};

