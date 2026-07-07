import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { RequestWithId } from './requestLogger';

export const notFoundHandler = (req: Request, res: Response) => {
  const request = req as RequestWithId;
  logger.warn({
    event: 'http.not_found',
    requestId: request.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: request.user?.userId || null
  }, 'Route not found');
  return res.status(404).json({ error: 'Endpoint bulunamadı.' });
};

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const request = req as RequestWithId;
  logger.error({
    event: 'http.unhandled_error',
    err: error,
    requestId: request.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: request.user?.userId || null
  }, 'Unhandled request error');

  if (res.headersSent) return;
  return res.status(500).json({ error: 'Beklenmeyen sunucu hatası.' });
};
