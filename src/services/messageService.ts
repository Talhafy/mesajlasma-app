/**
 * ============================================================================
 * MESAJLAŞMA İŞ MANTIĞI SERVİSİ (Message Management Service)
 * ============================================================================
 * 
 * Bu dosya; mesaj gönderimi, mesaj düzenleme, herkesten/benden mesaj silme,
 * PostgreSQL pg_trgm GIN indeksi ile hızlı arama, medya/link geçmişi çekme, 
 * mesaj yıldızlama, okundu bilgisi işaretleme (`ConversationReadState` cursor)
 * ve okunmamış mesaj sayacı hesaplama iş mantıklarını yürütür.
 */

import { Prisma } from '@prisma/client';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { withSignedFileUrl } from './fileStorage';
import { historyDeliveryFor, historyVersion, listHistoryReaders, removeHistoryDeliveryFor, requireVaultRecipients, verifyHistoryDelivery, type HistoryDelivery } from './accountHistoryService';
import { deleteFileIfUnreferenced } from './fileCleanup';
import { attachOwnedAsset, cloneAssetForOwner } from './uploadedAssetService';
import {
  requireActiveParticipant,
  requireHistoryParticipant
} from './conversationAccess';

/** Görünür mesaj filtresi (Süresi dolmuş kaybolan mesajları hariç tutar) */
const visibleMessageWhere = () => ({
  OR: [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } }
  ]
});

/** Yanıt önizlemesinin metin yanında medya türünü ve E2EE zarfını da koruması için ortak seçim. */
const replyToSelect = {
  id: true,
  content: true,
  protocolVersion: true,
  epoch: true,
  senderDeviceId: true,
  ciphertext: true,
  encryptedFileMetadata: true,
  messageType: true,
  isDeletedForEveryone: true,
  fileKey: true,
  fileType: true,
  fileName: true,
  sender: { select: { username: true } }
} satisfies Prisma.MessageSelect;

type MessagePeriod = { joinedAt: Date; leftAt: Date | null };

const messagePeriods = (membership: MessagePeriod & { historyPeriods?: MessagePeriod[] }) =>
  [membership, ...(membership.historyPeriods ?? [])];

const messagePeriodWhere = (periods: MessagePeriod[]): Prisma.MessageWhereInput => ({
  OR: periods.map(({ joinedAt, leftAt }) => ({ createdAt: { gte: joinedAt, ...(leftAt ? { lte: leftAt } : {}) } }))
});

const withGroupRecipients = <T extends { senderId: string; createdAt: Date }>(message: T, activeMembers: { userId: string; joinedAt: Date }[]) => ({
  ...message,
  groupRecipientIds: activeMembers.filter((member) => member.userId !== message.senderId && member.joinedAt <= message.createdAt)
    .map((member) => member.userId)
});

/** Kullanıcının aktif olduğu sohbet pencerelerini getirir */
const getActiveMessageWindows = (userId: string) => (
  prisma.participant.findMany({
    where: {
      userId,
      isActive: true,
      conversation: { isDeleted: false }
    },
    select: {
      conversationId: true,
      joinedAt: true
    }
  })
);

/** Mesaja aktif erişim yetkisi olup olmadığını denetler */
const requireActiveMessageAccess = async (
  message: { conversationId: string; createdAt: Date },
  userId: string,
  errorMessage: string
) => {
  const membership = await requireActiveParticipant(
    message.conversationId,
    userId,
    errorMessage
  );
  if (message.createdAt < membership.joinedAt) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', errorMessage);
  }
  return membership;
};

/** Mesaja eklenecek dosya varlığını çözümler veya iletilen mesaj için klonlar */
const resolveMessageAsset = async (input: {
  fileKey?: string | null;
  fileName?: string | null;
  isForwarded?: boolean;
  senderId: string;
}) => {
  if (!input.fileKey) return null;

  if (!input.isForwarded) {
    await attachOwnedAsset(input.fileKey, input.senderId);
    return input.fileKey;
  }

  const sourceMessage = await prisma.message.findFirst({
    where: { fileKey: input.fileKey, ...visibleMessageWhere() },
    include: {
      conversation: {
        select: {
          isDeleted: true,
          participants: {
            where: { userId: input.senderId, isActive: true },
            select: { joinedAt: true }
          }
        }
      }
    }
  });
  const membership = sourceMessage?.conversation.participants[0];
  if (!sourceMessage || sourceMessage.conversation.isDeleted || !membership || sourceMessage.createdAt < membership.joinedAt) {
    throw AppError.forbidden('ASSET_NOT_OWNED', 'İletilecek dosyaya erişim yetkiniz yok.');
  }

  const sourceAsset = await prisma.uploadedAsset.findUnique({ where: { fileKey: input.fileKey } });
  if (!sourceAsset || sourceAsset.status === 'REJECTED') {
    throw AppError.badRequest('ASSET_EXPIRED_OR_REJECTED', 'İletilecek dosya kullanılamıyor.');
  }

  const copiedFileKey = await cloneAssetForOwner({
    sourceFileKey: input.fileKey,
    sourceAsset,
    ownerId: input.senderId,
    originalName: input.fileName || sourceMessage.fileName || input.fileKey
  });
  await attachOwnedAsset(copiedFileKey, input.senderId);
  return copiedFileKey;
};

