/**
 * ============================================================================
 * ZAMANLANMIŞ MESAJ ROTALARI (Scheduled Messages Routes)
 * ============================================================================
 * 
 * Bu dosya, kullanıcıların ileri bir tarihte/saatte otomatik olarak gönderilmek
 * üzere planladığı mesajların (Scheduled Messages) yönetimi ve anlık tetiklenmesi
 * rotalarını içerir.
 * 
 * TASARIM İLKELERİ:
 * 1. İdempotency (`clientId`): İstek tekrarlandığında mükerrer mesaj zamanlanmasını engeller.
 * 2. Yarış Durumu Koruması (Race Condition Prevention): `send-now` ile arka plan worker'ı
 *    aynı anda mesajı göndermeye kalkarsa, atomik `deleteMany` silme işlemi sayesinde
 *    mesaj yalnızca bir defa veritabanına mesaj olarak yazılır ve Socket ile iletilir.
 */

import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { logger } from '../config/logger';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { requireActiveParticipant } from '../services/conversationAccess';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { withSignedFileUrl } from '../services/fileStorage';
import { serializeMessage } from '../services/messageService';
import { attachOwnedAsset } from '../services/uploadedAssetService';
import { getAuthenticatedUserId, getRouteParam } from '../utils/request';
import { chatSchemas } from '../validation/schemas';

const router = express.Router();
router.use(authenticateToken);

/**
 * POST /api/v1/messages/schedule -> İleri Tarihli Mesaj Zamanlama
 * Kullanıcının seçtiği `sendAt` tarihini doğrular ve planlanan kaydı veritabanına ekler.
 */
