/**
 * ============================================================================
 * UYGULAMA ÖZEL HATA MODELİ (AppError Infrastructure)
 * ============================================================================
 * 
 * Bu dosya, tüm uygulamadaki hata yönetimini standartlaştıran merkezi hata sınıfını
 * ve tip güvenli hata kodlarını tanımlar.
 * 
 * NEDEN KULLANILIR?
 * - Standart JavaScript 'Error' sınıfı yalnızca mesaj taşıyabilir (HTTP kodu ve hata kodu taşıyamaz).
 * - AppError sayesinde her hata nesnesi bir HTTP Durum Kodu (400, 401, 403, 404, 500 vb.)
 *   ve makine tarafından okunabilir benzersiz bir 'code' (örn: CONVERSATION_FORBIDDEN) taşır.
 * - Frontend tarafı Türkçe metin analizi yapmak zorunda kalmaz; doğrudan 'code' değerine bakarak
 *   kullanıcıya uygun arayüz bildirimleri verebilir.
 */

/**
 * Uygulamada fırlatılabilecek tüm makine-okunabilir hata kodlarının kümesi.
 */
export type AppErrorCode =
  // Standart Faz 1 Hata Kodları
  | 'CONVERSATION_FORBIDDEN'      // Sohbete erişim yetkisi yok
  | 'MESSAGE_NOT_FOUND'           // Mesaj bulunamadı
  | 'ASSET_NOT_OWNED'             // Dosya yükleyen kullanıcıya ait değil
  | 'VALIDATION_ERROR'            // Girdi doğrulama hatası (Zod şemasına uymuyor)
  // Sohbet ve Mesajlaşma Kodları
  | 'CONVERSATION_NOT_FOUND'      // Sohbet oturumu bulunamadı
  | 'MESSAGE_FORBIDDEN'           // Mesaj üzerinde işlem yetkisi yok (örn: başkasının mesajını silme)
  | 'CHANNEL_NOT_FOUND'           // Oyun kanalı bulunamadı
  | 'CHANNEL_FORBIDDEN'           // Kanala erişim yetkisi yok
  | 'CHANNEL_LIMIT_REACHED'       // Kanal katılımcı sınırı doldu
  | 'CHANNEL_DUPLICATE'           // Aynı isimde kanal zaten var
  // Kullanıcı ve Oturum Kodları
  | 'USER_NOT_FOUND'              // Kullanıcı bulunamadı
  | 'USER_BLOCKED'                // Kullanıcı engellenmiş
  | 'CANNOT_BLOCK_SELF'           // Kendini engellemeye çalışma hatası
  | 'CANNOT_CHAT_SELF'            // Kendisiyle sohbet başlatma hatası
  | 'UNAUTHORIZED'                // Oturum açılmamış / Token geçersiz
  | 'INVALID_CREDENTIALS'         // Giriş bilgileri hatalı (E-posta veya Şifre)
  // Güvenlik ve Depolama Kodları
  | 'ASSET_EXPIRED_OR_REJECTED'   // Dosyanın yükleme süresi dolmuş veya zararlı bulunarak reddedilmiş
  | 'FILE_NOT_FOUND'              // Depolamadaki dosya bulunamadı
  | 'MALWARE_DETECTED'            // Virüs / Zararlı yazılım tespit edildi
  | 'MALWARE_SCANNER_UNAVAILABLE' // Virüs tarayıcı sunucuya ulaşılamıyor
  // Genel HTTP Kodları
  | 'FORBIDDEN'                   // Yetkisiz erişim (403)
  | 'NOT_FOUND'                   // Bulunamadı (404)
  | 'CONFLICT'                    // Çakışma var (409)
  | 'BAD_REQUEST'                 // Hatalı istek (400)
  | 'RATE_LIMIT_EXCEEDED'         // İstek sınırı aşıldı (429)
  | 'INTERNAL_ERROR';             // Sunucu içi beklenmeyen hata (500)

/**
 * Standart Error sınıfını genişleten özel uygulama hatası sınıfı.
 */
export class AppError extends Error {
  /** HTTP Durum Kodu (ör. 400, 401, 403, 404, 500) */
  public readonly statusCode: number;
  /** Makine tarafından okunabilir hata kodu (ör. 'CONVERSATION_FORBIDDEN') */
  public readonly code: AppErrorCode;
  /** Ekstra teknik detaylar veya Zod alan hataları */
  public readonly details?: any;
  /** Hatayla ilgili bilinen operasyonel bir durum mu olduğunu belirtir (true: tahmin edilen iş kuralı hatası) */
  public readonly isOperational: boolean;

  constructor(
    code: AppErrorCode,
    message: string,
    statusCode: number = 400,
    details?: any
  ) {
    super(message);
    // TypeScript miras alma yapısında prototype zincirini düzeltir
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }

  // --- STATİK FABRİKA YARDIMCILARI (Helper Factory Methods) ---

  /** 400 Bad Request (Hatalı İstek) Hatası Üretir */
  static badRequest(code: AppErrorCode, message: string, details?: any): AppError {
    return new AppError(code, message, 400, details);
  }

  /** 401 Unauthorized (Yetkisiz/Oturumsuz İstek) Hatası Üretir */
  static unauthorized(code: AppErrorCode = 'UNAUTHORIZED', message: string = 'Yetkisiz erişim.'): AppError {
    return new AppError(code, message, 401);
  }

  /** 403 Forbidden (Yasaklı İşlem) Hatası Üretir */
  static forbidden(code: AppErrorCode = 'FORBIDDEN', message: string = 'Bu işlem için yetkiniz yok.'): AppError {
    return new AppError(code, message, 403);
  }

  /** 404 Not Found (Bulunamadı) Hatası Üretir */
  static notFound(code: AppErrorCode = 'NOT_FOUND', message: string = 'Kayıt bulunamadı.'): AppError {
    return new AppError(code, message, 404);
  }

  /** 409 Conflict (Veri Çakışması) Hatası Üretir */
  static conflict(code: AppErrorCode = 'CONFLICT', message: string = 'Çakışma oluştu.'): AppError {
    return new AppError(code, message, 409);
  }

  /** 400 Validation Error (Girdi Şeması Doğrulama) Hatası Üretir */
  static validation(message: string = 'Geçersiz veri biçimi.', details?: any): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, details);
  }

  /** 500 Internal Error (Sunucu İçi Beklenmeyen) Hatası Üretir */
  static internal(message: string = 'Beklenmeyen sunucu hatası.'): AppError {
    const error = new AppError('INTERNAL_ERROR', message, 500);
    (error as any).isOperational = false;
    return error;
  }
}

/**
 * Express Route / Catch bloklarında yakalanan hataları istemciye standart JSON formatında dönen yardımcı fonksiyon.
 * 
 * Yanıt Formatı Örneği:
 * HTTP status: 403
 * {
 *   "error": "Bu sohbete erişim yetkiniz yok.",
 *   "code": "CONVERSATION_FORBIDDEN"
 * }
 */
export const respondWithError = (
  res: { status: (code: number) => { json: (body: any) => any } },
  error: unknown,
  fallbackMessage = 'İşlem başarısız.'
) => {
  // Eğer fırlatılan hata bizim tanımladığımız AppError sınıfından ise onun HTTP kodu ve code bilgisini döneriz.
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {})
    });
  }

  // Tanımlanmamış veya beklenmeyen bir sistem hatası ise 500 Internal Error döneriz.
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
};
