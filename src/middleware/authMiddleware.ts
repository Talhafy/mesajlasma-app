// authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { AccessTokenPayload, verifyAccessToken } from '../services/authTokens';

export interface CustomRequest extends Request {
  user?: AccessTokenPayload;
}

export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn({ event: 'auth.token_missing', ip: req.ip, path: req.originalUrl }, 'Access token missing');
    return res.status(401).json({ error: '🚨 Yetkisiz erişim: Token bulunamadı.' });
  }

  try {
    // Refresh cookie burada kabul edilmez; API erişimi yalnızca access token ile yapılır.
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    logger.warn({ event: 'auth.token_invalid', err: error, ip: req.ip, path: req.originalUrl }, 'Invalid or expired access token');
    return res.status(401).json({ error: '🚨 Geçersiz veya süresi dolmuş access token.' });
  }
};
