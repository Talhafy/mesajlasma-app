//Engellenen kullanıcılar için ayrı bir servis

import prisma from '../db';
import { createSignedFileUrl } from './fileStorage';

/**
 * Mevcut kullanıcı hariç tüm kullanıcıları engellenme durumlarıyla birlikte listeler.
 */
export const listUsers = async (currentUserId: string) => {
  const users = await prisma.user.findMany({
    where: { NOT: { id: currentUserId } },
    select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true }
  });

  const myBlocked = await prisma.blockedUser.findMany({
    where: { userId: currentUserId },
    select: { blockedId: true }
  });
  const myBlockedSet = new Set(myBlocked.map((r) => r.blockedId));

  const blockedMe = await prisma.blockedUser.findMany({
    where: { blockedId: currentUserId },
    select: { userId: true }
  });
  const blockedMeSet = new Set(blockedMe.map((r) => r.userId));

  return Promise.all(
    users.map(async (user) => {
      const isBlocked = myBlockedSet.has(user.id);
      const blockedByOther = blockedMeSet.has(user.id);
      return {
        ...user,
        avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null,
        isBlocked,
        blockedByOther
      };
    })
  );
};

/**
 * Hedef kullanıcının profil detaylarını ve engellenme durumunu döner.
 */
export const getUserProfile = async (targetId: string, currentUserId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true, email: true, avatarFileKey: true, lastSeenAt: true, createdAt: true }
  });
  if (!user) return null;

  const myBlock = await prisma.blockedUser.findUnique({
    where: { userId_blockedId: { userId: currentUserId, blockedId: targetId } }
  });

  const otherBlock = await prisma.blockedUser.findUnique({
    where: { userId_blockedId: { userId: targetId, blockedId: currentUserId } }
  });

  return {
    ...user,
    avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null,
    isBlocked: !!myBlock,
    blockedByOther: !!otherBlock
  };
};

/**
 * Kullanıcının engellediği kişileri listeler.
 */
export const getBlockedUsers = async (currentUserId: string) => {
  const rows = await prisma.blockedUser.findMany({
    where: { userId: currentUserId },
    include: { blocked: { select: { id: true, username: true, avatarFileKey: true } } }
  });

  return Promise.all(
    rows.map(async (row) => ({
      id: row.blocked.id,
      username: row.blocked.username,
      avatarUrl: row.blocked.avatarFileKey ? await createSignedFileUrl(row.blocked.avatarFileKey) : null,
      blockedAt: row.createdAt
    }))
  );
};

/**
 * Belirtilen kullanıcıyı engeller ve ilgili socket olaylarını tetikler.
 */
export const blockUser = async (currentUserId: string, targetId: string, io: any) => {
  if (currentUserId === targetId) {
    throw new Error("Kendinizi engelleyemezsiniz.");
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!targetUser) return null;

  await prisma.blockedUser.upsert({
    where: { userId_blockedId: { userId: currentUserId, blockedId: targetId } },
    create: { userId: currentUserId, blockedId: targetId },
    update: {}
  });

  if (io) {
    io.to(targetId).emit('user_blocked_you', { blockerId: currentUserId });
    io.to(currentUserId).emit('user_blocked_target', { targetId });
  }

  return { isBlocked: true };
};

/**
 * Belirtilen kullanıcının engelini kaldırır ve ilgili socket olaylarını tetikler.
 */
export const unblockUser = async (currentUserId: string, targetId: string, io: any) => {
  await prisma.blockedUser.deleteMany({
    where: { userId: currentUserId, blockedId: targetId }
  });

  if (io) {
    io.to(targetId).emit('user_unblocked_you', { blockerId: currentUserId });
    io.to(currentUserId).emit('user_unblocked_target', { targetId });
  }

  return { isBlocked: false };
};
