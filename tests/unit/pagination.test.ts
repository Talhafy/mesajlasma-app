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
  requireHistoryParticipantMock
} = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  participantFindManyMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  requireHistoryParticipantMock: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: {
    user: { findMany: userFindManyMock },
    participant: { findMany: participantFindManyMock },
    message: { findMany: messageFindManyMock, findUnique: messageFindUniqueMock },
    blockedUser: { findMany: vi.fn().mockResolvedValue([]) },
    conversationReadState: { findMany: vi.fn().mockResolvedValue([]) }
  }
}));

vi.mock('../../src/services/conversationAccess', () => ({
  requireHistoryParticipant: requireHistoryParticipantMock
}));

import { fetchMessages } from '../../src/services/messageService';
import { listUsers } from '../../src/services/userService';

describe('Deterministic Cursor & Composite Tuple Pagination unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

