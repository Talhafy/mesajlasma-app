/**
 * ============================================================================
 * SWAGGER UI VE OPENAPI DOKÜMANTASYON ROTALARI (API Documentation Routes)
 * ============================================================================
 * 
 * Bu dosya, backend API'lerinin interaktif dokümantasyon arayüzünü (Swagger UI)
 * ve ham OpenAPI spesifikasyonunu (JSON) yayınlayan rotaları içerir.
 * 
 * SUNULAN UÇ NOKTALAR:
 * 1. GET /api/v1/docs/json  -> Ham OpenAPI 3.0 JSON belgesi
 * 2. GET /api/v1/docs       -> Tarayıcıda canlı test yapılabilen Swagger UI ekranı
 */

import express, { Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from '../docs/openapiSpec';

const router = express.Router();

/**
 * GET /api/v1/docs/json -> OpenAPI JSON Spesifikasyonu
 * Ham OpenAPI 3.0 JSON spesifikasyonunu indirmek veya SDK üretmek isteyen istemcilere sunar.
 */
router.get('/docs/json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify(openapiSpec, null, 2));
});

/**
 * GET /api/v1/docs -> İnteraktif Swagger UI Ekranı
 * Tarayıcı üzerinden API'lerin canlı incelenmesini ve test edilmesini sağlayan Swagger UI arayüzü.
 */
router.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'Mesajlaşma App API Dokümantasyonu'
}));

export default router;