export type MessageWithReads = Prisma.MessageGetPayload<{
  include: {
    reads: {
      select: {
        userId: true;
      };
    };
    stars: {
      select: {
        userId: true;
      };
    };
    deletions: {
      select: {
        userId: true;
      };
    };
  };
}>;

/**
 * Mesajı imzalı dosya URL'leri ile zenginleştirir ve okundu listesine göndericiyi dahil eder.
 */
type MessageWithAccountHistory = MessageWithReads & {
  accountHistory?: { version: string; iv: string; payload: string }[];
};

export const selectAccountHistory = (userId: string) => ({ where: { userId }, select: { version: true, iv: true, payload: true } } as const);

export const serializeMessage = async (msg: MessageWithAccountHistory, cursorReadByIds: string[] = [], viewerId?: string) => {
  const signed = await withSignedFileUrl(msg);
  const { reads = [], stars = [], deletions = [], historyDelivery, accountHistory, ...rest } = signed;
  const version = viewerId && accountHistory?.length && msg.ciphertext ? historyVersion(msg.ciphertext) : undefined;

  const readByIds = [...new Set([
    ...reads.map((r) => r.userId),
    ...cursorReadByIds
  ])];

  const starredByIds = stars.map((s) => s.userId);
  const deletedForIds = deletions.map((d) => d.userId);

  return {
    ...rest,
    historyDelivery: historyDeliveryFor(historyDelivery, viewerId),
    accountHistoryCopy: version ? accountHistory?.find((copy) => copy.version === version) : undefined,
    readByIds,
    starredByIds,
    deletedForIds
  };
};

/**
 * Read cursor'larını tek sorguda çekerek eski MessageRead kayıtlarıyla birleştirir.
 * Böylece yeni mesajlar için MessageRead yazmadan, sayfa yenilendiğinde de read receipt gösterilir.
 */
export const serializeMessages = async (messages: MessageWithAccountHistory[], viewerId?: string) => {
  if (messages.length === 0) return [];
  const conversationIds = [...new Set(messages.map((message) => message.conversationId))];
  const states = await prisma.conversationReadState.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { userId: true, conversationId: true, lastReadAt: true }
  });
  const statesByWindow = new Map<string, typeof states>();
  for (const state of states) {
    const key = state.conversationId;
    const current = statesByWindow.get(key) || [];
    current.push(state);
    statesByWindow.set(key, current);
  }

  return Promise.all(messages.map((message) => {
    const stateReaders = (statesByWindow.get(message.conversationId) || [])
      .filter((state) => state.userId !== message.senderId && state.lastReadAt >= message.createdAt)
      .map((state) => state.userId);
    return serializeMessage(message, stateReaders, viewerId);
  }));
};

/**
 * YENİ MESAJ GÖNDERME
 * Engelleme kontrolleri, yanıt verilen mesaj doğrulaması, dosya bağlama (attachment)
 * ve idempotency (`clientId`) kontrolleri yapılarak mesaj veritabanına eklenir ve Socket.IO yayınlanır.
 */
