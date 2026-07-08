import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { logger } from '../config/logger';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { isConversationMember } from '../services/conversationAccess';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { withSignedFileUrl } from '../services/fileStorage';
import { getAuthenticatedUserId, getRouteParam } from '../utils/request';
import { chatSchemas } from '../validation/schemas';

const router = express.Router();
router.use(authenticateToken);

// Bu dosyada zamanlanmış mesajlar normal mesajlardan ayrı tutulur.
// Kullanıcı zamanlanmış mesajı düzenlediğinde chat'e mesaj düşmez; yalnızca ScheduledMessage kaydı güncellenir.

// Zamanlama route'ları normal mesaj route'larından ayrıdır; düzenleme işlemi sohbet mesajı üretmez.
router.post('/messages/schedule', validateRequest({ body: chatSchemas.scheduledMessage }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { conversationId, clientId, content, sendAt, fileKey, fileType, fileName } = req.body;
    const senderId = getAuthenticatedUserId(req);
    if (!(await isConversationMember(conversationId, senderId))) {
      return res.status(403).json({ error: 'Bu sohbet için mesaj zamanlama yetkiniz yok.' });
    }

    const targetDate = new Date(sendAt);
    if (targetDate.getTime() <= Date.now()) return res.status(400).json({ error: 'Geçmiş zaman seçilemez.' });

    try {
      // clientId sayesinde zamanlama isteği retry edilirse aynı mesaj ikinci kez planlanmaz.
      await prisma.scheduledMessage.create({
        data: {
          clientId,
          content: content.trim(),
          senderId,
          conversationId,
          sendAt: targetDate,
          fileKey: fileKey || null,
          fileType: fileType || null,
          fileName: fileName || null
        }
      });
    } catch (error) {
      // Aynı clientId tekrar gönderilirse ikinci görev yaratmadan başarılı kabul edilir.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(200).json({ success: true, duplicate: true });
      }
      throw error;
    }

    return res.status(200).json({ success: true, message: 'Mesaj zamanlandı.' });
  } catch (error) {
    logger.error({ event: 'chat.scheduled_message_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Scheduled message creation failed');
    return res.status(500).json({ error: 'Mesaj zamanlanamadı.' });
  }
});

router.get('/messages/scheduled/:conversationId', validateRequest({ params: chatSchemas.scheduledConversationParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getRouteParam(req, 'conversationId');
    const userId = getAuthenticatedUserId(req);
    if (!(await isConversationMember(conversationId, userId))) {
      return res.status(403).json({ error: 'Bu sohbetin zamanlanmış mesajlarını görüntüleme yetkiniz yok.' });
    }

    const pending = await prisma.scheduledMessage.findMany({
      where: { conversationId, senderId: userId },
      orderBy: { sendAt: 'asc' }
    });
    // Bekleyen mesajlarda dosya varsa frontend önizleyebilsin diye her kayıt için geçici signed URL eklenir.
    return res.status(200).json(await Promise.all(pending.map(withSignedFileUrl)));
  } catch {
    return res.status(500).json({ error: 'Bekleyen mesajlar listelenemedi.' });
  }
});

router.delete('/messages/schedule/:id', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getRouteParam(req, 'id');
    const userId = getAuthenticatedUserId(req);
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) return res.status(404).json({ error: 'Zamanlanmış mesaj bulunamadı.' });
    if (scheduled.senderId !== userId) return res.status(403).json({ error: 'Bu mesajı iptal etme yetkiniz yok.' });

    await prisma.scheduledMessage.delete({ where: { id } });
    await deleteFileIfUnreferenced(scheduled.fileKey);
    return res.status(200).json({ success: true, message: 'Zamanlanmış mesaj iptal edildi.' });
  } catch {
    return res.status(500).json({ error: 'İptal işlemi başarısız.' });
  }
});

