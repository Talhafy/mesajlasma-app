import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { userSchemas } from '../validation/schemas';
import { deleteFileIfUnreferenced } from '../services/fileCleanup';
import { createSignedFileUrl } from '../services/fileStorage';
import { clearRefreshCookie } from '../services/authTokens';
import { getAuthenticatedUserId as getUserId } from '../utils/request';

const router = express.Router();


// Profil adı güncelleme
router.put('/username', authenticateToken, validateRequest({ body: userSchemas.username }), async (req: CustomRequest, res: any) => {
  try {
    const { newUsername } = req.body;
    const userId = getUserId(req);

    const existingUser = await prisma.user.findUnique({ where: { username: newUsername } });
    if (existingUser) return res.status(400).json({ error: "Bu kullanıcı adı zaten alınmış." });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { username: newUsername }
    });

    res.status(200).json({ message: "Kullanıcı adı güncellendi", username: updatedUser.username });
  } catch (error) {
    res.status(500).json({ error: "İsim güncellenemedi." });
  }
});

// Şifre değişince çalınmış olabilecek bütün refresh oturumları da iptal edilir.
router.put('/password', authenticateToken, validateRequest({ body: userSchemas.password }), async (req: CustomRequest, res: any) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = getUserId(req);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: "Mevcut şifreniz yanlış." });

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password_hash: hashedNewPassword }
      });
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    });

    clearRefreshCookie(res);
    res.status(200).json({ message: "Şifreniz değiştirildi. Güvenlik için yeniden giriş yapın." });
  } catch (error) {
    res.status(500).json({ error: "Şifre güncellenemedi." });
  }
});

// Hesap, ilişkili sohbetler ve dosya referansları tek transaction içinde ele alınır.
router.delete('/account', authenticateToken, async (req: CustomRequest, res: any) => {
  try {
    const userId = getUserId(req);
    const deleteResult = await prisma.$transaction(async (tx) => {
      const account = await tx.user.findUnique({ where: { id: userId }, select: { avatarFileKey: true } });
      // Kullanıcının dahil olduğu bütün konuşmaları ve katılımcıları başta yüklüyoruz.
      // Böylece silme/devir kararlarını tek transaction içinde tutarlı veriyle verebiliyoruz.
      const memberships = await tx.participant.findMany({
        where: { userId },
        include: {
          conversation: {
            include: {
              participants: {
                select: { userId: true, joinedAt: true },
                orderBy: { joinedAt: 'asc' }
              }
            }
          }
        }
      });

      const deletedConversationIds = memberships
        .filter(({ conversation }) => !conversation.isGroup || (
          conversation.adminId === userId && conversation.participants.length === 1
        ))
        .map(({ conversation }) => conversation.id);
      // Silme tamamlandıktan sonra bu kullanıcılara socket olayı gönderilecek.
      // Böylece F5 atmadan sidebar/chat listesi güncellenebilir.
      const affectedUserIds = [...new Set(memberships
        .flatMap(({ conversation }) => conversation.participants.map((participant) => participant.userId))
        .filter((participantUserId) => participantUserId !== userId))];
      const deletedGroupIds = memberships
        .filter(({ conversation }) => conversation.isGroup && conversation.adminId === userId && conversation.participants.length === 1)
        .map(({ conversation }) => conversation.id);
      const updatedGroups = memberships
        .filter(({ conversation }) => conversation.isGroup && !deletedGroupIds.includes(conversation.id))
        .map(({ conversation }) => {
          // Grup admini hesabını siliyorsa grupta kalan ilk üyeye adminlik devredilir.
          // Kalan kimse yoksa grup zaten deletedGroupIds üzerinden silinecektir.
          const successor = conversation.adminId === userId
            ? conversation.participants.find((participant) => participant.userId !== userId)
            : null;
          return { groupId: conversation.id, removedUserId: userId, newAdminId: successor?.userId || null };
        });

      // Silinecek kullanıcı/sohbet dosyalarının key'lerini önceden topluyoruz.
      // Transaction bitince dosya gerçekten sahipsizse R2 temizliği yapılır.
      const messageFiles = await tx.message.findMany({
          where: {
            fileKey: { not: null },
            OR: [
              { senderId: userId },
              { conversationId: { in: deletedConversationIds } }
            ]
          },
          select: { fileKey: true }
        });
      const scheduledFiles = await tx.scheduledMessage.findMany({
          where: {
            fileKey: { not: null },
            OR: [
              { senderId: userId },
              { conversationId: { in: deletedConversationIds } }
            ]
          },
          select: { fileKey: true }
        });

      for (const membership of memberships) {
        const conversation = membership.conversation;

        if (!conversation.isGroup) {
          // Birebir sohbetlerde kullanıcının silinmesi konuşmayı da kaldırır.
          await tx.conversation.delete({ where: { id: conversation.id } });
          continue;
        }

        if (conversation.adminId === userId) {
          const successor = conversation.participants.find((participant) => participant.userId !== userId);
          if (successor) {
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { adminId: successor.userId }
            });
          } else {
            await tx.conversation.delete({ where: { id: conversation.id } });
          }
        }
      }

      await tx.user.delete({ where: { id: userId } });
      return {
        affectedUserIds,
        deletedConversationIds,
        deletedGroupIds,
        updatedGroups,
        deletedFileKeys: [...messageFiles, ...scheduledFiles, { fileKey: account?.avatarFileKey || null }]
          .map((entry) => entry.fileKey)
          .filter((key): key is string => Boolean(key))
      };
    });

    // DB transaction tamamlandıktan sonra dış sistem olan R2'ye dokunuyoruz.
    // DB rollback olursa dosya silinmiş kalmasın diye R2 temizliği transaction dışındadır.
    for (const fileKey of [...new Set(deleteResult.deletedFileKeys)]) {
      await deleteFileIfUnreferenced(fileKey);
    }
    const io = req.app.get('io');
    // Etkilenen kullanıcılara anlık bildirim gönderilir; silinen kullanıcı/sohbetler frontend state'inden düşürülebilir.
    deleteResult.affectedUserIds.forEach((affectedUserId) => {
      io.to(affectedUserId).emit('kullanici_silindi', {
        userId,
        conversationIds: deleteResult.deletedConversationIds,
        deletedGroupIds: deleteResult.deletedGroupIds,
        updatedGroups: deleteResult.updatedGroups
      });
    });
    res.status(200).json({ message: "Hesabınız başarıyla silindi." });
  } catch (error) {
    res.status(500).json({ error: "Hesap silinirken bir hata oluştu." });
  }
});

