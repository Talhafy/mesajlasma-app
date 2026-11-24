import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Message } from '../types/chat';
import { bytesToBase64, clearMemoryVaultForTests, saveDeviceIdentity, type StoredMlsDelivery } from './vault';
import {
  createAccountHistoryDelivery, openAccountHistory, prepareAccountHistoryPasswordChange, queueAccountHistoryMessage,
  receiveAccountHistoryCopies, recoverAccountHistoryMessage, recoverDeliveredHistoryMessage, registerHistoryDevice, syncAccountHistoryBeforeLogout, syncAuthoredHistory
} from './accountHistory';
import {
  approveDeviceWithAccountVault, generateAccountVaultRecoveryCode, recoverAccountVault, rememberAccountVault,
  resumeAccountVault, setupAccountVault, unlockAccountVault, updateVaultAccessFromDevice
} from './accountHistory';
import { computeSha256Hex } from './fileCrypto';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../api/httpClient', () => ({ api }));

const password = 'Bilinen1!';
const recipient = 'recipient';
const keyEndpoint = '/mls/account-history/key';
const controllers: AbortController[] = [];
let enrolled: Record<string, unknown>;

const open = (userId: string, password?: string) => {
  const controller = new AbortController();
  controllers.push(controller);
  return openAccountHistory(userId, password, controller.signal);
};

const clearDevice = () => {
  for (const controller of controllers.splice(0)) controller.abort();
  clearMemoryVaultForTests();
};

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ data: { key: null } });
  api.post.mockImplementation(async (_url: string, { password: _, ...wrapped }) => {
    enrolled = { ...wrapped, revision: 1 };
    return { data: { key: enrolled } };
  });
});
afterEach(clearDevice);

it('opens the same vault on a fresh device with its independent passphrase and signs the new device approval', async () => {
  const phrase = 'Ayri kasa parolasi 82';
  const primary = new AbortController();
  controllers.push(primary);
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const sign = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, data as BufferSource));
  api.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith('/vault')) {
      enrolled = { ...body, vaultApproval: body.authority, revision: 1 };
      return { data: { key: enrolled } };
    }
    return { data: { approved: true } };
  });
  await setupAccountVault(recipient, phrase, '', 'primary', sign, primary.signal);
  expect(JSON.stringify(api.post.mock.calls[0][1])).not.toContain(phrase);
  clearDevice();
  api.get.mockResolvedValue({ data: { key: enrolled } });
  const secondary = new AbortController();
  controllers.push(secondary);
  await expect(unlockAccountVault(recipient, password, secondary.signal)).rejects.toBeDefined();
  await expect(approveDeviceWithAccountVault(recipient, 'second-device', 'second-public-key', secondary.signal)).rejects.toBeDefined();
  const revision = await unlockAccountVault(recipient, phrase, secondary.signal);
  await rememberAccountVault(recipient, 'browser-session', 'second-device', revision);
  secondary.abort();
  const reloaded = new AbortController();
  controllers.push(reloaded);
  await expect(resumeAccountVault(recipient, 'another-session', 'second-device', reloaded.signal)).resolves.toBe(false);
  await expect(resumeAccountVault(recipient, 'browser-session', 'another-device', reloaded.signal)).resolves.toBe(false);
  await expect(resumeAccountVault(recipient, 'browser-session', 'second-device', reloaded.signal)).resolves.toBe(true);
  await approveDeviceWithAccountVault(recipient, 'second-device', 'second-public-key', reloaded.signal);
  const request = api.post.mock.calls.at(-1)?.[1];
  const authority = enrolled.vaultApproval as { publicKey: string };
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(authority.publicKey), (character) => character.charCodeAt(0)), 'Ed25519', false, ['verify']);
  await expect(crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(request.signature), (character) => character.charCodeAt(0)),
    new TextEncoder().encode(JSON.stringify(['account-vault-device-v1', recipient, 'second-device', 'second-public-key'])))).resolves.toBe(true);
  expect(await prepareAccountHistoryPasswordChange(recipient, password, 'Yeni123!')).toBeUndefined();
});

