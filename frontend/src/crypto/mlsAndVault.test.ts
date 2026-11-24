import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplicationMessage } from 'ts-mls';
import { encodePrivateMessage } from 'ts-mls/privateMessage.js';

// Bellek içi Delivery Service (DS) taklidi — gerçek mlsClient.ts uçtan uca simülasyon testi için
type SimKeyPackage = {
  userId: string;
  deviceId: string;
  keyPackageRef: string;
  keyPackage: string;
  consumed: boolean;
};

const simDevices = new Map<
  string,
  { id: string; userId: string; signaturePublicKey: string; credential: string; deviceName: string; revokedAt: string | null; approvedByDeviceId: string | null; approvalSignature: string | null; approvedByVault?: boolean }
>();
const simVaultAuthorities: { userId: string; issuerId: string; historyPublicKey: string; publicKey: string; signature: string }[] = [];
const simKeyPackages: SimKeyPackage[] = [];
const simCommits: any[] = [];
const simWelcomes: any[] = [];
let simCurrentEpoch = 0;
let simCurrentUser = '';
let simMembers: string[] = [];
let pendingRegistrations = false;

vi.mock('../api/httpClient', () => ({
  api: {
    post: async (url: string, body: any) => {
      if (url === '/mls/devices') {
        const existing = simDevices.get(body.deviceId);
        if (existing?.revokedAt) {
          throw Object.assign(new Error('Device revoked'), { response: { status: 403, data: { code: 'DEVICE_ACCESS_REVOKED' } } });
        }
        simDevices.set(body.deviceId, {
          id: body.deviceId,
          userId: simCurrentUser,
          signaturePublicKey: body.signaturePublicKey,
          credential: body.credential,
          revokedAt: null,
          approvedByDeviceId: existing?.approvedByDeviceId ?? null,
          approvalSignature: existing?.approvalSignature ?? null,
          approvedByVault: existing?.approvedByVault,
          deviceName: body.deviceName
        });
        for (const p of body.initialKeyPackages || body.keyPackages || []) {
          simKeyPackages.push({
            userId: simCurrentUser,
            deviceId: body.deviceId,
            ...p,
            consumed: false
          });
        }
        return { data: { device: { id: body.deviceId, approvedAt: pendingRegistrations ? null : new Date().toISOString() }, availableKeyPackageCount: 15 } };
      }
      if (url === '/mls/key-packages') {
        for (const p of body.keyPackages || []) {
          simKeyPackages.push({
            userId: simCurrentUser,
            deviceId: body.deviceId,
            ...p,
            consumed: false
          });
        }
        return { data: { availableKeyPackageCount: 15 } };
      }
      if (url === '/mls/key-packages/claim') {
        const excluded = new Set<string>([
          ...(body.excludeDeviceId ? [body.excludeDeviceId] : []),
          ...(body.excludeDeviceIds || [])
        ]);
        const claimedPackages: any[] = [];
        for (const d of simDevices.values()) {
          if (!body.userIds.includes(d.userId) || excluded.has(d.id)) continue;
          const kp = simKeyPackages.find((k) => k.deviceId === d.id && !k.consumed);
          if (!kp) continue;
          kp.consumed = true;
          claimedPackages.push({
            userId: d.userId,
            deviceId: d.id,
            deviceName: d.deviceName,
            signaturePublicKey: d.signaturePublicKey,
            credential: d.credential,
            keyPackageRef: kp.keyPackageRef,
            keyPackage: kp.keyPackage
          });
        }
        return { data: { claimedPackages } };
      }
      const m = url.match(/\/mls\/conversations\/(.+)\/commits/);
      if (m) {
        if (body.epoch !== simCurrentEpoch + 1) {
          const e: any = new Error('409');
          e.response = { status: 409 };
          throw e;
        }
        simCurrentEpoch = body.epoch;
        simCommits.push({
          id: String(simCommits.length),
          conversationId: m[1],
          epoch: body.epoch,
          senderDeviceId: body.senderDeviceId,
          commitData: body.commitData,
          ratchetTree: body.ratchetTree
        });
        for (const w of body.welcomes || []) {
          simWelcomes.push({
            id: 'w' + simWelcomes.length,
            conversationId: m[1],
            epoch: body.epoch,
            recipientDeviceId: w.recipientDeviceId,
            welcomeData: w.welcomeData,
            ratchetTree: w.ratchetTree
          });
        }
        return { data: {} };
      }
      throw new Error('unknown POST ' + url);
    },
    get: async (url: string, opts: any) => {
      if (url.endsWith('/devices')) return { data: {
        userIds: simMembers, isGroup: false, adminId: null,
        vaultAuthorities: simVaultAuthorities,
        devices: Array.from(simDevices.values()).filter((device) => simMembers.includes(device.userId))
      } };
      if (url.endsWith('/group-info')) {
        const latest = simCommits.at(-1);
        return { data: { epoch: simCurrentEpoch, groupInfo: latest ? JSON.parse(latest.commitData).groupInfoBase64 : null } };
      }
      const m = url.match(/\/mls\/conversations\/(.+)\/sync/);
      if (m) {
        const { deviceId, sinceEpoch } = opts.params;
        return {
          data: {
            conversationId: m[1],
            currentEpoch: simCurrentEpoch,
            welcomes: simWelcomes
              .filter((w) => w.recipientDeviceId === deviceId)
              .sort((a, b) => b.epoch - a.epoch)
              .slice(0, 5),
            commits: simCommits
              .filter((c) => c.epoch > sinceEpoch)
              .sort((a, b) => a.epoch - b.epoch)
          }
        };
      }
      throw new Error('unknown GET ' + url);
    }
  }
}));

