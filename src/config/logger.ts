/**
 * ============================================================================
 * MERKEZİ LOGGING (GÜNLÜK) YAPILANDIRMASI (Pino Logger Config)
 * ============================================================================
 * 
 * Bu dosya, tüm backend uygulamasında `console.log` veya `console.error` yerine 
 * kullanılan yüksek performanslı, yapay zekaya ve Logstash/Elasticsearch 
 * indekslemesine uygun JSON formatında günlükleme (logging) motorunu yapılandırır.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import {
  logDirectory,
  logFileEnabled,
  logFileName,
  logLevel,
  nodeEnv,
  serviceName
} from './env';

/** Dosyaya yazma akışı (WriteStream) referansı */
let fileStream: fs.WriteStream | null = null;
/** Log dosyasının tam sistem yolu */
let logFilePath: string | null = null;

/**
 * Dosyaya Günlükleme Ayarı:
 * Eğer LOG_FILE_ENABLED=true ise hedef klasörü oluşturur ve append ('a') modunda dosyayı açar.
 * Herhangi bir dosya hatasında sunucu çökmez, loglar terminale (stdout) akmaya devam eder.
 */
if (logFileEnabled) {
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    logFilePath = path.join(logDirectory, logFileName);
    fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    fileStream.on('error', (error) => {
      process.stderr.write(`[logger] log file stream failed: ${error.message}\n`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[logger] file logging disabled: ${message}\n`);
    logFilePath = null;
    fileStream = null;
  }
}

/** Log akış hedefleri: Terminal (stdout) ve isteğe bağlı log dosyası */
const streams = fileStream
  ? [{ stream: process.stdout }, { stream: fileStream }]
  : [{ stream: process.stdout }];

/**
 * MERKEZİ PINO LOGGER NESNESİ
 * Tüm backend servislerinde `logger.info()`, `logger.error()`, `logger.warn()` olarak kullanılır.
 */
export const logger = pino(
  {
    level: logLevel,
    messageKey: 'message',
    base: {
      // Her log satırına otomatik eklenen ortak servis ve ortam bilgisi
      service: serviceName,
      env: nodeEnv
    },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: () => ({
        pid: process.pid,
        hostname: os.hostname()
      })
    },
    serializers: {
      err: pino.stdSerializers.err
    },
    redact: {
      // GÜVENLİK VE GİZLİLİK (Data Masking):
      // Şifreler, token'lar ve cookie bilgileri günlüklere asla düz metin yazılmaz.
      // Bu yollar üzerindeki tüm hassas veriler otomatik olarak [REDACTED] ile maskelenir.
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.accessToken',
        'req.body.refreshToken',
        'res.headers["set-cookie"]',
        '*.password',
        '*.password_hash',
        '*.passwordHash',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.refreshTokenHash',
        '*.refreshSession',
        'authorization',
        'cookie'
      ],
      censor: '[REDACTED]'
    },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  pino.multistream(streams)
);

/**
 * Uygulamanın anlık loglama durumunu ve dosya konumunu raporlayan çalışma zamanı bilgisi.
 * (Sağlık `/health/ready` uç noktasında kullanılır).
 */
export const loggerRuntime = Object.freeze({
  level: logLevel,
  service: serviceName,
  env: nodeEnv,
  stdout: true,
  file: Boolean(fileStream),
  logDirectory: fileStream ? logDirectory : null,
  logFilePath
});

/**
 * Sunucu güvenli olarak kapatılırken (Graceful Shutdown) askıdaki son logların 
 * dosyaya tam yazılmasını garanti eden boşaltma (flush) fonksiyonu.
 */
export const flushLogs = () => new Promise<void>((resolve) => {
  if (!fileStream || fileStream.destroyed || fileStream.writableEnded) {
    resolve();
    return;
  }

  fileStream.end(resolve);
});

