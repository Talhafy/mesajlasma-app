/**
 * ============================================================================
 * ORTAM DEĞİŞKENLERİ VE KONFİGÜRASYON DOĞRULAMA (Environment Config)
 * ============================================================================
 * 
 * Bu dosya `.env` dosyasından veya işletim sisteminden okunan ortam değişkenlerini
 * tiplerine göre doğrular, varsayılan değerlerini atar ve uygulamanın çalışma
 * zamanındaki tüm konfigürasyon parametrelerini tek bir güvenli noktadan dışa aktarır.
 * 
 * Hatalı/eksik konfigürasyon durumunda sunucunun eksik çalışmasını önlemek için 
 * uygulama henüz başlatılırken hemen (fail-fast) hata verir ve durur.
 */

import path from 'path';

/**
 * Ortam değişkeninden gelen string metni boolean (true/false) değere dönüştürür.
 * "1", "true", "yes", "on" gibi değerleri `true`; "0", "false", "no", "off" değerlerini `false` kabul eder.
 */
const parseBoolean = (key: string, defaultValue: boolean) => {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;

  throw new Error(`${key} true/false formatında olmalıdır.`);
};

/**
 * Ortam değişkeninden gelen değeri belirtilen sayı aralığında (min-max) tam sayıya (integer) dönüştürür.
 */
const parseIntegerInRange = (key: string, defaultValue: number, min: number, max: number) => {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} ${min} ile ${max} arasında tam sayı olmalıdır.`);
  }

  return value;
};

/** Kabul edilen geçerli log seviyeleri listesi */
const allowedLogLevels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

/**
 * LOG_LEVEL parametresini doğrular; geçersiz yazım durumunda hata fırlatır.
 */
const resolveLogLevel = () => {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (!allowedLogLevels.has(level)) {
    throw new Error(`LOG_LEVEL geçersiz: ${level}`);
  }

  return level;
};

/**
 * Log dosya adını doğrular. Dosya adının dizin yolu (path) içermesini engeller.
 */
const resolveLogFileName = () => {
  const fileName = process.env.LOG_FILE_NAME || 'app.log';
  // Log dosya adı path içeremez; aksi halde yanlışlıkla proje dışına dosya yazılabilir.
  if (path.basename(fileName) !== fileName) {
    throw new Error('LOG_FILE_NAME yalnızca dosya adı olmalıdır.');
  }

  return fileName;
};

// ----------------------------------------------------------------------------
// DIŞA AKTARILAN GENEL SUNUCU VE SİSTEM KONFİGÜRASYONLARI
// ----------------------------------------------------------------------------

/** Sunucunun çalışma ortamı ('development', 'production', 'test') */
export const nodeEnv = process.env.NODE_ENV || 'development';

/** Sunucu birden fazla örnek (instance) olarak çalıştığında Socket.IO, presence ve rate-limit paylaşımı sağlayan Redis URL'si */
export const redisUrl = process.env.REDIS_URL || '';

/** Frontend uygulamasının adresi (CORS ve CSRF origin kontrollerinde kullanılır) */
export const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

/** API sunucusunun dinleyeceği port numarası (Varsayılan: 3000) */
export const port = Number(process.env.PORT || 3000);

/** Nginx/Cloudflare gibi ters proxy arkasında çalışırken istemci IP'sine güvenilip güvenilmeyeceği */
export const trustProxy = parseBoolean('TRUST_PROXY', false);

/** Servis adı (Loglarda ve izleme araçlarında kullanılır) */
export const serviceName = process.env.SERVICE_NAME || 'mesajlasma-api';

/** Aktif log seviyesi ('info', 'debug', 'error' vb.) */
export const logLevel = resolveLogLevel();

/** Log dosyalarının kaydedileceği klasör yolu */
export const logDirectory = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));

/** Günlüğün dosyaya yazılıp yazılmayacağı bayrağı */
export const logFileEnabled = parseBoolean('LOG_FILE_ENABLED', true);

/** Log dosyasının adı */
export const logFileName = resolveLogFileName();

/** LiveKit sesli/görüntülü görüşme sunucusu WebSocket adresi */
export const livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';

/** LiveKit API anahtarı */
export const livekitApiKey = process.env.LIVEKIT_API_KEY || '';

/** LiveKit API gizli şifresi */
export const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';

/** LiveKit katılım jetonlarının (token) yaşam süresi (Saniye) */
export const livekitTokenTtlSeconds = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 60 * 60);

/** Zamanlanmış mesaj işleyici arka plan servisinin çalışma sıklığı (Milisaniye) */
export const scheduledMessageWorkerIntervalMs = parseIntegerInRange(
  'SCHEDULED_MESSAGE_WORKER_INTERVAL_MS',
  5_000,
  1_000,
  60_000
);

/** Yüklenen geçici dosyaların silinmeden önceki saklanma süresi (Saat) */
export const uploadedAssetTtlHours = parseIntegerInRange('UPLOADED_ASSET_TTL_HOURS', 24, 1, 168);

/** Yüklenen dosyalarda zararlı yazılım (Malware - ClamAV) taramasının aktifliği */
export const malwareScanEnabled = parseBoolean('MALWARE_SCAN_ENABLED', nodeEnv === 'production');

/** ClamAV tarayıcı çalıştırılabilir dosya adı/yolu */
export const clamavBinary = process.env.CLAMAV_BINARY || 'clamscan';

/** Zararlı yazılım taramasının zaman aşımı süresi (Milisaniye) */
export const malwareScanTimeoutMs = parseIntegerInRange('MALWARE_SCAN_TIMEOUT_MS', 60_000, 5_000, 5 * 60_000);

/** Veritabanı bağlantı havuzu maksimum bağlantı sayısı */
export const dbPoolMax = parseIntegerInRange('DB_POOL_MAX', 20, 2, 100);

/** Veritabanı bağlantı havuzu boşta kalma süresi (Milisaniye) */
export const dbPoolIdleTimeoutMs = parseIntegerInRange('DB_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 300_000);

/** Veritabanı bağlantı havuzu bağlantı zaman aşımı süresi (Milisaniye) */
export const dbPoolConnectionTimeoutMs = parseIntegerInRange('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000);

/** Veritabanı sorgu zaman aşımı süresi (Milisaniye) */
export const dbStatementTimeoutMs = parseIntegerInRange('DB_STATEMENT_TIMEOUT_MS', 10_000, 1_000, 120_000);

// PRODUCTION ÖZEL KRİTİK KONTROLLER
if (nodeEnv === 'production' && !redisUrl) {
  throw new Error('Production ölçeklenebilir Socket.IO için REDIS_URL tanımlanmalıdır.');
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT geçerli bir port numarası olmalıdır.');
}

if (
  !Number.isInteger(livekitTokenTtlSeconds) ||
  livekitTokenTtlSeconds < 60 ||
  livekitTokenTtlSeconds > 24 * 60 * 60
) {
  throw new Error('LIVEKIT_TOKEN_TTL_SECONDS 60 ile 86400 arasında olmalıdır.');
}
