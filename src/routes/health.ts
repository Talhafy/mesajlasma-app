import express, { Response } from 'express';
import { logger, loggerRuntime } from '../config/logger';
import { CustomRequest } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/health', async (_req: CustomRequest, res: Response) => {
  logger.info({ event: 'system.health_check' }, 'Health check requested');
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

router.get('/health/logging', async (_req: CustomRequest, res: Response) => {
  logger.info({ event: 'system.logging_health_check' }, 'Logging health check requested');
  res.status(200).json({
    status: 'ok',
    logging: loggerRuntime
  });
});

export default router;
