import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { globalApiLimiter, loginLimiter } from '../../src/config/rateLimiters';
import { createRedisRateLimitStore } from '../../src/config/redisStore';

describe('Rate Limiters & Redis Store unit tests', () => {
  it('should create undefined store fallback when REDIS_URL is not set', () => {
    const store = createRedisRateLimitStore('test');
    expect(store).toBeUndefined();
  });

  it('should enforce rate limits and respond with 429 and RATE_LIMIT_EXCEEDED code', async () => {
    const app = express();
    const testLimiter = loginLimiter;

    app.post('/login', testLimiter, (_req, res) => {
      res.status(401).json({ error: 'Hatalı şifre' });
    });

    // Make 20 failed login requests (within limit)
    for (let i = 0; i < 20; i++) {
      await request(app).post('/login').expect(401);
    }

    // 21st failed request should be blocked with 429
    const res = await request(app).post('/login').expect(429);
    expect(res.body).toMatchObject({
      error: expect.any(String),
      code: 'RATE_LIMIT_EXCEEDED'
    });
  });
});
