import { Prisma } from '@prisma/client';
import prisma from '../db';
import { withSignedFileUrl } from './fileStorage';
import { deleteFileIfUnreferenced } from './fileCleanup';
import { isConversationMember } from './conversationAccess';

// Arama koşulu (expiresAt null veya gelecekte olan mesajlar)
const visibleMessageWhere = () => ({
  OR: [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } }
  ]
});

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
export const serializeMessage = async (msg: MessageWithReads) => {
  const signed = await withSignedFileUrl(msg);
  const { reads = [], stars = [], deletions = [], ...rest } = signed;

  // Gönderici otomatik olarak okumuş sayılır
  const readByIds = [...new Set([
    msg.senderId,
    ...reads.map((r) => r.userId)
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
 * Yeni mesaj gönderir, engelleme kontrollerini yapar ve soket yayını tetikler.
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
  },
  io: any
) => {
  const { conversationId, clientId, content, replyToId, isForwarded, fileKey, fileType, fileName } = payload;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { participants: true }
  });
  if (!conversation) throw new Error("Sohbet bulunamadı.");
  if (!conversation.participants.some((participant) => participant.userId === senderId)) {
    throw new Error("Bu sohbete mesaj gönderme yetkiniz yok.");
  }

  // Birebir sohbetlerde engelleme durumları kontrol edilir
  if (!conversation.isGroup) {
    const otherParticipant = conversation.participants.find((p) => p.userId !== senderId);
    if (otherParticipant) {
      const blockedByOther = await prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId: otherParticipant.userId, blockedId: senderId } }
      });
      if (blockedByOther) {
        throw new Error("Bu kullanıcıya mesaj gönderemezsiniz çünkü engellendiniz.");
      }

      const blockedByMe = await prisma.blockedUser.findUnique({
        where: { userId_blockedId: { userId: senderId, blockedId: otherParticipant.userId } }
      });
      if (blockedByMe) {
        throw new Error("Bu kullanıcıyı engellediniz. Mesaj göndermek için engeli kaldırın.");
      }
    }
  }

  // Yanıtlanan mesaj doğrulaması
  if (replyToId) {
    const repliedMessage = await prisma.message.findFirst({
      where: { id: String(replyToId), conversationId },
      select: { id: true }
    });
    if (!repliedMessage) throw new Error("Yanıtlanan mesaj bu sohbete ait değil.");
  }

  let savedMessage;
  try {
    const createdMessage = await prisma.message.create({
      data: {
        clientId,
        content: content.trim(),
        senderId,
        conversationId,
        replyToId: replyToId || null,
        isForwarded: isForwarded || false,
        fileKey: fileKey || null,
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
    if (!savedMessage) throw new Error('Oluşturulan mesaj yüklenemedi.');
  } catch (error) {
    // Idempotency (clientId unique key çakışması) kontrolü
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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
    throw error;
  }

  const responseMessage = await serializeMessage(savedMessage);

  if (io) {
    const targetRooms = conversation.participants.map((p) => p.userId);
    targetRooms.push(conversationId);
    io.to(targetRooms).emit('yeni_mesaj_geldi', responseMessage);
  }

  return responseMessage;
};

/**
 * Geçmiş mesajları sayfalanmış şekilde döner.
 */
export const fetchMessages = async (conversationId: string, userId: string, cursor?: string) => {
  if (!(await isConversationMember(conversationId, userId))) {
    throw new Error("Bu sohbetin mesajlarını görüntüleme yetkiniz yok.");
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      deletions: { none: { userId } },
      ...visibleMessageWhere()
    },
    take: 50,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: String(cursor) } } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });

  return Promise.all(messages.reverse().map(serializeMessage));
};

/**
 * Kullanıcının katıldığı konuşmalardaki mesajları arar.
 */
export const searchMessages = async (userId: string, searchTerm: string) => {
  const messages = await prisma.message.findMany({
    where: {
      content: { contains: searchTerm.trim(), mode: 'insensitive' },
      deletions: { none: { userId } },
      ...visibleMessageWhere(),
      conversation: {
        participants: { some: { userId } }
      }
    },
    include: {
      sender: { select: { username: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } },
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, username: true, email: true } } } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 30
  });

  return Promise.all(messages.map(serializeMessage));
};

/**
 * Kullanıcının yıldızlı mesajlarını döner.
 */
export const fetchStarredMessages = async (userId: string) => {
  const messages = await prisma.message.findMany({
    where: {
      stars: { some: { userId } },
      deletions: { none: { userId } },
      ...visibleMessageWhere(),
      conversation: {
        participants: { some: { userId } }
      }
    },
    include: {
      sender: { select: { username: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } },
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, username: true, email: true } } } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return Promise.all(messages.map(serializeMessage));
};

/**
 * Gönderilen mesajın içeriğini düzenler.
 */
export const editMessage = async (messageId: string, userId: string, content: string, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new Error("Mesaj bulunamadı.");
  if (message.senderId !== userId) {
    throw new Error("Yalnızca kendi mesajınızı düzenleyebilirsiniz.");
  }
  if (!(await isConversationMember(message.conversationId, userId))) {
    throw new Error("Bu sohbetin üyesi değilsiniz.");
  }

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
  if (!updatedMessage) throw new Error("Mesaj yüklenemedi.");

  const responseMessage = await serializeMessage(updatedMessage);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
  }

  return responseMessage;
};

