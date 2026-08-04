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
export const serializeMessage = async (msg: MessageWithReads, cursorReadByIds: string[] = []) => {
  const signed = await withSignedFileUrl(msg);
  const { reads = [], stars = [], deletions = [], ...rest } = signed;

  const readByIds = [...new Set([
    ...reads.map((r) => r.userId),
    ...cursorReadByIds
  ])];

  const starredByIds = stars.map((s) => s.userId);
  const deletedForIds = deletions.map((d) => d.userId);

  return {
    ...rest,
    readByIds,
    starredByIds,
    deletedForIds
  };
};

/**
 * Read cursor'larını tek sorguda çekerek eski MessageRead kayıtlarıyla birleştirir.
 * Böylece yeni mesajlar için MessageRead yazmadan, sayfa yenilendiğinde de read receipt gösterilir.
 */
export const serializeMessages = async (messages: MessageWithReads[]) => {
  if (messages.length === 0) return [];
  const windows = [...new Map(messages.map((message) => [
    `${message.conversationId}:${message.gameChannelId || ''}`,
    { conversationId: message.conversationId, channelKey: message.gameChannelId || '' }
  ])).values()];
  const states = await prisma.conversationReadState.findMany({
    where: { OR: windows },
    select: { userId: true, conversationId: true, channelKey: true, lastReadAt: true }
  });
  const statesByWindow = new Map<string, typeof states>();
  for (const state of states) {
    const key = `${state.conversationId}:${state.channelKey}`;
    const current = statesByWindow.get(key) || [];
    current.push(state);
    statesByWindow.set(key, current);
  }

  return Promise.all(messages.map((message) => {
    const stateReaders = (statesByWindow.get(`${message.conversationId}:${message.gameChannelId || ''}`) || [])
      .filter((state) => state.userId !== message.senderId && state.lastReadAt >= message.createdAt)
      .map((state) => state.userId);
    return serializeMessage(message, stateReaders);
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
    content: string;
    replyToId?: string | null;
    isForwarded?: boolean;
    fileKey?: string | null;
    fileType?: string | null;
    fileName?: string | null;
    gameChannelId?: string | null;
  },
  io: any
) => {
  const { conversationId, clientId, content, replyToId, isForwarded, fileKey, fileType, fileName, gameChannelId } = payload;

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

  if (gameChannelId) {
    const channel = await prisma.gameChannel.findFirst({
      where: { id: gameChannelId, conversationId, type: 'TEXT' },
      select: { id: true }
    });
    if (!conversation.isGroup || !channel) {
      throw AppError.notFound('CHANNEL_NOT_FOUND', 'Yazı kanalı bulunamadı.');
    }
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
        gameChannelId: gameChannelId || null,
        createdAt: { gte: membership.joinedAt }
      },
      select: { id: true }
    });
    if (!repliedMessage) throw AppError.badRequest('BAD_REQUEST', 'Yanıtlanan mesaj bu sohbete ait değil.');
  }

  const resolvedFileKey = await resolveMessageAsset({ fileKey, fileName, isForwarded, senderId });

  let savedMessage;
  try {
    const createdMessage = await prisma.message.create({
      data: {
        clientId,
        content: content.trim(),
        senderId,
        conversationId,
        gameChannelId: gameChannelId || null,
        replyToId: replyToId || null,
        isForwarded: isForwarded || false,
        fileKey: resolvedFileKey,
        fileType: fileType || null,
        fileName: fileName || null,
        expiresAt: conversation.disappearingDurationSeconds
          ? new Date(Date.now() + conversation.disappearingDurationSeconds * 1000)
          : null
      }
    });

    savedMessage = await prisma.message.findUnique({
      where: { id: createdMessage.id },
      include: {
        sender: { select: { username: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
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
      if (resolvedFileKey) await deleteFileIfUnreferenced(resolvedFileKey);
      const existingMessage = await prisma.message.findUnique({
        where: { senderId_clientId: { senderId, clientId } },
        include: {
          sender: { select: { username: true } },
          replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
          conversation: { select: { isGroup: true } },
          reads: { select: { userId: true } },
          stars: { select: { userId: true } },
          deletions: { select: { userId: true } }
        }
      });
      if (!existingMessage) throw error;
      return serializeMessage(existingMessage);
    }
    if (resolvedFileKey) await deleteFileIfUnreferenced(resolvedFileKey);
    throw error;
  }

  const responseMessage = await serializeMessage(savedMessage);

  if (io) {
    const targetRooms = conversation.participants.filter((p: any) => p.isActive).map((p) => p.userId);
    targetRooms.push(conversationId);
    io.to(targetRooms).emit(gameChannelId ? 'game:message' : 'yeni_mesaj_geldi', responseMessage);
  }

  return responseMessage;
};

/**
 * MESAJLARI GETİRME (Cursor Pagination)
 * Geçmiş mesajları kullanıcının katılım tarihine (`joinedAt`) göre süzerek getirir.
 */
export const fetchMessages = async (conversationId: string, userId: string, cursor?: string, limit: number = 50) => {
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

  const whereClause: any = {
    conversationId,
    gameChannelId: null,
    deletions: { none: { userId } },
    ...visibleMessageWhere(),
    createdAt: {
      gte: participant.joinedAt,
      ...(participant.leftAt ? { lte: participant.leftAt } : {})
    },
    ...tupleCursorWhere
  };

  const rawMessages = await prisma.message.findMany({
    where: whereClause,
    take: takeLimit + 1,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    include: {
      sender: { select: { username: true } },
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });

  const hasNext = rawMessages.length > takeLimit;
  const pageMessages = hasNext ? rawMessages.slice(0, takeLimit) : rawMessages;
  const nextCursor = hasNext ? pageMessages[pageMessages.length - 1].id : null;

  const items = await serializeMessages(pageMessages.reverse());
  return { items, nextCursor };
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
    WHERE m."gameChannelId" IS NULL
      AND m."content" ILIKE ${`%${term}%`}
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
    .filter((message): message is typeof messages[number] => Boolean(message)));
};

/**
 * YILDIZLI MESAJLARI GETİRME
 */
export const fetchStarredMessages = async (userId: string) => {
  const memberships = await getActiveMessageWindows(userId);
  if (memberships.length === 0) return [];

  const messages = await prisma.message.findMany({
    where: {
      gameChannelId: null,
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

  return serializeMessages(messages);
};

/**
 * MESAJ DÜZENLEME
 */
export const editMessage = async (messageId: string, userId: string, content: string, io: any) => {
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

  const updatedMessageRecord = await prisma.message.update({
    where: { id: messageId },
    data: { content: content.trim(), editedAt: new Date() }
  });

  const updatedMessage = await prisma.message.findUnique({
    where: { id: updatedMessageRecord.id },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
      conversation: { select: { isGroup: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });
  if (!updatedMessage) throw AppError.internal('Mesaj yüklenemedi.');

  const responseMessage = await serializeMessage(updatedMessage);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
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
    'Bu sohbetin medya bilgilerini görme yetkiniz yok.'
  );

  const records = await prisma.message.findMany({
    where: {
      conversationId,
      gameChannelId: null,
      deletions: { none: { userId } },
      AND: [
        visibleMessageWhere(),
        { createdAt: { gte: membership.joinedAt } },
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
      deletions: { select: { userId: true } }
    }
  });

  const signedRecords = await Promise.all(records.map((record) => serializeMessage(record)));
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
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
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
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
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
  await requireActiveMessageAccess(
    message,
    userId,
    'Bu mesajı silme yetkiniz yok.'
  );

  if (forEveryone) {
    if (message.senderId !== userId) {
      throw AppError.forbidden('MESSAGE_FORBIDDEN', 'Sadece kendi mesajınızı herkesten silebilirsiniz.');
    }

    const updatedMessageId = await prisma.$transaction(async (tx) => {
      // Mesaja verilen yanıtların FK'lerini temizle
      await tx.message.updateMany({ where: { replyToId: messageId }, data: { replyToId: null } });
      const updatedMessageRecord = await tx.message.update({
        where: { id: messageId },
        data: {
          content: '🚫 Bu mesaj silindi',
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
    // Sadece benden sil
    await prisma.messageDeletion.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId },
      update: {}
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
  io?: any,
  gameChannelId?: string | null
) => {
  const membership = await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbet odasına erişim yetkiniz yok.'
  );

  let lastReadMessage = null;
  if (lastReadMessageId) {
    lastReadMessage = await prisma.message.findFirst({
      where: { id: lastReadMessageId, conversationId, gameChannelId: gameChannelId || null },
      select: { id: true, createdAt: true }
    });
    if (!lastReadMessage) {
      throw AppError.badRequest('BAD_REQUEST', 'Belirtilen son okunan mesaj bu sohbete ait değil.');
    }
    if (lastReadMessage.createdAt < membership.joinedAt) {
      throw AppError.badRequest('BAD_REQUEST', 'Belirtilen son okunan mesaj üyelik döneminizin dışında.');
    }
  }

  const channelKey = gameChannelId || '';
  const readCursor = lastReadMessage?.createdAt || new Date();
  const previousReadState = await prisma.conversationReadState.findUnique({
    where: { userId_conversationId_channelKey: { userId, conversationId, channelKey } },
    select: { lastReadAt: true }
  });
  const previousReadAt = previousReadState?.lastReadAt || membership.joinedAt;

  const updatedCount = readCursor > previousReadAt
    ? await prisma.message.count({
    where: {
      conversationId,
      gameChannelId: gameChannelId || null,
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
      ("id", "userId", "conversationId", "channelKey", "lastReadAt", "lastReadMessageId", "updatedAt")
    VALUES
      (${crypto.randomUUID()}, ${userId}, ${conversationId}, ${channelKey}, ${readCursor}, ${lastReadMessageId || null}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "conversationId", "channelKey") DO UPDATE
    SET
      "lastReadAt" = GREATEST("ConversationReadState"."lastReadAt", EXCLUDED."lastReadAt"),
      "lastReadMessageId" = CASE
        WHEN EXCLUDED."lastReadAt" >= "ConversationReadState"."lastReadAt" THEN EXCLUDED."lastReadMessageId"
        ELSE "ConversationReadState"."lastReadMessageId"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  if (updatedCount > 0 && emitReceipt !== false && io) {
    io.to(conversationId).emit('mesajlar_okundu', {
      conversationId,
      readByUserId: userId,
      lastReadMessageId: lastReadMessageId || null,
      gameChannelId: gameChannelId || null
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
      AND rs."channelKey" = ''
    LEFT JOIN "Message" m
      ON m."conversationId" = p."conversationId"
      AND m."gameChannelId" IS NULL
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
