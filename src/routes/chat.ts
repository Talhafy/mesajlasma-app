import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { uploadSingleFile } from '../config/fileUpload';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { chatSchemas } from '../validation/schemas';
import {
  createSignedFileUrl,
  uploadPrivateFile,
  withSignedFileUrl
} from '../services/fileStorage';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { isConversationMember } from '../services/conversationAccess';
import { getAuthenticatedUserId as getUserId, getRouteParam as getParam } from '../utils/request';

const router = express.Router();

// Bu router altındaki tüm mesaj, sohbet ve dosya endpoint'leri access token gerektirir.
router.use(authenticateToken);

// DOSYA YÜKLEME API'Sİ
router.post('/upload', uploadSingleFile, async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    if (!req.file) return res.status(400).json({ error: "Dosya bulunamadı." });

    const fileKey = await uploadPrivateFile(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    const signedFile = await withSignedFileUrl({ fileKey });
    return res.status(200).json({
      fileKey,
      fileUrl: signedFile.fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype.startsWith('image/') ? 'image' :
                req.file.mimetype.startsWith('audio/') || req.file.mimetype.startsWith('video/') ? 'audio' : 'document'
    });
  } catch (error) {
    console.error("Buluta yükleme hatası:", error);
    return res.status(500).json({ error: "Dosya buluta yüklenemedi." });
  }
});

// KULLANICILARI LİSTELEME
router.get('/users', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const users = await prisma.user.findMany({
      where: { NOT: { id: currentUserId } },
      select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true }
    });
    const responseUsers = await Promise.all(users.map(async (user) => ({
      ...user,
      avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null
    })));
    return res.status(200).json(responseUsers);
  } catch (error) {
    return res.status(500).json({ error: "Kullanıcılar getirilemedi." });
  }
});

// SON MESAJINA GÖRE SIRALANMIŞ GERÇEK SOHBET LİSTESİ
router.get('/conversations', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const memberships = await prisma.participant.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            participants: {
              include: {
                user: {
                  select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true }
                }
              }
            },
            messages: {
              where: { NOT: { deletedForIds: { has: userId } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { sender: { select: { username: true } } }
            }
          }
        }
      }
    });

    const conversations = await Promise.all(memberships.map(async ({ conversation }) => {
      const otherParticipant = conversation.isGroup
        ? null
        : conversation.participants.find((participant) => participant.userId !== userId);
      const otherUser = otherParticipant?.user
        ? {
            ...otherParticipant.user,
            avatarUrl: otherParticipant.user.avatarFileKey
              ? await createSignedFileUrl(otherParticipant.user.avatarFileKey)
              : null
          }
        : null;
      const lastMessage = conversation.messages[0]
        ? await withSignedFileUrl(conversation.messages[0])
        : null;

      return {
        id: conversation.id,
        isGroup: conversation.isGroup,
        name: conversation.name,
        adminId: conversation.adminId,
        createdAt: conversation.createdAt,
        otherUser,
        lastMessage
      };
    }));

    conversations.sort((a, b) => {
      const aTime = new Date(a.lastMessage?.createdAt || a.createdAt).getTime();
      const bTime = new Date(b.lastMessage?.createdAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    return res.status(200).json(conversations);
  } catch (error) {
    console.error('Sohbet listesi alınamadı:', error);
    return res.status(500).json({ error: 'Sohbet listesi alınamadı.' });
  }
});

// ODA BULMA / OLUŞTURMA (Birebir Sohbet Başlatma)
router.post('/conversations/direct', validateRequest({ body: chatSchemas.directConversation }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = getUserId(req);

    if (typeof targetUserId !== 'string' || !targetUserId || targetUserId === currentUserId) {
      return res.status(400).json({ error: "Geçerli bir hedef kullanıcı seçin." });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });

    let conversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId: currentUserId } } },
          { participants: { some: { userId: targetUserId } } }
        ]
      }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          isGroup: false,
          participants: {
            create: [
              { userId: currentUserId },
              { userId: targetUserId }
            ]
          }
        }
      });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    console.error("Oda oluşturma hatası:", error);
    return res.status(500).json({ error: "Sohbet odası oluşturulamadı." });
  }
});

