//sohbet ve grup mesajları için gerekli olan servisler

import prisma from '../db';
import { createSignedFileUrl } from './fileStorage';
import { deleteFileIfUnreferenced } from './fileCleanup';
import { isConversationMember } from './conversationAccess';
import { serializeMessage } from './messageService';

const withConversationAvatarUrl = async <T extends { avatarFileKey?: string | null }>(conversation: T) => ({
  ...conversation,
  avatarUrl: conversation.avatarFileKey ? await createSignedFileUrl(conversation.avatarFileKey) : null
});

// Arama koşulu (expiresAt null veya gelecekte olan mesajlar)
const visibleMessageWhere = () => ({
  OR: [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } }
  ]
});

/**
 * Kullanıcının katıldığı tüm konuşmaları son mesajları ve okunma durumlarıyla birlikte döner.
 */
export const listConversations = async (userId: string) => {
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
            where: { gameChannelId: null, deletions: { none: { userId } }, ...visibleMessageWhere() },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              sender: { select: { username: true } },
              reads: { select: { userId: true } },
              stars: { select: { userId: true } },
              deletions: { select: { userId: true } }
            }
          }
        }
      }
    }
  });

  const myBlocked = await prisma.blockedUser.findMany({
    where: { userId },
    select: { blockedId: true }
  });
  const myBlockedSet = new Set(myBlocked.map((r) => r.blockedId));

  const blockedMe = await prisma.blockedUser.findMany({
    where: { blockedId: userId },
    select: { userId: true }
  });
  const blockedMeSet = new Set(blockedMe.map((r) => r.userId));

  const conversations = await Promise.all(
    memberships.map(async (membership: any) => {
      const { conversation } = membership;
      const otherParticipant = conversation.isGroup
        ? null
        : conversation.participants.find((p: any) => p.userId !== userId);

      const otherUser = otherParticipant?.user
        ? {
          ...otherParticipant.user,
          avatarUrl: otherParticipant.user.avatarFileKey
            ? await createSignedFileUrl(otherParticipant.user.avatarFileKey)
            : null,
          isBlocked: myBlockedSet.has(otherParticipant.user.id),
          blockedByOther: blockedMeSet.has(otherParticipant.user.id)
        }
        : null;

      let lastMessageRaw: any = conversation.messages[0];
      if (membership.leftAt && lastMessageRaw && new Date(lastMessageRaw.createdAt) > membership.leftAt) {
        lastMessageRaw = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            gameChannelId: null,
            deletions: { none: { userId } },
            ...visibleMessageWhere(),
            createdAt: { lte: membership.leftAt }
          },
          orderBy: { createdAt: 'desc' },
          include: {
            sender: { select: { username: true } },
            reads: { select: { userId: true } },
            stars: { select: { userId: true } },
            deletions: { select: { userId: true } }
          }
        });
      }

      const lastMessage = lastMessageRaw
        ? await serializeMessage(lastMessageRaw)
        : null;

      return {
        id: conversation.id,
        isGroup: conversation.isGroup,
        name: conversation.name,
        adminId: conversation.adminId,
        avatarFileKey: conversation.avatarFileKey,
        avatarUrl: conversation.avatarFileKey ? await createSignedFileUrl(conversation.avatarFileKey) : null,
        createdAt: conversation.createdAt,
        isPinned: membership.isPinned,
        isArchived: membership.isArchived,
        isMuted: membership.isMuted,
        isActive: membership.isActive,
        leftAt: membership.leftAt ? membership.leftAt.toISOString() : null,
        disappearingDurationSeconds: conversation.disappearingDurationSeconds,
        otherUser,
        lastMessage
      };
    })
  );

  return conversations.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aTime = new Date(a.lastMessage?.createdAt || a.createdAt).getTime();
    const bTime = new Date(b.lastMessage?.createdAt || b.createdAt).getTime();
    return bTime - aTime;
  });
};

/**
 * Sohbeti sabitler veya sabitlemeyi kaldırır.
 */
