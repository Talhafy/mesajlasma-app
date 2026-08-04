/**
 * ============================================================================
 * ZAMANLANMIŞ MESAJ VE ÇÖP TEMİZLİK WORKER SERVİSİ (Scheduled Worker Core)
 * ============================================================================
 * 
 * Bu dosya, arka planda zamanı gelen mesajları teslim eden ve süresi dolmuş
 * (kaybolan) mesajlar ile yetim kalmış dosyaları periyodik olarak temizleyen
 * bağımsız arka plan servis (worker) mantığını barındırır.
 * 
 * ESNEK VE GÜVENLİ MİMARİ:
 * 1. HTTP ve Socket.IO bağımlılığı yoktur; bağımsız bir Container/Process olarak çalışabilir.
 * 2. Eşzamanlı Dağıtık Çalışma Güvenliği (`FOR UPDATE SKIP LOCKED`): Birden fazla worker 
 *    replikası aynı anda çalışsa bile tek bir zamanlanmış mesaj yalnızca bir worker 
 *    tarafından işlenir ve mükerrer gönderim önlenir.
 * 3. PostgreSQL Transaction & NOTIFY: Mesaj kaydedildiği transaction commit edilince
 *    `pg_notify` ile dinleyici sunuculara bildirim atılır.
 */

import { scheduledMessageWorkerIntervalMs } from '../config/env';
import { logger } from '../config/logger';
import prisma from '../db';
import { requireActiveParticipant } from '../services/conversationAccess';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { removeExpiredUnattachedAssets } from '../services/uploadedAssetService';

/** PostgreSQL NOTIFY kanalı adı */
const SCHEDULED_MESSAGE_DELIVERED_CHANNEL = 'scheduled_message_delivered';

/**
 * Zamanlanmış mesaj teslimatını ve süresi dolmuş medya temizliğini başlatan worker döngüsü.
 */
export const startScheduledMessageWorker = () => {
  let workerRunning = false;
  let lastCleanupTime = 0;

  /** Zamanı gelmiş mesajları bulan ve Message tablosuna aktaran ana fonksiyon */
  const deliverScheduledMessages = async () => {
    if (workerRunning) return;
    workerRunning = true;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        // Satır kilitleme (FOR UPDATE SKIP LOCKED) ile çoklu worker örnekleri çakışmadan çalışır
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

          // Gönderenin gruptan ayrılıp ayrılmadığı veya grubun silinip silinmediği denetlenir
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
          // Transaction commit edildikten sonra API sunucularına pg_notify atılır
          await tx.$executeRaw`
            SELECT pg_notify(${SCHEDULED_MESSAGE_DELIVERED_CHANNEL}, ${createdMessage.id})
          `;
        }

        return { discardedFileKeys };
      });

      for (const fileKey of result.discardedFileKeys) {
        await deleteFileIfUnreferenced(fileKey);
      }

      // 60 saniyede bir süresi dolan mesajları ve yetim kalmış R2 dosyalarını temizler
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