export const sendMessage = async (
  senderId: string,
  payload: {
    conversationId: string;
    clientId: string;
    content?: string;
    protocolVersion?: number;
    epoch?: number | null;
    senderDeviceId?: string | null;
    ciphertext?: string | null;
    encryptedFileMetadata?: string | null;
    historyDelivery?: HistoryDelivery;
    replyToId?: string | null;
    isForwarded?: boolean;
    fileKey?: string | null;
    fileType?: string | null;
    fileName?: string | null;
  },
  io: any
) => {
  const {
    conversationId,
    clientId,
    protocolVersion = 0,
    epoch = null,
    senderDeviceId = null,
    ciphertext = null,
    replyToId,
    isForwarded,
    fileKey,
    fileType,
    fileName,
    historyDelivery
  } = payload;

  const membership = await requireActiveParticipant(
    conversationId,
    senderId,
    'Bu sohbete mesaj gönderme yetkiniz yok.'
  );

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { participants: true }
  });
  if (!conversation) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Sohbet bulunamadı.');
  if (conversation.isDeleted) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Bu grup silinmiştir. Yeni mesaj gönderilemez.');
  }
  if (!conversation.participants.some((participant: any) => participant.userId === senderId && participant.isActive)) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Bu sohbete mesaj gönderme yetkiniz yok.');
  }
  let activeMembers: { userId: string; joinedAt: Date }[] = conversation.participants.filter((participant) => participant.isActive);

  // Yeni MLS zarfları şifreli içeriğe sohbet ve mesaj kimliğini bağlar.
  const activeEpoch = (conversation as any).mlsCurrentEpoch ?? 0;
  if (protocolVersion !== 2 || !ciphertext) {
    throw AppError.badRequest(
      'MLS_ENCRYPTION_REQUIRED',
      'Mesaj göndermek için güncel bir MLS zarfı gereklidir.'
    );
  }
  if (activeEpoch < 1 || epoch !== activeEpoch) {
    throw AppError.conflict('MLS_EPOCH_MISMATCH', 'Mesaj göndermeden önce MLS dönemini eşitleyin.');
  }
  if (!senderDeviceId) {
    throw AppError.badRequest('MLS_DEVICE_NOT_FOUND', 'MLS mesajlarında senderDeviceId zorunludur.');
  }
  const senderDevice = await prisma.userDevice.findUnique({ where: { id: senderDeviceId } });
  if (!senderDevice || senderDevice.userId !== senderId || senderDevice.revokedAt || !senderDevice.approvedAt) {
    throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Gönderici cihaz doğrulanamadı veya iptal edilmiş.');
  }

  // Birebir sohbetlerde engelleme durumları kontrol edilir
  if (!conversation.isGroup) {
    const otherParticipant = conversation.participants.find((p) => p.userId !== senderId);
    if (otherParticipant) {
      const blockedByOther = await prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId: otherParticipant.userId, blockedId: senderId } }
      });
      if (blockedByOther) {
        throw AppError.forbidden('USER_BLOCKED', 'Bu kullanıcıya mesaj gönderemezsiniz çünkü engellendiniz.');
      }

      const blockedByMe = await prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId: senderId, blockedId: otherParticipant.userId } }
      });
      if (blockedByMe) {
        throw AppError.forbidden('USER_BLOCKED', 'Bu kullanıcıyı engellediniz. Mesaj göndermek için engeli kaldırın.');
      }
    }
  }

  // Yanıtlanan mesaj doğrulaması
  if (replyToId) {
    const repliedMessage = await prisma.message.findFirst({
      where: {
        id: String(replyToId),
        conversationId,
        createdAt: { gte: membership.joinedAt }
      },
      select: { id: true }
    });
    if (!repliedMessage) throw AppError.badRequest('BAD_REQUEST', 'Yanıtlanan mesaj bu sohbete ait değil.');
  }

  if (!historyDelivery) throw AppError.badRequest('HISTORY_VAULT_REQUIRED', 'Mesajın şifreli geçmiş kopyası gerekli.');
  let recovery = await verifyHistoryDelivery(historyDelivery, conversationId, senderId, clientId,
    ciphertext, senderDevice.signaturePublicKey, activeMembers.map((member) => member.userId));

  const attachInTransaction = Boolean(fileKey && !isForwarded);
  const resolvedFileKey = attachInTransaction ? fileKey ?? null : await resolveMessageAsset({ fileKey, fileName, isForwarded, senderId });

  let savedMessage;
  try {
    const data = {
        clientId,
        content: '',
        protocolVersion,
        epoch,
        senderDeviceId,
        ciphertext,
        encryptedFileMetadata: null,
        senderId,
        conversationId,
        replyToId: replyToId || null,
        isForwarded: isForwarded || false,
        fileKey: resolvedFileKey,
        fileType: fileType || null,
        fileName: resolvedFileKey ? 'encrypted.enc' : null,
        expiresAt: conversation.disappearingDurationSeconds
          ? new Date(Date.now() + conversation.disappearingDurationSeconds * 1000)
          : null
    };
    const createdMessage = await prisma.$transaction(async (tx) => {
      const lockedMembers = await tx.$queryRaw<{ userId: string; joinedAt: Date; historyClearedAt: Date | null }[]>`
        SELECT "userId", "joinedAt", "historyClearedAt" FROM "Participant"
        WHERE "conversationId" = ${conversationId} AND "isActive" ORDER BY "userId" FOR SHARE
      `;
      activeMembers = lockedMembers;
      if (!activeMembers.some((member) => member.userId === senderId)) {
        throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Bu sohbete mesaj gönderme yetkiniz yok.');
      }
      const [current] = await tx.$queryRaw<{ mlsCurrentEpoch: number; isDeleted: boolean }[]>`
        SELECT "mlsCurrentEpoch", "isDeleted" FROM "Conversation" WHERE "id" = ${conversationId} FOR SHARE
      `;
      if (!current || current.isDeleted || current.mlsCurrentEpoch !== epoch) {
        throw AppError.conflict('MLS_EPOCH_MISMATCH', 'Mesaj göndermeden önce MLS dönemini eşitleyin.');
      }
      const recipients = await requireVaultRecipients(activeMembers.map((member) => member.userId), tx);
      if (recipients.some(({ userId }) => !historyDelivery.keys[userId])) {
        throw AppError.conflict('HISTORY_RECIPIENTS_CHANGED', 'Şifreli geçmiş alıcıları değişti.');
      }
      recovery = { ...recovery, keys: Object.fromEntries(recipients.map(({ userId }) => [userId, historyDelivery.keys[userId]])), deviceKeys: {} };
      if (attachInTransaction && resolvedFileKey) await attachOwnedAsset(resolvedFileKey, senderId, tx);
      const createdAt = new Date(lockedMembers.reduce((time, member) =>
        Math.max(time, (member.historyClearedAt?.getTime() ?? 0) + 1), Date.now()));
      return tx.message.create({ data: { ...data, createdAt, historyDelivery: { ...recovery, vaultOnly: true } } });
    });

    savedMessage = await prisma.message.findUnique({
      where: { id: createdMessage.id },
      include: {
        sender: { select: { username: true } },
        replyTo: { select: replyToSelect },
        conversation: { select: { isGroup: true } },
        reads: { select: { userId: true } },
        stars: { select: { userId: true } },
        deletions: { select: { userId: true } }
      }
    });
    if (!savedMessage) throw AppError.internal('Oluşturulan mesaj yüklenemedi.');
  } catch (error) {
    // Idempotency (clientId unique key çakışması) kontrolü
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      if (resolvedFileKey && !attachInTransaction) await deleteFileIfUnreferenced(resolvedFileKey);
      const existingMessage = await prisma.message.findUnique({
        where: { senderId_clientId: { senderId, clientId } },
        include: {
          sender: { select: { username: true } },
          replyTo: { select: replyToSelect },
          conversation: { select: { isGroup: true } },
          reads: { select: { userId: true } },
          stars: { select: { userId: true } },
          deletions: { select: { userId: true } }
        }
      });
      if (!existingMessage) throw error;
      if (!(existingMessage.historyDelivery as { vaultOnly?: boolean } | null)?.vaultOnly) {
        throw AppError.conflict('HISTORY_VAULT_REQUIRED', 'Önceki gönderimin kasa kopyası bulunamadı.');
      }
      const serialized = await serializeMessage(existingMessage, [], senderId);
      return conversation.isGroup ? withGroupRecipients(serialized, activeMembers) : serialized;
    }
    if (resolvedFileKey && !attachInTransaction) await deleteFileIfUnreferenced(resolvedFileKey);
    throw error;
  }

  const serialized = await serializeMessage(savedMessage, [], senderId);
  const responseMessage = conversation.isGroup ? withGroupRecipients(serialized, activeMembers) : serialized;

  if (io) {
    const targetRooms = activeMembers.map((p) => p.userId);
    targetRooms.push(conversationId);
    io.to(targetRooms).emit('yeni_mesaj_geldi', { ...responseMessage, historyDelivery: { ...recovery, vaultOnly: true } });
  }

  return responseMessage;
};

