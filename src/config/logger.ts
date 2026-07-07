import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logDirectory = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
fs.mkdirSync(logDirectory, { recursive: true });

const fileStream = fs.createWriteStream(path.join(logDirectory, 'app.log'), { flags: 'a' });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: process.env.SERVICE_NAME || 'mesajlasma-api',
      env: process.env.NODE_ENV || 'development'
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.password_hash',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.refreshSession',
        'authorization',
        'cookie'
      ],
      censor: '[REDACTED]'
    },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: fileStream }
  ])
);

export const flushLogs = () => {
  fileStream.end();
};
