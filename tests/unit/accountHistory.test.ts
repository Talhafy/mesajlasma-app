import { expect, it, vi } from 'vitest';

const { findMessages, storeCopies } = vi.hoisted(() => ({ findMessages: vi.fn(), storeCopies: vi.fn() }));
const { findDevice, findDevices, findMembers, findAccountKeys, findVault, saveVault, updateVault, updateDevice } = vi.hoisted(() => ({
  findDevice: vi.fn(), findDevices: vi.fn(), findMembers: vi.fn(), findAccountKeys: vi.fn(), findVault: vi.fn(),
  saveVault: vi.fn(), updateVault: vi.fn(), updateDevice: vi.fn()
}));
vi.mock('../../src/db', () => ({ default: {
  message: { findMany: findMessages }, accountHistoryMessage: { createMany: storeCopies },
  userDevice: { findFirst: findDevice, findMany: findDevices, updateMany: updateDevice }, participant: { findMany: findMembers },
  accountHistoryKey: { findMany: findAccountKeys, findUnique: findVault },
  $transaction: (run: (tx: unknown) => unknown) => run({
    $queryRaw: vi.fn(), userDevice: { findFirst: findDevice },
    accountHistoryKey: { findUnique: findVault, upsert: saveVault, updateMany: updateVault }
  })
} }));

import { approveAccountVaultDevice, historyDeliveryFor, historyVersion, listHistoryRepairs, requireVaultRecipients,
  setupAccountVault, storeAccountHistory, updateAccountVaultAccess, verifyHistoryDelivery } from '../../src/services/accountHistoryService';

it('requires the vault and a recovery or active device signature for the current vault revision', async () => {
  const keys = await Promise.all(['vault', 'recovery', 'device'].map(async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    return { privateKey: pair.privateKey, publicKey: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64') };
  }));
  const [vaultKey, recoveryKey, deviceKey] = keys;
  const password = { salt: 'new-salt', iv: 'password-iv', wrappedKey: 'same-key-encrypted' };
  const recovery = { publicKey: 'new-recovery-public-key', iv: 'recovery-iv', payload: 'encrypted' };
  const input = { revision: 3, password, recovery };
  const signedFields = ['account-vault-access-v1', 'owner', 3, 'recovery', null,
    [password.salt, password.iv, password.wrappedKey], [recovery.publicKey, recovery.iv, recovery.payload]];
  const sign = async (key: CryptoKey, fields: unknown[]) => Buffer.from(
    await crypto.subtle.sign('Ed25519', key, Buffer.from(JSON.stringify(fields)))
  ).toString('base64');
  const stored = { revision: 3, vaultApproval: { publicKey: vaultKey.publicKey }, vaultRecovery: { publicKey: recoveryKey.publicKey } };
  const proof = await sign(vaultKey.privateKey, signedFields);
  const authorization = await sign(recoveryKey.privateKey, signedFields);
  const request = { ...input, method: 'recovery' as const, proof, authorization };

  findVault.mockResolvedValueOnce(stored).mockResolvedValueOnce(stored).mockResolvedValueOnce(stored)
    .mockResolvedValueOnce(stored).mockResolvedValueOnce({ ...stored, revision: 4 });
  await expect(updateAccountVaultAccess('owner', { ...request, proof: authorization })).rejects.toMatchObject({ statusCode: 403 });
  await expect(updateAccountVaultAccess('owner', { ...request, recovery: { ...recovery, payload: 'tampered' } })).rejects.toMatchObject({ statusCode: 403 });
  await expect(updateAccountVaultAccess('owner', { ...request, authorization: proof })).rejects.toMatchObject({ statusCode: 403 });
  updateVault.mockResolvedValueOnce({ count: 1 });
  await updateAccountVaultAccess('owner', request);
  expect(updateVault).toHaveBeenCalledExactlyOnceWith({
    where: { userId: 'owner', revision: 3 },
    data: { ...password, vaultRecovery: recovery, revision: { increment: 1 } }
  });
  await expect(updateAccountVaultAccess('owner', request)).rejects.toMatchObject({ statusCode: 409 });

  const deviceFields = ['account-vault-access-v1', 'owner', 3, 'device', 'device-id',
    [password.salt, password.iv, password.wrappedKey], null];
  const deviceRequest = { method: 'device' as const, revision: 3, deviceId: 'device-id', password,
    proof: await sign(vaultKey.privateKey, deviceFields), authorization: await sign(deviceKey.privateKey, deviceFields) };
  findVault.mockResolvedValueOnce(stored).mockResolvedValueOnce(stored);
  findDevice.mockResolvedValueOnce(null).mockResolvedValueOnce({ signaturePublicKey: deviceKey.publicKey });
  await expect(updateAccountVaultAccess('owner', deviceRequest)).rejects.toMatchObject({ statusCode: 403 });
  updateVault.mockResolvedValueOnce({ count: 1 });
  await updateAccountVaultAccess('owner', deviceRequest);
  expect(updateVault.mock.lastCall?.[0].data).toEqual({ ...password, revision: { increment: 1 } });
});

