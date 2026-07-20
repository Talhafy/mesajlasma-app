import type { Prisma } from '@prisma/client';
import prisma from '../db';

type ConversationAccessClient = Pick<Prisma.TransactionClient, 'participant'>;

const findParticipant = (
  conversationId: string,
  userId: string,
  client: ConversationAccessClient = prisma
) => (
  client.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: {
      id: true,
      userId: true,
      conversationId: true,
      isActive: true,
      joinedAt: true,
      leftAt: true,
      isPinned: true,
      isArchived: true,
      isMuted: true,
      user: {
        select: {
          id: true,
          username: true
        }
      },
      conversation: {
        select: {
          id: true,
          isGroup: true,
          name: true,
          isDeleted: true
        }
      }
    }
  })
);

/**
 * Aktif işlem yetkisi ile geçmişi salt okunur görme yetkisi birbirinden ayrıdır.
 * Pasif Participant kaydı geçmiş görünürlüğü için korunur; yeni işlem yapma yetkisi vermez.
 */
export const requireActiveParticipant = async (
  conversationId: string,
  userId: string,
  errorMessage = 'Bu sohbet için aktif üyeliğiniz bulunmuyor.',
  client: ConversationAccessClient = prisma
) => {
  const participant = await findParticipant(conversationId, userId, client);
  if (!participant?.isActive || participant.conversation.isDeleted) {
    throw new Error(errorMessage);
  }
  return participant;
};

/**
 * Mesaj geçmişi için Participant kaydının bulunması yeterlidir.
 * Çağıran sorgu joinedAt/leftAt sınırlarını uygulayarak yalnızca üyelik dönemini göstermelidir.
 */
export const requireHistoryParticipant = async (
  conversationId: string,
  userId: string,
  errorMessage = 'Bu sohbetin geçmişini görüntüleme yetkiniz yok.',
  client: ConversationAccessClient = prisma
) => {
  const participant = await findParticipant(conversationId, userId, client);
  if (!participant || (!participant.isActive && !participant.leftAt)) {
    throw new Error(errorMessage);
  }
  return participant;
};
