/**
 * ============================================================================
 * ZOD GİRDİ DOĞRULAMA MIDDLEWARE'İ (Request Validation Middleware)
 * ============================================================================
 * 
 * Bu middleware, istemciden (Frontend/Mobil) gelen verileri API rotasına ulaşmadan
 * önce Zod şemaları ile doğrular ve temizler (sanitize eder).
 * 
 * NEDEN KULLANILIR?
 * - Controller/Service katmanlarını kirli verileri temizleme yükünden kurtarır.
 * - Eksik, yanlış tipli veya zararlı (parametrik enjeksiyon) verilerin iş kuralı
 *   çalışmadan 400 Bad Request ile doğrudan reddedilmesini sağlar.
 */

import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

/**
 * Doğrulanabilecek istek alanlarını tanımlayan tip (body, URL parametreleri veya Query dizesi).
 */
type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

/**
 * Yüksek mertebeden fonksiyon (Higher-Order Function):
 * Verilen Zod şemalarını kullanarak istek üzerindeki body/params/query alanlarını sırayla dener.
 * 
 * Kullanım Örneği:
 * router.post('/login', validateRequest({ body: authSchemas.login }), loginController);
 */
export const validateRequest = (schemas: RequestSchemas) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Girdi alanlarını teker teker tarıyoruz: body (istek gövdesi), params (URL değişkenleri), query (URL sorgu dizgisi)
  for (const location of ['body', 'params', 'query'] as const) {
    const schema = schemas[location];
    if (!schema) continue;

    // Zod şeması üzerinden veriyi güvenle doğruluyoruz (safeParse istisna fırlatmaz, başarı nesnesi döner)
    const result = schema.safeParse(req[location]);

    // Eğer veri şemadaki kurallara uymuyorsa (ör. şifre kısa, e-posta geçersiz veya fazla alan enjekte edilmişse)
    if (!result.success) {
      return res.status(400).json({
        error: 'İstek verileri geçersiz.',
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    // Şema başarılı ise temizlenmiş/dönüştürülmüş veriyi istek üzerine geri yazarız
    if (location === 'body') req.body = result.data;
  }

  // Tüm doğrulamalar başarılı ise zincirdeki bir sonraki rotaya/middleware'e geç
  next();
};