// MESAJ GÖNDERME
router.post('/messages', validateRequest({ body: chatSchemas.message }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { conversationId, clientId, content, replyToId, isForwarded, fileKey, fileType, fileName } = req.body;
    const senderId = getUserId(req);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }, include: { participants: true }
    });
    if (!conversation) return res.status(404).json({ error: "Sohbet bulunamadı." });
    if (!conversation.participants.some((participant) => participant.userId === senderId)) {
      return res.status(403).json({ error: "Bu sohbete mesaj gönderme yetkiniz yok." });
    }

    if (replyToId) {
      const repliedMessage = await prisma.message.findFirst({
        where: { id: String(replyToId), conversationId },
        select: { id: true }
      });
      if (!repliedMessage) return res.status(400).json({ error: "Yanıtlanan mesaj bu sohbette bulunamadı." });
    }

    let savedMessage;
    try {
      savedMessage = await prisma.message.create({
        data: {
          clientId,
          content: content.trim(),
          senderId,
          conversationId,
          replyToId: replyToId || null,
          isForwarded: isForwarded || false,
          fileKey: fileKey || null,
          fileType: fileType || null,
          fileName: fileName || null
        },
        include: {
          sender: { select: { username: true } },
          replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
          conversation: { select: { isGroup: true } }
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existingMessage = await prisma.message.findUnique({
          where: { senderId_clientId: { senderId, clientId } },
          include: {
            sender: { select: { username: true } },
            replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
            conversation: { select: { isGroup: true } }
          }
        });
        if (!existingMessage) throw error;
        return res.status(200).json(await withSignedFileUrl(existingMessage));
      }
      throw error;
    }

    const responseMessage = await withSignedFileUrl(savedMessage);

    const io = req.app.get('io');
    const targetRooms = conversation.participants.map(p => p.userId);
    targetRooms.push(conversationId);

    io.to(targetRooms).emit('yeni_mesaj_geldi', responseMessage);
    return res.status(201).json(responseMessage);
  } catch (error) {
    console.error("Mesaj kaydetme hatası:", error);
    return res.status(500).json({ error: "Mesaj gönderilemedi." });
  }
});

// GEÇMİŞ MESAJLARI ÇEKME
router.get('/conversations/:conversationId/messages', validateRequest({
  params: chatSchemas.conversationParams,
  query: chatSchemas.conversationMessagesQuery
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'conversationId');
    const { cursor } = req.query;
    const userId = getUserId(req);

    if (!(await isConversationMember(conversationId, userId))) {
      return res.status(403).json({ error: "Bu sohbetin mesajlarını görüntüleme yetkiniz yok." });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        NOT: { deletedForIds: { has: userId } }
      },
      take: 50,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: String(cursor) } } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: { username: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } }
      }
    });

    const responseMessages = await Promise.all(messages.reverse().map(withSignedFileUrl));
    return res.status(200).json(responseMessages);
  } catch (error) {
    console.error("Mesajlar çekilirken hata:", error);
    return res.status(500).json({ error: "Mesajlar yüklenemedi." });
  }
});

