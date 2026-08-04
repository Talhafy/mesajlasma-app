/**
 * ============================================================================
 * SOHBET VE GRUP YÖNETİM SERVİSİ (Conversation & Group Service)
 * ============================================================================
 * 
 * Bu dosya; birebir sohbetlerin ve grup konuşmalarının oluşturulması, sohbet listesi 
 * çekme (cursor pagination), sabitleme, arşivleme, sessize alma, kaybolan mesaj 
 * modu ayarları, gruba üye ekleme/çıkarma, yönetici devretme ve grup/sohbet silme 
 * işlemlerini yürüten temel iş mantığı servisidir.
 */

import prisma from '../db';
import { AppError } from '../errors/AppError';
import { createSignedFileUrl } from './fileStorage';
import { deleteFileIfUnreferenced } from './fileCleanup';
import { requireActiveParticipant } from './conversationAccess';
import { serializeMessage } from './messageService';
import { attachOwnedAsset } from './uploadedAssetService';

/**
 * Sohbet nesnesine imzalı avatar URL'si ekleyen yardımcı fonksiyon.
 */
const withConversationAvatarUrl = async <T extends { avatarFileKey?: string | null }>(conversation: T) => ({
  ...conversation,
  avatarUrl: conversation.avatarFileKey ? await createSignedFileUrl(conversation.avatarFileKey) : null
});

/**
 * Görünür mesaj filtresi (Süresi dolmuş kaybolan mesajlar hariç tutulur).
 */
const visibleMessageWhere = () => ({
  OR: [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } }
  ]
});

/**
 * KULLANICININ SOHBET LİSTESİNİ ÇEKME
 * Kullanıcının üye olduğu birebir ve grup sohbetlerini son mesajları, engelleme durumları,
 * okunmamış sayıları ve kişisel tercihleriyle (pin, archive, mute) birlikte döndürür.
 */
export const listConversations = async (userId: string, cursor?: string, limit: number = 20) => {
  const takeLimit = Math.min(Math.max(limit || 20, 1), 100);
  const memberships = await prisma.participant.findMany({
    where: { userId },
    take: takeLimit + 1,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: String(cursor) } } : {}),
    orderBy: { joinedAt: 'desc' },
    include: {
      conversation: {
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, username: true, avatarFileKey: true, lastSeenAt: true }
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

  const hasNext = memberships.length > takeLimit;
  const pageMemberships = hasNext ? memberships.slice(0, takeLimit) : memberships;
  const nextCursor = hasNext ? pageMemberships[pageMemberships.length - 1].id : null;

  // Kullanıcının engellediği ve kullanıcayı engelleyen kişilerin listesi
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
    pageMemberships.map(async (membership: any) => {
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
      const lastMessageCreatedAt = lastMessageRaw ? new Date(lastMessageRaw.createdAt) : null;
      const isOutsideMembershipWindow = Boolean(
        lastMessageCreatedAt && (
          lastMessageCreatedAt < membership.joinedAt ||
          (membership.leftAt && lastMessageCreatedAt > membership.leftAt)
        )
      );
      if (isOutsideMembershipWindow) {
        lastMessageRaw = await prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            gameChannelId: null,
            deletions: { none: { userId } },
            ...visibleMessageWhere(),
            createdAt: {
              gte: membership.joinedAt,
              ...(membership.leftAt ? { lte: membership.leftAt } : {})
            }
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
        isDeleted: conversation.isDeleted,
        otherUser,
        lastMessage
      };
    })
  );

  // Başa sabitlenenler üstte, ardından son mesaj tarihine göre sıralanır
  const items = conversations.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aTime = new Date(a.lastMessage?.createdAt || a.createdAt).getTime();
    const bTime = new Date(b.lastMessage?.createdAt || b.createdAt).getTime();
    return bTime - aTime;
  });

  return { items, nextCursor };
};

/**
 * Sohbeti sabitler veya sabitlemeyi kaldırır.
 */
