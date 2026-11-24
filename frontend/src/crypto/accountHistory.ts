import { api } from '../api/httpClient';
import type { Message } from '../types/chat';
import {
  base64ToBytes, bytesToBase64, clearLegacyAccountHistoryKey, getStoredDeviceIdentity, isVaultUnlocked, listAllLocalMessages, readAccountHistoryKey,
  pinAccountHistoryBinding, readAccountHistoryUploadMarkers, readHistoryDevice, saveAccountHistoryKey, saveAccountHistoryUploadMarkers, saveHistoryDevice,
  forgetRememberedVaultSession, readRememberedVaultSession, saveRememberedVaultSession,
  type StoredMlsDelivery, type VaultMessageEntry
} from './vault';
import { computeSha256Hex } from './fileCrypto';

type PasswordEnvelope = { salt: string; iv: string; wrappedKey: string };
type RecoveryEnvelope = { publicKey: string; iv: string; payload: string };

interface WrappedKey extends PasswordEnvelope {
  revision: number;
  publicKey: string;
  inboxIv: string;
  inboxKey: string;
  vaultApproval?: { publicKey: string; privateKey: string; iv: string; issuerId: string; signature: string } | null;
  vaultRecovery?: RecoveryEnvelope | null;
}

type HistoryMessage = Pick<VaultMessageEntry, 'id' | 'conversationId' | 'ciphertext' | 'content' | 'encryptedFileMetadata'>;
type Copy = NonNullable<Message['accountHistoryCopy']>;
export type SyncedHistoryCopy = Copy & { messageId: string };
type HistoryRecipients = { recipients: { userId: string; publicKey: string }[]; devices?: { userId: string; deviceId: string; publicKey: string }[] };
type RepairCandidate = Message & HistoryRecipients;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_ENDPOINT = '/mls/account-history/key';

interface HistorySession {
  key: CryptoKey;
  inbox: CryptoKey;
  approval?: CryptoKey;
  vaultKeyBytes?: Uint8Array;
  signal: AbortSignal;
  pending: Map<string, HistoryMessage>;
  uploaded: Map<string, string>;
  recentCopies: Map<string, Copy>;
  timer?: ReturnType<typeof setTimeout>;
  flushing?: boolean;
  retryAt?: number;
  failures?: number;
}

const sessions = new Map<string, HistorySession>();
const cryptoBytes = (value: Uint8Array) => value as BufferSource;
const messageVersion = (ciphertext: string) => computeSha256Hex(encoder.encode(ciphertext));
const keyContext = (userId: string) => encoder.encode(JSON.stringify(['account-history-key-v1', userId]));
const copyContext = (userId: string, message: { id: string; conversationId: string }, version: string) =>
  encoder.encode(JSON.stringify(['account-history-message-v1', userId, message.conversationId, message.id, version]));
const aesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', cryptoBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
const rsa = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;
const inboxContext = (userId: string, publicKey: string) => encoder.encode(JSON.stringify(['account-history-inbox-v1', userId, publicKey]));
const deliveryParameters = (conversationId: string, senderId: string, target: string, version: string) =>
  ['account-history-delivery-v1', conversationId, senderId, target, version];

const generateInbox = async () => {
  const pair = await crypto.subtle.generateKey({ ...rsa, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  return {
    publicKey: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))),
    privateKey: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  };
};

const createInbox = async (userId: string, raw: Uint8Array) => {
  const { publicKey, privateKey } = await generateInbox();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const inboxKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: inboxContext(userId, publicKey) },
      await aesKey(raw), privateKey);
    return { publicKey, inboxIv: bytesToBase64(iv), inboxKey: bytesToBase64(new Uint8Array(inboxKey)) };
  } finally {
    privateKey.fill(0);
  }
};

const passwordKey = async (password: string, salt: Uint8Array) => {
  const bytes = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: cryptoBytes(salt), iterations: 600_000 },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally {
    bytes.fill(0);
  }
};