// GRUP OLUŞTURMA
router.post('/conversations/group', validateRequest({ body: chatSchemas.group }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { name, participantIds } = req.body;
    const currentUserId = getUserId(req);

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: "Grup adı boş olamaz." });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: "Grup adı en fazla 100 karakter olabilir." });
    }
    if (!Array.isArray(participantIds) || participantIds.length === 0 || !participantIds.every((id) => typeof id === 'string')) {
      return res.status(400).json({ error: "En az bir geçerli grup üyesi seçin." });
    }

    const allMemberIds = [...new Set([...participantIds, currentUserId])];
    const existingUserCount = await prisma.user.count({ where: { id: { in: allMemberIds } } });
    if (existingUserCount !== allMemberIds.length) {
      return res.status(400).json({ error: "Seçilen kullanıcılardan biri bulunamadı." });
    }

    const newGroup = await prisma.conversation.create({
      data: {
        isGroup: true,
        name: name.trim(),
        adminId: currentUserId,
        participants: { create: allMemberIds.map((id: string) => ({ userId: id })) }
      }
    });

    const io = req.app.get('io');
    allMemberIds.filter((id) => id !== currentUserId).forEach((userId: string) => {
      io.to(userId).emit('grup_olusturuldu', newGroup);
    });

    return res.status(201).json(newGroup);
  } catch (error) { return res.status(500).json({ error: "Grup oluşturulamadı." }); }
});

// KULLANICININ GRUPLARINI GETİRME
router.get('/conversations/groups', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);

    const myGroups = await prisma.participant.findMany({
      where: {
        userId: currentUserId,
        conversation: { isGroup: true }
      },
      include: { conversation: true }
    });

    const groups = myGroups.map(p => p.conversation);
    return res.status(200).json(groups);
  } catch (error) {
    return res.status(500).json({ error: "Gruplar getirilemedi." });
  }
});

// GRUBUN İÇİNDEKİ KİŞİLERİ ÇEKME
router.get('/conversations/group/:id/participants', validateRequest({ params: chatSchemas.groupParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    if (!(await isConversationMember(groupId, currentUserId))) {
      return res.status(403).json({ error: "Bu grubun üyelerini görüntüleme yetkiniz yok." });
    }

    const participants = await prisma.participant.findMany({
      where: { conversationId: groupId },
      include: { user: { select: { id: true, username: true } } }
    });
    return res.status(200).json(participants.map(p => p.user));
  } catch (error) {
    return res.status(500).json({ error: "Grup üyeleri alınamadı." });
  }
});

// GRUP ADI GÜNCELLEME
router.put('/conversations/group/:id/name', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.groupName
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    const newName = req.body.newName;
    if (typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: "Grup adı boş olamaz." });
    }
    if (newName.trim().length > 100) {
      return res.status(400).json({ error: "Grup adı en fazla 100 karakter olabilir." });
    }

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Grup bulunamadı." });
    if (!group.isGroup || group.adminId !== currentUserId) {
      return res.status(403).json({ error: "Grup adını yalnızca yönetici değiştirebilir." });
    }

    const updatedGroup = await prisma.conversation.update({
      where: { id: groupId },
      data: { name: newName.trim() }
    });
    return res.status(200).json(updatedGroup);
  } catch (error) {
    return res.status(500).json({ error: "Grup adı güncellenemedi." });
  }
});

// GRUPTAN KİŞİ ÇIKARTMA VE OTOMATİK SİLME
router.delete('/conversations/group/:id/participants/:userId', validateRequest({ params: chatSchemas.groupMemberParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const userId = getParam(req, 'userId');
    const adminId = getUserId(req);

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Grup bulunamadı." });

    if (group.adminId !== adminId && userId !== adminId) {
      return res.status(403).json({ error: "Sadece grup yöneticisi kişi çıkarabilir!" });
    }

    await prisma.$transaction([
      prisma.participant.deleteMany({
        where: { conversationId: groupId, userId }
      }),
      prisma.scheduledMessage.deleteMany({
        where: { conversationId: groupId, senderId: userId }
      })
    ]);

    const io = req.app.get('io');
    io.to(groupId).emit('gruptan_atildi', { groupId, removedUserId: userId });

    const remainingParticipants = await prisma.participant.findMany({
      where: { conversationId: groupId }
    });

    if (remainingParticipants.length === 0) {
      const [messageFiles, scheduledFiles] = await Promise.all([
        prisma.message.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } }),
        prisma.scheduledMessage.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } })
      ]);
      await prisma.conversation.delete({ where: { id: groupId } });
      const deletedFileKeys = [...messageFiles, ...scheduledFiles]
        .map((entry) => entry.fileKey)
        .filter((key): key is string => Boolean(key));
      await Promise.all([...new Set(deletedFileKeys)].map(deleteFileIfUnreferenced));
      io.to(groupId).emit('grup_silindi', { groupId });
    }
    else if (group.adminId === userId) {
      const newAdminId = remainingParticipants[0].userId;
      await prisma.conversation.update({
        where: { id: groupId },
        data: { adminId: newAdminId }
      });
      io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });
    }

    return res.status(200).json({ message: "İşlem başarılı." });
  } catch (error) { return res.status(500).json({ error: "Kişi çıkarılamadı." }); }
});