export const pinConversation = async (conversationId: string, userId: string) => {
  const participant = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbeti sabitleme yetkiniz yok.'
  );

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
  const participant = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbeti arşivleme yetkiniz yok.'
  );

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
  const participant = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbeti sessize alma yetkiniz yok.'
  );

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
  await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbetin kaybolan mesaj modunu değiştirme yetkiniz yok.'
  );

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
    throw AppError.badRequest('CANNOT_CHAT_SELF', 'Kendinizle sohbet oluşturamazsınız.');
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!targetUser) throw AppError.notFound('USER_NOT_FOUND', 'Hedef kullanıcı bulunamadı.');

  let conversation = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      isDeleted: false,
      AND: [
        { participants: { some: { userId: currentUserId, isActive: true } } },
        { participants: { some: { userId: targetUserId, isActive: true } } }
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
    throw AppError.notFound('USER_NOT_FOUND', 'Seçilen kullanıcılardan biri bulunamadı.');
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
      isActive: true,
      conversation: {
        isGroup: true,
        isDeleted: false
      }
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
  await requireActiveParticipant(
    groupId,
    userId,
    'Bu grubun üyelerini görüntüleme yetkiniz yok.'
  );

  const participants = await prisma.participant.findMany({
    where: { conversationId: groupId },
    include: { user: { select: { id: true, username: true, avatarFileKey: true, lastSeenAt: true } } }
  });

  const blockedRows = await prisma.blockedUser.findMany({
    where: { userId },
    select: { blockedId: true }
  });
  const blockedIds = new Set(blockedRows.map((r) => r.blockedId));

  const systemMessages = await prisma.message.findMany({
    where: {
      conversationId: groupId,
      content: {
        startsWith: '[SYSTEM_'
      }
    },
    select: {
      content: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  return Promise.all(
    participants.map(async (p: any) => {
      let leftReason: string | null = null;
      if (!p.isActive) {
        const matchingMsg = systemMessages.find(msg => {
          if (msg.content.startsWith(`[SYSTEM_LEAVE]:${p.user.username}`)) return true;
          if (msg.content.startsWith('[SYSTEM_KICK]:')) {
            const parts = msg.content.split(':');
            return parts[2] === p.user.username;
          }
          return false;
        });
        leftReason = (matchingMsg && matchingMsg.content.startsWith('[SYSTEM_KICK]:')) ? 'KICK' : 'LEAVE';
      }

      return {
        id: p.user.id,
        username: p.user.username,
        lastSeenAt: p.user.lastSeenAt,
        avatarUrl: p.user.avatarFileKey ? await createSignedFileUrl(p.user.avatarFileKey) : null,
        isBlocked: blockedIds.has(p.user.id),
        isActive: p.isActive,
        leftAt: p.leftAt ? p.leftAt.toISOString() : null,
        leftReason,
        joinedAt: p.joinedAt ? p.joinedAt.toISOString() : null
      };
    })
  );
};

/**
 * Grup adını günceller.
 */
export const updateGroupName = async (groupId: string, userId: string, newName: string) => {
  await requireActiveParticipant(
    groupId,
    userId,
    'Grup adını değiştirmek için aktif üye olmalısınız.'
  );
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Grup bulunamadı.');
  if (!group.isGroup || group.adminId !== userId) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Grup adını yalnızca yönetici değiştirebilir.');
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
  await requireActiveParticipant(
    groupId,
    userId,
    'Grup resmini değiştirmek için aktif üye olmalısınız.'
  );
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Grup bulunamadı.');
  if (!group.isGroup || group.adminId !== userId) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Grup resmini yalnızca yönetici değiştirebilir.');
  }

  const updatedGroup = await prisma.$transaction(async (tx) => {
    if (fileKey) await attachOwnedAsset(fileKey, userId, tx);
    return tx.conversation.update({
      where: { id: groupId },
      data: { avatarFileKey: fileKey }
    });
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
  await requireActiveParticipant(
    groupId,
    adminId,
    'Bu grupta üye çıkarma veya ayrılma yetkiniz yok.'
  );
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Grup bulunamadı.');

  if (group.adminId !== adminId && participantId !== adminId) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Sadece grup yöneticisi kişi çıkarabilir!');
  }

  const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
  const participantUser = await prisma.user.findUnique({ where: { id: participantId } });
  if (!adminUser || !participantUser) throw AppError.notFound('USER_NOT_FOUND', 'Kullanıcı bulunamadı.');
  await requireActiveParticipant(
    groupId,
    participantId,
    'Çıkarılacak kullanıcı grubun aktif bir üyesi değil.'
  );

  const isSelf = participantId === adminId;
  const systemContent = isSelf 
    ? `[SYSTEM_LEAVE]:${participantUser.username}`
    : `[SYSTEM_KICK]:${adminUser.username}:${participantUser.username}`;

  await (prisma.participant.update as any)({
    where: { userId_conversationId: { userId: participantId, conversationId: groupId } },
    data: { isActive: false, leftAt: new Date() }
  });
  await prisma.scheduledMessage.deleteMany({
    where: { conversationId: groupId, senderId: participantId }
  });
  
  const systemMessage = await prisma.message.create({
    data: {
      content: systemContent,
      senderId: adminId,
      conversationId: groupId,
    },
    include: {
      sender: { select: { username: true } },
      reads: true,
      stars: true,
      deletions: true
    }
  });

  if (io && systemMessage) {
    const serialized = await serializeMessage(systemMessage);
    io.to(groupId).emit('yeni_mesaj_geldi', serialized);
    io.to(groupId).emit('gruptan_atildi', { groupId, removedUserId: participantId, removedById: adminId });
    io.in(participantId).socketsLeave(groupId);
  }

  const remainingParticipants = await prisma.participant.findMany({
    where: { conversationId: groupId, isActive: true } as any
  });

  if (remainingParticipants.length === 0) {
    await prisma.conversation.update({
      where: { id: groupId },
      data: { adminId: null }
    });
  } else if (group.adminId === participantId) {
    let newAdminId: string | null = null;
    const historyList = group.adminHistory ? group.adminHistory.split(',') : [];
    const remainingIds = new Set(remainingParticipants.map(p => p.userId));

    for (let i = historyList.length - 1; i >= 0; i--) {
      const historicalId = historyList[i];
      if (remainingIds.has(historicalId)) {
        newAdminId = historicalId;
        break;
      }
    }

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

    const newAdminUser = newAdminId ? await prisma.user.findUnique({ where: { id: newAdminId } }) : null;
    if (newAdminUser) {
      const systemAdminChangeContent = `[SYSTEM_ADMIN_ASSIGN]:${newAdminUser.username}`;
      const changeMsg = await prisma.message.create({
        data: {
          content: systemAdminChangeContent,
          senderId: newAdminId!,
          conversationId: groupId,
        },
        include: {
          sender: { select: { username: true } },
          reads: true,
          stars: true,
          deletions: true
        }
      });
      if (io) {
        const serialized = await serializeMessage(changeMsg);
        io.to(groupId).emit('yeni_mesaj_geldi', serialized);
      }
    }

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
  await requireActiveParticipant(
    groupId,
    adminId,
    'Bu gruba üye ekleme yetkiniz yok.'
  );
  const uniqueUserIds = [...new Set(participantIds)];
  const existingUserCount = await prisma.user.count({ where: { id: { in: uniqueUserIds } } });
  if (existingUserCount !== uniqueUserIds.length) {
    throw AppError.notFound('USER_NOT_FOUND', 'Eklenecek kullanıcılardan biri bulunamadı.');
  }

  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Grup bulunamadı.');
  if (group.adminId !== adminId) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Sadece yönetici kişi ekleyabilir.');
  }

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
    include: { user: { select: { id: true, username: true, avatarFileKey: true, lastSeenAt: true } } }
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
      lastSeenAt: p.user.lastSeenAt,
      avatarUrl: p.user.avatarFileKey ? await createSignedFileUrl(p.user.avatarFileKey) : null,
      isBlocked: blockedIds.has(p.user.id),
      isActive: p.isActive,
      leftAt: p.leftAt ? p.leftAt.toISOString() : null,
      leftReason: null,
      joinedAt: p.joinedAt ? p.joinedAt.toISOString() : null
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

  const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
  if (!adminUser) throw AppError.notFound('USER_NOT_FOUND', 'Yönetici bulunamadı.');

  const systemMessages: any[] = [];
  for (const participant of newParticipants) {
    const systemContent = `[SYSTEM_ADD]:${adminUser.username}:${participant.user.username}`;
    const msg = await prisma.message.create({
      data: {
        content: systemContent,
        senderId: adminId,
        conversationId: groupId,
      },
      include: {
        sender: { select: { username: true } },
        reads: true,
        stars: true,
        deletions: true
      }
    });
    systemMessages.push(msg);
  }

  if (io) {
    for (const msg of systemMessages) {
      const serialized = await serializeMessage(msg);
      io.to(groupId).emit('yeni_mesaj_geldi', serialized);
    }

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
  await requireActiveParticipant(
    groupId,
    adminId,
    'Yöneticiliği devretmek için aktif üye olmalısınız.'
  );
  const group = await prisma.conversation.findUnique({ where: { id: groupId } });
  if (!group) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Grup bulunamadı.');
  if (group.adminId !== adminId) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Sadece kurucu yetki devredebilir.');
  }
  await requireActiveParticipant(
    groupId,
    newAdminId,
    'Yeni yönetici grubun aktif bir üyesi olmalıdır.'
  );

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

  const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
  const newAdminUser = await prisma.user.findUnique({ where: { id: newAdminId } });
  if (adminUser && newAdminUser) {
    const systemContent = `[SYSTEM_ADMIN_TRANSFER]:${adminUser.username}:${newAdminUser.username}`;
    const changeMsg = await prisma.message.create({
      data: {
        content: systemContent,
        senderId: adminId,
        conversationId: groupId,
      },
      include: {
        sender: { select: { username: true } },
        reads: true,
        stars: true,
        deletions: true
      }
    });
    if (io) {
      const serialized = await serializeMessage(changeMsg);
      io.to(groupId).emit('yeni_mesaj_geldi', serialized);
    }
  }

  if (io) {
    io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });
  }

  return { message: "Yönetici değiştirildi." };
};

/**
 * Grubu ve onunla ilişkili tüm mesaj, dosya ve verileri siler (Yalnızca Admin).
 */
export const deleteGroup = async (groupId: string, adminId: string, io: any) => {
  await requireActiveParticipant(
    groupId,
    adminId,
    'Grubu silmek için aktif üye olmalısınız.'
  );
  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.conversation.findUnique({ where: { id: groupId } });
    if (!group?.isGroup || group.adminId !== adminId) return null;

    await tx.scheduledMessage.deleteMany({ where: { conversationId: groupId } });

    await tx.conversation.update({
      where: { id: groupId },
      data: { isDeleted: true, adminId: null }
    });

    return true;
  });

  if (!result) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Grubu yalnızca yönetici silebilir.');
  }

  if (io) {
    io.to(groupId).emit('grup_silindi', { groupId });
  }

  return { message: "Grup başarıyla silindi." };
};

