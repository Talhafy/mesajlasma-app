import express, { Response } from 'express';
import { logger } from '../config/logger';
import { CustomRequest } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/health', async (_req: CustomRequest, res: Response) => {
  logger.info({ event: 'system.health_check' }, 'Health check requested');
  res.status(200).json({ status: 'ok' });
});

export default router;