it('accepts a vault authorized by an existing MLS device and grants another device only with the vault signature', async () => {
  const issuer = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const inbox = await crypto.subtle.generateKey({ name: 'RSA-OAEP', hash: 'SHA-256', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']) as CryptoKeyPair;
  const exportKey = async (format: 'raw' | 'spki', key: CryptoKey) => Buffer.from(await crypto.subtle.exportKey(format, key)).toString('base64');
  const sign = async (key: CryptoKey, fields: unknown[]) => Buffer.from(await crypto.subtle.sign('Ed25519', key, Buffer.from(JSON.stringify(fields)))).toString('base64');
  const publicKey = await exportKey('spki', inbox.publicKey);
  const authorityKey = await exportKey('raw', signing.publicKey);
  const fields = ['owner', 'main-device', publicKey, authorityKey];
  const signature = await sign(issuer.privateKey, ['account-vault-authority-v1', ...fields]);
  const authority = { issuerId: 'main-device', publicKey: authorityKey, privateKey: 'encrypted signing key', iv: 'authority-iv', signature };
  const wrapped = { salt: 'salt', iv: 'iv', wrappedKey: 'wrapped', publicKey, inboxIv: 'inbox-iv', inboxKey: 'inbox', revision: 0, authority };
  const proof = await sign(issuer.privateKey, ['account-vault-setup-v1', ...fields, 0, wrapped.salt, wrapped.iv, wrapped.wrappedKey,
    wrapped.inboxIv, wrapped.inboxKey, authority.iv, authority.privateKey, signature]);
  findDevice.mockResolvedValueOnce({ signaturePublicKey: await exportKey('raw', issuer.publicKey) });
  findVault.mockResolvedValueOnce(null);
  await setupAccountVault('owner', { ...wrapped, proof });
  expect(saveVault).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ vaultApproval: authority, revision: 1 }) }));

  const device = { id: 'new-device', signaturePublicKey: 'new-device-public', approvedAt: null };
  const approved = await sign(signing.privateKey, ['account-vault-device-v1', 'owner', device.id, device.signaturePublicKey]);
  findVault.mockResolvedValueOnce({ vaultApproval: authority }).mockResolvedValueOnce({ vaultApproval: authority });
  findDevice.mockResolvedValueOnce({ ...device, signaturePublicKey: 'other-key' }).mockResolvedValueOnce(device);
  updateDevice.mockResolvedValueOnce({ count: 1 });
  await expect(approveAccountVaultDevice('owner', device.id, approved)).rejects.toMatchObject({ code: 'MLS_DEVICE_APPROVAL_INVALID' });
  await expect(approveAccountVaultDevice('owner', device.id, approved)).resolves.toBe(true);
  expect(updateDevice).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ data: expect.objectContaining({
    approvedByVault: true, approvedByDeviceId: 'main-device', approvalSignature: approved
  }) }));
});

it('requires every permitted recipient including the sender to have a configured vault', async () => {
  const sender = { userId: 'sender', publicKey: 'sender-key' };
  const recipient = { userId: 'recipient', publicKey: 'recipient-key' };
  findAccountKeys.mockResolvedValueOnce([sender]).mockResolvedValueOnce([sender, recipient]);
  await expect(requireVaultRecipients(['sender', 'recipient'])).rejects.toMatchObject({ code: 'HISTORY_VAULT_REQUIRED' });
  await expect(requireVaultRecipients(['sender', 'recipient'])).resolves.toEqual([sender, recipient]);
  expect(findAccountKeys.mock.calls.at(-1)?.[0].where).toHaveProperty('vaultApproval');
});

