/**
 * ============================================================================
 * SOHBET ERİŞİM POLİTİKASI BİRİM TESTLERİ (Conversation Access Unit Tests)
 * ============================================================================
 * 
 * Bu dosya; kullanıcıların sohbet odalarına aktif katılım haklarını (`requireActiveParticipant`)
 * ve sohbetten ayrılmış eski üyelerin geçmiş mesajları okuma haklarını (`requireHistoryParticipant`)
 * doğrulayan birim testlerini barındırır.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  requireActiveParticipant,
  requireHistoryParticipant
} from '../../src/services/conversationAccess';

/** Sahte katılımcı (Participant) nesnesi üreten yardımcı */
const participant = (overrides: Record<string, unknown> = {}) => ({
  id: 'participant-1',
  userId: 'user-1',
  conversationId: 'conversation-1',
  isActive: true,
  joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  leftAt: null,
  isPinned: false,
  isArchived: false,
  isMuted: false,
  user: { id: 'user-1', username: 'talha' },
  conversation: {
    id: 'conversation-1',
    isGroup: true,
    name: 'Test group',
    isDeleted: false
  },
  ...overrides
});

/** Sahte Prisma veritabanı istemcisi oluşturan yardımcı */
const clientReturning = (value: ReturnType<typeof participant> | null) => ({
  participant: {
    findUnique: vi.fn().mockResolvedValue(value)
  }
});

describe('conversation access policy', () => {
  it('allows an active participant in a live conversation', async () => {
    // Aktif katılımcı canlı sohbet odasına erişebilmelidir
    const client = clientReturning(participant());

    await expect(requireActiveParticipant('conversation-1', 'user-1', undefined, client as never))
      .resolves.toMatchObject({ isActive: true });
  });

  it('rejects a passive participant from active operations', async () => {
    // Gruptan ayrılmış pasif katılımcı canlı işlem (mesaj atma, üye ekleme) yapamamalıdır
    const client = clientReturning(participant({
      isActive: false,
      leftAt: new Date('2026-02-01T00:00:00.000Z')
    }));

    await expect(requireActiveParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow('aktif');
  });

  it('rejects active operations in a deleted conversation', async () => {
    // Silinmiş bir grupta hiçbir aktif işlem gerçekleştirilememelidir
    const client = clientReturning(participant({
      conversation: {
        id: 'conversation-1',
        isGroup: true,
        name: 'Deleted group',
        isDeleted: true
      }
    }));

    await expect(requireActiveParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow();
  });

  it('allows a former participant to read membership-period history', async () => {
    // Gruptan ayrılan eski bir üye kendi üye olduğu döneme ait geçmiş mesajları okuyabilmelidir
    const client = clientReturning(participant({
      isActive: false,
      leftAt: new Date('2026-02-01T00:00:00.000Z')
    }));

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .resolves.toMatchObject({ isActive: false });
  });

  it('rejects history access when no membership exists', async () => {
    // Gruba hiç üye olmamış bir kullanıcı geçmiş mesajları okuyamamalıdır
    const client = clientReturning(null);

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow();
  });

  it('rejects an inconsistent passive membership without a departure time', async () => {
    // Ayrılma zamanı (leftAt) bulunmayan tutarsız pasif üyelik durumu reddedilmelidir
    const client = clientReturning(participant({ isActive: false, leftAt: null }));

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow();
  });
});