export const pinConversation = async (conversationId: string, userId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } }
  });
  if (!participant) {
    throw new Error('Bu sohbeti sabitleme yetkiniz yok.');
  }

  const updated = await prisma.participant.update({
    where: { id: participant.id },
    data: { isPinned: !participant.isPinned }
  });

  return { conversationId, isPinned: updated.isPinned };
};

/**
 * Sohbeti arşivler veya arşivden kaldırır.
 */
export const archiveConversation = async (conversationId: string, userId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } }
  });
  if (!participant) {
    throw new Error('Bu sohbeti arşivleme yetkiniz yok.');
  }

  const updated = await prisma.participant.update({
    where: { id: participant.id },
    data: { isArchived: !participant.isArchived }
  });

  return { conversationId, isArchived: updated.isArchived };
};

/**
 * Sohbeti sessize alır veya sessizden çıkarır.
 */
export const muteConversation = async (conversationId: string, userId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } }
  });
  if (!participant) {
    throw new Error('Bu sohbeti sessize alma yetkiniz yok.');
  }

  const updated = await prisma.participant.update({
    where: { id: participant.id },
    data: { isMuted: !participant.isMuted }
  });

  return { conversationId, isMuted: updated.isMuted };
};

/**
 * Kaybolan mesaj modunu günceller.
 */
export const updateDisappearingMode = async (conversationId: string, userId: string, durationSeconds: number | null, io: any) => {
  if (!(await isConversationMember(conversationId, userId))) {
    throw new Error('Bu sohbetin kaybolan mesaj modunu değiştirme yetkiniz yok.');
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { disappearingDurationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null }
  });

  if (io) {
    io.to(conversationId).emit('sohbet_ayarlari_guncellendi', {
      conversationId,
      disappearingDurationSeconds: updated.disappearingDurationSeconds
    });
  }

  return { conversationId, disappearingDurationSeconds: updated.disappearingDurationSeconds };
};

/**
 * Birebir sohbet odası bulur veya oluşturur.
 */
export const createDirectConversation = async (currentUserId: string, targetUserId: string) => {
  if (currentUserId === targetUserId) {
    throw new Error('Kendinizle sohbet oluşturamazsınız.');
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!targetUser) throw new Error('Hedef kullanıcı bulunamadı.');

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
    conversation = await prisma.$transaction(async (tx) => {
      const createdConversation = await tx.conversation.create({
        data: { isGroup: false }
      });
      await tx.participant.createMany({
        data: [
          { userId: currentUserId, conversationId: createdConversation.id },
          { userId: targetUserId, conversationId: createdConversation.id }
        ],
        skipDuplicates: true
      });
      return createdConversation;
    });
  }

  const currentParticipant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId: currentUserId, conversationId: conversation.id } }
  });

  return {
    ...conversation,
    isPinned: currentParticipant?.isPinned || false,
    isArchived: currentParticipant?.isArchived || false,
    isMuted: currentParticipant?.isMuted || false
  };
};

/**
 * Grup sohbeti oluşturur.
 */
export const createGroupConversation = async (adminId: string, name: string, participantIds: string[], io: any) => {
  const allMemberIds = [...new Set([...participantIds, adminId])];
  const existingUserCount = await prisma.user.count({ where: { id: { in: allMemberIds } } });
  if (existingUserCount !== allMemberIds.length) {
    throw new Error('Seçilen kullanıcılardan biri bulunamadı.');
  }

  const newGroup = await prisma.$transaction(async (tx) => {
    const createdGroup = await tx.conversation.create({
      data: {
        isGroup: true,
        name: name.trim(),
        adminId
      }
    });
    await tx.participant.createMany({
      data: allMemberIds.map((id) => ({ userId: id, conversationId: createdGroup.id })),
      skipDuplicates: true
    });
    return createdGroup;
  });

  const responseGroup = await withConversationAvatarUrl(newGroup);
  const resultGroup = {
    ...responseGroup,
    isPinned: false,
    isArchived: false,
    isMuted: false
  };

  if (io) {
    allMemberIds.filter((id) => id !== adminId).forEach((userId) => {
      io.to(userId).emit('grup_olusturuldu', resultGroup);
    });
  }

  return resultGroup;
};

