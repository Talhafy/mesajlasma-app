//İstekleri izleme, kimlik verme,  güvenlik olaylarını ayrıca işaretleme

import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
import { CustomRequest } from './authMiddleware';

export interface RequestWithId extends CustomRequest {
  id: string;
}

// Her HTTP isteğine tekil requestId veriyoruz.
// Bu id hem response header'a yazılır hem de bütün loglara eklenir; Kibana'da tek isteğin izini sürmeyi kolaylaştırır.
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incomingRequestId = req.headers['x-request-id'];
    const requestId = Array.isArray(incomingRequestId) ? incomingRequestId[0] : incomingRequestId || randomUUID();
    res.setHeader('x-request-id', requestId);
    return requestId;
  },
  customProps: (req, res) => {
    // pino-http varsayılan req/res alanlarını basar; customProps ile aradığımız operasyonel alanları düzleştiriyoruz.
    // Böylece dashboardlarda method/url/statusCode/userId/ip alanlarına direkt filtre atılabilir.
    const request = req as Request & { ip?: string };
    return {
      event: 'http.request',
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      userId: (req as CustomRequest).user?.userId || null,
      ip: request.ip || request.socket.remoteAddress || null
    };
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
      remotePort: req.remotePort
    }),
    res: (res) => ({
      statusCode: res.statusCode
    })
  }
});

// 401/403/429 durumları güvenlik açısından ayrıca izlenir.
// Request logger zaten genel kaydı atar; bu middleware ise security.* dashboard ve alertleri için ikinci, daha net sinyal üretir.
export const securityStatusLogger = (req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    if (![401, 403, 429].includes(res.statusCode)) return;
    const request = req as RequestWithId;
    logger.warn({
      event: 'security.http_status',
      requestId: request.id,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      userId: request.user?.userId || null,
      ip: req.ip
    }, 'Security relevant HTTP status');
  });
  next();
};
