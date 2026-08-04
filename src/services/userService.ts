/**
 * ============================================================================
 * KULLANICI VE ENGELLENENLER SERVİSİ (User & Blocked User Management)
 * ============================================================================
 * 
 * Bu dosya; kullanıcı arama/listeleme, kullanıcı profil detaylarını getirme ve
 * kullanıcı engelleme/engeli kaldırma (BlockedUser) iş mantıklarını yürütür.
 */

import prisma from '../db';
import { AppError } from '../errors/AppError';
import { createSignedFileUrl } from './fileStorage';

/**
 * Mevcut kullanıcı hariç tüm kullanıcıları engellenme durumlarıyla birlikte listeler.
 */
export const listUsers = async (currentUserId: string, cursor?: string, limit: number = 20) => {
  const takeLimit = Math.min(Math.max(limit || 20, 1), 100);
  const users = await prisma.user.findMany({
    where: { NOT: { id: currentUserId } },
    take: takeLimit + 1,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: String(cursor) } } : {}),
    orderBy: { id: 'asc' },
    select: { id: true, username: true, avatarFileKey: true, lastSeenAt: true }
  });

  const hasNext = users.length > takeLimit;
  const pageUsers = hasNext ? users.slice(0, takeLimit) : users;
  const nextCursor = hasNext ? pageUsers[pageUsers.length - 1].id : null;

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

  const items = await Promise.all(
    pageUsers.map(async (user) => {
      const isBlocked = myBlockedSet.has(user.id);
      const blockedByOther = blockedMeSet.has(user.id);
      return {
        id: user.id,
        username: user.username,
        avatarFileKey: user.avatarFileKey,
        lastSeenAt: user.lastSeenAt,
        avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null,
        isBlocked,
        blockedByOther
      };
    })
  );

  return { items, nextCursor };
};

/**
 * Hedef kullanıcının profil detaylarını ve engellenme durumunu döner.
 */
export const getUserProfile = async (targetId: string, currentUserId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true, avatarFileKey: true, lastSeenAt: true, createdAt: true }
  });
  if (!user) return null;

  const myBlock = await prisma.blockedUser.findUnique({
    where: { userId_blockedId: { userId: currentUserId, blockedId: targetId } }
  });

  const otherBlock = await prisma.blockedUser.findUnique({
    where: { userId_blockedId: { userId: targetId, blockedId: currentUserId } }
  });

  return {
    id: user.id,
    username: user.username,
    avatarFileKey: user.avatarFileKey,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
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
    throw AppError.badRequest('CANNOT_BLOCK_SELF', 'Kendinizi engelleyemezsiniz.');
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