const wrapKey = async (userId: string, raw: Uint8Array, password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: keyContext(userId) },
    await passwordKey(password, salt), cryptoBytes(raw));
  return { salt: bytesToBase64(salt), iv: bytesToBase64(iv), wrappedKey: bytesToBase64(new Uint8Array(wrapped)) };
};

const unwrapKey = async (userId: string, wrapped: WrappedKey, password: string) => new Uint8Array(await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(wrapped.iv)), additionalData: keyContext(userId) },
  await passwordKey(password, base64ToBytes(wrapped.salt)), cryptoBytes(base64ToBytes(wrapped.wrappedKey))
));

export const prepareAccountHistoryPasswordChange = async (userId: string, oldPassword: string, newPassword: string) => {
  const { data } = await api.get<{ key: WrappedKey | null }>(KEY_ENDPOINT);
  if (!data.key || data.key.vaultApproval) return undefined;
  const raw = await unwrapKey(userId, data.key, oldPassword);
  try {
    return { ...await wrapKey(userId, raw, newPassword), revision: data.key.revision };
  } finally {
    raw.fill(0);
  }
};

const activateHistory = async (userId: string, raw: Uint8Array, privateKey: Uint8Array, signal: AbortSignal, approval?: CryptoKey) => {
  const [key, inbox] = await Promise.all([aesKey(raw), crypto.subtle.importKey('pkcs8', cryptoBytes(privateKey), rsa, false, ['decrypt'])]);
  signal.throwIfAborted();
  const previous = sessions.get(userId);
  previous?.vaultKeyBytes?.fill(0);
  const session: HistorySession = { key, inbox, approval, vaultKeyBytes: approval ? raw.slice() : undefined, signal,
    pending: new Map(), uploaded: new Map(), recentCopies: new Map() };
  sessions.set(userId, session);
  signal.addEventListener('abort', () => {
    if (session.timer) clearTimeout(session.timer);
    session.vaultKeyBytes?.fill(0);
    session.pending.clear();
    if (sessions.get(userId) === session) sessions.delete(userId);
  }, { once: true });
  void Promise.all([readAccountHistoryUploadMarkers(userId).catch(() => new Map<string, string>()), listAllLocalMessages(userId)])
    .then(([uploaded, messages]) => {
      if (sessions.get(userId) !== session) return;
      for (const [id, version] of uploaded) if (!session.uploaded.has(id)) session.uploaded.set(id, version);
      for (const message of messages) if (!session.pending.has(message.id)) queueAccountHistoryMessage(userId, message);
    }).catch(() => undefined);
};

export const openAccountHistory = async (userId: string, password: string | undefined, signal: AbortSignal) => {
  const local = await readAccountHistoryKey(userId).catch(() => null);
  let raw = local ? base64ToBytes(local.key) : null;
  let privateKey = local ? base64ToBytes(local.inboxKey) : null;
  try {
    if (!raw && password) {
      let { data: { key: wrapped } } = await api.get<{ key: WrappedKey | null }>(KEY_ENDPOINT, { signal });
      if (!wrapped) {
        const candidate = crypto.getRandomValues(new Uint8Array(32));
        try {
          const [envelope, inbox] = await Promise.all([wrapKey(userId, candidate, password), createInbox(userId, candidate)]);
          ({ data: { key: wrapped } } = await api.post<{ key: WrappedKey }>(KEY_ENDPOINT, { ...envelope, ...inbox, password }, { signal }));
        } finally {
          candidate.fill(0);
        }
      }
      if (wrapped) {
        raw = await unwrapKey(userId, wrapped, password);
        privateKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(wrapped.inboxIv)),
          additionalData: inboxContext(userId, wrapped.publicKey) }, await aesKey(raw), cryptoBytes(base64ToBytes(wrapped.inboxKey))));
      }
    }
    if (!raw || !privateKey) return false;
    signal.throwIfAborted();
    if (!local) await saveAccountHistoryKey(userId, { key: bytesToBase64(raw), inboxKey: bytesToBase64(privateKey) });
    await activateHistory(userId, raw, privateKey, signal);
    return true;
  } finally {
    raw?.fill(0);
    privateKey?.fill(0);
  }
};

