// Oyun grupları altındaki sesli ve yazılı kanalların yönetimini sağlayan servis katmanı.
import type { GameChannelType } from '@prisma/client';
import prisma from '../db';
import { requireActiveParticipant } from './conversationAccess';
import { markAsRead, sendMessage, serializeMessage } from './messageService';

// Her kanal türü (ses/yazı) için grup başına maksimum kanal sınırı
const MAX_CHANNELS_PER_TYPE = 5;

/**
 * Kullanıcının ilgili oyun grubunun üyesi olup olmadığını kontrol eder.
 * Üye değilse hata fırlatır, üyeyse grup bilgilerini döner.
 */
const requireGroupMember = async (groupId: string, userId: string) => {
  const membership = await requireActiveParticipant(
    groupId,
    userId,
    'Bu oyun grubuna erişim yetkiniz yok.'
  );
  const group = await prisma.conversation.findFirst({
    where: {
      id: groupId,
      isGroup: true,
      isDeleted: false
    },
    select: { id: true, name: true, adminId: true }
  });
  if (!group) throw new Error('Bu oyun grubuna erişim yetkiniz yok.');
  return { group, membership };
};

/**
 * Bir oyun grubuna ait tüm kanalları, sıralı olarak ve kullanıcının sessize alma durumlarıyla birlikte listeler.
 */
export const listChannels = async (groupId: string, userId: string) => {
  // Grup üyeliği doğrulanır
  const { group } = await requireGroupMember(groupId, userId);
  
  // Kanallar türlerine, sıralarına ve oluşturulma tarihlerine göre listelenir
  const channels = await prisma.gameChannel.findMany({
    where: { conversationId: groupId },
    orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }]
  });
  
  // Kullanıcının bu grupta sessize aldığı kanallar bulunur
  const mutes = await prisma.gameChannelMute.findMany({
    where: { userId, channel: { conversationId: groupId } },
    select: { channelId: true }
  });
  const mutedChannelIds = mutes.map((m: { channelId: string }) => m.channelId);
  
  return { group, channels, mutedChannelIds, limits: { perType: MAX_CHANNELS_PER_TYPE } };
};

/**
 * Oyun grubunda yeni bir sesli veya yazılı kanal oluşturur.
 */
export const createChannel = async (
  groupId: string,
  userId: string,
  input: { name: string; type: GameChannelType; maxParticipants?: number | null }
) => {
  const { group } = await requireGroupMember(groupId, userId);
  
  // Kanal limit kontrolü
  const count = await prisma.gameChannel.count({
    where: { conversationId: groupId, type: input.type }
  });
  if (count >= MAX_CHANNELS_PER_TYPE) {
    throw new Error(`Bir grupta en fazla ${MAX_CHANNELS_PER_TYPE} ${input.type === 'VOICE' ? 'ses' : 'yazı'} kanalı olabilir.`);
  }

  // Yazı kanalları için isim normalizasyonu (küçük harf ve türkçe karakter duyarlılığı, boşluklar yerine tire)
  const name = input.type === 'TEXT'
    ? input.name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, '-').replace(/-+/g, '-')
    : input.name.trim();

  // Aynı grupta aynı isimde kanal olup olmadığı kontrol edilir
  const duplicate = await prisma.gameChannel.findFirst({
    where: { conversationId: groupId, type: input.type, name: { equals: name, mode: 'insensitive' } },
    select: { id: true }
  });
  if (duplicate) throw new Error('Bu isimde bir kanal zaten var.');

  // Kanal veritabanına eklenir
  return prisma.gameChannel.create({
    data: {
      conversationId: groupId,
      createdById: userId,
      name,
      type: input.type,
      position: count,
      maxParticipants: input.type === 'VOICE' ? (input.maxParticipants || 8) : null
    }
  });
};

/**
 * Oyun grubundaki bir kanalı siler (Yalnızca grup yöneticisi veya kanalı oluşturan kişi silebilir).
 */
export const deleteChannel = async (groupId: string, channelId: string, userId: string) => {
  const { group } = await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId },
    select: { id: true, createdById: true }
  });
  if (!channel) throw new Error('Kanal bulunamadı.');
  
  // Yetki kontrolü (Grup yöneticisi veya kanalı oluşturan kişi)
  if (group.adminId !== userId && channel.createdById !== userId) {
    throw new Error('Bu kanalı silme yetkiniz yok.');
  }
  
  await prisma.gameChannel.delete({ where: { id: channelId } });
  return { deleted: true, channelId };
};

/**
 * Yazılı kanala ait geçmiş mesajları sayfa sayfa (cursor-based pagination) getirir.
 */
export const fetchChannelMessages = async (
  groupId: string,
  channelId: string,
  userId: string,
  cursor?: string
) => {
  const { membership } = await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId, type: 'TEXT' },
    select: { id: true }
  });
  if (!channel) throw new Error('Yazı kanalı bulunamadı.');

  // Silinmemiş ve süresi dolmamış mesajlar çekilir
  const messages = await prisma.message.findMany({
    where: {
      conversationId: groupId,
      gameChannelId: channelId,
      deletions: { none: { userId } },
      createdAt: { gte: membership.joinedAt },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    take: 50,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: cursor } } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: { username: true } },
      replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } },
      conversation: { select: { isGroup: true } },
      reads: { select: { userId: true } },
      stars: { select: { userId: true } },
      deletions: { select: { userId: true } }
    }
  });
  // Mesajlar kronolojik sıra için tersine çevrilerek serialize edilir
  return Promise.all(messages.reverse().map(serializeMessage));
};

