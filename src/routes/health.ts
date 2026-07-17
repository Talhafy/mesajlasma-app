//Sunucu 200 döndürüyor mu? çalışıyor mu?

import express, { Response } from 'express';
import { logger, loggerRuntime } from '../config/logger';
import { CustomRequest } from '../middleware/authMiddleware';

const router = express.Router();

// Basit canlılık kontrolü.
// Load balancer veya manuel test için uygulama process'i ayakta mı hızlıca anlaşılır.
router.get('/health', async (_req: CustomRequest, res: Response) => {
  logger.info({ event: 'system.health_check' }, 'Health check requested');
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Logging health endpoint'i Elastic/Kibana kurulumundan bağımsız olarak logger runtime bilgisini gösterir.
// Dosya log açık mı, hangi level aktif, hangi path kullanılıyor gibi bilgiler burada görünür.
router.get('/health/logging', async (_req: CustomRequest, res: Response) => {
  logger.info({ event: 'system.logging_health_check' }, 'Logging health check requested');
  res.status(200).json({
    status: 'ok',
    logging: loggerRuntime
  });
});

export default router;