const fetchWrappedKey = async (signal: AbortSignal) => (await api.get<{ key: WrappedKey | null }>(KEY_ENDPOINT, { signal })).data.key;

export const accountVaultMode = async (userId: string, signal: AbortSignal) => {
  const key = await fetchWrappedKey(signal);
  if (key?.vaultApproval) return 'unlock' as const;
  if (key && !await readAccountHistoryKey(userId).catch(() => null)) return 'migrate' as const;
  return 'setup' as const;
};

const authorityContext = (userId: string, publicKey: string) => encoder.encode(JSON.stringify(['account-vault-signing-key-v1', userId, publicKey]));

const recoveryContext = (userId: string, publicKey: string) =>
  encoder.encode(JSON.stringify(['account-vault-recovery-v1', userId, publicKey]));

const encodeRecoveryCode = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/, '');

export const generateAccountVaultRecoveryCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    return encodeRecoveryCode(bytes);
  } finally {
    bytes.fill(0);
  }
};

const recoveryCodeKey = async (code: string) => {
  const normalized = code.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) throw new Error('Kurtarma kodunu eksiksiz gir.');
  const bytes = base64ToBytes(normalized.replace(/-/g, '+').replace(/_/g, '/') + '=');
  try {
    if (encodeRecoveryCode(bytes) !== normalized) throw new Error('Kurtarma kodunu eksiksiz gir.');
    return await aesKey(bytes);
  } finally {
    bytes.fill(0);
  }
};

const wrapRecovery = async (userId: string, raw: Uint8Array, code: string): Promise<RecoveryEnvelope> => {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const secret = new Uint8Array(raw.length + privateKey.length);
  secret.set(raw);
  secret.set(privateKey, raw.length);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: recoveryContext(userId, publicKey) },
      await recoveryCodeKey(code), secret);
    return { publicKey, iv: bytesToBase64(iv), payload: bytesToBase64(new Uint8Array(encrypted)) };
  } finally {
    privateKey.fill(0);
    secret.fill(0);
  }
};

export const setupAccountVault = async (
  userId: string, passphrase: string, legacyPassword: string, issuerId: string, sign: SignHistory, signal: AbortSignal,
  recoveryCode?: string
) => {
  const previous = await fetchWrappedKey(signal);
  if (previous?.vaultApproval) return false;
  const local = previous && await readAccountHistoryKey(userId).catch(() => null);
  const raw = previous ? (local ? base64ToBytes(local.key) : await unwrapKey(userId, previous, legacyPassword)) : crypto.getRandomValues(new Uint8Array(32));
  let privateBytes: Uint8Array | undefined;
  try {
    if (previous) {
      const existingInbox = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(previous.inboxIv)),
        additionalData: inboxContext(userId, previous.publicKey) }, await aesKey(raw), cryptoBytes(base64ToBytes(previous.inboxKey))));
      existingInbox.fill(0);
    }
    const [envelope, inbox, pair, recovery] = await Promise.all([
      wrapKey(userId, raw, passphrase),
      previous ?? createInbox(userId, raw),
      crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as Promise<CryptoKeyPair>,
      recoveryCode ? wrapRecovery(userId, raw, recoveryCode) : undefined
    ]);
    const publicKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: authorityContext(userId, publicKey) }, await aesKey(raw), cryptoBytes(privateBytes));
    const authorityFields = [userId, issuerId, inbox.publicKey, publicKey];
    const signature = bytesToBase64(await sign(encoder.encode(JSON.stringify(['account-vault-authority-v1', ...authorityFields]))));
    const authority = { issuerId, publicKey, signature, iv: bytesToBase64(iv), privateKey: bytesToBase64(new Uint8Array(sealed)) };
    const revision = previous?.revision ?? 0;
    const proof = bytesToBase64(await sign(encoder.encode(JSON.stringify(['account-vault-setup-v1', ...authorityFields, revision,
      envelope.salt, envelope.iv, envelope.wrappedKey, inbox.inboxIv, inbox.inboxKey, authority.iv, authority.privateKey, signature,
      ...(recovery ? [recovery.publicKey, recovery.iv, recovery.payload] : [])]))));
    await api.post('/mls/account-history/vault', { ...envelope, publicKey: inbox.publicKey, inboxIv: inbox.inboxIv, inboxKey: inbox.inboxKey,
      revision, authority, proof, ...(recovery && { recovery }) }, { signal });
    return true;
  } finally {
    raw.fill(0);
    privateBytes?.fill(0);
  }
};