// Sessiz oturum açılışından sonra güncel kullanıcı profilini döndürür.
router.get('/me', authenticateToken, async (req: CustomRequest, res: any) => {
  try {
    const userId = getUserId(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    // İstemciye readReceiptsOn bilgisini de gönderiyoruz ki ayarlarda tiki gösterelim
    res.status(200).json({
        id: user.id,
        username: user.username,
        email: user.email,
        readReceiptsOn: user.readReceiptsOn,
        lastSeenAt: user.lastSeenAt,
        avatarFileKey: user.avatarFileKey,
        avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null
    });
  } catch (error) {
    res.status(500).json({ error: "Kullanıcı bilgileri alınamadı." });
  }
});

// Birebir sohbetlerde kullanılan okundu bilgisi tercihi
router.put('/settings/read-receipts', authenticateToken, validateRequest({ body: userSchemas.readReceipts }), async (req: CustomRequest, res: any) => {
  try {
    const { isEnabled } = req.body;
    const userId = getUserId(req);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { readReceiptsOn: isEnabled }
    });

    res.status(200).json({ message: "Görüldü ayarı güncellendi.", readReceiptsOn: updatedUser.readReceiptsOn });
  } catch (error) {
    res.status(500).json({ error: "Ayar güncellenemedi." });
  }
});

router.put('/avatar', authenticateToken, validateRequest({ body: userSchemas.avatar }), async (req: CustomRequest, res: any) => {
  try {
    const userId = getUserId(req);
    const { fileKey } = req.body;
    const previous = await prisma.user.findUnique({ where: { id: userId }, select: { avatarFileKey: true } });
    if (!previous) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarFileKey: fileKey }
    });

    if (previous.avatarFileKey && previous.avatarFileKey !== fileKey) {
      await deleteFileIfUnreferenced(previous.avatarFileKey);
    }

    return res.status(200).json({
      avatarFileKey: updated.avatarFileKey,
      avatarUrl: updated.avatarFileKey ? await createSignedFileUrl(updated.avatarFileKey) : null
    });
  } catch (error) {
    return res.status(500).json({ error: "Profil fotoğrafı güncellenemedi." });
  }
});

export default router;
