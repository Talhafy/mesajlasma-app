import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyFileSignature } from '../../src/utils/fileValidation';
import { chatSchemas, mlsSchemas } from '../../src/validation/schemas';

const CONV_ID = '11111111-1111-4111-8111-111111111111';
const DEV_ALICE_ID = '22222222-2222-4222-8222-222222222222';
const DEV_BOB_ID = '33333333-3333-4333-8333-333333333333';
const DEV_OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';

const mockPrisma = vi.hoisted(() => ({
  userDevice: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn()
  },
  mlsKeyPackage: {
    deleteMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  participant: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn()
  },
  conversation: {
    findUnique: vi.fn(),
    updateMany: vi.fn()
  },
  message: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn()
  },
  mlsCommit: {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn()
  },
  mlsWelcome: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn()
  },
  encryptedHistoryBackup: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn()
  },
  uploadedAsset: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: mockPrisma
}));

vi.mock('../../src/services/fileStorage', () => ({
  createSignedFileUrl: vi.fn(async (key: string) => `https://signed.r2.local/${key}`),
  withSignedFileUrl: vi.fn(async (obj: any) => obj)
}));

vi.mock('../../src/services/fileCleanup', () => ({
  deleteFileIfUnreferenced: vi.fn(async () => undefined)
}));

import * as mlsDeliveryService from '../../src/services/mlsDeliveryService';
import * as backupService from '../../src/services/backupService';
import * as messageService from '../../src/services/messageService';