const openVaultAuthority = async (userId: string, authority: NonNullable<WrappedKey['vaultApproval']>, key: CryptoKey) => {
  const signing = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(authority.iv)), additionalData: authorityContext(userId, authority.publicKey) },
    key, cryptoBytes(base64ToBytes(authority.privateKey))
  ));
  try {
    return await crypto.subtle.importKey('pkcs8', cryptoBytes(signing), 'Ed25519', false, ['sign']);
  } finally {
    signing.fill(0);
  }
};

const openAccountVaultWithKey = async (userId: string, wrapped: WrappedKey, raw: Uint8Array, signal: AbortSignal) => {
  const authority = wrapped?.vaultApproval;
  if (!authority) throw new Error('Hesap kasası oluşturulmamış.');
  let inbox: Uint8Array | undefined;
  try {
    const key = await aesKey(raw);
    inbox = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(wrapped.inboxIv)),
      additionalData: inboxContext(userId, wrapped.publicKey) }, key, cryptoBytes(base64ToBytes(wrapped.inboxKey))));
    const approval = await openVaultAuthority(userId, authority, key);
    await activateHistory(userId, raw, inbox, signal, approval);
    await clearLegacyAccountHistoryKey(userId).catch(() => undefined);
  } finally {
    inbox?.fill(0);
  }
};

export const unlockAccountVault = async (userId: string, passphrase: string, signal: AbortSignal) => {
  const wrapped = await fetchWrappedKey(signal);
  if (!wrapped?.vaultApproval) throw new Error('Hesap kasası oluşturulmamış.');
  const raw = await unwrapKey(userId, wrapped, passphrase);
  try {
    await openAccountVaultWithKey(userId, wrapped, raw, signal);
    return wrapped.revision;
  } finally {
    raw.fill(0);
  }
};

export const rememberAccountVault = async (userId: string, sessionId: string, deviceId: string, revision: number) => {
  const session = sessions.get(userId);
  if (!session?.vaultKeyBytes || session.signal.aborted) return;
  await saveRememberedVaultSession(userId, sessionId, { deviceId, revision, wrappedByDeviceVault: bytesToBase64(session.vaultKeyBytes) });
  if (session.signal.aborted) await forgetRememberedVaultSession(userId, sessionId);
};

export const resumeAccountVault = async (
  userId: string, sessionId: string, deviceId: string, signal: AbortSignal
) => {
  const remembered = await readRememberedVaultSession(userId, sessionId);
  if (!remembered || remembered.deviceId !== deviceId) return false;
  const vault = await fetchWrappedKey(signal);
  if (!vault?.vaultApproval || vault.revision !== remembered.revision) return false;
  const raw = base64ToBytes(remembered.wrappedByDeviceVault);
  try {
    await openAccountVaultWithKey(userId, vault, raw, signal);
    return true;
  } finally {
    raw.fill(0);
  }
};

