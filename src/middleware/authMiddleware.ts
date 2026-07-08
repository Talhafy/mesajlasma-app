// authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { AccessTokenPayload, verifyAccessToken } from '../services/authTokens';

export interface CustomRequest extends Request {
  user?: AccessTokenPayload;
}

// API endpoint'lerinde kimlik bilgisi body/query'den değil Authorization header içindeki access token'dan alınır.
// Böylece frontend'in userId/senderId göndermesine güvenmek yerine kullanıcı kimliği JWT imzasıyla doğrulanır.
export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  const requestId = (req as CustomRequest & { id?: string }).id;

  if (!token) {
    // Token yoksa bu yalnızca normal hata değil, güvenlik açısından da izlenmesi gereken bir 401 durumudur.
    logger.warn({
      event: 'auth.token_missing',
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }, 'Access token missing');
    return res.status(401).json({ error: 'Yetkisiz erişim: Token bulunamadı.' });
  }

  try {
    // Refresh cookie burada kabul edilmez; API erişimi yalnızca kısa ömürlü access token ile yapılır.
    // Refresh cookie burada kabul edilmez; API erişimi yalnızca access token ile yapılır.
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    // Süresi dolmuş, bozulmuş veya yanlış imzalanmış token'lar burada yakalanır.
    // Loga token'ın kendisi asla yazılmaz; yalnızca sebep ve request bilgisi yazılır.
    logger.warn({
      event: 'auth.token_invalid',
      err: error,
      requestId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }, 'Invalid or expired access token');
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş access token.' });
  }
};