/**
 * Kullanıcının katıldığı grupları listeler.
 */
export const listGroupConversations = async (userId: string) => {
  const myGroups = await prisma.participant.findMany({
    where: {
      userId,
      conversation: { isGroup: true }
    },
    include: { conversation: true }
  });

  return Promise.all(
    myGroups.map(async (p: any) => {
      const responseGroup = await withConversationAvatarUrl(p.conversation);
      return {
        ...responseGroup,
        isPinned: p.isPinned,
        isArchived: p.isArchived,
        isMuted: p.isMuted,
        isActive: p.isActive,
        leftAt: p.leftAt ? p.leftAt.toISOString() : null
      };
    })
  );
};

/**
 * Grubun katılımcı listesini ve engelleme durumlarını döner.
 */
export const listGroupParticipants = async (groupId: string, userId: string) => {
  if (!(await isConversationMember(groupId, userId))) {
    throw new Error('Bu grubun üyelerini görüntüleme yetkiniz yok.');
  }

  const participants = await prisma.participant.findMany({
    where: { conversationId: groupId },
    include: { user: { select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true } } }
  });

  const blockedRows = await prisma.blockedUser.findMany({
    where: { userId },
    select: { blockedId: true }
  });
  const blockedIds = new Set(blockedRows.map((r) => r.blockedId));

  return Promise.all(
    participants.map(async (p: any) => ({
      id: p.user.id,
      username: p.user.username,
      email: p.user.email,
      lastSeenAt: p.user.lastSeenAt,
      avatarUrl: p.user.avatarFileKey ? await createSignedFileUrl(p.user.avatarFileKey) : null,
      isBlocked: blockedIds.has(p.user.id),
      isActive: p.isActive
    }))
  );
};

/**
 * Grup adını günceller.
 */
export const updateGroupName = async (groupId: string, userId: string, newName: string) => {
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Grup bulunamadı.');
  if (!group.isGroup || group.adminId !== userId) {
    throw new Error('Grup adını yalnızca yönetici değiştirebilir.');
  }

  return prisma.conversation.update({
    where: { id: groupId },
    data: { name: newName.trim() }
  });
};

/**
 * Grup resmini (avatar) günceller ve eskisini siler.
 */
export const updateGroupAvatar = async (groupId: string, userId: string, fileKey: string | null, io: any) => {
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Grup bulunamadı.');
  if (!group.isGroup || group.adminId !== userId) {
    throw new Error('Grup resmini yalnızca yönetici değiştirebilir.');
  }

  const updatedGroup = await prisma.conversation.update({
    where: { id: groupId },
    data: { avatarFileKey: fileKey }
  });

  if (group.avatarFileKey && group.avatarFileKey !== fileKey) {
    await deleteFileIfUnreferenced(group.avatarFileKey);
  }

  const responseGroup = await withConversationAvatarUrl(updatedGroup);

  if (io) {
    io.to(groupId).emit('grup_guncellendi', responseGroup);
  }

  const participant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId: groupId } }
  });

  return {
    ...responseGroup,
    isPinned: participant?.isPinned || false,
    isArchived: participant?.isArchived || false,
    isMuted: participant?.isMuted || false
  };
};

/**
 * Gruptan üye çıkarır, kendi çıkmak isteyen üyeyi gruptan çıkarır veya grubu komple temizler.
 */