describe('MLS Delivery Service, Server-Side Signature & Authorization Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockPrisma.participant.findUnique.mockResolvedValue({
      id: 'part-1',
      userId: 'user-1',
      conversationId: CONV_ID,
      isActive: true,
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      conversation: { isDeleted: false }
    });
  });

  it('validates MSE1 client-side encrypted blob magic signature', () => {
    const validEncryptedHeader = Buffer.from([0x4d, 0x53, 0x45, 0x31, 0x01, 0x02, 0x03, 0x04]);
    const spoofedExecutable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    expect(verifyFileSignature(validEncryptedHeader, 'application/octet-stream')).toBe(true);
    expect(verifyFileSignature(spoofedExecutable, 'application/octet-stream')).toBe(false);
  });

  it('accepts both initialKeyPackages and keyPackages in registerDevice schema and verifies Ed25519 signature on server', async () => {
    // Zod şeması hem initialKeyPackages hem keyPackages alanlarını kabul etmeli
    const sampleItem = {
      keyPackageRef: 'kp_12345678_abcd',
      keyPackage: '{"mock":"package-payload-string"}'
    };
    expect(
      mlsSchemas.registerDevice.safeParse({
        deviceId: DEV_ALICE_ID,
        deviceName: 'Chrome (Windows)',
        signaturePublicKey: 'a'.repeat(44),
        credential: '{"credentialType":"BasicCredential"}',
        initialKeyPackages: [sampleItem]
      }).success
    ).toBe(true);

    expect(
      mlsSchemas.registerDevice.safeParse({
        deviceId: DEV_ALICE_ID,
        deviceName: 'Chrome (Windows)',
        signaturePublicKey: 'a'.repeat(44),
        credential: '{"credentialType":"BasicCredential"}',
        keyPackages: [sampleItem]
      }).success
    ).toBe(true);

    // Gerçek Ed25519 anahtar çiftiyle imzalı KeyPackage doğrulaması
    const sigPair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const sigPubBase64 = Buffer.from(await crypto.subtle.exportKey('raw', sigPair.publicKey)).toString('base64');
    const kpRef = 'kp_22222222_ephemeral1';
    const hpkePubBase64 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const issuedAt = new Date().toISOString();
    const canonical = new TextEncoder().encode(
      `MLS-KeyPackage-v2:${kpRef}:user-1:${DEV_ALICE_ID}:${hpkePubBase64}:${issuedAt}`
    );
    const sigBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', sigPair.privateKey, canonical)).toString('base64');

    const validKeyPackageJson = JSON.stringify({
      keyPackageRef: kpRef,
      userId: 'user-1',
      deviceId: DEV_ALICE_ID,
      signaturePublicKeyBase64: sigPubBase64,
      hpkePublicKeyBase64: hpkePubBase64,
      issuedAt,
      signatureBase64: sigBase64
    });

    await expect(
      mlsDeliveryService.verifyKeyPackageForDevice('user-1', DEV_ALICE_ID, sigPubBase64, {
        keyPackageRef: kpRef,
        keyPackage: validKeyPackageJson
      })
    ).resolves.toBeUndefined();

    // Başka bir kullanıcı adına imzalanmış veya değiştirilmiş KeyPackage reddedilmeli
    await expect(
      mlsDeliveryService.verifyKeyPackageForDevice('user-other', DEV_ALICE_ID, sigPubBase64, {
        keyPackageRef: kpRef,
        keyPackage: validKeyPackageJson
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'MLS_INVALID_KEY_PACKAGE'
    });
  });

  it('prevents KeyPackage draining (DoS) for users outside the active conversation and claims packages for active members', async () => {
    // user-outsider sohbette aktif üye değil -> findMany yalnızca user-bob'u döner
    mockPrisma.participant.findMany.mockResolvedValueOnce([{ userId: 'user-bob' }]);

    await expect(
      mlsDeliveryService.claimKeyPackagesForUsers(
        'user-1',
        CONV_ID,
        ['user-bob', 'user-outsider']
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'MLS_RECIPIENT_FORBIDDEN'
    });

    // Yalnızca aktif sohbet üyesi olan user-bob için talep edildiğinde başarılı olmalı
    mockPrisma.participant.findMany.mockResolvedValueOnce([{ userId: 'user-bob' }]);
    mockPrisma.userDevice.findMany.mockResolvedValue([
      {
        id: DEV_BOB_ID,
        userId: 'user-bob',
        deviceName: 'Bob Desktop',
        signaturePublicKey: 'ed25519-pub-key',
        credential: 'credential-json'
      }
    ]);
    mockPrisma.mlsKeyPackage.findFirst.mockResolvedValue({
      id: 'kp-1',
      keyPackageRef: 'kp-ref-1',
      keyPackage: 'serialized-mls-keypackage'
    });
    mockPrisma.mlsKeyPackage.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.mlsKeyPackage.count.mockResolvedValue(2);

    const emitMock = vi.fn();
    const ioMock = {
      to: vi.fn(() => ({ emit: emitMock }))
    };

    const result = await mlsDeliveryService.claimKeyPackagesForUsers(
      'user-1',
      CONV_ID,
      ['user-bob'],
      undefined,
      ioMock
    );

    expect(result.claimedPackages).toHaveLength(1);
    expect(result.claimedPackages[0].deviceId).toBe(DEV_BOB_ID);
    expect(emitMock).toHaveBeenCalledWith('mls:key_package_low', {
      deviceId: DEV_BOB_ID,
      remainingCount: 2
    });
  });

  it('accepts a signed commit from an approved device and rejects stale epochs', async () => {
    const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString('base64');
    const device = { id: DEV_ALICE_ID, userId: 'user-1', revokedAt: null, approvedAt: new Date(), signaturePublicKey: publicKey };
    const ratchetTree = JSON.stringify([{ deviceId: device.id, userId: device.userId, signaturePublicKeyBase64: publicKey, leafIndex: 0 }]);
    mockPrisma.userDevice.findUnique.mockResolvedValue(device);
    mockPrisma.userDevice.findMany.mockResolvedValue([device]);
    mockPrisma.mlsCommit.findUnique.mockResolvedValue({ ratchetTree });
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: CONV_ID, isDeleted: false, isGroup: false, mlsCurrentEpoch: 1,
      participants: [{ userId: 'user-1' }]
    });
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.mlsCommit.create.mockResolvedValue({ id: 'commit-2', epoch: 2 });
    const payload = async (epoch: number) => {
      const commitData = JSON.stringify({
        version: 2, groupId: 'mls:' + CONV_ID, epoch, senderDeviceId: device.id,
        tsMlsCommitBase64: Buffer.alloc(16).toString('base64')
      });
      const signed = Buffer.from(JSON.stringify(['mls-delivery-commit-v1', CONV_ID, epoch, device.id, commitData, ratchetTree, []]));
      const deliverySignature = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, signed)).toString('base64');
      return { epoch, senderDeviceId: device.id, commitData, ratchetTree, deliverySignature };
    };
    await expect(mlsDeliveryService.submitCommit('user-1', CONV_ID, await payload(1))).rejects
      .toMatchObject({ code: 'MLS_EPOCH_MISMATCH' });
    await expect(mlsDeliveryService.submitCommit('user-1', CONV_ID, await payload(2))).resolves
      .toMatchObject({ id: 'commit-2', epoch: 2 });
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('requires and verifies approval from a trusted device for the pending device', async () => {
    const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString('base64');
    const approver = { id: DEV_ALICE_ID, userId: 'user-1', approvedAt: new Date(), signaturePublicKey: publicKey };
    const pending = { id: DEV_BOB_ID, userId: 'user-1', approvedAt: null, signaturePublicKey: 'pending-public-key' };
    const signed = Buffer.from(JSON.stringify(['mls-device-approval-v1', 'user-1', approver.id, pending.id, pending.signaturePublicKey]));
    const signature = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, signed)).toString('base64');
    mockPrisma.userDevice.findUnique.mockResolvedValueOnce({ ...approver, approvedAt: null }).mockResolvedValueOnce(pending);
    await expect(mlsDeliveryService.approveDevice('user-1', pending.id, approver.id, signature)).rejects
      .toMatchObject({ code: 'MLS_DEVICE_APPROVAL_INVALID' });
    mockPrisma.userDevice.findUnique.mockResolvedValueOnce(approver).mockResolvedValueOnce(pending);
    mockPrisma.userDevice.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(mlsDeliveryService.approveDevice('user-1', pending.id, approver.id, signature)).resolves
      .toEqual({ approved: true });
    expect(mockPrisma.userDevice.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects plaintext (protocolVersion=0) downgrade attempts and unowned/revoked senderDeviceId on MLS-enabled conversations (M1 & H5a)', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: CONV_ID,
      isGroup: true,
      isDeleted: false,
      mlsCurrentEpoch: 2,
      participants: [
        { userId: 'user-1', isActive: true },
        { userId: 'user-2', isActive: true }
      ]
    });

    await expect(
      messageService.sendMessage(
        'user-1',
        {
          conversationId: CONV_ID,
          clientId: '55555555-5555-4555-8555-555555555555',
          content: 'Düz metin downgrade saldırısı',
          protocolVersion: 0
        },
        null
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'MLS_ENCRYPTION_REQUIRED'
    });

    // Başka bir kullanıcıya ait veya iptal edilmiş senderDeviceId ile mesaj gönderilemez (M1)
    mockPrisma.userDevice.findUnique.mockResolvedValueOnce({
      id: DEV_BOB_ID,
      userId: 'user-2',
      revokedAt: null
    });
    await expect(
      messageService.sendMessage(
        'user-1',
        {
          conversationId: CONV_ID,
          clientId: '66666666-6666-4666-8666-666666666666',
          content: '',
          protocolVersion: 2,
          epoch: 2,
          senderDeviceId: DEV_BOB_ID,
          ciphertext: 'forged-device-ciphertext'
        },
        null
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'MLS_DEVICE_NOT_FOUND'
    });

    // İptal edilmiş bir cihaz kendini POST /mls/devices ile tekrar aktif edemez (H5a)
    mockPrisma.userDevice.findUnique.mockResolvedValueOnce({
      id: DEV_ALICE_ID,
      userId: 'user-1',
      signaturePublicKey: 'revoked-pub-key',
      revokedAt: new Date()
    });
    await expect(
      mlsDeliveryService.registerOrUpdateDevice('user-1', {
        deviceId: DEV_ALICE_ID,
        signaturePublicKey: 'revoked-pub-key',
        credential: '{"credentialType":"BasicCredential"}'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'MLS_DEVICE_NOT_FOUND'
    });
  });

  it('prevents older zero-knowledge history backups from overwriting newer versions', async () => {
    mockPrisma.encryptedHistoryBackup.findUnique.mockResolvedValue({
      id: 'bkp-1',
      userId: 'user-1',
      backupVersion: 3,
      fileKey: 'backup-blob-v3.enc'
    });

    await expect(
      backupService.saveEncryptedBackupManifest('user-1', {
        fileKey: 'backup-blob-v2.enc',
        expectedPreviousVersion: 2,
        kdfAlgorithm: 'PBKDF2-SHA256',
        kdfSalt: 'salt-base64-string',
        kdfParams: '{"iterations":600000}',
        cipherNonce: 'iv-base64-string',
        checksum: 'a'.repeat(64),
        sizeBytes: 4096
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'BACKUP_VERSION_CONFLICT'
    });
  });
});
