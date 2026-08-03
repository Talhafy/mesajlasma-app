// Liveness yalnızca process'in çalıştığını, readiness ise bağımlılıkların trafik almaya hazır
// olduğunu bildirir. Load balancer bu iki sinyali farklı amaçlarla kullanmalıdır.
import express, { Request, Response } from 'express';
import { redisUrl } from '../config/env';
import { logger, loggerRuntime } from '../config/logger';
import prisma from '../db';
import { getRealtimeRedis } from '../realtime/redis';

const router = express.Router();

const sendLiveness = (_req: Request, res: Response) => {
  logger.info({ event: 'system.liveness_check' }, 'Liveness check requested');
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
};

// /health geriye dönük uyumluluk için liveness alias'ı olarak kalır.
router.get('/health', sendLiveness);
router.get('/health/live', sendLiveness);

router.get('/health/ready', async (_req: Request, res: Response) => {
  const checks = {
    database: 'up' as 'up' | 'down',
    redis: (redisUrl ? 'up' : 'disabled') as 'up' | 'down' | 'disabled'
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    checks.database = 'down';
    logger.error({ event: 'system.readiness_database_failed', err: error }, 'Database readiness check failed');
  }

  if (redisUrl) {
    try {
      const redis = getRealtimeRedis();
      if (!redis?.isReady) throw new Error('Redis client is not ready.');
      await redis.ping();
    } catch (error) {
      checks.redis = 'down';
      logger.error({ event: 'system.readiness_redis_failed', err: error }, 'Redis readiness check failed');
    }
  }

  const isReady = checks.database === 'up' && checks.redis !== 'down';
  return res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString()
  });
});

// Logging health endpoint'i Elastic/Kibana kurulumundan bağımsız olarak logger runtime bilgisini gösterir.
// Dosya sistemi yolları ve diğer iç yapılandırma bilgileri public yanıta dahil edilmez.
router.get('/health/logging', async (_req: Request, res: Response) => {
  logger.info({ event: 'system.logging_health_check' }, 'Logging health check requested');
  const { level, service, env, stdout, file } = loggerRuntime;
  res.status(200).json({
    status: 'ok',
    logging: { level, service, env, stdout, file }
  });
});

export default router;
