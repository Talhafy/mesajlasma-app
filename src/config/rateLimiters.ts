import { rateLimit } from 'express-rate-limit';

const commonOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false
};

// Başarılı girişler sayılmaz; yalnızca kaba kuvvet denemeleri kotayı tüketir.
export const loginLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.' }
});

export const registerLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok fazla hesap oluşturma denemesi yaptınız. Lütfen daha sonra tekrar deneyin.' }
});

// Refresh endpoint'i API çağrılarından ayrı sınırlanır; normal mesaj trafiğini etkilemez.
export const refreshLimiter = rateLimit({
  ...commonOptions,
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: { error: 'Çok fazla token yenileme isteği gönderdiniz. Lütfen daha sonra tekrar deneyin.' }
});

// Büyük dosya yüklemelerinde hem bellek tüketimini hem R2 maliyetini sınırlar.
export const uploadLimiter = rateLimit({
  ...commonOptions,
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: { error: 'Çok kısa sürede çok fazla dosya yüklediniz. Lütfen birkaç dakika bekleyin.' }
});
