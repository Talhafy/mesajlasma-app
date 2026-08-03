/**
 * ============================================================================
 * JWT KİMLİK DOĞRULAMA MIDDLEWARE'İ (Authentication Middleware)
 * ============================================================================
 * 
 * Bu middleware, korumalı API rotalarına gelen isteklerde HTTP 'Authorization'
 * başlığındaki (Header) Bearer JWT Access Token'ı doğrular.
 * 
 * GÜVENLİK İLKELERİ:
 * - Kullanıcı kimliği (userId) hiçbir zaman URL veya Request Body üzerinden kabul edilmez.
 * - İstemcinin kimliği yalnızca dijital imzası doğrulanmış JWT Access Token içinden (`req.user`) okunur.
 * - Böylece yetkisiz bir kullanıcının başkasının `userId`'sini taklit ederek (IDOR Saldırısı)
 *   işlem yapması engellenir.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { AccessTokenPayload, verifyAccessToken } from '../services/authTokens';

/**
 * Express Request arabirimini genişleterek doğrulanmış kullanıcı payload'unu (`req.user`) taşır.
 */
export interface CustomRequest extends Request {
  user?: AccessTokenPayload;
}

/**
 * JWT Access Token Doğrulama Fonksiyonu
 */
export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  // 'Authorization: Bearer <token>' başlığını alıyoruz
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  const requestId = (req as CustomRequest & { id?: string }).id;

  // Başlıkta Token yoksa isteği 401 Unauthorized ile kes
  if (!token) {
    logger.warn({
      event: 'auth.token_missing',
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }, 'Access token missing');
    return res.status(401).json({ error: 'Yetkisiz erişim: Token bulunamadı.', code: 'UNAUTHORIZED' });
  }

  try {
    // Access token'ın imzasını, son kullanma tarihini ve audience/issuer bilgilerini doğruluyoruz
    req.user = verifyAccessToken(token);

    // Doğrulama başarılıysa zincirdeki bir sonraki rotaya geç
    next();
  } catch (error) {
    // Süresi dolmuş, imzası bozuk veya sahtelenmiş token'lar burada yakalanır
    logger.warn({
      event: 'auth.token_invalid',
      err: error,
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }, 'Invalid or expired access token');
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş access token.', code: 'UNAUTHORIZED' });
  }
};
