import prisma from '../db';

// Sohbet verisine erişen route'ların kullandığı merkezi üyelik kontrolü.
export const isConversationMember = async (conversationId: string, userId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { id: true }
  });
  return Boolean(participant);
};
