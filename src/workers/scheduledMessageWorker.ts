import { scheduledMessageWorkerIntervalMs } from '../config/env';
import { logger } from '../config/logger';
import prisma from '../db';
import { requireActiveParticipant } from '../services/conversationAccess';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { removeExpiredUnattachedAssets } from '../services/uploadedAssetService';

const SCHEDULED_MESSAGE_DELIVERED_CHANNEL = 'scheduled_message_delivered';

// This process owns scheduled-message delivery and expired-file cleanup. It intentionally has no
// HTTP or Socket.IO dependency, so it can run as an independent deployment.
export const startScheduledMessageWorker = () => {
  let workerRunning = false;
  let lastCleanupTime = 0;

  const deliverScheduledMessages = async () => {
    if (workerRunning) return;
    workerRunning = true;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        // Row locks make concurrent worker replicas safe: a due job is claimed by at most one worker.
        const candidates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "ScheduledMessage"
          WHERE "sendAt" <= ${now}
          ORDER BY "sendAt" ASC
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `;

        const discardedFileKeys: string[] = [];
        for (const candidate of candidates) {
          const scheduled = await tx.scheduledMessage.findUnique({ where: { id: candidate.id } });
          if (!scheduled) continue;

          // A removed sender and a deleted conversation can never produce a scheduled message.
          const membership = await requireActiveParticipant(
            scheduled.conversationId,
            scheduled.senderId,
            'Scheduled message sender is no longer an active participant.',
            tx
          ).catch(() => null);
          const conversation = membership
            ? await tx.conversation.findFirst({
              where: { id: scheduled.conversationId, isDeleted: false },
              select: { id: true, disappearingDurationSeconds: true }
            })
            : null;

          if (!conversation) {
            if (scheduled.fileKey) discardedFileKeys.push(scheduled.fileKey);
            await tx.scheduledMessage.delete({ where: { id: scheduled.id } });
            continue;
          }

          const createdMessage = await tx.message.create({
            data: {
              clientId: `scheduled:${scheduled.id}`,
              content: scheduled.content,
              senderId: scheduled.senderId,
              conversationId: scheduled.conversationId,
              fileKey: scheduled.fileKey,
              fileType: scheduled.fileType,
              fileName: scheduled.fileName,
              expiresAt: conversation.disappearingDurationSeconds
                ? new Date(Date.now() + conversation.disappearingDurationSeconds * 1000)
                : null
            }
          });

          await tx.scheduledMessage.delete({ where: { id: scheduled.id } });
          // The notification becomes visible only after this transaction commits. API instances use
          // the message id to load and emit the normal socket payload to their local clients.
          await tx.$executeRaw`
            SELECT pg_notify(${SCHEDULED_MESSAGE_DELIVERED_CHANNEL}, ${createdMessage.id})
          `;
        }

        return { discardedFileKeys };
      });

      for (const fileKey of result.discardedFileKeys) {
        await deleteFileIfUnreferenced(fileKey);
      }

      const nowMs = Date.now();
      if (nowMs - lastCleanupTime > 60_000) {
        lastCleanupTime = nowMs;

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
      }
    } catch (error) {
      logger.error({ event: 'worker.scheduled_message_failed', err: error }, 'Scheduled message worker failed');
    } finally {
      workerRunning = false;
    }
  };

  logger.info(
    { event: 'worker.scheduled_message_started', intervalMs: scheduledMessageWorkerIntervalMs },
    'Scheduled message worker started'
  );
  const interval = setInterval(() => void deliverScheduledMessages(), scheduledMessageWorkerIntervalMs);
  void deliverScheduledMessages();

  return () => {
    logger.info({ event: 'worker.scheduled_message_stopped' }, 'Scheduled message worker stopped');
    clearInterval(interval);
  };
};