export const removeGroupParticipant = async (groupId: string, participantId: string, adminId: string, io: any) => {
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Grup bulunamadı.');

  // Sadece admin başkasını çıkarabilir, üye kendisi gruptan çıkabilir
  if (group.adminId !== adminId && participantId !== adminId) {
    throw new Error('Sadece grup yöneticisi kişi çıkarabilir!');
  }

  await prisma.$transaction(async (tx) => {
    // Katılımcıyı tamamen silmek yerine pasife çekiyoruz ve leftAt zamanını kaydediyoruz
    await (tx.participant.update as any)({
      where: { userId_conversationId: { userId: participantId, conversationId: groupId } },
      data: { isActive: false, leftAt: new Date() }
    });
    await tx.scheduledMessage.deleteMany({
      where: { conversationId: groupId, senderId: participantId }
    });
  });

  if (io) {
    io.to(groupId).emit('gruptan_atildi', { groupId, removedUserId: participantId, removedById: adminId });
    io.in(participantId).socketsLeave(groupId);
  }

  // Sadece AKTİF kalan katılımcıları buluyoruz
  const remainingParticipants = await prisma.participant.findMany({
    where: { conversationId: groupId, isActive: true } as any
  });

  if (remainingParticipants.length === 0) {
    // Katılımcı kalmadıysa grubu ve onunla ilişkili dosyaları temizle
    const messageFiles = await prisma.message.findMany({
      where: { conversationId: groupId, fileKey: { not: null } },
      select: { fileKey: true }
    });
    const scheduledFiles = await prisma.scheduledMessage.findMany({
      where: { conversationId: groupId, fileKey: { not: null } },
      select: { fileKey: true }
    });

    await prisma.conversation.delete({ where: { id: groupId } });

    const deletedFileKeys = [...messageFiles, ...scheduledFiles, { fileKey: group.avatarFileKey }]
      .map((entry) => entry.fileKey)
      .filter((key): key is string => Boolean(key));

    for (const fileKey of [...new Set(deletedFileKeys)]) {
      await deleteFileIfUnreferenced(fileKey);
    }

    if (io) {
      io.to(groupId).emit('grup_silindi', { groupId });
    }
  } else if (group.adminId === participantId) {
    // Ayrılan kişi yöneticisiyse sıradaki aktif yöneticiyi belirle
    let newAdminId: string | null = null;

    // 1. En son yönetici yapan kişi (adminHistory tersten taranır)
    const historyList = group.adminHistory ? group.adminHistory.split(',') : [];
    const remainingIds = new Set(remainingParticipants.map(p => p.userId));

    for (let i = historyList.length - 1; i >= 0; i--) {
      const historicalId = historyList[i];
      if (remainingIds.has(historicalId)) {
        newAdminId = historicalId;
        break;
      }
    }

    // 2. Tarihçedekiler grupta değilse, katılım tarihine göre en eski olan üye (joinedAt)
    if (!newAdminId) {
      const sorted = [...remainingParticipants].sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
      newAdminId = sorted[0].userId;
    }

    const updatedHistory = historyList.filter(id => id !== participantId && id !== newAdminId).join(',');

    await prisma.conversation.update({
      where: { id: groupId },
      data: {
        adminId: newAdminId,
        adminHistory: updatedHistory
      }
    });

    if (io) {
      io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });
    }
  }

  return { message: "İşlem başarılı." };
};

/**
 * Gruba yeni üyeler ekler.
 */