/**
 * Yazılı kanala yeni bir mesaj gönderir.
 */
export const sendChannelMessage = async (
  groupId: string,
  channelId: string,
  userId: string,
  input: { clientId: string; content: string; fileKey?: string | null; fileType?: string | null; fileName?: string | null },
  io: unknown
) => {
  return sendMessage(userId, {
    conversationId: groupId,
    gameChannelId: channelId,
    clientId: input.clientId,
    content: input.content,
    fileKey: input.fileKey,
    fileType: input.fileType,
    fileName: input.fileName
  }, io);
};

/**
 * Yazılı kanaldaki mesajları kullanıcı için okundu olarak işaretler.
 */
export const markChannelAsRead = async (
  groupId: string,
  channelId: string,
  userId: string,
  lastReadMessageId: string | undefined,
  io: unknown
) => {
  await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId, type: 'TEXT' },
    select: { id: true }
  });
  if (!channel) throw new Error('Yazı kanalı bulunamadı.');
  return markAsRead(groupId, userId, lastReadMessageId, true, io, channelId);
};

/**
 * Sesli kanala erişim yetkilerini ve bağlantı bilgilerini denetler. (LiveKit vb. entegrasyonlar için)
 */
export const getVoiceChannelAccess = async (channelId: string, userId: string) => {
  const channel = await prisma.gameChannel.findUnique({
    where: { id: channelId },
    include: {
      conversation: {
        select: {
          id: true,
          isGroup: true,
          name: true
        }
      }
    }
  });
  if (!channel || channel.type !== 'VOICE' || !channel.conversation.isGroup) {
    throw new Error('Bu ses kanalına katılma yetkiniz yok.');
  }
  const membership = await requireActiveParticipant(
    channel.conversation.id,
    userId,
    'Bu ses kanalına katılma yetkiniz yok.'
  );
  return { channel, conversation: channel.conversation, user: membership.user };
};

/**
 * Kanal bilgilerini (adı, maksimum katılımcı sınırı) günceller.
 */
export const updateChannel = async (
  groupId: string,
  channelId: string,
  userId: string,
  input: { name?: string; maxParticipants?: number | null }
) => {
  const { group } = await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId }
  });
  if (!channel) throw new Error('Kanal bulunamadı.');

  // Yalnızca grup yöneticisi veya kanalı oluşturan kişi düzenleyebilir
  if (group.adminId !== userId && channel.createdById !== userId) {
    throw new Error('Bu kanalı düzenleme yetkiniz yok.');
  }

  const data: any = {};
  if (input.name !== undefined) {
    const name = channel.type === 'TEXT'
      ? input.name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, '-').replace(/-+/g, '-')
      : input.name.trim();

    if (!name) throw new Error('Geçersiz kanal adı.');

    // Çakışan isim kontrolü
    const duplicate = await prisma.gameChannel.findFirst({
      where: {
        conversationId: groupId,
        type: channel.type,
        name: { equals: name, mode: 'insensitive' },
        id: { not: channelId }
      },
      select: { id: true }
    });
    if (duplicate) throw new Error('Bu isimde bir kanal zaten var.');
    data.name = name;
  }

  // Ses kanalları için katılımcı limiti güncellenir, yazı kanallarında bu işleme izin verilmez
  if (input.maxParticipants !== undefined) {
    if (channel.type === 'TEXT' && input.maxParticipants !== null) {
      throw new Error('Yazı kanallarında katılımcı limiti kullanılamaz.');
    }
    data.maxParticipants = input.maxParticipants;
  }

  return prisma.gameChannel.update({
    where: { id: channelId },
    data
  });
};

/**
 * Gruptaki kanalların sıralamasını (position) günceller.
 */
export const reorderChannels = async (
  groupId: string,
  userId: string,
  orderedIds: string[]
) => {
  const { group } = await requireGroupMember(groupId, userId);
  // Transaction ile toplu pozisyon güncellemesi yapılır
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.gameChannel.updateMany({
        where: { id, conversationId: groupId },
        data: { position: index }
      })
    )
  );
  // Güncel sıralı liste geri dönülür
  return prisma.gameChannel.findMany({
    where: { conversationId: groupId },
    orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }]
  });
};

/**
 * Bir kanalı kullanıcı bazında sessize alır veya sessizden çıkarır.
 */
export const toggleChannelMute = async (
  groupId: string,
  channelId: string,
  userId: string
) => {
  await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId },
    select: { id: true }
  });
  if (!channel) throw new Error('Kanal bulunamadı.');

  const existing = await prisma.gameChannelMute.findUnique({
    where: { channelId_userId: { channelId, userId } }
  });

  if (existing) {
    // Zaten sessizdeyse sessizden çıkar
    await prisma.gameChannelMute.delete({
      where: { channelId_userId: { channelId, userId } }
    });
    return { muted: false, channelId };
  } else {
    // Sessize alınmamışsa sessize al
    await prisma.gameChannelMute.create({
      data: { channelId, userId }
    });
    return { muted: true, channelId };
  }
};
