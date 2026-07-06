// authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import { AccessTokenPayload, verifyAccessToken } from '../services/authTokens';

export interface CustomRequest extends Request {
  user?: AccessTokenPayload;
}

export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "🚨 Yetkisiz erişim: Token bulunamadı." });

  try {
    // Refresh cookie burada kabul edilmez; API erişimi yalnızca access token ile yapılır.
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "🚨 Geçersiz veya süresi dolmuş access token." });
  }
};