export const addGroupParticipants = async (groupId: string, participantIds: string[], adminId: string, io: any) => {
  const uniqueUserIds = [...new Set(participantIds)];
  const existingUserCount = await prisma.user.count({ where: { id: { in: uniqueUserIds } } });
  if (existingUserCount !== uniqueUserIds.length) {
    throw new Error('Eklenecek kullanıcılardan biri bulunamadı.');
  }

  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Grup bulunamadı.');
  if (group.adminId !== adminId) {
    throw new Error('Sadece yönetici kişi ekleyebilir.');
  }

  // Her bir kullanıcıyı gruba eklerken, eğer önceden pasif bir kaydı varsa aktif ediyoruz
  for (const userId of uniqueUserIds) {
    const existing = await prisma.participant.findUnique({
      where: { userId_conversationId: { userId, conversationId: groupId } }
    });
    if (existing) {
      await (prisma.participant.update as any)({
        where: { id: existing.id },
        data: { isActive: true, leftAt: null, joinedAt: new Date() }
      });
    } else {
      await (prisma.participant.create as any)({
        data: { userId, conversationId: groupId, isActive: true, leftAt: null }
      });
    }
  }

  const newParticipants = await prisma.participant.findMany({
    where: { conversationId: groupId, userId: { in: uniqueUserIds } },
    include: { user: { select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true } } }
  });

  const blockedRows = await prisma.blockedUser.findMany({
    where: { userId: adminId },
    select: { blockedId: true }
  });
  const blockedIds = new Set(blockedRows.map((r) => r.blockedId));

  const serializedMembers = await Promise.all(
    newParticipants.map(async (p: any) => ({
      id: p.user.id,
      username: p.user.username,
      email: p.user.email,
      lastSeenAt: p.user.lastSeenAt,
      avatarUrl: p.user.avatarFileKey ? await createSignedFileUrl(p.user.avatarFileKey) : null,
      isBlocked: blockedIds.has(p.user.id),
      isActive: p.isActive
    }))
  );

  const enrichedGroup = await withConversationAvatarUrl(group);
  const resultGroup = {
    ...enrichedGroup,
    isPinned: false,
    isArchived: false,
    isMuted: false,
    isActive: true,
    leftAt: null
  };

  if (io) {
    uniqueUserIds.forEach((userId) => {
      io.to(userId).emit('grup_olusturuldu', resultGroup);
      io.in(userId).socketsJoin(groupId);
    });
    io.to(groupId).emit('grup_uyeleri_eklendi', { groupId, newMembers: serializedMembers });
  }

  return { message: "Kişiler eklendi." };
};

/**
 * Grup yöneticiliğini (adminlik) devreder.
 */
export const transferGroupAdmin = async (groupId: string, newAdminId: string, adminId: string, io: any) => {
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('Grup bulunamadı.');
  if (group.adminId !== adminId) {
    throw new Error('Sadece kurucu yetki devredebilir.');
  }
  if (!(await isConversationMember(groupId, newAdminId))) {
    throw new Error('Yeni yönetici grubun üyesi olmalıdır.');
  }

  const historyList = group.adminHistory ? group.adminHistory.split(',').filter(id => id !== adminId) : [];
  historyList.push(adminId);
  const newHistory = historyList.join(',');

  await prisma.conversation.update({
    where: { id: groupId },
    data: {
      adminId: newAdminId,
      adminHistory: newHistory
    }
  });

  if (io) {
    io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });
  }

  return { message: "Yönetici değiştirildi." };
};

/**
 * Grubu ve onunla ilişkili tüm mesaj, dosya ve verileri siler (Yalnızca Admin).
 */
export const deleteGroup = async (groupId: string, adminId: string, io: any) => {
  const deletedFileKeys = await prisma.$transaction(async (tx) => {
    const group = await tx.conversation.findUnique({ where: { id: groupId } });
    if (!group?.isGroup || group.adminId !== adminId) return null;

    const messageFiles = await tx.message.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } });
    const scheduledFiles = await tx.scheduledMessage.findMany({ where: { conversationId: groupId, fileKey: { not: null } }, select: { fileKey: true } });

    await tx.conversation.delete({ where: { id: groupId } });
    return [...messageFiles, ...scheduledFiles, { fileKey: group.avatarFileKey }]
      .map((entry) => entry.fileKey)
      .filter((key): key is string => Boolean(key));
  });

  if (!deletedFileKeys) {
    throw new Error("Grubu yalnızca yönetici silebilir.");
  }

  for (const fileKey of [...new Set(deletedFileKeys)]) {
    await deleteFileIfUnreferenced(fileKey);
  }

  if (io) {
    io.to(groupId).emit('grup_silindi', { groupId });
  }

  return { message: "Grup başarıyla silindi." };
};
