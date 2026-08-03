/**
 * ============================================================================
 * HTTP RATE LIMITER KONFİGÜRASYONU (Rate Limiters & Abuse Protection)
 * ============================================================================
 * 
 * Bu dosya, uygulamadaki hassas uç noktalara (Giriş, Kayıt, Dosya Yükleme vb.)
 * yapılan aşırı istekleri (Brute-Force & DDoS) engellemek için kullanılan
 * hız sınırlayıcılarını tanımlar.
 * 
 * GÜVENLİK İLKELERİ:
 * 1. Her hassas işlem için ayrı bir `windowMs` (zaman penceresi) ve `limit` tanımlanır.
 * 2. Sayaçlar Redis üzerinde tutularak sunucular arası dağıtık koruma sağlanır.
 * 3. Hız sınırına takılan her istek güvenlik olayı (`security.rate_limit`) olarak loglanır
 *    ve 429 Too Many Requests yanıtı döner.
 */

import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logger } from './logger';
import { createRedisRateLimitStore } from './redisStore';

type RequestWithLogContext = Request & {
  id?: unknown;
  user?: { userId?: string };
};

/**
 * Tüm sınırlayıcıların paylaştığı standart HTTP RateLimit başlık ayarları.
 * modern `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` başlıklarını otomatik ekler.
 */
const commonOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false
};

/**
 * Hız sınırına takılan istekleri güvenlik uyarısı olarak loglayan ve 429 yanıtı dönen işleyici.
 */
const sendRateLimitResponse = (
  req: RequestWithLogContext,
  res: Response,
  limiter: string,
  error: string
) => {
  logger.warn({
    event: 'security.rate_limit',
    requestId: req.id === undefined ? undefined : String(req.id),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.userId || null,
    limiter
  }, 'Rate limit exceeded');

  return res.status(429).json({ error, code: 'RATE_LIMIT_EXCEEDED' });
};

/**
 * GİRİŞ İSTEKLERİ SINIRLAYICISI (Login Rate Limiter)
 * - Pencere: 15 Dakika
 * - Maksimum Başarısız Deneme: 20
 * - `skipSuccessfulRequests: true` sayesinde doğru şifreyle yapılan başarılı girişler kotayı tüketmez.
 */
export const loginLimiter = rateLimit({
  ...commonOptions,
  store: createRedisRateLimitStore('login'),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.', code: 'RATE_LIMIT_EXCEEDED' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'login',
    'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.'
  )
});

/**
 * KULLANICI KAYIT SINIRLAYICISI (Register Rate Limiter)
 * - Pencere: 1 Saat
 * - Maksimum Kayıt Denemesi: 10
 * - Otomatik hesap açma botlarına ve Spam üyeliklere karşı koruma sağlar.
 */
export const registerLimiter = rateLimit({
  ...commonOptions,
  store: createRedisRateLimitStore('register'),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok fazla hesap oluşturma denemesi yaptınız. Lütfen daha sonra tekrar deneyin.', code: 'RATE_LIMIT_EXCEEDED' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'register',
    'Çok fazla hesap oluşturma denemesi yaptınız. Lütfen daha sonra tekrar deneyin.'
  )
});

/**
 * REFRESH TOKEN SINIRLAYICISI (Refresh Rate Limiter)
 * - Pencere: 5 Dakika
 * - Maksimum İstek: 30
 * - Refresh token döngüsünün kötüye kullanılmasını engeller.
 */
export const refreshLimiter = rateLimit({
  ...commonOptions,
  store: createRedisRateLimitStore('refresh'),
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: { error: 'Çok fazla token yenileme isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.', code: 'RATE_LIMIT_EXCEEDED' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'refresh',
    'Çok fazla token yenileme isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.'
  )
});

/**
 * DOSYA YÜKLEME SINIRLAYICISI (Upload Rate Limiter)
 * - Pencere: 5 Dakika
 * - Maksimum Yükleme: 10
 * - Depolama maliyetini (Cloudflare R2) ve bant genişliği tüketimini korur.
 */
export const uploadLimiter = rateLimit({
  ...commonOptions,
  store: createRedisRateLimitStore('upload'),
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok kısa sürede çok fazla dosya yüklediniz. Lütfen birkaç dakika bekleyin.', code: 'RATE_LIMIT_EXCEEDED' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'upload',
    'Çok kısa sürede çok fazla dosya yüklediniz. Lütfen birkaç dakika bekleyin.'
  )
});

/**
 * GENEL API SINIRLAYICISI (Global API Limiter)
 * - Pencere: 15 Dakika
 * - IP Başına Maksimum İstek: 500
 * - Tüm API uç noktaları için genel DDoS ve kaynak tüketim koruması sağlar.
 */
export const globalApiLimiter = rateLimit({
  ...commonOptions,
  store: createRedisRateLimitStore('global'),
  windowMs: 15 * 60 * 1000,
  limit: 500,
  message: { error: 'Çok fazla API isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.', code: 'RATE_LIMIT_EXCEEDED' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'global_api',
    'Çok fazla API isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.'
  )
});
