/**
 * ============================================================================
 * SİSTEM SAĞLIK VE ENTEGRASYON TESTLERİ (Health Check API Integration Tests)
 * ============================================================================
 * 
 * Bu dosya, uygulamanın yaşam belirtisi (`/health/live`), veritabanı hazır olma
 * durumu (`/health/ready`) ve loglama güvenliği (`/health/logging`) uç noktalarını
 * HTTP düzeyinde (Supertest ile) test eder.
 * 
 * TEST KANITLARI:
 * 1. Liveness: Sunucunun ayakta ve çalışır durumda olduğunu doğrular.
 * 2. Readiness: Veritabanı kesintisinde `503 Service Unavailable` (Fail-Closed) döner.
 * 3. Log Güvenliği: Log durumunu döndürürken `JWT_SECRET` veya dosya yollarını sızdırmaz.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: { $queryRaw: queryRawMock }
}));

import healthRoutes from '../../src/routes/health';
import { notFoundHandler } from '../../src/middleware/errorHandler';

/** Test amaçlı geçici Express uygulaması oluşturan yardımcı */
const createTestApp = () => {
  const app = express();
  const v1Router = express.Router();
  v1Router.use(healthRoutes);
  app.use('/api/v1', v1Router);
  app.use('/api', v1Router);
  app.use(notFoundHandler);
  return app;
};

describe('health API', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    queryRawMock.mockResolvedValue([{ ok: 1 }]);
  });

  it('returns a machine-readable liveness response', async () => {
    // /health/live makine tarafından okunabilir 200 OK yanıtı dönmelidir
    const response = await request(createTestApp()).get('/api/v1/health/live').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it('keeps the legacy health route as a liveness alias', async () => {
    // Eski /health rotaları geriye dönük uyumluluk için 200 OK vermelidir
    await request(createTestApp()).get('/api/v1/health').expect(200);
    await request(createTestApp()).get('/api/health').expect(200);
  });

  it('reports database readiness and fails closed when the database is unavailable', async () => {
    // DB aktifken /health/ready 200 OK ve status: ready vermelidir
    const ready = await request(createTestApp()).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toMatchObject({
      status: 'ready',
      checks: { database: 'up', redis: 'disabled' }
    });

    // DB kesintisinde /health/ready 503 Service Unavailable ve status: not_ready vermelidir
    queryRawMock.mockRejectedValueOnce(new Error('database unavailable'));
    const unavailable = await request(createTestApp()).get('/api/v1/health/ready').expect(503);
    expect(unavailable.body).toMatchObject({
      status: 'not_ready',
      checks: { database: 'down', redis: 'disabled' }
    });
  });

  it('exposes logger readiness without secrets', async () => {
    // /health/logging hassas verileri (JWT_SECRET, log dosyası dizinleri) sızdırmamalıdır
    const response = await request(createTestApp()).get('/api/v1/health/logging').expect(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      logging: { service: 'mesajlasma-test', env: 'test', stdout: true, file: false }
    });
    expect(response.body.logging).not.toHaveProperty('logDirectory');
    expect(response.body.logging).not.toHaveProperty('logFilePath');
    expect(JSON.stringify(response.body)).not.toContain('JWT_SECRET');
  });

  it('keeps unknown routes behind the API 404 contract', async () => {
    // Var olmayan rotalarda global notFoundHandler çalışarak 404 yanıtı vermelidir
    await request(createTestApp()).get('/api/v1/does-not-exist').expect(404);
  });
});