const updateVaultAccess = async (
  userId: string, revision: number, approval: CryptoKey, sign: SignHistory, signal: AbortSignal,
  method: { method: 'device'; deviceId: string } | { method: 'recovery' },
  password?: PasswordEnvelope, recovery?: RecoveryEnvelope
) => {
  const fields = ['account-vault-access-v1', userId, revision, method.method, 'deviceId' in method ? method.deviceId : null,
    password ? [password.salt, password.iv, password.wrappedKey] : null,
    recovery ? [recovery.publicKey, recovery.iv, recovery.payload] : null];
  const bytes = encoder.encode(JSON.stringify(fields));
  const [proof, authorization] = await Promise.all([crypto.subtle.sign('Ed25519', approval, bytes), sign(bytes)]);
  signal.throwIfAborted();
  await api.put('/mls/account-history/vault/access', {
    ...method, revision, password, recovery, proof: bytesToBase64(new Uint8Array(proof)), authorization: bytesToBase64(authorization)
  }, { signal });
};

export const updateVaultAccessFromDevice = async (
  userId: string, deviceId: string, sign: SignHistory, changes: { passphrase?: string; recoveryCode?: string }
) => {
  const session = sessions.get(userId);
  if (!session?.approval || !session.vaultKeyBytes || session.signal.aborted) {
    throw new Error('Bu cihazda kasayı açıp tekrar dene.');
  }
  const raw = session.vaultKeyBytes.slice();
  try {
    const vault = await fetchWrappedKey(session.signal);
    if (!vault?.vaultApproval) throw new Error('Kasa bilgileri alınamadı.');
    const password = changes.passphrase ? await wrapKey(userId, raw, changes.passphrase) : undefined;
    const recovery = changes.recoveryCode ? await wrapRecovery(userId, raw, changes.recoveryCode) : undefined;
    await updateVaultAccess(userId, vault.revision, session.approval, sign, session.signal, { method: 'device', deviceId }, password, recovery);
  } finally {
    raw.fill(0);
  }
};

export const recoverAccountVault = async (
  userId: string, oldCode: string, passphrase: string, nextCode: string, signal: AbortSignal
) => {
  const vault = await fetchWrappedKey(signal);
  const previous = vault?.vaultRecovery;
  if (!vault?.vaultApproval || !previous) throw new Error('Bu hesap için kayıtlı kasa kurtarma kodu bulunamadı.');

  const codeKey = await recoveryCodeKey(oldCode);
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(previous.iv)), additionalData: recoveryContext(userId, previous.publicKey)
    }, codeKey, cryptoBytes(base64ToBytes(previous.payload))));
  } catch {
    throw new Error('Kurtarma kodu kasayı açamadı. En son kaydettiğin kodu kontrol et.');
  }
  try {
    const raw = secret.subarray(0, 32);
    const recoverySigner = await crypto.subtle.importKey('pkcs8', cryptoBytes(secret.subarray(32)), 'Ed25519', false, ['sign']);
    const approval = await openVaultAuthority(userId, vault.vaultApproval, await aesKey(raw));
    const password = await wrapKey(userId, raw, passphrase);
    const recovery = await wrapRecovery(userId, raw, nextCode);
    await updateVaultAccess(userId, vault.revision, approval, async (bytes) =>
      new Uint8Array(await crypto.subtle.sign('Ed25519', recoverySigner, cryptoBytes(bytes))), signal, { method: 'recovery' }, password, recovery);
  } finally {
    secret.fill(0);
  }
};

export const approveDeviceWithAccountVault = async (userId: string, deviceId: string, publicKey: string, signal: AbortSignal) => {
  const approval = sessions.get(userId)?.approval;
  if (!approval) throw new Error('Kasa anahtarı bulunamadı.');
  const input = encoder.encode(JSON.stringify(['account-vault-device-v1', userId, deviceId, publicKey]));
  const signature = await crypto.subtle.sign('Ed25519', approval, input);
  await api.post('/mls/account-history/approve-device', { deviceId, signature: bytesToBase64(new Uint8Array(signature)) }, { signal });
};

const schedule = (userId: string, session: HistorySession, delay: number) => {
  if (session.signal.aborted || session.timer || session.flushing || !session.pending.size) return;
  session.timer = setTimeout(() => {
    session.timer = undefined;
    void flush(userId, session);
  }, Math.max(delay, (session.retryAt ?? 0) - Date.now()));
};

