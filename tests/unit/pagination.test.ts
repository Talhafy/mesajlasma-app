/**
 * ============================================================================
 * İLERİ SAYFALAMA VE BİLEŞİK SAYFALAMA TESTLERİ (Pagination Unit Tests)
 * ============================================================================
 * 
 * Bu dosya, kullanıcı ve mesaj listelemede kullanılan determinitik cursor-based
 * sayfalama mantığını ve çakışmasız bileşik sıralamayı (`createdAt`, `id`) test eder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.R2_ENDPOINT = 'https://r2.example.com';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
});

const {
  userFindManyMock,
  participantFindManyMock,
  messageFindManyMock,
  messageFindUniqueMock,
  messageDeletionUpsertMock,
  requireActiveParticipantMock,
  requireHistoryParticipantMock
} = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  participantFindManyMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  messageDeletionUpsertMock: vi.fn(),
  requireActiveParticipantMock: vi.fn(),
  requireHistoryParticipantMock: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: {
    user: { findMany: userFindManyMock },
    participant: { findMany: participantFindManyMock },
    message: { findMany: messageFindManyMock, findUnique: messageFindUniqueMock, count: vi.fn().mockResolvedValue(1) },
    messageDeletion: { upsert: messageDeletionUpsertMock },
    blockedUser: { findMany: vi.fn().mockResolvedValue([]) },
    conversationReadState: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn(),
    $transaction: (run: (tx: unknown) => unknown) => run({
      messageDeletion: { upsert: messageDeletionUpsertMock }, accountHistoryMessage: { deleteMany: vi.fn() }, $executeRaw: vi.fn()
    })
  }
}));

vi.mock('../../src/services/conversationAccess', () => ({
  requireActiveParticipant: requireActiveParticipantMock,
  requireHistoryParticipant: requireHistoryParticipantMock
}));

import { deleteMessage, fetchMessages, markAsRead } from '../../src/services/messageService';
import { listUsers } from '../../src/services/userService';

describe('Deterministic Cursor & Composite Tuple Pagination unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts receipts for groups even if the caller opts out and respects opt-out in direct chats', async () => {
    const joinedAt = new Date('2026-08-01T00:00:00Z');
    requireActiveParticipantMock.mockResolvedValueOnce({ joinedAt, conversation: { isGroup: true } })
      .mockResolvedValueOnce({ joinedAt, conversation: { isGroup: false } });
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) };

    await markAsRead('group', 'reader', undefined, false, io);
    await markAsRead('direct', 'reader', undefined, false, io);

    expect(io.to).toHaveBeenCalledExactlyOnceWith('group');
    expect(emit).toHaveBeenCalledExactlyOnceWith('mesajlar_okundu', expect.objectContaining({ readByUserId: 'reader', readThroughAt: expect.any(String) }));
  });

  it('should paginate users with cursor and return nextCursor', async () => {
    // Kullanıcı listesi istenen limitle çekilmeli ve bir sonraki cursor (nextCursor) dönmelidir
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user-1', username: 'user1', avatarFileKey: null, lastSeenAt: new Date() },
      { id: 'user-2', username: 'user2', avatarFileKey: null, lastSeenAt: new Date() },
      { id: 'user-3', username: 'user3', avatarFileKey: null, lastSeenAt: new Date() }
    ]);

    const result = await listUsers('current-user-id', undefined, 2);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('user-2');
  });

  it('should construct composite (createdAt, id) tuple OR query when cursor is passed in fetchMessages', async () => {
    // Mesaj sayfalama sorgusu eşit zamanlı mesajlarda Atlamaları önlemek için (createdAt, id) bileşik sıralaması kullanmalıdır
    requireHistoryParticipantMock.mockResolvedValueOnce({
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      leftAt: null
    });

    messageFindUniqueMock.mockResolvedValueOnce({
      id: 'msg-cursor-id',
      createdAt: new Date('2026-08-01T12:00:00Z')
    });

    messageFindManyMock.mockResolvedValueOnce([
      {
        id: 'msg-1',
        content: 'Hello',
        senderId: 'user-1',
        conversationId: 'conv-1',
        createdAt: new Date('2026-08-01T11:00:00Z'),
        sender: { username: 'user1' },
        reads: [],
        stars: [],
        deletions: []
      }
    ]);

    const res = await fetchMessages('conv-1', 'user-1', 'msg-cursor-id', 10);
    expect(messageFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'msg-cursor-id' },
      select: { createdAt: true, id: true }
    });

    expect(messageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: expect.objectContaining({
        OR: [
          { createdAt: { lt: expect.any(Date) } },
          { createdAt: expect.any(Date), id: { lt: 'msg-cursor-id' } }
        ]
      })
    }));

    expect(res.items).toHaveLength(1);
  });

  it('restricts rejoined group history to the previous and current membership periods', async () => {
    const joinedAt = new Date('2026-08-03T00:00:00Z');
    const prior = { joinedAt: new Date('2026-08-01T00:00:00Z'), leftAt: new Date('2026-08-01T23:59:59Z') };
    requireHistoryParticipantMock.mockResolvedValueOnce({ id: 'membership', joinedAt, leftAt: null, historyPeriods: [prior] });
    messageFindManyMock.mockResolvedValueOnce([]);

    const result = await fetchMessages('conv-1', 'user-1');

    expect(messageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      AND: expect.arrayContaining([{ OR: [
        { createdAt: { gte: joinedAt } },
        { createdAt: { gte: prior.joinedAt, lte: prior.leftAt } }
      ] }])
    }) }));
    expect(result).toMatchObject({ historySince: prior.joinedAt, historyId: 'membership' });
  });

  it('allows a removed member to delete their own copy only within their membership period', async () => {
    const membership = { joinedAt: new Date('2026-08-01T00:00:00Z'), leftAt: new Date('2026-08-02T00:00:00Z'), isActive: false };
    requireHistoryParticipantMock.mockResolvedValue(membership);
    messageFindUniqueMock.mockResolvedValueOnce({ conversationId: 'conv-1', createdAt: new Date('2026-08-01T12:00:00Z') })
      .mockResolvedValueOnce({ conversationId: 'conv-1', createdAt: new Date('2026-08-02T12:00:00Z') });

    await expect(deleteMessage('inside', 'user-1', false, null)).resolves.toBeDefined();
    await expect(deleteMessage('outside', 'user-1', false, null)).rejects.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });
    expect(messageDeletionUpsertMock).toHaveBeenCalledExactlyOnceWith({
      where: { messageId_userId: { messageId: 'inside', userId: 'user-1' } },
      create: { messageId: 'inside', userId: 'user-1' },
      update: {}
    });
  });
});