/**
 * MESAJLARI GETİRME (Cursor Pagination)
 * Geçmiş mesajları kullanıcının katılım tarihine (`joinedAt`) göre süzerek getirir.
 */
export const fetchMessages = async (conversationId: string, userId: string, cursor?: string, limit: number = 50, anchor?: string) => {
  const participant = await requireHistoryParticipant(
    conversationId,
    userId,
    'Bu sohbetin mesajlarını görüntüleme yetkiniz yok.'
  );

  const takeLimit = Math.min(Math.max(limit || 50, 1), 100);
  let tupleCursorWhere = {};

  if (cursor) {
    const cursorMsg = await prisma.message.findUnique({
      where: { id: String(cursor) },
      select: { createdAt: true, id: true }
    });
    if (cursorMsg) {
      tupleCursorWhere = {
        OR: [
          { createdAt: { lt: cursorMsg.createdAt } },
          { createdAt: cursorMsg.createdAt, id: { lt: cursorMsg.id } }
        ]
      };
    }
  }

  const periods = messagePeriods(participant);
  const whereClause: Prisma.MessageWhereInput = {
    conversationId,
    deletions: { none: { userId } },
    ...(participant.historyClearedAt && { createdAt: { gt: participant.historyClearedAt } }),
    AND: [visibleMessageWhere(), messagePeriodWhere(periods)],
  };

  const anchorMessage = anchor
    ? await prisma.message.findFirst({ where: { ...whereClause, id: anchor }, select: { id: true, createdAt: true } })
    : null;
  if (anchor && !anchorMessage) throw AppError.notFound('NOT_FOUND', 'Mesaj bu sohbet geçmişinde bulunamadı.');
  const descending = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
  const include = {
      sender: { select: { username: true } },
      replyTo: { select: { ...replyToSelect, conversationId: true, createdAt: true, expiresAt: true, deletions: { where: { userId }, select: { userId: true } } } },
      accountHistory: selectAccountHistory(userId),
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
  } satisfies Prisma.MessageInclude;
  const newerLimit = 15;
  const [rawMessages, newer] = await Promise.all([
    prisma.message.findMany({
      where: { ...whereClause, ...(anchorMessage ? { OR: [
        { createdAt: { lt: anchorMessage.createdAt } },
        { createdAt: anchorMessage.createdAt, id: { lte: anchorMessage.id } }
      ] } : tupleCursorWhere) },
      take: takeLimit + 1,
      orderBy: [...descending],
      include
    }),
    anchorMessage ? prisma.message.findMany({
      where: { ...whereClause, OR: [
        { createdAt: { gt: anchorMessage.createdAt } },
        { createdAt: anchorMessage.createdAt, id: { gt: anchorMessage.id } }
      ] },
      take: newerLimit + 1,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include
    }) : []
  ]);

  const hasNext = rawMessages.length > takeLimit;
  const pageMessages = hasNext ? rawMessages.slice(0, takeLimit) : rawMessages;
  const nextCursor = hasNext ? pageMessages[pageMessages.length - 1].id : null;

  const now = new Date();
  const serialized = await serializeMessages([...pageMessages.reverse(), ...newer.slice(0, newerLimit)].map(({ replyTo, ...message }) => ({
    ...message,
    replyTo: replyTo && replyTo.conversationId === conversationId && !replyTo.deletions.length && (!replyTo.expiresAt || replyTo.expiresAt > now) &&
      (!participant.historyClearedAt || replyTo.createdAt > participant.historyClearedAt) &&
      periods.some(({ joinedAt, leftAt }) => replyTo.createdAt >= joinedAt && (!leftAt || replyTo.createdAt <= leftAt))
      ? replyTo : null
  })), userId);
  const activeMembers = participant.conversation?.isGroup ? await prisma.participant.findMany({
    where: { conversationId, isActive: true },
    select: { userId: true, joinedAt: true }
  }) : null;
  const items = serialized.map((message) => ({
    ...(activeMembers ? withGroupRecipients(message, activeMembers) : message),
    isPriorMembershipMessage: message.createdAt < participant.joinedAt
  }));
  const historySince = periods.reduce((earliest, period) => period.joinedAt < earliest ? period.joinedAt : earliest, participant.joinedAt);
  return { items, nextCursor, historySince, historyId: participant.id,
    ...(anchorMessage && { hasNewer: newer.length > newerLimit }),
    ...(participant.historyClearedAt && { historyClearedAt: participant.historyClearedAt.toISOString() }) };
};

