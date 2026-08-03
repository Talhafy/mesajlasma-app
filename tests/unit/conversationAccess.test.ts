import { describe, expect, it, vi } from 'vitest';
import {
  requireActiveParticipant,
  requireHistoryParticipant
} from '../../src/services/conversationAccess';

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

const clientReturning = (value: ReturnType<typeof participant> | null) => ({
  participant: {
    findUnique: vi.fn().mockResolvedValue(value)
  }
});

describe('conversation access policy', () => {
  it('allows an active participant in a live conversation', async () => {
    const client = clientReturning(participant());

    await expect(requireActiveParticipant('conversation-1', 'user-1', undefined, client as never))
      .resolves.toMatchObject({ isActive: true });
  });

  it('rejects a passive participant from active operations', async () => {
    const client = clientReturning(participant({
      isActive: false,
      leftAt: new Date('2026-02-01T00:00:00.000Z')
    }));

    await expect(requireActiveParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow('aktif');
  });

  it('rejects active operations in a deleted conversation', async () => {
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
    const client = clientReturning(participant({
      isActive: false,
      leftAt: new Date('2026-02-01T00:00:00.000Z')
    }));

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .resolves.toMatchObject({ isActive: false });
  });

  it('rejects history access when no membership exists', async () => {
    const client = clientReturning(null);

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow();
  });

  it('rejects an inconsistent passive membership without a departure time', async () => {
    const client = clientReturning(participant({ isActive: false, leftAt: null }));

    await expect(requireHistoryParticipant('conversation-1', 'user-1', undefined, client as never))
      .rejects.toThrow();
  });
});
