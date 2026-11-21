/** Süresi dolan mesaj ve dosyaları temizleyen bağımsız süreç. */

import 'dotenv/config';
import { flushLogs, logger } from '../config/logger';
import prisma from '../db';
import { startMessageCleanupWorker } from './messageCleanupWorker';

// Worker servisi başlatılır
const stopWorker = startMessageCleanupWorker();
let shuttingDown = false;

/** Süreci temiz bir şekilde sonlandıran (Graceful Shutdown) fonksiyon */
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'worker.message_cleanup_shutdown', signal }, 'Message cleanup worker shutting down');
  stopWorker();

  try {
    await prisma.$disconnect();
  } finally {
    await flushLogs();
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ event: 'worker.message_cleanup_unhandled_rejection', err: reason }, 'Unhandled worker rejection');
});
process.on('uncaughtException', async (error) => {
  logger.fatal({ event: 'worker.message_cleanup_uncaught_exception', err: error }, 'Uncaught worker exception');
  await shutdown('uncaughtException');
  process.exit(1);
});