/**
 * Kullanıcı için sohbet geçmişini temizler/siler.
 */
export const deleteConversationHistory = async (conversationId: string, userId: string, io: any = null) => {
  const group = await prisma.conversation.findUnique({ where: { id: conversationId } });
  
  if (group && group.isGroup && group.adminId === userId) {
    const remainingParticipants = await prisma.participant.findMany({
      where: { conversationId, userId: { not: userId }, isActive: true }
    });

    let newAdminId: string | null = null;
    if (remainingParticipants.length > 0) {
      const historyList = group.adminHistory ? group.adminHistory.split(',') : [];
      const remainingIds = new Set(remainingParticipants.map(p => p.userId));

      for (let i = historyList.length - 1; i >= 0; i--) {
        const historicalId = historyList[i];
        if (remainingIds.has(historicalId)) {
          newAdminId = historicalId;
          break;
        }
      }

      if (!newAdminId) {
        const sorted = [...remainingParticipants].sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
        newAdminId = sorted[0].userId;
      }
    }

    const updatedHistory = group.adminHistory 
      ? group.adminHistory.split(',').filter(id => id !== userId && id !== newAdminId).join(',') 
      : "";

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        adminId: newAdminId,
        adminHistory: updatedHistory
      }
    });

    if (io && newAdminId) {
      io.to(conversationId).emit('grup_yonetici_degisti', { groupId: conversationId, newAdminId });
    }
  }

  await prisma.participant.delete({
    where: {
      userId_conversationId: {
        userId,
        conversationId
      }
    }
  }).catch(() => undefined);

  const remainingCount = await prisma.participant.count({
    where: { conversationId }
  });

  if (remainingCount === 0) {
    await prisma.conversation.delete({
      where: { id: conversationId }
    }).catch(() => undefined);
  }

  if (io) {
    io.in(userId).socketsLeave(conversationId);
  }

  return { message: "Sohbet başarıyla temizlendi." };
};

