//Projemizde ollmayan bir route fark edilirse gerekli loglamayı yapmak için

import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { RequestWithId } from './requestLogger';

// Hiçbir route ile eşleşmeyen istekler buraya düşer.
// 404'leri de logluyoruz çünkü yanlış URL taramaları veya bot istekleri güvenlik sinyali olabilir.
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

// Express zincirinde yakalanmamış hata olursa tek formatta cevap ve structured log üretir.
// Hata detayını kullanıcıya dönmeyiz; stack ve ayrıntı sadece log sisteminde kalır.
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