const flush = async (userId: string, session: HistorySession) => {
  if (session.signal.aborted || !isVaultUnlocked(userId)) return;
  if ((session.retryAt ?? 0) > Date.now()) {
    schedule(userId, session, 0);
    return;
  }
  session.flushing = true;
  let delay = 1_500;
  try {
    const entries: (Copy & { messageId: string })[] = [];
    const sent: HistoryMessage[] = [];
    let size = 0;
    for (const message of session.pending.values()) {
      const version = await messageVersion(message.ciphertext!);
      if (session.uploaded.get(message.id) === version) {
        if (session.pending.get(message.id) === message) session.pending.delete(message.id);
        continue;
      }
      const bytes = encoder.encode(JSON.stringify({ content: message.content, encryptedFileMetadata: message.encryptedFileMetadata ?? null }));
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: copyContext(userId, message, version) }, session.key, bytes);
        const payload = bytesToBase64(new Uint8Array(sealed));
        if (payload.length > 60_000) {
          if (session.pending.get(message.id) === message) session.pending.delete(message.id);
          continue;
        }
        if (size + payload.length > 85_000) break;
        entries.push({ messageId: message.id, version, payload, iv: bytesToBase64(iv) });
        sent.push(message);
        size += payload.length;
        if (entries.length === 24) break;
      } finally {
        bytes.fill(0);
      }
    }
    if (!entries.length || session.signal.aborted) return;
    const { data } = await api.put<{ accepted: { messageId: string; version: string }[] }>('/mls/account-history/messages', { entries }, { signal: session.signal });
    session.retryAt = undefined;
    session.failures = 0;
    for (const message of sent) if (session.pending.get(message.id) === message) session.pending.delete(message.id);
    for (const { messageId, version } of data.accepted) session.uploaded.set(messageId, version);
    if (!session.signal.aborted) await saveAccountHistoryUploadMarkers(userId, data.accepted);
  } catch (error) {
    if (session.signal.aborted) return;
    session.failures = (session.failures ?? 0) + 1;
    const response = (error as { response?: { status?: number; headers?: Record<string, string> } })?.response;
    const header = response?.headers?.['retry-after'];
    const seconds = Number(header);
    const retryAfter = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()) : 0;
    const backoff = Math.min(300_000, 15_000 * 2 ** (session.failures - 1));
    delay = Math.max(backoff, Number.isFinite(retryAfter) ? retryAfter : 0, response?.status === 429 ? 60_000 : 0);
    session.retryAt = Date.now() + delay;
  } finally {
    session.flushing = false;
    schedule(userId, session, delay);
  }
};

export const queueAccountHistoryMessage = (userId: string, message: HistoryMessage) => {
  const session = sessions.get(userId);
  if (!session || session.signal.aborted || !message.ciphertext) return;
  session.pending.set(message.id, message);
  schedule(userId, session, 1_500);
};

export const syncAccountHistoryBeforeLogout = async (userId: string) => {
  const session = sessions.get(userId);
  if (!session || !session.pending.size) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.flushing ? new Promise<void>(() => undefined) : flush(userId, session),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 1_500); })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const receiveAccountHistoryCopies = (userId: string, copies: SyncedHistoryCopy[]) => {
  const session = sessions.get(userId);
  if (!session || session.signal.aborted) return;
  for (const { messageId, ...copy } of copies) session.recentCopies.set(messageId, copy);
  while (session.recentCopies.size > 100) {
    const oldest = session.recentCopies.keys().next().value;
    if (!oldest) break;
    session.recentCopies.delete(oldest);
  }
};