/**
 * MESAJ ARAMA (pg_trgm GIN Index)
 * PostgreSQL Trigram indeksi kullanarak mesaj içeriklerinde hızlı arama yapar.
 */
export const searchMessages = async (userId: string, searchTerm: string) => {
  const term = searchTerm.trim();
  // pg_trgm GIN indexi ILIKE '%term%' sorgusunu büyük Message tablosunda full scan olmadan çalıştırır.
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT m."id"
    FROM "Message" m
    INNER JOIN "Participant" p
      ON p."conversationId" = m."conversationId"
      AND p."userId" = ${userId}
      AND p."isActive" = true
      AND m."createdAt" >= p."joinedAt"
    INNER JOIN "Conversation" c ON c."id" = m."conversationId" AND c."isDeleted" = false
    WHERE m."content" ILIKE ${`%${term}%`}
      AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
      AND NOT EXISTS (
        SELECT 1 FROM "MessageDeletion" d
        WHERE d."messageId" = m."id" AND d."userId" = ${userId}
      )
    ORDER BY similarity(m."content", ${term}) DESC, m."createdAt" DESC
    LIMIT 30
  `;
  if (matches.length === 0) return [];

  const messages = await prisma.message.findMany({
    where: {
      id: { in: matches.map((match) => match.id) }
    },
    include: {
      sender: { select: { username: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } },
      accountHistory: selectAccountHistory(userId),
      conversation: {
        include: {
          participants: {
            where: { isActive: true },
            include: { user: { select: { id: true, username: true } } }
          }
        }
      }
    },
    take: 30
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  return serializeMessages(matches
    .map((match) => byId.get(match.id))
    .filter((message): message is typeof messages[number] => Boolean(message)), userId);
};

/**
 * YILDIZLI MESAJLARI GETİRME
 */
export const fetchStarredMessages = async (userId: string) => {
  const memberships = await getActiveMessageWindows(userId);
  if (memberships.length === 0) return [];

  const messages = await prisma.message.findMany({
    where: {
      stars: { some: { userId } },
      deletions: { none: { userId } },
      AND: [
        visibleMessageWhere(),
        {
          OR: memberships.map(({ conversationId, joinedAt }) => ({
            conversationId,
            createdAt: { gte:joinedAt }
          }))
        }
      ]
    },
    include: {
      sender: { select: { username: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } },
      accountHistory: selectAccountHistory(userId),
      conversation: {
        include: {
          participants: {
            where: { isActive: true },
            include: { user: { select: { id: true, username: true } } }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return serializeMessages(messages, userId);
};

/**
 * MESAJ DÜZENLEME
 */
export const editMessage = async (
  messageId: string,
  userId: string,
  editPayload: { protocolVersion: 2; epoch: number; senderDeviceId: string; ciphertext: string; historyDelivery?: HistoryDelivery },
  io: any
) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
  if (message.senderId !== userId) {
    throw AppError.forbidden('MESSAGE_FORBIDDEN', 'Yalnızca kendi mesajınızı düzenleyebilirsiniz.');
  }
  await requireActiveMessageAccess(
    message,
    userId,
    'Bu sohbetin aktif üyesi değilsiniz.'
  );

  const conversation = await prisma.conversation.findUnique({
    where: { id: message.conversationId },
    select: { mlsCurrentEpoch: true }
  });
  if (conversation?.mlsCurrentEpoch !== editPayload.epoch) {
    throw AppError.conflict('MLS_EPOCH_MISMATCH', 'Mesajı düzenlemeden önce MLS dönemini eşitleyin.');
  }
  const senderDevice = await prisma.userDevice.findUnique({ where: { id: editPayload.senderDeviceId } });
  if (!senderDevice || senderDevice.userId !== userId || senderDevice.revokedAt || !senderDevice.approvedAt) {
    throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Düzenleyen cihaz doğrulanamadı veya iptal edilmiş.');
  }

  const delivery = editPayload.historyDelivery;
  if (!delivery) throw AppError.badRequest('HISTORY_VAULT_REQUIRED', 'Mesajın şifreli geçmiş kopyası gerekli.');

  const updatedMessageRecord = await prisma.$transaction(async (tx) => {
    const recipients = await requireVaultRecipients(await listHistoryReaders(message, tx), tx);
    if (recipients.some(({ userId }) => !delivery.keys[userId])) {
      throw AppError.conflict('HISTORY_RECIPIENTS_CHANGED', 'Şifreli geçmiş alıcıları değişti.');
    }
    const recovery = await verifyHistoryDelivery(delivery, message.conversationId,
      userId, messageId, editPayload.ciphertext, senderDevice.signaturePublicKey, recipients.map((member) => member.userId));
    const updated = await tx.message.update({
      where: { id: messageId },
      data: {
        content: '', protocolVersion: editPayload.protocolVersion, epoch: editPayload.epoch,
        senderDeviceId: editPayload.senderDeviceId, ciphertext: editPayload.ciphertext,
        editedAt: new Date(), historyDelivery: { ...recovery, vaultOnly: true }
      }
    });
    await tx.accountHistoryMessage.deleteMany({ where: { messageId, version: { not: historyVersion(editPayload.ciphertext) } } });
    return updated;
  });

  const updatedMessage = await prisma.message.findUnique({
    where: { id: updatedMessageRecord.id },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: replyToSelect },
      conversation: { select: { isGroup: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });
  if (!updatedMessage) throw AppError.internal('Mesaj yüklenemedi.');

  const responseMessage = await serializeMessage(updatedMessage, [], userId);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', { ...responseMessage, historyDelivery: updatedMessage.historyDelivery });
  }

  return responseMessage;
};

/**
 * SOHBET MEDYA VE BAĞLANTILARINI ÇEKME
 */
export const fetchConversationMedia = async (conversationId: string, userId: string) => {
  const membership = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbetin medya bilgilerini görme yetkiniz yok.',
    prisma,
    true
  );

  const records = await prisma.message.findMany({
    where: {
      conversationId,
      deletions: { none: { userId } },
      AND: [
        visibleMessageWhere(),
        messagePeriodWhere(messagePeriods(membership)),
        {
          OR: [
            { fileKey: { not: null } },
            { content: { contains: 'http', mode: 'insensitive' } }
          ]
        }
      ]
    },
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: { username: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } },
      accountHistory: selectAccountHistory(userId)
    }
  });

  const signedRecords = await Promise.all(records.map((record) => serializeMessage(record, [], userId)));
  const mediaMessages = signedRecords.filter((message) => Boolean(message.fileKey));
  const linkItems = signedRecords.flatMap((message) => {
    const urls = message.content?.match(/https?:\/\/[^\s]+/g) || [];
    return urls.map((url: string) => ({ messageId: message.id, url, createdAt: message.createdAt }));
  });

  return { mediaMessages, linkItems };
};

/**
 * MESAJ SABİTLEME
 */
export const pinMessage = async (messageId: string, userId: string, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
  await requireActiveMessageAccess(
    message,
    userId,
    'Bu mesajı sabitleme yetkiniz yok.'
  );

  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: { isPinned: !message.isPinned },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: replyToSelect },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });

  const responseMessage = await serializeMessage(updatedMessage);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
  }

  return responseMessage;
};

/**
 * MESAJ YILDIZLAMA
 */
export const starMessage = async (messageId: string, userId: string, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
  await requireActiveMessageAccess(
    message,
    userId,
    'Bu mesajı yıldızlama yetkiniz yok.'
  );

  const existingStar = await prisma.messageStar.findUnique({
    where: { messageId_userId: { messageId, userId } }
  });

  if (existingStar) {
    await prisma.messageStar.delete({
      where: { messageId_userId: { messageId, userId } }
    });
  } else {
    await prisma.messageStar.create({
      data: { messageId, userId }
    });
  }

  const updatedMessage = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: replyToSelect },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });
  if (!updatedMessage) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');

  const responseMessage = await serializeMessage(updatedMessage);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
  }

  return responseMessage;
};

/**
 * MESAJ SİLME (Herkesten Sil vs. Benden Sil)
 * Herkesten silinirken mesaj içeriği "🚫 Bu mesaj silindi" yapılır ve R2 dosyası kaldırılır.
 */
export const deleteMessage = async (messageId: string, userId: string, forEveryone: boolean, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');

  if (forEveryone) {
    await requireActiveMessageAccess(message, userId, 'Bu mesajı silme yetkiniz yok.');
    if (message.senderId !== userId) {
      throw AppError.forbidden('MESSAGE_FORBIDDEN', 'Sadece kendi mesajınızı herkesten silebilirsiniz.');
    }

    const updatedMessageId = await prisma.$transaction(async (tx) => {
      // Mesaja verilen yanıtların FK'lerini temizle
      await tx.message.updateMany({ where: { replyToId: messageId }, data: { replyToId: null } });
      await tx.accountHistoryMessage.deleteMany({ where: { messageId } });
      const updatedMessageRecord = await tx.message.update({
        where: { id: messageId },
        data: {
          content: '🚫 Bu mesaj silindi',
          isDeletedForEveryone: true,
          ciphertext: null,
          historyDelivery: Prisma.DbNull,
          encryptedFileMetadata: null,
          fileKey: null,
          fileType: null,
          fileName: null,
          replyToId: null,
          isForwarded: false
        }
      });
      return updatedMessageRecord.id;
    });

    const updatedMessage = await prisma.message.findUnique({
      where: { id: updatedMessageId },
      include: {
        sender: { select: { username: true } },
        conversation: { select: { isGroup: true } },
        reads: { select: { userId: true } },
        stars: { select: { userId: true } },
        deletions: { select: { userId: true } }
      }
    });
    if (!updatedMessage) throw AppError.internal('Geri yüklenen mesaj bulunamadı.');

    await deleteFileIfUnreferenced(message.fileKey);

    const responseMessage = await serializeMessage(updatedMessage);

    if (io) {
      io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
    }
    return { message: "Mesaj herkesten silindi." };
  } else {
    const participant = await requireHistoryParticipant(message.conversationId, userId, 'Bu mesajı silme yetkiniz yok.');
    if (!messagePeriods(participant).some(({ joinedAt, leftAt }) => message.createdAt >= joinedAt && (!leftAt || message.createdAt <= leftAt))) {
      throw AppError.forbidden('CONVERSATION_FORBIDDEN', 'Bu mesajı silme yetkiniz yok.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.messageDeletion.upsert({
        where: { messageId_userId: { messageId, userId } },
        create: { messageId, userId },
        update: {}
      });
      await tx.accountHistoryMessage.deleteMany({ where: { messageId, userId } });
      await removeHistoryDeliveryFor(tx, userId, { messageId });
    });

    if (io) {
      io.to(userId).emit('mesaj_silindi', { messageId, conversationId: message.conversationId });
    }
    return { message: "Mesaj sadece sizden silindi." };
  }
};

/**
 * MESAJLARI OKUNDU İŞARETLEME (Monotonic ConversationReadState Cursor)
 */
export const markAsRead = async (
  conversationId: string,
  userId: string,
  lastReadMessageId?: string,
  emitReceipt?: boolean,
  io?: any
) => {
  const membership = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbet odasına erişim yetkiniz yok.'
  );

  let lastReadMessage = null;
  if (lastReadMessageId) {
    lastReadMessage = await prisma.message.findFirst({
      where: { id: lastReadMessageId, conversationId },
      select: { id: true, createdAt: true }
    });
    if (!lastReadMessage) {
      throw AppError.badRequest('BAD_REQUEST', 'Belirtilen son okunan mesaj bu sohbete ait değil.');
    }
    if (lastReadMessage.createdAt < membership.joinedAt) {
      throw AppError.badRequest('BAD_REQUEST', 'Belirtilen son okunan mesaj üyelik döneminizin dışında.');
    }
  }

  const readCursor = lastReadMessage?.createdAt || new Date();
  const previousReadState = await prisma.conversationReadState.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { lastReadAt: true }
  });
  const previousReadAt = previousReadState?.lastReadAt || membership.joinedAt;

  const updatedCount = readCursor > previousReadAt
    ? await prisma.message.count({
    where: {
      conversationId,
      senderId: { not: userId },
      createdAt: {
        gt: previousReadAt,
        lte: readCursor
      },
      ...visibleMessageWhere()
    },
  })
    : 0;

  // Monotonik cursor: iki sekmenin eş zamanlı read isteği daha eski bir konuma geri döndüremez.
  await prisma.$executeRaw`
    INSERT INTO "ConversationReadState"
      ("id", "userId", "conversationId", "lastReadAt", "lastReadMessageId", "updatedAt")
    VALUES
      (${crypto.randomUUID()}, ${userId}, ${conversationId}, ${readCursor}, ${lastReadMessageId || null}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "conversationId") DO UPDATE
    SET
      "lastReadAt" = GREATEST("ConversationReadState"."lastReadAt", EXCLUDED."lastReadAt"),
      "lastReadMessageId" = CASE
        WHEN EXCLUDED."lastReadAt" >= "ConversationReadState"."lastReadAt" THEN EXCLUDED."lastReadMessageId"
        ELSE "ConversationReadState"."lastReadMessageId"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  if (updatedCount > 0 && (membership.conversation.isGroup || emitReceipt !== false) && io) {
    io.to(conversationId).emit('mesajlar_okundu', {
      conversationId,
      readByUserId: userId,
      lastReadMessageId: lastReadMessageId || null,
      readThroughAt: readCursor.toISOString()
    });
  }

  return { success: true, updatedCount };
};

