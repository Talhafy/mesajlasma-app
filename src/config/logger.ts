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

export const logger = pino(
  {
    level: logLevel,
    messageKey: 'message',
    base: {
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
  level: logLevel,
  service: serviceName,
  env: nodeEnv,
  stdout: true,
  file: Boolean(fileStream),
  logDirectory: fileStream ? logDirectory : null,
  logFilePath
});

export const flushLogs = () => new Promise<void>((resolve) => {
  if (!fileStream || fileStream.destroyed || fileStream.writableEnded) {
    resolve();
    return;
  }

  fileStream.end(resolve);
});
