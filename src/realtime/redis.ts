import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { nodeEnv, redisUrl } from '../config/env';
import { logger } from '../config/logger';

const createRedisClient = () => {
  const client = createClient({ url: redisUrl });
  client.on('error', (error) => {
    logger.error({ event: 'realtime.redis_error', err: error }, 'Redis client error');
  });
  return client;
};

type RedisClient = ReturnType<typeof createRedisClient>;
let commandClient: RedisClient | null = null;
let adapterClients: RedisClient[] = [];

export const getRealtimeRedis = () => commandClient;

export const configureRealtimeAdapter = async (io: Server) => {
  if (!redisUrl) {
    logger.warn({ event: 'realtime.redis_disabled' }, 'Redis is not configured; using single-instance realtime fallback');
    return false;
  }

  try {
    const command = createRedisClient();
    const pubClient = createRedisClient();
    const subClient = createRedisClient();
    await Promise.all([command.connect(), pubClient.connect(), subClient.connect()]);
    commandClient = command;
    adapterClients = [pubClient, subClient];
    io.adapter(createAdapter(pubClient, subClient));
    logger.info({ event: 'realtime.redis_connected' }, 'Redis Socket.IO adapter configured');
    return true;
  } catch (error) {
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

export const closeRealtimeRedis = async () => {
  const clients = [commandClient, ...adapterClients].filter((client): client is RedisClient => client !== null);
  commandClient = null;
  adapterClients = [];
  await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
};
