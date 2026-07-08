import { createHmac, randomBytes } from 'crypto';
import { Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET ortam değişkeni tanımlı değil.');

// Dual-token mimarisi:
// - Access token kısa ömürlüdür ve API çağrılarında kullanılır.
// - Refresh token 30 gün yaşar ama API yetkisi vermez; sadece yeni access token almak için kullanılır.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE_NAME = 'refresh_token';

const jwtOptions = {
  // issuer/audience kontrolü token'ın bu uygulama ve bu API için üretildiğini doğrular.
  issuer: 'mesajlasma-app',
  audience: 'mesajlasma-api'
} as const;

export interface AccessTokenPayload extends JwtPayload {
  // Bu payload backend'de req.user içine yazılır; userId/senderId frontend body/query'den kabul edilmez.
  userId: string;
  username: string;
  tokenType: 'access';
  exp: number;
}

export const createAccessToken = (user: { id: string; username: string }) => jwt.sign(
  // Access token içinde hassas bilgi yoktur; sadece kullanıcıyı tanımak için gereken minimum alanlar vardır.
  { userId: user.id, username: user.username, tokenType: 'access' },
  jwtSecret,
  {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    ...jwtOptions
  }
);

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  // İmza, süre, issuer ve audience burada doğrulanır.
  // verify başarısızsa authMiddleware isteği 401 ile keser.
  const decoded = jwt.verify(token, jwtSecret, {
    algorithms: ['HS256'],
    ...jwtOptions
  });

  if (
    typeof decoded === 'string' ||
    decoded.tokenType !== 'access' ||
    typeof decoded.userId !== 'string' ||
    typeof decoded.username !== 'string' ||
    typeof decoded.exp !== 'number'
  ) {
    throw new Error('Geçersiz access token içeriği.');
  }

  return decoded as AccessTokenPayload;
};

// Refresh token JWT değildir; tahmin edilemeyen, tek amaçlı bir oturum anahtarıdır.
// İçinde userId veya başka anlamlı bilgi taşımaz; bu yüzden çalınsa bile DB kaydı/hash eşleşmesi gerekir.
export const createRefreshToken = () => randomBytes(48).toString('base64url');

// Veritabanı sızsa bile ham refresh token açığa çıkmasın diye yalnızca HMAC özeti saklanır.
export const hashRefreshToken = (token: string) => createHmac('sha256', jwtSecret)
  .update(token)
  .digest('hex');

export const getRefreshExpiry = () => new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

const cookieOptions = {
  // path '/api' olduğu için refresh cookie yalnızca backend API isteklerine eklenir.
  // Frontend route'larında veya statik asset isteklerinde gereksiz yere taşınmaz.
  // JavaScript refresh token'ı okuyamaz; production'da cookie yalnızca HTTPS üzerinden gider.
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  path: '/api'
};

export const setRefreshCookie = (res: Response, token: string, expiresAt: Date) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...cookieOptions,
    expires: expiresAt
  });
};

export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
};

export const readRefreshToken = (cookieHeader?: string): string | null => {
  // Express cookie-parser kullanmadan header'ı elle okuyoruz.
  // Bu dosya refresh token adını tek yerde tuttuğu için isim değişikliği kolaydır.
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
};