it('keeps message history after open-device password change and code recovery on a fresh device', async () => {
  const original = 'Eski kasa parolası 85';
  const devicePassword = 'Açık cihazdan yeni parola 75';
  const finalPassword = 'Kurtarılmış kasa parolası 95';
  const firstCode = generateAccountVaultRecoveryCode();
  const activeCode = generateAccountVaultRecoveryCode();
  const replacementCode = generateAccountVaultRecoveryCode();
  const issuer = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair;
  const sign = async (data: Uint8Array) =>
    new Uint8Array(await crypto.subtle.sign('Ed25519', issuer.privateKey, data as BufferSource));
  const first = new AbortController();
  controllers.push(first);
  api.get.mockImplementation(async () => ({ data: { key: enrolled ?? null } }));
  api.post.mockImplementationOnce(async (_url, { authority, recovery, ...envelope }) => {
    enrolled = { ...envelope, vaultApproval: authority, vaultRecovery: recovery, revision: 1 };
  });
  api.get.mockResolvedValueOnce({ data: { key: null } });
  await setupAccountVault(recipient, original, '', 'device', sign, first.signal, firstCode);
  expect(JSON.stringify(api.post.mock.calls[0][1])).not.toContain(firstCode);
  await unlockAccountVault(recipient, original, first.signal);

  const message: Message = { id: 'recovered', conversationId: 'group', ciphertext: 'original', senderId: 'sender', content: '' };
  queueAccountHistoryMessage(recipient, {
    id: message.id, conversationId: message.conversationId, ciphertext: 'original', content: 'Kurtarılan mesaj'
  });
  api.put.mockResolvedValueOnce({ data: { accepted: [] } });
  await syncAccountHistoryBeforeLogout(recipient);
  const [copy] = api.put.mock.calls[0][1].entries;

  api.put.mockImplementation(async (_url, { password: envelope, recovery, revision }) => {
    enrolled = { ...enrolled, ...envelope, ...(recovery && { vaultRecovery: recovery }), revision: revision + 1 };
  });
  await updateVaultAccessFromDevice(recipient, 'device', sign, { passphrase: devicePassword });
  await updateVaultAccessFromDevice(recipient, 'device', sign, { recoveryCode: activeCode });
  clearDevice();

  const fresh = new AbortController();
  controllers.push(fresh);
  await expect(unlockAccountVault(recipient, original, fresh.signal)).rejects.toBeDefined();
  await unlockAccountVault(recipient, devicePassword, fresh.signal);
  clearDevice();

  const recovered = new AbortController();
  controllers.push(recovered);
  const updatesBeforeRecovery = api.put.mock.calls.length;
  await expect(recoverAccountVault(recipient, firstCode, finalPassword, replacementCode, recovered.signal)).rejects.toThrow('Kurtarma kodu kasayı açamadı');
  expect(api.put).toHaveBeenCalledTimes(updatesBeforeRecovery);
  await recoverAccountVault(recipient, activeCode, finalPassword, replacementCode, recovered.signal);
  const request = JSON.stringify(api.put.mock.lastCall?.[1]);
  for (const secret of [activeCode, finalPassword, replacementCode]) expect(request).not.toContain(secret);
  await expect(recoverAccountVault(recipient, activeCode, finalPassword, firstCode, recovered.signal)).rejects.toThrow('Kurtarma kodu kasayı açamadı');
  await expect(unlockAccountVault(recipient, devicePassword, recovered.signal)).rejects.toBeDefined();
  await unlockAccountVault(recipient, finalPassword, recovered.signal);
  await expect(recoverAccountHistoryMessage(recipient, { ...message, accountHistoryCopy: copy })).resolves.toMatchObject({ content: 'Kurtarılan mesaj' });
});

it('decrypts a message delivered while the recipient was offline after logging in on a fresh device', async () => {
  expect(await open(recipient, password)).toBe(true);
  clearDevice();

  api.get.mockImplementation(async (url: string) => url === keyEndpoint
    ? { data: { key: enrolled } }
    : { data: { recipients: [{ userId: recipient, publicKey: enrolled.publicKey }] } });
  const device = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const signer = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey)));
  const item: StoredMlsDelivery = { ciphertext: 'mls ciphertext', content: 'Çevrimdışıyken gelen mesaj', conversationId: 'group',
    clientId: 'client', epoch: 3, senderDeviceId: 'device' };
  const delivery = await createAccountHistoryDelivery('sender', item, async (data) =>
    new Uint8Array(await crypto.subtle.sign('Ed25519', device.privateKey, data as BufferSource)));
  const version = await computeSha256Hex(new TextEncoder().encode(item.ciphertext));
  expect(JSON.stringify(delivery)).not.toContain(item.content);
  expect(delivery?.keys[recipient]).toHaveLength(344);
  const message: Message = { ...item, id: 'message', senderId: 'sender', content: '', encryptedFileMetadata: null,
    historyDelivery: { ...delivery, deviceKeys: undefined, signer, target: item.clientId, version } };

  expect(await recoverDeliveredHistoryMessage(recipient, message)).toBeNull();
  const updated = await prepareAccountHistoryPasswordChange(recipient, password, 'YeniParola1!');
  enrolled = { ...enrolled, ...updated, revision: 2 };
  await expect(open(recipient, password)).rejects.toBeDefined();
  expect(await open(recipient, 'YeniParola1!')).toBe(true);
  await expect(recoverDeliveredHistoryMessage(recipient, message)).resolves.toMatchObject({ content: item.content });
  await expect(recoverDeliveredHistoryMessage(recipient, { ...message, ciphertext: 'changed' })).resolves.toBeNull();
  await expect(recoverDeliveredHistoryMessage(recipient, { ...message, clientId: 'different-client' })).resolves.toBeNull();
  await expect(recoverDeliveredHistoryMessage('someone-else', message)).resolves.toBeNull();
});

