/**
 * ============================================================================
 * SİSTEM SAĞLIĞI VE CANLILIK ROTALARI (System Health & Readiness Routes)
 * ============================================================================
 * 
 * Bu dosya, Kubernetes, Cloudflare, Nginx veya Yük Dengeleyiciler (Load Balancer)
 * tarafından sunucunun canlılık (liveness) ve trafiğe hazır olma (readiness)
 * durumlarını izlemek için kullanılan sağlık kontrolü (Health Check) uç noktalarını içerir.
 */

import express, { Request, Response } from 'express';
import { redisUrl } from '../config/env';
import { logger, loggerRuntime } from '../config/logger';
import prisma from '../db';
import { getRealtimeRedis } from '../realtime/redis';

const router = express.Router();

/**
 * Liveness (Canlılık Kontrolü) Yanıt Fonksiyonu
 * Process'in çalışır durumda olduğunu doğrular.
 */
const sendLiveness = (_req: Request, res: Response) => {
  logger.info({ event: 'system.liveness_check' }, 'Liveness check requested');
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
};

/** GET /api/v1/health -> Gerçi dönük uyumluluk (Legacy Alias) */
router.get('/health', sendLiveness);
/** GET /api/v1/health/live -> Kubernetes Liveness Probe Uç Noktası */
router.get('/health/live', sendLiveness);

/**
 * GET /api/v1/health/ready -> Kubernetes Readiness Probe Uç Noktası
 * 
 * Sunucunun gelen HTTP/WebSocket trafiğini işleyip işleyemeyeceğini doğrular.
 * - PostgreSQL veritabanı sorgusunu (`SELECT 1`) test eder.
 * - Redis yapılandırılmışsa Redis `ping` komutunu doğrular.
 * - Servislerden biri çökmüşse HTTP 503 Service Unavailable döner.
 */
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

/**
 * GET /api/v1/health/logging -> Günlükleme (Logging) Sağlık Uç Noktası
 * Pino logger çalışma zamanı durumunu (stdout, dosya kaydı aktifliği, log seviyesi) raporlar.
 */
router.get('/health/logging', async (_req: Request, res: Response) => {
  logger.info({ event: 'system.logging_health_check' }, 'Logging health check requested');
  const { level, service, env, stdout, file } = loggerRuntime;
  res.status(200).json({
    status: 'ok',
    logging: { level, service, env, stdout, file }
  });
});

export default router;

