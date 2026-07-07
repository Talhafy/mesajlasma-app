import 'dotenv/config';
import path from 'path';

const parseBoolean = (key: string, defaultValue: boolean) => {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;

  throw new Error(`${key} true/false formatında olmalıdır.`);
};

const allowedLogLevels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const resolveLogLevel = () => {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (!allowedLogLevels.has(level)) {
    throw new Error(`LOG_LEVEL geçersiz: ${level}`);
  }

  return level;
};

const resolveLogFileName = () => {
  const fileName = process.env.LOG_FILE_NAME || 'app.log';
  if (path.basename(fileName) !== fileName) {
    throw new Error('LOG_FILE_NAME yalnızca dosya adı olmalıdır.');
  }

  return fileName;
};

// Ortam değişkenlerini tek noktada doğrular; hatalı ayarda sunucu yarım çalışmaz.
export const nodeEnv = process.env.NODE_ENV || 'development';
export const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
export const port = Number(process.env.PORT || 3000);
export const trustProxy = parseBoolean('TRUST_PROXY', false);

export const serviceName = process.env.SERVICE_NAME || 'mesajlasma-api';
export const logLevel = resolveLogLevel();
export const logDirectory = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
export const logFileEnabled = parseBoolean('LOG_FILE_ENABLED', true);
export const logFileName = resolveLogFileName();

export const livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
export const livekitApiKey = process.env.LIVEKIT_API_KEY || '';
export const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';
export const livekitTokenTtlSeconds = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 60 * 60);

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