import {
  cacheGroupAttachment,
  decryptBytesFromMse1,
  encryptBytesWithMse1,
  openGroupAttachment
} from './fileCrypto';
import {
  createEncryptedBackupPayload,
  decryptBackupPayload,
  generateRecoveryKey
} from './historyBackup';
import {
  decryptIncomingMessage,
  deserializeTsMlsClientState,
  encryptOutgoingMessage,
  ensureDeviceRegistered,
  registerDeviceForAccountVault,
  generateDeviceCryptoIdentity,
  generateSignedKeyPackages,
  getActiveConversationCallMediaKey,
  getTsMlsCiphersuite,
  rotateConversationEpoch,
  serializeTsMlsClientState,
  verifySignedKeyPackage,
  type SignedKeyPackagePayload
} from './mlsClient';
import {
  base64ToBytes,
  bytesToBase64,
  cacheDecryptedMessage,
  clearMemoryVaultForTests,
  consumeEphemeralKeyPackageKey,
  deleteEncryptedRecord,
  deleteGroupHistory,
  getConversationMlsState,
  getLocalConversationMedia,
  getStoredDeviceIdentity,
  hasEphemeralKeyPackageKey,
  importVaultHistory,
  saveConversationMlsState,
  saveDeviceIdentity,
  searchLocalMessages
} from './vault';