/**
 * OKUNMAMIŞ MESAJ SAYACINI HESAPLAMA (Single Grouped Query)
 */
export const getUnreadCounts = async (userId: string) => {
  // Tek grouped sorgu, sohbet sayısı kadar Message.count çağrısı yapmaz.
  const rows = await prisma.$queryRaw<Array<{
    conversationId: string;
    isGroup: boolean;
    otherUserId: string | null;
    unreadCount: number;
  }>>`
    SELECT
      p."conversationId",
      c."isGroup",
      (
        SELECT other_p."userId"
        FROM "Participant" other_p
        WHERE other_p."conversationId" = p."conversationId" AND other_p."userId" <> ${userId}
        ORDER BY other_p."joinedAt" ASC
        LIMIT 1
      ) AS "otherUserId",
      COUNT(m."id")::int AS "unreadCount"
    FROM "Participant" p
    INNER JOIN "Conversation" c ON c."id" = p."conversationId" AND c."isDeleted" = false
    LEFT JOIN "ConversationReadState" rs
      ON rs."userId" = p."userId"
      AND rs."conversationId" = p."conversationId"
    LEFT JOIN "Message" m
      ON m."conversationId" = p."conversationId"
      AND m."senderId" <> ${userId}
      AND m."createdAt" >= p."joinedAt"
      AND (rs."lastReadAt" IS NULL OR m."createdAt" > rs."lastReadAt")
      AND m."content" NOT LIKE '[SYSTEM\_%' ESCAPE '\'
      AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
      AND NOT EXISTS (
        SELECT 1 FROM "MessageDeletion" d
        WHERE d."messageId" = m."id" AND d."userId" = ${userId}
      )
    WHERE p."userId" = ${userId} AND p."isActive" = true
    GROUP BY p."conversationId", c."isGroup"
  `;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.unreadCount <= 0) continue;
    if (row.isGroup) counts[row.conversationId] = row.unreadCount;
    else if (row.otherUserId) counts[row.otherUserId] = row.unreadCount;
  }

  return counts;
};
