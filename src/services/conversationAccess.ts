/**
 * ============================================================================
 * SOHBET ERİŞİM VE YETKİLENDİRME SERVİSİ (Conversation Access Control)
 * ============================================================================
 * 
 * Bu servis, kullanıcıların sohbet oturumlarına erişim haklarını denetler.
 * 
 * ERİŞİM İLKELERİ:
 * 1. Aktif İşlem Yetkisi (`requireActiveParticipant`): Mesaj gönderme, düzenleme veya
 *    gruba adam ekleme gibi işlemler için kullanıcının sohbet grubunda `isActive = true` olması gerekir.
 * 2. Geçmişi Görme Yetkisi (`requireHistoryParticipant`): Gruptan ayrılmış bir kullanıcı
 *    yalnızca grupta bulunduğu tarih aralığındaki (`joinedAt` -> `leftAt`) geçmiş mesajları görebilir;
 *    gruptan ayrıldıktan sonra atılan yeni mesajları göremez.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../db';
import { AppError } from '../errors/AppError';

/** Veritabanı transaction istemcisi veya ana prisma örneği tipi */
type ConversationAccessClient = Pick<Prisma.TransactionClient, 'participant'>;

/**
 * Katılımcı kaydını veritabanından ilişkili verileriyle (User & Conversation) sorgulayan dahili yardımcı fonksiyon.
 */
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
 * AKTİF KATILIMCI DENETİMİ (Active Participant Enforcement)
 * Kullanıcının sohbete aktif olarak katıldığını ve sohbetin silinmediğini doğrular.
 * Yetki yoksa 403 Forbidden (`CONVERSATION_FORBIDDEN`) hatası fırlatır.
 */
export const requireActiveParticipant = async (
  conversationId: string,
  userId: string,
  errorMessage = 'Bu sohbet için aktif üyeliğiniz bulunmuyor.',
  client: ConversationAccessClient = prisma
) => {
  const participant = await findParticipant(conversationId, userId, client);
  if (!participant?.isActive || participant.conversation.isDeleted) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', errorMessage);
  }
  return participant;
};

/**
 * GEÇMİŞİ GÖRÜNTÜLEME DENETİMİ (History View Enforcement)
 * Kullanıcının sohbet geçmişini görme yetkisini doğrular.
 * Eski üyeler gruptan ayrılmış olsalar bile kaldıkları sürenin geçmişini okuyabilirler.
 */
export const requireHistoryParticipant = async (
  conversationId: string,
  userId: string,
  errorMessage = 'Bu sohbetin geçmişini görüntüleme yetkiniz yok.',
  client: ConversationAccessClient = prisma
) => {
  const participant = await findParticipant(conversationId, userId, client);
  if (!participant || (!participant.isActive && !participant.leftAt)) {
    throw AppError.forbidden('CONVERSATION_FORBIDDEN', errorMessage);
  }
  return participant;
};