export const recoverAccountHistoryMessage = async (userId: string, message: Message) => {
  const session = sessions.get(userId);
  if (!session || session.signal.aborted || !message.ciphertext) return null;
  const alternatives = [message.accountHistoryCopy, session.recentCopies.get(message.id)];
  if (!alternatives.some(Boolean)) return null;
  try {
    const version = await messageVersion(message.ciphertext);
    const copy = alternatives.find((entry) => entry?.version === version);
    if (!copy) return null;
    const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(copy.iv)),
      additionalData: copyContext(userId, message, copy.version) }, session.key, cryptoBytes(base64ToBytes(copy.payload))));
    try {
      const restored = JSON.parse(decoder.decode(bytes)) as Pick<VaultMessageEntry, 'content' | 'encryptedFileMetadata'>;
      return !session.signal.aborted && typeof restored.content === 'string' ? restored : null;
    } finally {
      bytes.fill(0);
    }
  } catch {
    return null;
  }
};

type SignHistory = (bytes: Uint8Array) => Promise<Uint8Array>;

export const registerHistoryDevice = async (userId: string, deviceId: string, sign: SignHistory, signal: AbortSignal) => {
  const provision = async () => {
    let keys = await readHistoryDevice(userId, deviceId);
    if (!keys) {
      const { publicKey, privateKey } = await generateInbox();
      try {
        signal.throwIfAborted();
        keys = { publicKey, privateKey: bytesToBase64(privateKey) };
        await saveHistoryDevice(userId, deviceId, keys);
      } finally {
        privateKey.fill(0);
      }
    }
    const signature = await sign(encoder.encode(JSON.stringify(['account-history-device-v1', userId, deviceId, keys.publicKey])));
    await api.put('/mls/account-history/device', { deviceId, publicKey: keys.publicKey, signature: bytesToBase64(signature) }, { signal });
  };
  return navigator.locks ? navigator.locks.request(`history-device:${userId}:${deviceId}`, { signal }, provision) : provision();
};

export const createAccountHistoryDelivery = async (userId: string, item: StoredMlsDelivery, sign: SignHistory, repairRecipients?: HistoryRecipients) => {
  const data = repairRecipients ?? (await api.get<HistoryRecipients>(`/mls/account-history/recipients/${item.conversationId}`, {
    params: { messageId: item.editId }
  })).data;
  const version = await messageVersion(item.ciphertext);
  const parameters = deliveryParameters(item.conversationId, userId, item.editId ?? item.clientId, version);
  const context = encoder.encode(JSON.stringify(parameters));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const bytes = encoder.encode(JSON.stringify({ content: item.content, encryptedFileMetadata: item.encryptedFileMetadata ?? null }));
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, await aesKey(raw), bytes);
    const payload = bytesToBase64(new Uint8Array(sealed));
    const encodedIv = bytesToBase64(iv);
    const wrapFor = async (id: string, publicKey: string) => {
      if (!await pinAccountHistoryBinding(userId, 'recipient', id, publicKey)) {
        throw new Error('Alıcının şifreli geçmiş anahtarı değişti.');
      }
      const key = await crypto.subtle.importKey('spki', cryptoBytes(base64ToBytes(publicKey)), rsa, false, ['encrypt']);
      const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label: context }, key, raw);
      return bytesToBase64(new Uint8Array(wrapped));
    };
    const [keys, deviceKeys] = await Promise.all([
      Promise.all(data.recipients.map(async ({ userId, publicKey }) => [userId, await wrapFor(userId, publicKey)] as const)),
      Promise.all((data.devices ?? []).map(async ({ deviceId, publicKey }) => [deviceId, await wrapFor(`device:${deviceId}`, publicKey)] as const))
    ]);
    const signature = await sign(encoder.encode(JSON.stringify([...parameters, encodedIv, payload])));
    return { iv: encodedIv, payload, keys: Object.fromEntries(keys), deviceKeys: Object.fromEntries(deviceKeys), signature: bytesToBase64(signature) };
  } finally {
    raw.fill(0);
    bytes.fill(0);
  }
};

