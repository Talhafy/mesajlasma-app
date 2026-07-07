import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma from '../db';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { withSignedFileUrl } from '../services/fileStorage';

const WORKER_INTERVAL_MS = 30_000;

export const startScheduledMessageWorker = (io: Server) => {
  let workerRunning = false;

  const deliverScheduledMessages = async () => {
    // Aynı Node sürecinde önceki tur bitmeden ikinci tur başlamaz.
    if (workerRunning) return;
    workerRunning = true;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Birden fazla sunucu aynı DB'yi kullansa bile SKIP LOCKED aynı kaydı iki kez seçtirmez.
        const candidates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "ScheduledMessage"
          WHERE "sendAt" <= NOW()
          ORDER BY "sendAt" ASC
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `;

        const completed = [];
        const discardedFileKeys: string[] = [];
        for (const candidate of candidates) {
          const scheduled = await tx.scheduledMessage.findUnique({ where: { id: candidate.id } });
          if (!scheduled) continue;

          const conversation = await tx.conversation.findUnique({
            where: { id: scheduled.conversationId },
            include: { participants: { select: { userId: true } } }
          });
          const senderIsMember = conversation?.participants.some(({ userId }) => userId === scheduled.senderId);

          // Silinmiş sohbet veya üyelik durumunda mesaj gönderilmez, sahipsiz dosya temizlenir.
          if (!conversation || !senderIsMember) {
            if (scheduled.fileKey) discardedFileKeys.push(scheduled.fileKey);
            await tx.scheduledMessage.delete({ where: { id: scheduled.id } });
            continue;
          }

          const savedMessage = await tx.message.create({
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
            },
            include: {
              sender: { select: { username: true } },
              conversation: { select: { isGroup: true } }
            }
          });

          await tx.scheduledMessage.delete({ where: { id: scheduled.id } });
          completed.push({
            savedMessage,
            conversationId: conversation.id,
            participantIds: conversation.participants.map(({ userId }) => userId)
          });
        }

        return { completed, discardedFileKeys };
      });

      for (const delivery of result.completed) {
        const rooms = [...new Set([delivery.conversationId, ...delivery.participantIds])];
        io.to(rooms).emit('yeni_mesaj_geldi', await withSignedFileUrl(delivery.savedMessage));
      }
      await Promise.all(result.discardedFileKeys.map(deleteFileIfUnreferenced));

      const expiredFiles = await prisma.message.findMany({
        where: { expiresAt: { lte: new Date() }, fileKey: { not: null } },
        select: { fileKey: true }
      });
      await prisma.message.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      await Promise.all([...new Set(expiredFiles.map((file) => file.fileKey).filter((key): key is string => Boolean(key)))].map(deleteFileIfUnreferenced));
    } catch (error) {
      logger.error({ event: 'worker.scheduled_message_failed', err: error }, 'Scheduled message worker failed');
    } finally {
      workerRunning = false;
    }
  };

  logger.info({ event: 'worker.started' }, 'Scheduled message worker started');
  const interval = setInterval(() => void deliverScheduledMessages(), WORKER_INTERVAL_MS);
  void deliverScheduledMessages();

  // Sunucu kapanırken interval'in yeni DB işi başlatmasını engeller.
  return () => {
    logger.info({ event: 'worker.stopped' }, 'Scheduled message worker stopped');
    clearInterval(interval);
  };
};