// GRUBA YENİ KİŞİ EKLEME
router.post('/conversations/group/:id/participants', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.addGroupMembers
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const { userIdsToAdd } = req.body;
    const adminId = getUserId(req);

    if (!Array.isArray(userIdsToAdd) || userIdsToAdd.length === 0 || !userIdsToAdd.every((id) => typeof id === 'string')) {
      return res.status(400).json({ error: "Eklenecek kullanıcı listesi geçersiz." });
    }

    const uniqueUserIds = [...new Set<string>(userIdsToAdd)];
    const existingUserCount = await prisma.user.count({ where: { id: { in: uniqueUserIds } } });
    if (existingUserCount !== uniqueUserIds.length) {
      return res.status(400).json({ error: "Eklenecek kullanıcılardan biri bulunamadı." });
    }

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (group?.adminId !== adminId) return res.status(403).json({ error: "Sadece yönetici kişi ekleyebilir." });

    const data = uniqueUserIds.map((userId) => ({ userId, conversationId: groupId }));
    await prisma.participant.createMany({ data, skipDuplicates: true });

    const io = req.app.get('io');
    uniqueUserIds.forEach((userId) => {
      io.to(userId).emit('grup_olusturuldu', group);
    });

    return res.status(200).json({ message: "Kişiler eklendi." });
  } catch (error) { return res.status(500).json({ error: "Ekleme başarısız." }); }
});

// YÖNETİCİLİĞİ BAŞKASINA DEVRETME
router.put('/conversations/group/:id/admin', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.transferAdmin
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const { newAdminId } = req.body;
    const currentAdminId = getUserId(req);

    if (typeof newAdminId !== 'string' || !newAdminId) {
      return res.status(400).json({ error: "Yeni yönetici geçersiz." });
    }

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (group?.adminId !== currentAdminId) return res.status(403).json({ error: "Sadece kurucu yetki devredebilir." });
    if (!(await isConversationMember(groupId, newAdminId))) {
      return res.status(400).json({ error: "Yeni yönetici grubun üyesi olmalıdır." });
    }

    await prisma.conversation.update({
      where: { id: groupId },
      data: { adminId: newAdminId }
    });

    const io = req.app.get('io');
    io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });

    return res.status(200).json({ message: "Yönetici değiştirildi." });
  } catch (error) { return res.status(500).json({ error: "İşlem başarısız." }); }
});

// GRUBU KOMPLE SİLME
router.delete('/conversations/group/:id', validateRequest({ params: chatSchemas.groupParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const adminId = getUserId(req);
    const deletedFileKeys = await prisma.$transaction(async (tx) => {
      const group = await tx.conversation.findUnique({ where: { id: groupId } });
      if (!group?.isGroup || group.adminId !== adminId) return null;

      const [messageFiles, scheduledFiles] = await Promise.all([
        tx.message.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } }),
        tx.scheduledMessage.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } })
      ]);

      await tx.conversation.delete({ where: { id: groupId } });
      return [...messageFiles, ...scheduledFiles]
        .map((entry) => entry.fileKey)
        .filter((key): key is string => Boolean(key));
    });

    if (!deletedFileKeys) {
      return res.status(403).json({ error: "Grubu yalnızca yönetici silebilir." });
    }

    await Promise.all([...new Set(deletedFileKeys)].map(deleteFileIfUnreferenced));

    const io = req.app.get('io');
    io.to(groupId).emit('grup_silindi', { groupId });

    return res.status(200).json({ message: "Grup başarıyla silindi." });
  } catch (error) { return res.status(500).json({ error: "Grup silinemedi." }); }
});

