//Ortam değişkenleri için ayrı güvenlik amaçlı dosyamız
// import 'dotenv/config';
import path from 'path';

// .env dosyasındaki boolean değerler string gelir.
// Bu yardımcı hem "true/false" hem de "1/0, yes/no" gibi pratik değerleri destekler.
const parseBoolean = (key: string, defaultValue: boolean) => {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;

  throw new Error(`${key} true/false formatında olmalıdır.`);
};

const parseIntegerInRange = (key: string, defaultValue: number, min: number, max: number) => {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} ${min} ile ${max} arasında tam sayı olmalıdır.`);
  }

  return value;
};

const allowedLogLevels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
// LOG_LEVEL yanlış yazılırsa logger sessizce garip davranmasın diye başlangıçta hata veriyoruz.
const resolveLogLevel = () => {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (!allowedLogLevels.has(level)) {
    throw new Error(`LOG_LEVEL geçersiz: ${level}`);
  }

  return level;
};

const resolveLogFileName = () => {
  const fileName = process.env.LOG_FILE_NAME || 'app.log';
  // Log dosya adı path içeremez; aksi halde yanlışlıkla proje dışına dosya yazılabilir.
  if (path.basename(fileName) !== fileName) {
    throw new Error('LOG_FILE_NAME yalnızca dosya adı olmalıdır.');
  }

  return fileName;
};

// Ortam değişkenlerini tek noktada doğrular; hatalı ayarda sunucu yarım çalışmaz.
export const nodeEnv = process.env.NODE_ENV || 'development';
// Birden fazla API instance'ında Socket.IO odaları, presence ve rate-limit durumu Redis'te ortak tutulur.
// Development/test ortamı Redis olmadan çalışabilir; production'da sessiz bellek fallback'i tutarsız veri üretir.
export const redisUrl = process.env.REDIS_URL || '';
// Frontend adresi CORS ve CSRF origin kontrollerinde kullanılır; production'da mutlaka gerçek domain olmalı.
export const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
export const port = Number(process.env.PORT || 3000);
export const trustProxy = parseBoolean('TRUST_PROXY', false);

export const serviceName = process.env.SERVICE_NAME || 'mesajlasma-api';
export const logLevel = resolveLogLevel();
export const logDirectory = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
export const logFileEnabled = parseBoolean('LOG_FILE_ENABLED', true);
export const logFileName = resolveLogFileName();

export const livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
// LiveKit değerleri boş bırakılabilir; bu durumda call endpoint 503 döner.
// Böylece mesajlaşma uygulaması çağrı altyapısı kurulmadan da geliştirilebilir.
export const livekitApiKey = process.env.LIVEKIT_API_KEY || '';
export const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';
export const livekitTokenTtlSeconds = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 60 * 60);
export const scheduledMessageWorkerIntervalMs = parseIntegerInRange(
  'SCHEDULED_MESSAGE_WORKER_INTERVAL_MS',
  5_000,
  1_000,
  60_000
);
export const uploadedAssetTtlHours = parseIntegerInRange('UPLOADED_ASSET_TTL_HOURS', 24, 1, 168);
// Production defaults to fail-closed malware scanning. Set MALWARE_SCAN_ENABLED=false only for a
// deliberately isolated development environment; production needs a reachable ClamAV binary.
export const malwareScanEnabled = parseBoolean('MALWARE_SCAN_ENABLED', nodeEnv === 'production');
export const clamavBinary = process.env.CLAMAV_BINARY || 'clamscan';
export const malwareScanTimeoutMs = parseIntegerInRange('MALWARE_SCAN_TIMEOUT_MS', 60_000, 5_000, 5 * 60_000);

export const dbPoolMax = parseIntegerInRange('DB_POOL_MAX', 20, 2, 100);
export const dbPoolIdleTimeoutMs = parseIntegerInRange('DB_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 300_000);
export const dbPoolConnectionTimeoutMs = parseIntegerInRange('DB_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000);
export const dbStatementTimeoutMs = parseIntegerInRange('DB_STATEMENT_TIMEOUT_MS', 10_000, 1_000, 120_000);

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