router.post('/messages/schedule', validateRequest({ body: chatSchemas.scheduledMessage }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { conversationId, clientId, content, sendAt, fileKey, fileType, fileName } = req.body;
    const senderId = getAuthenticatedUserId(req);
    try {
      await requireActiveParticipant(conversationId, senderId);
    } catch {
      return res.status(403).json({ error: 'Bu sohbet için mesaj zamanlama yetkiniz yok.' });
    }

    const targetDate = new Date(sendAt);
    if (targetDate.getTime() <= Date.now()) return res.status(400).json({ error: 'Geçmiş zaman seçilemez.' });

    try {
      // clientId sayesinde zamanlama isteği retry edilirse aynı mesaj ikinci kez planlanmaz.
      if (fileKey) await attachOwnedAsset(fileKey, senderId);
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

/**
 * GET /api/v1/messages/scheduled/:conversationId -> Sohbetin Bekleyen Zamanlanmış Mesajlarını Listeleme
 */
router.get('/messages/scheduled/:conversationId', validateRequest({ params: chatSchemas.scheduledConversationParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getRouteParam(req, 'conversationId');
    const userId = getAuthenticatedUserId(req);
    try {
      await requireActiveParticipant(conversationId, userId);
    } catch {
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

/**
 * DELETE /api/v1/messages/schedule/:id -> Zamanlanmış Mesajı İptal Etme / Silme
 */
router.delete('/messages/schedule/:id', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getRouteParam(req, 'id');
    const userId = getAuthenticatedUserId(req);
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) return res.status(404).json({ error: 'Zamanlanmış mesaj bulunamadı.' });
    if (scheduled.senderId !== userId) return res.status(403).json({ error: 'Bu mesajı iptal etme yetkiniz yok.' });
    try {
      await requireActiveParticipant(scheduled.conversationId, userId);
    } catch {
      return res.status(403).json({ error: 'Artık bu sohbetin aktif üyesi değilsiniz.' });
    }

    await prisma.scheduledMessage.delete({ where: { id } });
    await deleteFileIfUnreferenced(scheduled.fileKey);
    return res.status(200).json({ success: true, message: 'Zamanlanmış mesaj iptal edildi.' });
  } catch {
    return res.status(500).json({ error: 'İptal işlemi başarısız.' });
  }
});

/**
 * POST /api/v1/messages/schedule/send-now/:id -> Zamanlanmış Mesajı Beklemeden Anında Gönderme
 * Atomik `deleteMany` kullanarak yarış durumlarını engeller ve mesajı gerçek sohbet mesajına dönüştürür.
 */
router.post('/messages/schedule/send-now/:id', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getRouteParam(req, 'id');
    const userId = getAuthenticatedUserId(req);
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) return res.status(404).json({ error: 'Zamanlanmış mesaj bulunamadı veya zaten gönderildi.' });
    if (scheduled.senderId !== userId) return res.status(403).json({ error: 'Bu mesajı gönderme yetkiniz yok.' });
    try {
      await requireActiveParticipant(scheduled.conversationId, userId);
    } catch {
      return res.status(403).json({ error: 'Artık bu sohbetin üyesi değilsiniz.' });
    }

    // deleteMany kaydı atomik olarak sahiplenir; worker ile aynı anda yalnızca biri kazanır.
    const savedMessageId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.scheduledMessage.deleteMany({ where: { id, senderId: userId } });
      if (claimed.count !== 1) return null;

      // Konuşmadaki kaybolan mesaj süresini sorguluyoruz
      const conversation = await tx.conversation.findUnique({
        where: { id: scheduled.conversationId },
        select: { disappearingDurationSeconds: true }
      });

      const createdMessage = await tx.message.create({
        data: {
          content: scheduled.content,
          senderId: scheduled.senderId,
          conversationId: scheduled.conversationId,
          clientId: `scheduled:${scheduled.id}`,
          fileKey: scheduled.fileKey,
          fileType: scheduled.fileType,
          fileName: scheduled.fileName,
          expiresAt: conversation?.disappearingDurationSeconds
            ? new Date(Date.now() + conversation.disappearingDurationSeconds * 1000)
            : null
        }
      });
      return createdMessage.id;
    });
    if (!savedMessageId) return res.status(409).json({ error: 'Mesaj başka bir işlem tarafından gönderildi veya iptal edildi.' });

    // Transaction dışında ilişkili veriler okunur
    const savedMessage = await prisma.message.findUnique({
      where: { id: savedMessageId },
      include: {
        sender: { select: { username: true } },
        conversation: { select: { isGroup: true } },
        reads: { select: { userId: true } },
        stars: { select: { userId: true } },
        deletions: { select: { userId: true } }
      }
    });
    if (!savedMessage) return res.status(404).json({ error: 'Gönderilen mesaj yüklenemedi.' });

    const conversation = await prisma.conversation.findUnique({
      where: { id: scheduled.conversationId },
      include: {
        participants: {
          where: { isActive: true },
          select: { userId: true }
        }
      }
    });
    // Socket olayı hem conversation odasına hem de kullanıcı odalarına yayınlanır
    const rooms = [scheduled.conversationId, ...(conversation?.participants.map(({ userId: participantId }) => participantId) || [])];
    req.app.get('io').to([...new Set(rooms)]).emit('yeni_mesaj_geldi', await serializeMessage(savedMessage));
    return res.status(200).json({ success: true, message: 'Mesaj hemen gönderildi.' });
  } catch {
    return res.status(500).json({ error: 'Mesaj hemen gönderilemedi.' });
  }
});

/**
 * PUT /api/v1/messages/schedule/:id -> Bekleyen Zamanlanmış Mesajı Düzenleme
 */
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
    try {
      await requireActiveParticipant(scheduled.conversationId, userId);
    } catch {
      return res.status(403).json({ error: 'Artık bu sohbetin aktif üyesi değilsiniz.' });
    }

    const nextContent = content !== undefined ? content.trim() : scheduled.content;
    const nextFileKey = fileKey !== undefined ? fileKey : scheduled.fileKey;
    if (!nextContent && !nextFileKey) return res.status(400).json({ error: 'Zamanlanmış mesaj tamamen boş olamaz.' });

    if (fileKey && fileKey !== scheduled.fileKey) await attachOwnedAsset(fileKey, userId);
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
      // Dosya değiştirildiyse eski dosya silinir
      await deleteFileIfUnreferenced(scheduled.fileKey);
    }
    return res.status(200).json({ success: true, updatedMessage: await withSignedFileUrl(updated) });
  } catch {
    return res.status(500).json({ error: 'Zamanlanmış mesaj güncellenemedi.' });
  }
});

export default router;