// MESAJLARI OKUNDU OLARAK İŞARETLEME
router.post('/conversations/:id/read', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.readConversation
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { emitReceipt } = req.body;
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);

    if (!(await isConversationMember(conversationId, userId))) {
      return res.status(403).json({ error: "Bu sohbeti okundu olarak işaretleme yetkiniz yok." });
    }

    const allMessages = await prisma.message.findMany({
      where: {
        conversationId: conversationId,
        senderId: { not: userId }
      }
    });

    const unreadMessages = allMessages.filter(msg => {
      const reads = msg.readByIds || [];
      return !reads.includes(userId);
    });

    for (const msg of unreadMessages) {
      const currentReads = msg.readByIds || [];
      await prisma.message.update({
        where: { id: msg.id },
        data: { readByIds: [...currentReads, userId] }
      });
    }

    if (emitReceipt !== false) {
      const io = req.app.get('io');
      io.to(conversationId).emit('mesajlar_okundu', { conversationId, readByUserId: userId });
    }

    return res.status(200).json({ success: true, updatedCount: unreadMessages.length });
  } catch (error) {
    console.error("[GÖRÜLDÜ HATASI]:", error);
    return res.status(500).json({ error: "Görüldü atılamadı." });
  }
});

// OKUNMAMIŞ MESAJ SAYILARINI GETİRME
router.get('/unread-counts', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);

    const myParticipants = await prisma.participant.findMany({
      where: { userId: userId },
      select: { conversationId: true }
    });
    const validConversationIds = myParticipants.map(p => p.conversationId);

    const allPossibleUnread = await prisma.message.findMany({
      where: {
        conversationId: { in: validConversationIds },
        senderId: { not: userId }
      },
      select: {
        conversationId: true,
        senderId: true,
        readByIds: true,
        conversation: { select: { isGroup: true } }
      }
    });

    const unreadMessages = allPossibleUnread.filter(msg => {
      const reads = msg.readByIds || [];
      return !reads.includes(userId);
    });

    const counts: Record<string, number> = {};

    unreadMessages.forEach(msg => {
      if (msg.conversation.isGroup) {
        counts[msg.conversationId] = (counts[msg.conversationId] || 0) + 1;
      } else {
        counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
      }
    });

    return res.status(200).json(counts);
  } catch (error) {
    console.error("Unread Counts Hatası:", error);
    return res.status(500).json({ error: "Okunmamış mesajlar getirilemedi." });
  }
});

// GLOBAL MESAJ ARAMA
router.get('/messages/search', validateRequest({ query: chatSchemas.searchQuery }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { q } = req.query;
    const userId = getUserId(req);

    const searchTerm = Array.isArray(q) ? q[0] : q;
    if (typeof searchTerm !== 'string' || searchTerm.trim().length < 2) {
      return res.status(400).json({ error: "Arama metni en az 2 karakter olmalıdır." });
    }

    const messages = await prisma.message.findMany({
      where: {
        content: { contains: searchTerm.trim(), mode: 'insensitive' },
        NOT: { deletedForIds: { has: userId } },
        conversation: {
          participants: { some: { userId: userId } }
        }
      },
      include: {
        sender: { select: { username: true } },
        conversation: {
          include: {
            participants: { include: { user: { select: { id: true, username: true, email: true } } } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 30
    });

    const responseMessages = await Promise.all(messages.map(withSignedFileUrl));
    return res.status(200).json(responseMessages);
  } catch (error) {
    console.error("Arama hatası:", error);
    return res.status(500).json({ error: "Arama yapılamadı." });
  }
});

// GÖNDERİLMİŞ MESAJI DÜZENLEME
router.put('/messages/:id', validateRequest({
  params: chatSchemas.idParams,
  body: chatSchemas.editMessage
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);
    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });
    if (message.senderId !== userId) {
      return res.status(403).json({ error: "Yalnızca kendi mesajınızı düzenleyebilirsiniz." });
    }
    if (!(await isConversationMember(message.conversationId, userId))) {
      return res.status(403).json({ error: "Bu sohbetin üyesi değilsiniz." });
    }

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { content: req.body.content.trim(), editedAt: new Date() },
      include: {
        sender: { select: { username: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
        conversation: { select: { isGroup: true } }
      }
    });

    const responseMessage = await withSignedFileUrl(updatedMessage);
    req.app.get('io').to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
    return res.status(200).json(responseMessage);
  } catch (error) {
    return res.status(500).json({ error: "Mesaj düzenlenemedi." });
  }
});

