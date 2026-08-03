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
    const response = await request(createTestApp()).get('/api/v1/health/live').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it('keeps the legacy health route as a liveness alias', async () => {
    await request(createTestApp()).get('/api/v1/health').expect(200);
    await request(createTestApp()).get('/api/health').expect(200);
  });

  it('reports database readiness and fails closed when the database is unavailable', async () => {
    const ready = await request(createTestApp()).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toMatchObject({
      status: 'ready',
      checks: { database: 'up', redis: 'disabled' }
    });

    queryRawMock.mockRejectedValueOnce(new Error('database unavailable'));
    const unavailable = await request(createTestApp()).get('/api/v1/health/ready').expect(503);
    expect(unavailable.body).toMatchObject({
      status: 'not_ready',
      checks: { database: 'down', redis: 'disabled' }
    });
  });

  it('exposes logger readiness without secrets', async () => {
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
    await request(createTestApp()).get('/api/v1/does-not-exist').expect(404);
  });
});