describe('RFC 9420 MLS Crypto Engine (`ts-mls` Single Source of Truth) & Multi-Client Simulation', () => {
  beforeEach(() => {
    clearMemoryVaultForTests();
    simDevices.clear();
    simVaultAuthorities.length = 0;
    simKeyPackages.length = 0;
    simCommits.length = 0;
    simWelcomes.length = 0;
    simCurrentEpoch = 0;
    simCurrentUser = '';
    pendingRegistrations = false;
  });

  it('replaces a revoked identity after vault unlock even if a background registration is in flight', async () => {
    const user = 'reapproving-account';
    simCurrentUser = user;
    const original = (await ensureDeviceRegistered(user))!;
    simDevices.get(original.deviceId)!.revokedAt = new Date().toISOString();
    pendingRegistrations = true;

    const background = ensureDeviceRegistered(user);
    const foreground = registerDeviceForAccountVault(user, new AbortController().signal);
    await expect(background).resolves.toBeNull();
    const replacement = await foreground;

    expect(replacement.deviceId).not.toBe(original.deviceId);
    expect(simDevices.get(original.deviceId)?.revokedAt).toBeTruthy();
    expect(simDevices.get(replacement.deviceId)).toMatchObject({ revokedAt: null, signaturePublicKey: replacement.signaturePublicKeyBase64 });
    expect(await getStoredDeviceIdentity(user)).toEqual(replacement);
    await expect(ensureDeviceRegistered(user)).resolves.toBeNull();
  });

  it('generates distinct ephemeral X25519 keys per KeyPackage, requires tlsKeyPackageBase64 + v2 signature, checks lifetime, and deletes consumed private keys', async () => {
    const aliceDevice = await generateDeviceCryptoIdentity('user-alice', 'Alice Chrome');
    expect(aliceDevice.safetyFingerprint.split(' ')).toHaveLength(12);

    const packages = await generateSignedKeyPackages(aliceDevice, 3);
    expect(packages).toHaveLength(3);

    const pkg0 = JSON.parse(packages[0].keyPackage) as SignedKeyPackagePayload;
    const pkg1 = JSON.parse(packages[1].keyPackage) as SignedKeyPackagePayload;

    expect(pkg0.tlsKeyPackageBase64).toBeTruthy();
    expect(pkg0.hpkePublicKeyBase64).not.toBe(pkg1.hpkePublicKeyBase64);
    expect(pkg0.hpkePublicKeyBase64).not.toBe(aliceDevice.initPublicKeyBase64);

    expect(
      await verifySignedKeyPackage(
        pkg0,
        'user-alice',
        aliceDevice.deviceId,
        aliceDevice.signaturePublicKeyBase64
      )
    ).toBe(true);

    // Sunucu tlsKeyPackageBase64 alanını çıkarıp downgrade denemesi yaparsa reddedilmeli (M3)
    const strippedTlsPkg = { ...pkg0, tlsKeyPackageBase64: '' };
    expect(await verifySignedKeyPackage(strippedTlsPkg, 'user-alice', aliceDevice.deviceId)).toBe(
      false
    );

    // Başka bir userId adına sunulursa reddedilmeli
    expect(
      await verifySignedKeyPackage(pkg0, 'user-impersonated', aliceDevice.deviceId)
    ).toBe(false);

    expect(await hasEphemeralKeyPackageKey('user-alice', packages[0].keyPackageRef)).toBe(true);
    const consumedPrivKey = await consumeEphemeralKeyPackageKey(
      'user-alice',
      packages[0].keyPackageRef
    );
    expect(consumedPrivKey).toBeTruthy();
    expect(await hasEphemeralKeyPackageKey('user-alice', packages[0].keyPackageRef)).toBe(false);
  });

  it('joins with a vault-approved second device while the original device is offline and exchanges MLS messages', async () => {
    const user = 'account';
    const conversationId = 'second-device-test';
    simCurrentUser = user;
    simMembers = [user];
    const primary = (await ensureDeviceRegistered(user))!;
    expect(await rotateConversationEpoch(user, conversationId, [user])).toMatchObject({ currentEpoch: 1 });
    const primaryState = (await getConversationMlsState(user, conversationId))!;
    const second = await generateDeviceCryptoIdentity(user, 'Second device');
    const cs = await getTsMlsCiphersuite();
    const authority = await cs.signature.keygen();
    const authorityPublicKey = bytesToBase64(authority.publicKey);
    const historyPublicKey = 'history-key';
    const encode = (fields: string[]) => new TextEncoder().encode(JSON.stringify(fields));
    const approvalSignature = bytesToBase64(await cs.signature.sign(authority.signKey,
      encode(['account-vault-device-v1', user, second.deviceId, second.signaturePublicKeyBase64])));
    simVaultAuthorities.push({ userId: user, issuerId: primary.deviceId, historyPublicKey, publicKey: authorityPublicKey,
      signature: bytesToBase64(await cs.signature.sign(base64ToBytes(primary.signaturePrivateKeyPkcs8Base64),
        encode(['account-vault-authority-v1', user, primary.deviceId, historyPublicKey, authorityPublicKey]))) });
    simDevices.set(second.deviceId, { id: second.deviceId, userId: user, signaturePublicKey: second.signaturePublicKeyBase64,
      credential: second.credentialJson, deviceName: second.deviceName, revokedAt: null,
      approvedByDeviceId: primary.deviceId, approvalSignature, approvedByVault: true });
    await saveDeviceIdentity(second);
    await deleteEncryptedRecord(`mls:${user}:${conversationId}`);
    const envelope = await encryptOutgoingMessage(user, conversationId, [user], 'İkinci cihazdan');
    expect(envelope?.epoch).toBe(2);
    expect(JSON.parse(simCommits.at(-1).commitData).external).toBe(true);
    const secondState = (await getConversationMlsState(user, conversationId))!;

    await saveDeviceIdentity(primary);
    await saveConversationMlsState(user, primaryState);
    const message = { id: 'second-sent', senderId: user, conversationId, content: '', ...envelope! };
    expect((await decryptIncomingMessage(user, message)).content).toBe('İkinci cihazdan');
    const reply = await encryptOutgoingMessage(user, conversationId, [user], 'İlk cihazdan');
    expect(reply?.epoch).toBe(2);
    await saveDeviceIdentity(second);
    await saveConversationMlsState(user, secondState);
    expect((await decryptIncomingMessage(user, { id: 'first-sent', senderId: user, conversationId, content: '', ...reply! })).content).toBe('İlk cihazdan');
  });

  it('passes full end-to-end 3-client simulation (K1, K2, K3, H2, H6, M2, M5: Epoch 1 -> Epoch 2 Member Add -> Epoch 3 Member Remove + Self-Read + Historical Decrypt + Call Keys)', async () => {
    const CONV = '11111111-1111-4111-8111-111111111111';
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let msgN = 0;

    const send = async (user: string, members: string[], text: string) => {
      simCurrentUser = user;
      const env = await encryptOutgoingMessage(user, CONV, members, text);
      expect(env).not.toBeNull();
      expect(env?.encryptedFileMetadata).toBeNull();
      return {
        id: `m${msgN++}`,
        conversationId: CONV,
        senderId: user,
        content: '',
        createdAt: new Date().toISOString(),
        ...env
      } as any;
    };

    const read = async (user: string, msg: any) => {
      simCurrentUser = user;
      return (await decryptIncomingMessage(user, msg)).content;
    };

    for (const u of [A, B, C]) {
      simCurrentUser = u;
      await ensureDeviceRegistered(u);
    }

    simMembers = [A, B];
    // 1. Epoch 1: Alice -> Bob mesaj gönderir; hem Bob hem de Alice kendi mesajını okuyabilmeli (K2)
    const m1 = await send(A, [A, B], 'merhaba epoch1');
    expect(m1.epoch).toBe(1);
    expect(await read(B, m1)).toBe('merhaba epoch1');
    expect(await read(A, m1)).toBe('merhaba epoch1');

    const packagesBeforeBurst = simKeyPackages.length;
    const burst = await Promise.all(Array.from({ length: 12 }, (_, index) => send(A, [A, B], 'seri mesaj ' + index)));
    for (const [index, message] of burst.entries()) expect(await read(B, message)).toBe('seri mesaj ' + index);
    expect(simKeyPackages).toHaveLength(packagesBeforeBurst);

    // Bob'un kalan KeyPackage sayısı kontrolü (Epoch 2 rotasyonunda Bob'un KeyPackage'ı tüketilmemeli - K1 & M2)
    const bobUnconsumedBeforeEp2 = simKeyPackages.filter(
      (k) => k.userId === B && !k.consumed
    ).length;

    // 2. Epoch 2: Charlie gruba eklenir -> hem Bob (Commit ile) hem Charlie (Welcome ile) hem Alice okuyabilmeli (K1 & K3)
    simCurrentUser = A;
    simMembers = [A, B, C];
    const st2 = await rotateConversationEpoch(A, CONV, [A, B, C]);
    expect(st2?.currentEpoch).toBe(2);

    const bobUnconsumedAfterEp2 = simKeyPackages.filter(
      (k) => k.userId === B && !k.consumed
    ).length;
    expect(bobUnconsumedAfterEp2).toBe(bobUnconsumedBeforeEp2);

    const m2 = await send(A, [A, B, C], 'charlie eklendi epoch2');
    expect(m2.epoch).toBe(2);
    expect(await read(B, m2)).toBe('charlie eklendi epoch2');
    expect(await read(C, m2)).toBe('charlie eklendi epoch2');
    expect(await read(A, m2)).toBe('charlie eklendi epoch2');

    // Charlie Epoch 2'de bir mesaj gönderir (Alice bunu henüz çözmeden Charlie gruptan çıkarılacak -> H6 testi!)
    const mCharlieEp2 = await send(C, [A, B, C], 'charlie epoch2 mesaji');
    expect(mCharlieEp2.epoch).toBe(2);

    // 3. Epoch 3: Charlie gruptan çıkarılır -> Alice ve Bob Epoch 3'e geçer, Charlie Epoch 3 mesajını çözemez!
    simCurrentUser = A;
    simMembers = [A, B];
    const st3 = await rotateConversationEpoch(A, CONV, [A, B]);
    expect(st3?.currentEpoch).toBe(3);

    const m3 = await send(A, [A, B], 'charlie cikarildi epoch3');
    expect(m3.epoch).toBe(3);
    expect(await read(B, m3)).toBe('charlie cikarildi epoch3');

    // Çıkarılan Charlie Epoch 3 mesajını okuyamamalı (PCS)
    const charlieAttemptM3 = await read(C, m3);
    expect(charlieAttemptM3).not.toBe('charlie cikarildi epoch3');

    // H6: Alice Epoch 3'teyken, gruptan çıkarılmış olan Charlie'nin eski Epoch 2 mesajını doğrulayıp okuyabilmeli!
    expect(await read(A, mCharlieEp2)).toBe('charlie epoch2 mesaji');

    // M5: Alice ve Bob için LiveKit arama E2EE medya anahtarları birebir aynı türetilmeli
    simCurrentUser = A;
    const ka = await getActiveConversationCallMediaKey(A, CONV, 'call-1', [A, B]);
    simCurrentUser = B;
    const kb = await getActiveConversationCallMediaKey(B, CONV, 'call-1', [A, B], 3);
    expect(ka?.epoch).toBe(3);
    expect(kb?.epoch).toBe(3);
    expect(ka?.e2eeKeyBase64).toBeTruthy();
    expect(ka?.e2eeKeyBase64).toBe(kb?.e2eeKeyBase64);
    expect(await getActiveConversationCallMediaKey(B, CONV, 'call-1', [A, B], 2)).toBeNull();
    expect((await getActiveConversationCallMediaKey(B, CONV, 'call-2', [A, B], 3))?.e2eeKeyBase64)
      .not.toBe(kb?.e2eeKeyBase64);

    const state = (await getConversationMlsState(A, CONV))!;
    const legacyContent = 'Önceki biçimde gönderilen mesaj';
    const legacyMessage = await createApplicationMessage(
      deserializeTsMlsClientState(state.tsMlsStateBase64!),
      new TextEncoder().encode(JSON.stringify({ content: legacyContent })),
      await getTsMlsCiphersuite()
    );
    await saveConversationMlsState(A, { ...state, tsMlsStateBase64: serializeTsMlsClientState(legacyMessage.newState) });
    const oldEnvelope = {
      ...m3,
      id: 'legacy-message',
      ciphertext: bytesToBase64(encodePrivateMessage(legacyMessage.privateMessage)),
      protocolVersion: 1
    };
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await read(B, { ...oldEnvelope, protocolVersion: 2 })).not.toBe(legacyContent);
      expect(await read(B, { ...oldEnvelope, senderId: C })).not.toBe(legacyContent);
      expect(await read(B, oldEnvelope)).toBe(legacyContent);
    } finally {
      warnings.mockRestore();
    }

    // The account stays in the conversation while its browser device is revoked.
    const bob = Array.from(simDevices.values()).find((device) => device.userId === B)!;
    bob.revokedAt = new Date().toISOString();
    const m4 = await send(A, [A, B], 'device revoked');
    expect(m4.epoch).toBe(4);
    expect(simMembers).toContain(B);
    expect(JSON.parse(simCommits.at(-1).ratchetTree).map((node: { deviceId: string }) => node.deviceId))
      .not.toContain(bob.id);
    expect(await read(B, m4)).not.toBe('device revoked');
  });

  it('encrypts and decrypts attachments with MSE1 header and verifies SHA-256 integrity', async () => {
    const sampleBytes = new TextEncoder().encode('Gizli PDF Rapor İçeriği - 2026');
    const { encryptedBytes, metadata } = await encryptBytesWithMse1(
      sampleBytes,
      'rapor.pdf',
      'application/pdf'
    );

    expect(Array.from(encryptedBytes.slice(0, 4))).toEqual([0x4d, 0x53, 0x45, 0x31]);
    expect(metadata.originalFileName).toBe('rapor.pdf');
    expect(metadata.mimeType).toBe('application/pdf');

    const decryptedBytes = await decryptBytesFromMse1(encryptedBytes, metadata);
    expect(new TextDecoder().decode(decryptedBytes)).toBe('Gizli PDF Rapor İçeriği - 2026');

    const corrupted = new Uint8Array(encryptedBytes);
    corrupted[corrupted.length - 1] ^= 0xff;
    await expect(decryptBytesFromMse1(corrupted, metadata)).rejects.toThrow(/SHA-256/);
  });

  it.each([
    ['rapor.pdf', 'application/pdf'],
    ['foto.png', 'image/png'],
    ['voice-1.webm', 'audio/webm']
  ])('opens archived %s offline using the original MIME type', async (fileName, mimeType) => {
    const bytes = new TextEncoder().encode('file contents');
    const { encryptedBytes, metadata } = await encryptBytesWithMse1(bytes, fileName, mimeType);
    const message = { id: 'file-message', senderId: 'sender', conversationId: 'group', content: '',
      fileKey: 'attachment-key', fileUrl: 'https://storage.invalid/signed', encryptedFileMetadata: JSON.stringify(metadata) };
    const fetchFile = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => encryptedBytes.buffer.slice(0),
      headers: new Headers({ 'content-type': 'application/octet-stream' })
    });
    const createObjectURL = vi.fn().mockReturnValue('blob:local-file');
    const OriginalUrl = URL;
    vi.stubGlobal('fetch', fetchFile);
    vi.stubGlobal('URL', class extends OriginalUrl { static createObjectURL = createObjectURL; });
    try {
      await cacheGroupAttachment('reader', message, new AbortController().signal);
      fetchFile.mockClear();
      await expect(openGroupAttachment('reader', { ...message, fileUrl: undefined })).resolves.toBe('blob:local-file');
      expect(fetchFile).not.toHaveBeenCalled();
      expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: mimeType, size: bytes.length }));
      await expect(openGroupAttachment('another-account', message)).resolves.toBeNull();
      await deleteGroupHistory('reader', message.conversationId);
      await expect(openGroupAttachment('reader', message)).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('indexes decrypted messages in the encrypted local vault and excludes raw epoch secrets from zero-knowledge cloud backups (M4)', async () => {
    const userId = 'user-alice';
    const convId = 'conv-101';

    await saveConversationMlsState(userId, {
      conversationId: convId,
      groupId: `mls:${convId}`,
      currentEpoch: 2,
      epochSecrets: {
        1: 'epoch-1-secret-base64',
        2: 'epoch-2-secret-base64'
      },
      ratchetTree: [],
      updatedAt: new Date().toISOString()
    });

    await cacheDecryptedMessage(userId, {
      id: 'msg-1',
      conversationId: convId,
      senderId: userId,
      senderUsername: 'alice',
      content: 'Proje mimari dokümanı https://example.com/mls-rfc9420 adresinde',
      createdAt: '2026-11-18T10:00:00.000Z',
      protocolVersion: 1,
      epoch: 1
    });

    await cacheDecryptedMessage(userId, {
      id: 'msg-2',
      conversationId: convId,
      senderId: 'user-bob',
      senderUsername: 'bob',
      content: 'Tamamdır, şifreli yerel kasa testlerini tamamladım.',
      createdAt: '2026-11-18T10:05:00.000Z',
      protocolVersion: 1,
      epoch: 2,
      fileKey: 'enc-file-1.enc',
      fileType: 'document',
      fileName: 'mimari.pdf'
    });

    const searchHits = await searchLocalMessages(userId, 'yerel kasa');
    expect(searchHits).toHaveLength(1);
    expect(searchHits[0].id).toBe('msg-2');

    const mediaAndLinks = await getLocalConversationMedia(userId, convId);
    expect(mediaAndLinks.mediaMessages).toHaveLength(1);
    expect(mediaAndLinks.linkItems).toHaveLength(1);
    expect(mediaAndLinks.linkItems[0].url).toBe('https://example.com/mls-rfc9420');

    const recoveryKey = generateRecoveryKey();
    const { encryptedBytes, manifest, snapshot } = await createEncryptedBackupPayload(
      userId,
      recoveryKey,
      10_000
    );

    // M4: Bulut yedeğinde geçmiş epoch sırları veya özel anahtarlar yer almamalı (Forward Secrecy)
    expect(snapshot.conversationStates).toEqual([]);
    expect(snapshot.messages).toHaveLength(2);

    const wrongKey = generateRecoveryKey();
    await expect(decryptBackupPayload(encryptedBytes, wrongKey, manifest)).rejects.toThrow();

    clearMemoryVaultForTests();
    const restoredSnapshot = await decryptBackupPayload(encryptedBytes, recoveryKey, manifest);
    const importStats = await importVaultHistory(userId, restoredSnapshot);
    expect(importStats.importedMessages).toBe(2);

    const postRestoreSearch = await searchLocalMessages(userId, 'mimari dokümanı');
    expect(postRestoreSearch).toHaveLength(1);
    expect(postRestoreSearch[0].id).toBe('msg-1');
  });
});
