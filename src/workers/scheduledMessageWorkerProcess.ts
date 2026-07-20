import 'dotenv/config';
import { flushLogs, logger } from '../config/logger';
import prisma from '../db';
import { startScheduledMessageWorker } from './scheduledMessageWorker';

// This entry point starts no HTTP or Socket.IO server. Run it as a dedicated process/container.
const stopWorker = startScheduledMessageWorker();
let shuttingDown = false;

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