export const syncAuthoredHistory = async (userId: string, deviceId: string, sign: SignHistory, read: (message: Message) => Promise<Message>, signal: AbortSignal) => {
  let cursor: string | null = null;
  do {
    const page: { data: { items: RepairCandidate[]; nextCursor: string | null } } = await api.get('/mls/account-history/repair', { signal, params: { deviceId, cursor } });
    for (const message of page.data.items) {
      signal.throwIfAborted();
      if (!message.ciphertext) continue;
      const opened = await read({ ...message, content: '' }).catch(() => null);
      if (!opened || opened.decryptionPending) continue;
      const delivery = await createAccountHistoryDelivery(userId, {
        ciphertext: message.ciphertext, content: opened.content, conversationId: message.conversationId,
        clientId: message.clientId ?? message.id, editId: message.editedAt ? message.id : undefined,
        senderDeviceId: deviceId, epoch: message.epoch ?? 1,
        encryptedFileMetadata: opened.encryptedFileMetadata ? JSON.parse(opened.encryptedFileMetadata) : null
      }, sign, message).catch(() => null);
      if (!delivery) continue;
      await api.put(`/mls/account-history/repair/${message.id}`, { deviceId, version: await messageVersion(message.ciphertext), delivery }, { signal });
    }
    cursor = page.data.nextCursor;
  } while (cursor && !signal.aborted);
};

export const recoverDeliveredHistoryMessage = async (userId: string, message: Message) => {
  const session = sessions.get(userId);
  const envelope = message.historyDelivery;
  if (!isVaultUnlocked(userId) || !envelope || !message.ciphertext || !message.senderDeviceId) return null;
  let raw: Uint8Array | undefined;
  let bytes: Uint8Array | undefined;
  try {
    const target = message.editedAt ? message.id : message.clientId ?? message.id;
    if (envelope.target !== target || envelope.version !== await messageVersion(message.ciphertext)) return null;
    const parameters = deliveryParameters(message.conversationId, message.senderId, target, envelope.version);
    const context = encoder.encode(JSON.stringify(parameters));
    const signer = await crypto.subtle.importKey('raw', cryptoBytes(base64ToBytes(envelope.signer)), 'Ed25519', false, ['verify']);
    const signed = encoder.encode(JSON.stringify([...parameters, envelope.iv, envelope.payload]));
    if (!await crypto.subtle.verify('Ed25519', signer, cryptoBytes(base64ToBytes(envelope.signature)), signed)) return null;
    const accountKey = !session?.signal.aborted && (envelope.key ?? envelope.keys?.[userId]);
    if (session && accountKey) {
      raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP', label: context }, session.inbox, cryptoBytes(base64ToBytes(accountKey)))
        .then((value) => new Uint8Array(value)).catch(() => undefined);
    }
    if (!raw && envelope.deviceKeys) {
      const identity = await getStoredDeviceIdentity(userId);
      const wrapped = identity && envelope.deviceKeys[identity.deviceId];
      if (!identity || !wrapped || wrapped.userId !== userId) return null;
      const device = await readHistoryDevice(userId, identity.deviceId);
      if (!device) return null;
      const encoded = base64ToBytes(device.privateKey);
      try {
        const inbox = await crypto.subtle.importKey('pkcs8', cryptoBytes(encoded), rsa, false, ['decrypt']);
        raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP', label: context }, inbox, cryptoBytes(base64ToBytes(wrapped.key))));
      } finally {
        encoded.fill(0);
      }
    }
    if (!raw) return null;
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cryptoBytes(base64ToBytes(envelope.iv)), additionalData: context },
      await aesKey(raw), cryptoBytes(base64ToBytes(envelope.payload))));
    const restored = JSON.parse(decoder.decode(bytes)) as Pick<VaultMessageEntry, 'content' | 'encryptedFileMetadata'>;
    const senderMatches = isVaultUnlocked(userId) && typeof restored.content === 'string' &&
      await pinAccountHistoryBinding(userId, 'device', message.senderDeviceId, envelope.signer);
    return senderMatches ? restored : null;
  } catch {
    return null;
  } finally {
    raw?.fill(0);
    bytes?.fill(0);
  }
};
