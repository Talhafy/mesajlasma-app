import type { GameChannelType } from '@prisma/client';
import prisma from '../db';
import { markAsRead, sendMessage, serializeMessage } from './messageService';

const MAX_CHANNELS_PER_TYPE = 5;

const requireGroupMember = async (groupId: string, userId: string) => {
  const group = await prisma.conversation.findFirst({
    where: {
      id: groupId,
      isGroup: true,
      participants: { some: { userId } }
    },
    select: { id: true, name: true, adminId: true }
  });
  if (!group) throw new Error('Bu oyun grubuna erişim yetkiniz yok.');
  return group;
};

export const listChannels = async (groupId: string, userId: string) => {
  const group = await requireGroupMember(groupId, userId);
  const channels = await prisma.gameChannel.findMany({
    where: { conversationId: groupId },
    orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }]
  });
  return { group, channels, limits: { perType: MAX_CHANNELS_PER_TYPE } };
};

export const createChannel = async (
  groupId: string,
  userId: string,
  input: { name: string; type: GameChannelType; maxParticipants?: number | null }
) => {
  const group = await requireGroupMember(groupId, userId);
  const count = await prisma.gameChannel.count({
    where: { conversationId: groupId, type: input.type }
  });
  if (count >= MAX_CHANNELS_PER_TYPE) {
    throw new Error(`Bir grupta en fazla ${MAX_CHANNELS_PER_TYPE} ${input.type === 'VOICE' ? 'ses' : 'yazı'} kanalı olabilir.`);
  }

  const name = input.type === 'TEXT'
    ? input.name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, '-').replace(/-+/g, '-')
    : input.name.trim();

  const duplicate = await prisma.gameChannel.findFirst({
    where: { conversationId: groupId, type: input.type, name: { equals: name, mode: 'insensitive' } },
    select: { id: true }
  });
  if (duplicate) throw new Error('Bu isimde bir kanal zaten var.');

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

export const deleteChannel = async (groupId: string, channelId: string, userId: string) => {
  const group = await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId },
    select: { id: true, createdById: true }
  });
  if (!channel) throw new Error('Kanal bulunamadı.');
  if (group.adminId !== userId && channel.createdById !== userId) {
    throw new Error('Bu kanalı silme yetkiniz yok.');
  }
  await prisma.gameChannel.delete({ where: { id: channelId } });
  return { deleted: true, channelId };
};

export const fetchChannelMessages = async (
  groupId: string,
  channelId: string,
  userId: string,
  cursor?: string
) => {
  await requireGroupMember(groupId, userId);
  const channel = await prisma.gameChannel.findFirst({
    where: { id: channelId, conversationId: groupId, type: 'TEXT' },
    select: { id: true }
  });
  if (!channel) throw new Error('Yazı kanalı bulunamadı.');

  const messages = await prisma.message.findMany({
    where: {
      conversationId: groupId,
      gameChannelId: channelId,
      deletions: { none: { userId } },
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
  return Promise.all(messages.reverse().map(serializeMessage));
};

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

export const getVoiceChannelAccess = async (channelId: string, userId: string) => {
  const channel = await prisma.gameChannel.findUnique({
    where: { id: channelId },
    include: {
      conversation: {
        select: {
          id: true,
          isGroup: true,
          name: true,
          participants: { where: { userId }, select: { user: { select: { id: true, username: true } } } }
        }
      }
    }
  });
  const membership = channel?.conversation.participants[0];
  if (!channel || channel.type !== 'VOICE' || !channel.conversation.isGroup || !membership) {
    throw new Error('Bu ses kanalına katılma yetkiniz yok.');
  }
  return { channel, conversation: channel.conversation, user: membership.user };
};
