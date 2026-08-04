/**
 * ============================================================================
 * ZAMANLANMIŞ MESAJ WORKER SÜREÇ GİRİŞ NOKTASI (Standalone Worker Process Entry)
 * ============================================================================
 * 
 * Bu dosya, `scheduledMessageWorker.ts` modülünü bağımsız bir Node.js süreci (Process) 
 * veya Docker Container olarak başlatmak için giriş noktası (Entry Point) görevi görür.
 * 
 * ÖZELLİKLER:
 * - HTTP veya Socket.IO sunucusu açmaz.
 * - Sadece zamanlanmış mesaj teslimatı ve dosya temizliğinden sorumludur.
 * - `SIGINT`, `SIGTERM` sinyallerini yakalayarak veritabanı bağlantılarını ve log akışını 
 *   güvenle kapatır (Graceful Shutdown).
 */

import 'dotenv/config';
import { flushLogs, logger } from '../config/logger';
import prisma from '../db';
import { startScheduledMessageWorker } from './scheduledMessageWorker';

// Worker servisi başlatılır
const stopWorker = startScheduledMessageWorker();
let shuttingDown = false;

/** Süreci temiz bir şekilde sonlandıran (Graceful Shutdown) fonksiyon */
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'worker.scheduled_message_shutdown', signal }, 'Scheduled message worker shutting down');
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
  logger.fatal({ event: 'worker.scheduled_message_unhandled_rejection', err: reason }, 'Unhandled worker rejection');
});
process.on('uncaughtException', async (error) => {
  logger.fatal({ event: 'worker.scheduled_message_uncaught_exception', err: error }, 'Uncaught worker exception');
  await shutdown('uncaughtException');
  process.exit(1);
});

