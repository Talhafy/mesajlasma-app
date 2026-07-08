import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logger } from './logger';

type RequestWithLogContext = Request & {
  id?: unknown;
  user?: { userId?: string };
};

// Bütün rate limiter'lar aynı header formatını kullanır.
// standardHeaders ile istemci kalan hak / reset süresi bilgisini modern RateLimit header'larından okuyabilir.
const commonOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false
};

// Rate limit'e takılan her istek güvenlik olayıdır.
// Bu yüzden yalnızca 429 dönmekle kalmıyoruz; requestId, kullanıcı, IP ve limiter adıyla logluyoruz.
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

  return res.status(429).json({ error });
};

// Başarılı girişler sayılmaz; yalnızca kaba kuvvet denemeleri kotayı tüketir.
export const loginLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'login',
    'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.'
  )
});

export const registerLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok fazla hesap oluşturma denemesi yaptınız. Lütfen daha sonra tekrar deneyin.' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'register',
    'Çok fazla hesap oluşturma denemesi yaptınız. Lütfen daha sonra tekrar deneyin.'
  )
});

// Refresh endpoint'i API çağrılarından ayrı sınırlanır; normal mesaj trafiğini etkilemez.
export const refreshLimiter = rateLimit({
  ...commonOptions,
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: { error: 'Çok fazla token yenileme isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'refresh',
    'Çok fazla token yenileme isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.'
  )
});

// Büyük dosya yüklemelerinde hem bellek tüketimini hem R2 maliyetini sınırlar.
export const uploadLimiter = rateLimit({
  ...commonOptions,
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok kısa sürede çok fazla dosya yüklediniz. Lütfen birkaç dakika bekleyin.' },
  handler: (req, res) => sendRateLimitResponse(
    req,
    res,
    'upload',
    'Çok kısa sürede çok fazla dosya yüklediniz. Lütfen birkaç dakika bekleyin.'
  )
});
