import { logger } from '../config/logger';
import prisma from '../db';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { removeExpiredUnattachedAssets } from '../services/uploadedAssetService';

/** Periodic cleanup for expired messages and unattached files. */
export const startMessageCleanupWorker = () => {
  let workerRunning = false;

  const cleanup = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await prisma.message.deleteMany({
        where: { expiresAt: { lte: new Date() }, fileKey: null }
      });

      const expiredWithFiles = await prisma.message.findMany({
        where: { expiresAt: { lte: new Date() }, fileKey: { not: null } }
      });

      for (const message of expiredWithFiles) {
        try {
          await prisma.message.delete({ where: { id: message.id } });

          await deleteFileIfUnreferenced(message.fileKey);
        } catch (error) {
          logger.error({
            event: 'worker.expired_file_cleanup_failed',
            err: error,
            messageId: message.id,
            fileKey: message.fileKey
          }, 'Failed to clean up expired file or database record');
        }
      }

      await removeExpiredUnattachedAssets();
    } catch (error) {
      logger.error({ event: 'worker.message_cleanup_failed', err: error }, 'Message cleanup failed');
    } finally {
      workerRunning = false;
    }
  };

  const interval = setInterval(() => void cleanup(), 60_000);
  void cleanup();
  return () => clearInterval(interval);
};