// MESAJ SABİTLEME
router.put('/messages/:id/pin', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);
    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });
    if (!(await isConversationMember(message.conversationId, userId))) {
      return res.status(403).json({ error: "Bu mesajı sabitleme yetkiniz yok." });
    }

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { isPinned: !message.isPinned }
    });

    const io = req.app.get('io');
    const responseMessage = await withSignedFileUrl(updatedMessage);
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
    return res.status(200).json(responseMessage);
  } catch (error) { return res.status(500).json({ error: "Sabitleme işlemi başarısız." }); }
});

// MESAJ YILDIZLAMA
router.put('/messages/:id/star', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });
    if (!(await isConversationMember(message.conversationId, userId))) {
      return res.status(403).json({ error: "Bu mesajı yıldızlama yetkiniz yok." });
    }

    const currentStars = message.starredByIds || [];
    const isStarred = currentStars.includes(userId);

    const newStars = isStarred
      ? currentStars.filter(uid => uid !== userId)
      : [...currentStars, userId];

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { starredByIds: newStars }
    });

    const io = req.app.get('io');
    const responseMessage = await withSignedFileUrl(updatedMessage);
    io.to(userId).emit('mesaj_guncellendi', responseMessage);
    return res.status(200).json(responseMessage);
  } catch (error) { return res.status(500).json({ error: "Yıldızlama başarısız." }); }
});

// MESAJ SİLME (BENDEN / HERKESTEN SİL)
router.delete('/messages/:id', validateRequest({
  params: chatSchemas.idParams,
  query: chatSchemas.deleteMessageQuery
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const { forEveryone } = req.query;
    const userId = getUserId(req);

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });
    if (!(await isConversationMember(message.conversationId, userId))) {
      return res.status(403).json({ error: "Bu mesajı silme yetkiniz yok." });
    }

    const io = req.app.get('io');

    if (forEveryone === 'true') {
      if (message.senderId !== userId) return res.status(403).json({ error: "Sadece kendi mesajınızı herkesten silebilirsiniz." });

      await prisma.$transaction([
        prisma.message.updateMany({ where: { replyToId: id }, data: { replyToId: null } }),
        prisma.message.delete({ where: { id } })
      ]);
      await deleteFileIfUnreferenced(message.fileKey);

      io.to(message.conversationId).emit('mesaj_silindi', { messageId: id, conversationId: message.conversationId });
      return res.status(200).json({ message: "Mesaj herkesten silindi." });

    } else {
      const currentDeleted = message.deletedForIds || [];
      if (!currentDeleted.includes(userId)) {
        await prisma.message.update({
          where: { id },
          data: { deletedForIds: [...currentDeleted, userId] }
        });
      }

      io.to(userId).emit('mesaj_silindi', { messageId: id, conversationId: message.conversationId });
      return res.status(200).json({ message: "Mesaj sadece sizden silindi." });
    }
  } catch (error) { return res.status(500).json({ error: "Silme işlemi başarısız." }); }
});

export default router;
