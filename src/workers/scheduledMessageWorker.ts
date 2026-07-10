import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma from '../db';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { serializeMessage } from '../services/messageService';
import { deletePrivateFile } from '../services/fileStorage';

const WORKER_INTERVAL_MS = 30_000;

// Zamanlanmış mesajlar HTTP isteği gelmeden de gönderilebilmelidir.
// Bu worker periyodik olarak zamanı gelen ScheduledMessage kayıtlarını gerçek Message kaydına dönüştürür.
export const startScheduledMessageWorker = (io: Server) => {
  let workerRunning = false;

  const deliverScheduledMessages = async () => {
    // Aynı Node sürecinde önceki tur bitmeden ikinci tur başlamaz.
    // Bu local kilit, uzun süren DB/R2 işlemlerinde aynı process'in kendisiyle yarışmasını engeller.
    // Aynı Node sürecinde önceki tur bitmeden ikinci tur başlamaz.
    if (workerRunning) return;
    workerRunning = true;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // FOR UPDATE SKIP LOCKED çoklu backend instance çalıştığında kritik hale gelir.
        // Aynı scheduled message kaydını iki worker'ın aynı anda almasını engeller.
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

          // Transaction içinde include kullanmıyoruz; sadece mesajı oluşturup id'sini dışarı taşıyoruz.
          // İlişkili sender/conversation verisi transaction dışında okunur; adapter-pg paralel query warning'i azalır.
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
          completed.push({
            savedMessageId: createdMessage.id,
            conversationId: conversation.id,
            participantIds: conversation.participants.map(({ userId }) => userId)
          });
        }

        return { completed, discardedFileKeys };
      });

      for (const delivery of result.completed) {
        // Transaction commit olduktan sonra socket'e yayınlanacak zengin mesaj bilgisini okuyoruz.
        // Böylece kullanıcıya gönderilen payload normal anlık mesaj payload'ıyla aynı şekle gelir.
        const savedMessage = await prisma.message.findUnique({
          where: { id: delivery.savedMessageId },
          include: {
            sender: { select: { username: true } },
            conversation: { select: { isGroup: true } },
            reads: { select: { userId: true } },
            stars: { select: { userId: true } },
            deletions: { select: { userId: true } }
          }
        });
        if (!savedMessage) continue;
        const rooms = [...new Set([delivery.conversationId, ...delivery.participantIds])];
        io.to(rooms).emit('yeni_mesaj_geldi', await serializeMessage(savedMessage));
      }
      for (const fileKey of result.discardedFileKeys) {
        await deleteFileIfUnreferenced(fileKey);
      }

      // 1. Dosyası olmayan süresi geçmiş mesajları topluca sil (R2 işlemi gerekmez)
      await prisma.message.deleteMany({
        where: { expiresAt: { lte: new Date() }, fileKey: null }
      });

      // 2. Dosyası olan süresi geçmiş mesajları bul
      const expiredWithFiles = await prisma.message.findMany({
        where: { expiresAt: { lte: new Date() }, fileKey: { not: null } }
      });

      // 3. Dosyalı mesajları tek tek transaction içinde işle ki R2 silme hatasında DB kaydı rollback olsun (retry mekanizması)
      for (const msg of expiredWithFiles) {
        try {
          await prisma.$transaction(async (tx) => {
            // Mesaj kaydını sil
            await tx.message.delete({ where: { id: msg.id } });

            // Kalan referansları kontrol et
            const messageReferences = await tx.message.count({ where: { fileKey: msg.fileKey } });
            const scheduledReferences = await tx.scheduledMessage.count({ where: { fileKey: msg.fileKey } });
            const avatarReferences = await tx.user.count({ where: { avatarFileKey: msg.fileKey } });

            if (messageReferences === 0 && scheduledReferences === 0 && avatarReferences === 0) {
              // R2'den sil. Eğer hata fırlatırsa transaction rollback olur ve DB kaydı silinmez.
              await deletePrivateFile(msg.fileKey!);
            }
          });
        } catch (error) {
          logger.error({
            event: 'worker.expired_file_cleanup_failed',
            err: error,
            messageId: msg.id,
            fileKey: msg.fileKey
          }, 'Failed to clean up expired file, keeping database record for retry');
        }
      }
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
