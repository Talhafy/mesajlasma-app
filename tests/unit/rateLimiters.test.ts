/**
 * ============================================================================
 * RATE LIMITER VE REDIS STORE BİRİM TESTLERİ (Rate Limiter Unit Tests)
 * ============================================================================
 * 
 * Bu dosya, Express rate limiter middleware'lerinin (login, register, upload vb.)
 * limit aşıldığında `429 Too Many Requests` ve `RATE_LIMIT_EXCEEDED` hata kodu
 * döndürdüğünü ve REDIS_URL olmadığında in-memory deposuna düştüğünü test eder.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { globalApiLimiter, loginLimiter } from '../../src/config/rateLimiters';
import { createRedisRateLimitStore } from '../../src/config/redisStore';

describe('Rate Limiters & Redis Store unit tests', () => {
  it('should create undefined store fallback when REDIS_URL is not set', () => {
    // REDIS_URL env yoksa express-rate-limit varsayılan belle içi depoya düşer (undefined store)
    const store = createRedisRateLimitStore('test');
    expect(store).toBeUndefined();
  });

  it('should enforce rate limits and respond with 429 and RATE_LIMIT_EXCEEDED code', async () => {
    // Giriş sınırını aşan istemci isteği 429 Too Many Requests ve RATE_LIMIT_EXCEEDED ile engellenmelidir
    const app = express();
    const testLimiter = loginLimiter;

    app.post('/login', testLimiter, (_req, res) => {
      res.status(401).json({ error: 'Hatalı şifre' });
    });

    // Limit dahilinde 20 başarısız istek atılıyor
    for (let i = 0; i < 20; i++) {
      await request(app).post('/login').expect(401);
    }

    // 21. istek limite takılarak 429 almalıdır
    const res = await request(app).post('/login').expect(429);
    expect(res.body).toMatchObject({
      error: expect.any(String),
      code: 'RATE_LIMIT_EXCEEDED'
    });
  });
});

