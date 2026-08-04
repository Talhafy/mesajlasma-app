/**
 * ============================================================================
 * KULLANICI GİZLİLİĞİ VE E-POSTA KORUMASI BİRİM TESTLERİ (User Privacy Tests)
 * ============================================================================
 * 
 * Bu dosya; kullanıcı arama/rehber listelerinde ve başkasının profil detaylarında
 * kullanıcı e-posta adreslerinin kamuya sızdırılmadığını (`email` alanının silindiğini) test eder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, createSignedFileUrlMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    blockedUser: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    }
  },
  createSignedFileUrlMock: vi.fn()
}));

vi.mock('../../src/db', () => ({ default: prismaMock }));
vi.mock('../../src/services/fileStorage', () => ({
  createSignedFileUrl: createSignedFileUrlMock
}));

import { getUserProfile, listUsers } from '../../src/services/userService';

describe('public user privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.blockedUser.findMany.mockResolvedValue([]);
    prismaMock.blockedUser.findUnique.mockResolvedValue(null);
    createSignedFileUrlMock.mockResolvedValue('https://signed.example/avatar');
  });

  it('does not expose email addresses in the public user directory', async () => {
    // Kamuya açık kullanıcı arama rehberinde e-posta adresleri kesinlikle gizlenmelidir
    prismaMock.user.findMany.mockResolvedValue([{
      id: 'user-2',
      username: 'deniz',
      email: 'private@example.com',
      avatarFileKey: null,
      lastSeenAt: new Date('2026-08-03T10:00:00.000Z')
    }]);

    const res = await listUsers('user-1');
    const user = res.items[0];

    expect(user).not.toHaveProperty('email');
    expect(user).toMatchObject({ id: 'user-2', username: 'deniz' });
  });

  it('does not expose email addresses in another user profile', async () => {
    // Başka bir kullanıcının profili incelenirken e-posta adresi gizlenmelidir
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-2',
      username: 'deniz',
      email: 'private@example.com',
      avatarFileKey: 'avatar-key',
      lastSeenAt: new Date('2026-08-03T10:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    });

    const profile = await getUserProfile('user-2', 'user-1');

    expect(profile).not.toHaveProperty('email');
    expect(profile).toMatchObject({
      id: 'user-2',
      username: 'deniz',
      avatarUrl: 'https://signed.example/avatar'
    });
  });
});

