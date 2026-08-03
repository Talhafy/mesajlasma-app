import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { openapiSpec } from '../../src/docs/openapiSpec';
import docsRoutes from '../../src/routes/docs';

const createDocsApp = () => {
  const app = express();
  app.use('/api/v1', docsRoutes);
  return app;
};

describe('OpenAPI documentation and Swagger UI tests', () => {
  it('should have a valid OpenAPI spec structure', () => {
    expect(openapiSpec.openapi).toBe('3.0.3');
    expect(openapiSpec.info.title).toContain('Mesajlaşma Uygulaması');
    expect(openapiSpec.paths).toHaveProperty('/auth/login');
    expect(openapiSpec.paths).toHaveProperty('/messages');
    expect(openapiSpec.components.schemas).toHaveProperty('AppErrorResponse');
  });

  it('should serve openapi spec JSON at /api/v1/docs/json', async () => {
    const res = await request(createDocsApp()).get('/api/v1/docs/json').expect(200);
    expect(res.header['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.0.3');
  });

  it('should serve Swagger UI at /api/v1/docs', async () => {
    const res = await request(createDocsApp()).get('/api/v1/docs/').expect(200);
    expect(res.text).toContain('swagger-ui');
  });
});