router.post('/messages/schedule/send-now/:id', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getRouteParam(req, 'id');
    const userId = getAuthenticatedUserId(req);
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) return res.status(404).json({ error: 'Zamanlanmış mesaj bulunamadı veya zaten gönderildi.' });
    if (scheduled.senderId !== userId) return res.status(403).json({ error: 'Bu mesajı gönderme yetkiniz yok.' });
    if (!(await isConversationMember(scheduled.conversationId, userId))) {
      return res.status(403).json({ error: 'Artık bu sohbetin üyesi değilsiniz.' });
    }

    // deleteMany kaydı atomik olarak sahiplenir; worker ile aynı anda yalnızca biri kazanır.
    // "Şimdi gönder" ile background worker aynı anda davranırsa ikisi de aynı kaydı göndermeye çalışabilir.
    // deleteMany burada atomik sahiplenme görevi görür; count 1 değilse mesajı başka işlem kazanmıştır.
    const savedMessageId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.scheduledMessage.deleteMany({ where: { id, senderId: userId } });
      if (claimed.count !== 1) return null;

      const createdMessage = await tx.message.create({
        data: {
          content: scheduled.content,
          senderId: scheduled.senderId,
          conversationId: scheduled.conversationId,
          clientId: `scheduled:${scheduled.id}`,
          fileKey: scheduled.fileKey,
          fileType: scheduled.fileType,
          fileName: scheduled.fileName
        }
      });
      return createdMessage.id;
    });
    if (!savedMessageId) return res.status(409).json({ error: 'Mesaj başka bir işlem tarafından gönderildi veya iptal edildi.' });

    // Transaction içinde yalnızca mesaj id'si döndürülür; ilişkili sender/conversation verisi dışarıda okunur.
    // Bu ayrım Prisma adapter-pg'nin aynı transaction client'ında paralel include sorgusu çalıştırmasını engeller.
    const savedMessage = await prisma.message.findUnique({
      where: { id: savedMessageId },
      include: {
        sender: { select: { username: true } },
        conversation: { select: { isGroup: true } }
      }
    });
    if (!savedMessage) return res.status(404).json({ error: 'Gönderilen mesaj yüklenemedi.' });

    const conversation = await prisma.conversation.findUnique({
      where: { id: scheduled.conversationId },
      include: { participants: { select: { userId: true } } }
    });
    // Socket olayı hem conversation odasına hem de kullanıcı odalarına gider; sidebar ve açık chat aynı anda güncellenir.
    const rooms = [scheduled.conversationId, ...(conversation?.participants.map(({ userId: participantId }) => participantId) || [])];
    req.app.get('io').to([...new Set(rooms)]).emit('yeni_mesaj_geldi', await withSignedFileUrl(savedMessage));
    return res.status(200).json({ success: true, message: 'Mesaj hemen gönderildi.' });
  } catch {
    return res.status(500).json({ error: 'Mesaj hemen gönderilemedi.' });
  }
});

router.put('/messages/schedule/:id', validateRequest({
  params: chatSchemas.idParams,
  body: chatSchemas.editScheduledMessage
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getRouteParam(req, 'id');
    const userId = getAuthenticatedUserId(req);
    const { content, fileKey, fileType, fileName } = req.body;
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) return res.status(404).json({ error: 'Zamanlanmış mesaj bulunamadı.' });
    if (scheduled.senderId !== userId) return res.status(403).json({ error: 'Bu mesajı düzenleme yetkiniz yok.' });

    const nextContent = content !== undefined ? content.trim() : scheduled.content;
    const nextFileKey = fileKey !== undefined ? fileKey : scheduled.fileKey;
    if (!nextContent && !nextFileKey) return res.status(400).json({ error: 'Zamanlanmış mesaj tamamen boş olamaz.' });

    // Zamanlanmış mesaj düzenlenirken hem metin hem dosya tamamen boş hale getirilemez.
    const updated = await prisma.scheduledMessage.update({
      where: { id },
      data: {
        ...(content !== undefined ? { content: nextContent } : {}),
        ...(fileKey !== undefined ? { fileKey: nextFileKey } : {}),
        ...(fileType !== undefined ? { fileType } : {}),
        ...(fileName !== undefined ? { fileName } : {})
      }
    });
    if (fileKey !== undefined && scheduled.fileKey !== nextFileKey) {
      // Dosya değiştirildiyse eski dosya başka kayıt tarafından kullanılmıyorsa silinir.
      await deleteFileIfUnreferenced(scheduled.fileKey);
    }
    return res.status(200).json({ success: true, updatedMessage: await withSignedFileUrl(updated) });
  } catch {
    return res.status(500).json({ error: 'Zamanlanmış mesaj güncellenemedi.' });
  }
});

export default router;