it('does not retry throttled history uploads before the server allows another request', async () => {
  expect(await open(recipient, password)).toBe(true);
  queueAccountHistoryMessage(recipient, { id: 'queued', conversationId: 'group', ciphertext: 'ciphertext', content: 'queued' });
  api.put.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '90' } } });
  await syncAccountHistoryBeforeLogout(recipient);
  await syncAccountHistoryBeforeLogout(recipient);
  expect(api.put).toHaveBeenCalledTimes(1);
});

it('syncs readable old messages as encrypted account copies bound to their message ID and version', async () => {
  expect(await open(recipient, password)).toBe(true);
  const message: Message = { id: 'old-id', conversationId: 'group', ciphertext: 'older MLS envelope', senderId: 'sender', content: '' };
  const content = 'Daha önce okunan mesaj';
  api.put.mockImplementation(async (_url: string, { entries }) => ({ data: { accepted: entries } }));
  queueAccountHistoryMessage(recipient, { id: message.id, conversationId: message.conversationId, ciphertext: message.ciphertext!, content });
  await syncAccountHistoryBeforeLogout(recipient);
  const [upload] = api.put.mock.calls[0][1].entries;
  expect(JSON.stringify(upload)).not.toContain(content);
  clearDevice();

  api.get.mockResolvedValue({ data: { key: enrolled } });
  expect(await open(recipient, password)).toBe(true);
  await expect(recoverAccountHistoryMessage(recipient, { ...message, accountHistoryCopy: upload })).resolves.toMatchObject({ content });
  receiveAccountHistoryCopies(recipient, [upload]);
  await expect(recoverAccountHistoryMessage(recipient, message)).resolves.toMatchObject({ content });
  await expect(recoverAccountHistoryMessage(recipient, { ...message, id: 'other-id', accountHistoryCopy: upload })).resolves.toBeNull();
});

it('repairs an old message on an existing device session without an account password or an MLS epoch key', async () => {
  const sender = 'sender';
  const receivingDevice = 'existing-receiving-device';
  const senderDevice = 'original-device';
  const controller = new AbortController();
  controllers.push(controller);
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const signer = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const sign = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, data as BufferSource));
  await saveDeviceIdentity({ userId: recipient, deviceId: receivingDevice, deviceName: '', signaturePublicKeyBase64: '',
    signaturePrivateKeyPkcs8Base64: '', initPublicKeyBase64: '', initPrivateKeyPkcs8Base64: '', credentialJson: '', safetyFingerprint: '', createdAt: '' });
  api.put.mockResolvedValue({ data: {} });
  expect(await open(recipient)).toBe(false);
  await registerHistoryDevice(recipient, receivingDevice, sign, controller.signal);
  const { publicKey } = api.put.mock.calls[0][1];
  expect(api.put.mock.calls[0][1]).not.toHaveProperty('privateKey');

  const old: Message = { id: 'legacy-message', content: '', conversationId: 'group', senderId: sender, senderDeviceId: senderDevice,
    ciphertext: 'older-version', protocolVersion: 1 };
  api.get.mockResolvedValue({ data: { items: [{ ...old, recipients: [], devices: [{ userId: recipient, deviceId: receivingDevice, publicKey }] }], nextCursor: null } });
  await syncAuthoredHistory(sender, senderDevice, sign, async (message) => ({ ...message, content: 'Eski grup mesajı' }), controller.signal);
  const { delivery, version } = api.put.mock.calls[1][1];
  const repaired: Message = { ...old, historyDelivery: { ...delivery, version, target: old.id, signer,
    deviceKeys: { [receivingDevice]: { userId: recipient, key: delivery.deviceKeys[receivingDevice] } } } };
  await expect(recoverDeliveredHistoryMessage(recipient, repaired)).resolves.toMatchObject({ content: 'Eski grup mesajı' });
  await expect(recoverDeliveredHistoryMessage(sender, repaired)).resolves.toBeNull();
});