/**
 * Sohbetteki paylaşılan medyaları ve bağlantıları getirir.
 */
export const fetchConversationMedia = async (conversationId: string, userId: string) => {
  if (!(await isConversationMember(conversationId, userId))) {
    throw new Error('Bu sohbetin medya bilgilerini görme yetkiniz yok.');
  }

  const records = await prisma.message.findMany({
    where: {
      conversationId,
      deletions: { none: { userId } },
      AND: [
        visibleMessageWhere(),
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

  const signedRecords = await Promise.all(records.map(serializeMessage));
  const mediaMessages = signedRecords.filter((message) => Boolean(message.fileKey));
  const linkItems = signedRecords.flatMap((message) => {
    const urls = message.content?.match(/https?:\/\/[^\s]+/g) || [];
    return urls.map((url: string) => ({ messageId: message.id, url, createdAt: message.createdAt }));
  });

  return { mediaMessages, linkItems };
};

/**
 * Mesaj sabitleme ayarını günceller.
 */
export const pinMessage = async (messageId: string, userId: string, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new Error("Mesaj bulunamadı.");
  if (!(await isConversationMember(message.conversationId, userId))) {
    throw new Error("Bu mesajı sabitleme yetkiniz yok.");
  }

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
 * Mesajı yıldızlar veya yıldızı kaldırır.
 */
export const starMessage = async (messageId: string, userId: string, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new Error("Mesaj bulunamadı.");
  if (!(await isConversationMember(message.conversationId, userId))) {
    throw new Error("Bu mesajı yıldızlama yetkiniz yok.");
  }

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
  if (!updatedMessage) throw new Error("Mesaj bulunamadı.");

  const responseMessage = await serializeMessage(updatedMessage);

  if (io) {
    io.to(message.conversationId).emit('mesaj_guncellendi', responseMessage);
  }

  return responseMessage;
};

/**
 * Mesajı benden siler ya da herkesten silerek yerine placeholder koyar (R2 dosyasını temizler).
 */
export const deleteMessage = async (messageId: string, userId: string, forEveryone: boolean, io: any) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw new Error("Mesaj bulunamadı.");
  if (!(await isConversationMember(message.conversationId, userId))) {
    throw new Error("Bu mesajı silme yetkiniz yok.");
  }

  if (forEveryone) {
    if (message.senderId !== userId) {
      throw new Error("Sadece kendi mesajınızı herkesten silebilirsiniz.");
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
    if (!updatedMessage) throw new Error("Geri yüklenen mesaj bulunamadı.");

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
 * Mesajları belirli bir eşik değerine (lastReadMessageId) ve katılım tarihine göre okundu olarak işaretler.
 */
export const markAsRead = async (
  conversationId: string,
  userId: string,
  lastReadMessageId?: string,
  emitReceipt?: boolean,
  io?: any
) => {
  const membership = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { joinedAt: true }
  });
  if (!membership) {
    throw new Error("Bu sohbet odasına erişim yetkiniz yok.");
  }

  let lastReadMessage = null;
  if (lastReadMessageId) {
    lastReadMessage = await prisma.message.findFirst({
      where: { id: lastReadMessageId, conversationId },
      select: { id: true, createdAt: true }
    });
    if (!lastReadMessage) {
      throw new Error("Belirtilen son okunan mesaj bu sohbete ait değil.");
    }
  }

  const unreadMessages = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      createdAt: {
        gte: membership.joinedAt,
        ...(lastReadMessage ? { lte: lastReadMessage.createdAt } : {})
      },
      ...visibleMessageWhere(),
      reads: {
        none: { userId }
      }
    },
    select: { id: true }
  });

  if (unreadMessages.length > 0) {
    const data = unreadMessages.map((msg) => ({
      messageId: msg.id,
      userId
    }));
    await prisma.messageRead.createMany({
      data,
      skipDuplicates: true
    });
  }

  if (emitReceipt !== false && io) {
    io.to(conversationId).emit('mesajlar_okundu', {
      conversationId,
      readByUserId: userId,
      lastReadMessageId: lastReadMessageId || null
    });
  }

  return { success: true, updatedCount: unreadMessages.length };
};

/**
 * Kullanıcının katıldığı tüm sohbetlerdeki okunmamış mesaj sayılarını döner.
 */
export const getUnreadCounts = async (userId: string) => {
  const myParticipants = await prisma.participant.findMany({
    where: { userId },
    select: {
      conversationId: true,
      joinedAt: true,
      conversation: {
        select: {
          isGroup: true,
          participants: {
            where: { userId: { not: userId } },
            select: { userId: true }
          }
        }
      }
    }
  });

  const counts: Record<string, number> = {};

  await Promise.all(
    myParticipants.map(async (p) => {
      const count = await prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          createdAt: { gte: p.joinedAt },
          ...visibleMessageWhere(),
          reads: {
            none: { userId }
          },
          deletions: {
            none: { userId }
          }
        }
      });

      if (count > 0) {
        if (p.conversation.isGroup) {
          counts[p.conversationId] = count;
        } else {
          const otherParticipant = p.conversation.participants[0];
          if (otherParticipant) {
            counts[otherParticipant.userId] = count;
          }
        }
      }
    })
  );

  return counts;
};