it('accepts only the authenticated account’s eligible message and current encrypted version', async () => {
  const member = { joinedAt: new Date('2026-01-03'), isActive: true, leftAt: null, historyPeriods: [
    { joinedAt: new Date('2026-01-01'), leftAt: new Date('2026-01-01T23:59:59Z') }
  ] };
  const ciphertext = 'current ciphertext';
  const message = { id: 'eligible', ciphertext, createdAt: new Date('2026-01-01T13:00:00Z'), conversation: { participants: [member] } };
  findMessages.mockResolvedValueOnce([message, { ...message, id: 'gap', createdAt: new Date('2026-01-02') }]);
  const entry = { messageId: 'eligible', version: historyVersion(ciphertext), iv: 'iv', payload: 'opaque' };

  await expect(storeAccountHistory('owner', [entry, { ...entry, messageId: 'gap' }, { ...entry, version: 'stale' }]))
    .resolves.toEqual({ accepted: [{ messageId: 'eligible', version: entry.version }] });
  expect(storeCopies).toHaveBeenCalledExactlyOnceWith({ data: [{ userId: 'owner', ...entry }], skipDuplicates: true });
  expect(findMessages.mock.calls[0][0].where.deletions).toEqual({ none: { userId: 'owner' } });
});

it('verifies the sender signature and returns only the account’s wrapped key', async () => {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const signer = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
  const ciphertext = 'mls';
  const iv = 'iv';
  const payload = 'opaque';
  const signed = new TextEncoder().encode(JSON.stringify(['account-history-delivery-v1', 'group', 'sender', 'client', historyVersion(ciphertext), iv, payload]));
  const signature = Buffer.from(await crypto.subtle.sign('Ed25519', pair.privateKey, signed)).toString('base64');
  const envelope = { iv, payload, signature, keys: { permitted: 'wrapped', removed: 'other-wrapped' } };
  const verified = await verifyHistoryDelivery(envelope, 'group', 'sender', 'client', ciphertext, signer, ['permitted']);
  expect(historyDeliveryFor(verified, 'permitted')).toMatchObject({ key: 'wrapped' });
  expect(historyDeliveryFor(verified, 'removed')).toBeUndefined();
  expect(historyDeliveryFor(verified, 'permitted')).not.toHaveProperty('keys');
  await expect(verifyHistoryDelivery({ ...envelope, payload: 'altered' }, 'group', 'sender', 'client', ciphertext, signer, ['permitted'])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('offers old repairs only for the original approved device and recipients whose membership includes the message', async () => {
  const now = new Date('2026-08-01T12:00:00Z');
  const member = { conversationId: 'group', joinedAt: new Date('2026-08-01'), leftAt: null, isActive: true, historyPeriods: [] };
  findDevice.mockResolvedValueOnce({ id: 'origin' }).mockResolvedValueOnce(null);
  findMessages.mockResolvedValueOnce([{ id: 'message', conversationId: 'group', senderId: 'author', senderDeviceId: 'origin',
    createdAt: now, ciphertext: 'original', deletions: [{ userId: 'removed-personally' }], historyDelivery: null }]);
  findMembers.mockResolvedValueOnce([{ ...member, userId: 'author' },
    { ...member, userId: 'former', isActive: false, leftAt: new Date('2026-08-02') },
    { ...member, userId: 'removed-personally' }, { ...member, userId: 'later', joinedAt: new Date('2026-08-03') }]);
  findAccountKeys.mockResolvedValueOnce([]);
  findDevices.mockResolvedValueOnce(['author', 'former', 'removed-personally', 'later'].map((userId) => ({ id: `${userId}-device`, userId, historyPublicKey: 'public' })));

  const result = await listHistoryRepairs('author', 'origin');
  expect(result.items[0].devices.map(({ userId }) => userId)).toEqual(['author', 'former']);
  expect(findMessages.mock.calls.at(-1)?.[0].where).toMatchObject({ senderId: 'author', senderDeviceId: 'origin' });
  await expect(listHistoryRepairs('author', 'unapproved')).rejects.toMatchObject({ code: 'MLS_DEVICE_NOT_FOUND' });
});
