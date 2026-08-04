/**
 * ============================================================================
 * OPENAPI VE SWAGGER UI BİRİM TESTLERİ (OpenAPI & Swagger Documentation Tests)
 * ============================================================================
 * 
 * Bu dosya, `openapiSpec` nesnesinin OpenAPI 3.0.3 standartlarına uyumunu ve
 * `/api/v1/docs/json` ile `/api/v1/docs` Swagger UI uç noktalarını test eder.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { openapiSpec } from '../../src/docs/openapiSpec';
import docsRoutes from '../../src/routes/docs';

/** Test amaçlı Swagger docs uygulamasını oluşturan yardımcı */
const createDocsApp = () => {
  const app = express();
  app.use('/api/v1', docsRoutes);
  return app;
};

describe('OpenAPI documentation and Swagger UI tests', () => {
  it('should have a valid OpenAPI spec structure', () => {
    // OpenAPI spec nesnesi temel başlıkları ve şemaları içermelidir
    expect(openapiSpec.openapi).toBe('3.0.3');
    expect(openapiSpec.info.title).toContain('Mesajlaşma Uygulaması');
    expect(openapiSpec.paths).toHaveProperty('/auth/login');
    expect(openapiSpec.paths).toHaveProperty('/messages');
    expect(openapiSpec.components.schemas).toHaveProperty('AppErrorResponse');
  });

  it('should serve openapi spec JSON at /api/v1/docs/json', async () => {
    // /docs/json rotası geçerli JSON ve OpenAPI sürümü dönmelidir
    const res = await request(createDocsApp()).get('/api/v1/docs/json').expect(200);
    expect(res.header['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.0.3');
  });

  it('should serve Swagger UI at /api/v1/docs', async () => {
    // /docs rotası Swagger UI HTML arayüzünü sunmalıdır
    const res = await request(createDocsApp()).get('/api/v1/docs/').expect(200);
    expect(res.text).toContain('swagger-ui');
  });
});

