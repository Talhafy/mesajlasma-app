/**
 * ============================================================================
 * KİMLİK DOĞRULAMA JETON VE ÇEREZ SERVİSİ (Auth Tokens & Cookie Service)
 * ============================================================================
 * 
 * Bu dosya, uygulamanın Çift Token Modeli (Dual-Token System) için gerekli olan 
 * JWT Access Token ve HttpOnly Refresh Token işlemlerini yürütür.
 * 
 * SÜRELER VE ÇEREZ POLİTİKASI:
 * 1. Access Token: 15 dakika ömürlü, Authorization: Bearer <token> ile taşınır.
 * 2. Refresh Token: 30 gün ömürlü, yalnızca HttpOnly & Secure cookie üzerinde saklanır.
 */

import { createHmac, randomBytes } from 'crypto';
import { Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET ortam değişkeni tanımlı değil.');

/** Access Token yaşam süresi (Saniye) -> 15 Dakika */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh Token yaşam süresi (Milisaniye) -> 30 Gün */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** HttpOnly Çerez Adı */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/** JWT İmzalamasında doğrulanan yayıncı ve hedef kitle bilgileri */
const jwtOptions = {
  issuer: 'mesajlasma-app',
  audience: 'mesajlasma-api'
} as const;

/** JWT Access Token İçi Yapısı */
export interface AccessTokenPayload extends JwtPayload {
  userId: string;
  username: string;
  tokenType: 'access';
  exp: number;
}

/**
 * Kullanıcı için 15 dakika geçerli JWT Access Token imzalar ve üretir.
 */
export const createAccessToken = (user: { id: string; username: string }) => jwt.sign(
  { userId: user.id, username: user.username, tokenType: 'access' },
  jwtSecret,
  {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    ...jwtOptions
  }
);

/**
 * Gelen JWT Access Token'ın imzasını, süresini, issuer ve audience bilgilerini doğrular.
 */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
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

/**
 * 48 baytlık rastgele güvenli (Cryptographically Secure) Refresh Token dizgisi üretir.
 */
export const createRefreshToken = () => randomBytes(48).toString('base64url');

/**
 * Veritabanında sızma olsa bile ham token'ın açığa çıkmaması için HMAC SHA-256 özeti üretir.
 */
export const hashRefreshToken = (token: string) => createHmac('sha256', jwtSecret)
  .update(token)
  .digest('hex');

/** Refresh Token'ın bitiş tarihini hesaplar */
export const getRefreshExpiry = () => new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

/** Refresh Token çerezi için güvenlik parametreleri */
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
  path: '/api'
};

/**
 * HTTP Yanıtına HttpOnly & Secure Refresh Token Çerezi Yerleştirir.
 */
export const setRefreshCookie = (res: Response, token: string, expiresAt: Date) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...cookieOptions,
    expires: expiresAt
  });
};

/**
 * İstemcideki Refresh Token Çerezini Temizler (Logout).
 */
export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
};

/**
 * HTTP İstek Başlığındaki (`Cookie` header) `refresh_token` değerini ayrıştırır.
 */
export const readRefreshToken = (cookieHeader?: string): string | null => {
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

