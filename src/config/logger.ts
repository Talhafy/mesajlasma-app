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

let fileStream: fs.WriteStream | null = null;
let logFilePath: string | null = null;

// Logger iki hedefe yazabilir: terminal ve dosya.
// Dosya açılamazsa uygulama durmaz; terminal loglarıyla çalışmaya devam eder.
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

const streams = fileStream
  ? [{ stream: process.stdout }, { stream: fileStream }]
  : [{ stream: process.stdout }];

// Merkezi logger: backend'deki tüm modüller console.* yerine bunu kullanır.
// Pino JSON log ürettiği için Logstash/Elasticsearch tarafında alan bazlı filtreleme kolaylaşır.
export const logger = pino(
  {
    level: logLevel,
    messageKey: 'message',
    base: {
      // Her log kaydına servis ve environment bilgisi eklenir.
      // Aynı Elastic cluster içinde birden fazla servis olursa ayırmayı kolaylaştırır.
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
      // Güvenlik: token, cookie ve şifre benzeri alanlar loga düz metin yazılmaz.
      // Bir hata objesi request body taşısa bile bu alanlar [REDACTED] olarak maskelenir.
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

export const loggerRuntime = Object.freeze({
  // Health endpoint bu bilgiyi döner; logging gerçekten dosyaya yazıyor mu hızlıca kontrol edilir.
  level: logLevel,
  service: serviceName,
  env: nodeEnv,
  stdout: true,
  file: Boolean(fileStream),
  logDirectory: fileStream ? logDirectory : null,
  logFilePath
});

export const flushLogs = () => new Promise<void>((resolve) => {
  // Graceful shutdown sırasında dosya stream'i kapanmadan process sonlanırsa son loglar kaybolabilir.
  if (!fileStream || fileStream.destroyed || fileStream.writableEnded) {
    resolve();
    return;
  }

  fileStream.end(resolve);
});
