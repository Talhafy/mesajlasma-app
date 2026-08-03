/**
 * ============================================================================
 * GLOBAL HATA VE 404 YAKALAMA MIDDLEWARE'LERİ (Centralized Error Handling)
 * ============================================================================
 * 
 * Bu dosya, Express.js uygulamasında hiçbir rotayla eşleşmeyen istekleri (404 Not Found)
 * ve rotalar içinde fırlatılan ancak yakalanmamış tüm hataları (500/AppError) tek noktadan
 * yöneten merkezi hata yakalama mekanizmasını içerir.
 */

import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';
import { RequestWithId } from './requestLogger';

/**
 * 404 BULUNAMADI HANDLER (NotFoundHandler)
 * 
 * Sunucuya gelen bir HTTP isteğinin (örn: GET /api/v1/bilinmeyen-adres) hiçbir rota
 * tanımlaması ile eşleşmediği durumlarda Express zincirinin en sonunda devreye girer.
 * 
 * Güvenlik Açısından Önemi:
 * - Yanlış URL aramaları veya otomatize edilmiş bot taramaları güvenlik uyarısı olabilir.
 * - Bu yüzden isteği yapan IP, istek ID'si ve aranan URL bilgisi loglanır ve 404 yanıtı dönülür.
 */
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

  return res.status(404).json({ error: 'Endpoint bulunamadı.', code: 'NOT_FOUND' });
};

/**
 * GLOBAL HATA YAKALAYICI (Global Error Handler Middleware)
 * 
 * Express'te 4 parametre kabul eden `(error, req, res, next)` fonksiyonları hata yakalayıcıdır.
 * Uygulamanın herhangi bir yerinde `throw new AppError(...)` denildiğinde veya beklenmeyen bir
 * kütüphane hatası fırlatıldığında akış otomatik olarak bu fonksiyona düşer.
 * 
 * Ne Yapar?:
 * 1. Eğer hata bizim tanımladığımız 'AppError' sınıfındansa:
 *    - 500 ve üzeri hatalar 'error' seviyesinde loglanır.
 *    - 400-499 arası iş kuralı uyarıları (örn: hatalı şifre) 'warn' seviyesinde loglanır.
 *    - İstemciye belirlenen HTTP durum kodu ve makine-okunabilir hata kodu (`code`) dönülür.
 * 2. Eğer hata tahmin edilmeyen ham bir sistem hatası ise (ör. DB koptu, null pointer):
 *    - İstemciye hassas sistem verileri ifşa edilmeden jenerik 'INTERNAL_ERROR' yanıtı dönülür.
 */
export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const request = req as RequestWithId;

  // Hatayı bizim kurduğumuz AppError sınıfından mı kontrol ediyoruz
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({
        event: 'http.app_error',
        err: error,
        code: error.code,
        requestId: request.id,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userId: request.user?.userId || null
      }, error.message);
    } else {
      logger.warn({
        event: 'http.app_warning',
        code: error.code,
        requestId: request.id,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userId: request.user?.userId || null
      }, error.message);
    }

    // Cevap header'ları zaten gönderilmişse (örn. res.write kullanıldıysa) tekrar json gönderilmez
    if (res.headersSent) return;
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }

  // Beklenmeyen ve tahmin edilmeyen ham hatalar (Unhandler system error)
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
  return res.status(500).json({ error: 'Beklenmeyen sunucu hatası.', code: 'INTERNAL_ERROR' });
};
