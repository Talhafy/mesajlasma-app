/**
 * ============================================================================
 * RFC 9420 MLS (MESSAGING LAYER SECURITY) İSTEMCİ MOTORU (`ts-mls` Tek Kaynak)
 * ============================================================================
 *
 * Bu modül, IETF RFC 9420 (Messaging Layer Security) standardını uygulayan
 * `ts-mls` kütüphanesi (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`) üzerine
 * tek gerçek protokol kaynağı (single source of truth) olarak inşa edilmiştir:
 *
 * 1. `generateKeyPackageWithKey`, `encodeKeyPackage`, `decodeKeyPackage`, `verifyKeyPackage`
 *    ile gerçek RFC 9420 TLS ikili formatında (`tlsKeyPackageBase64`) ve tek kullanımlık
 *    (ephemeral) `X25519` `initKey` + `LeafNode` `encryptionKey` içeren `KeyPackage`
 *    paketleri üretir; `Lifetime` (`notBefore` / `notAfter`) ve `BasicCredential`
 *    (`userId:deviceId`) doğrulaması yapar.
 * 2. `createGroup`, `createCommit` (`ProposalAdd` / `ProposalRemove` + `ratchetTreeExtension`),
 *    `joinGroup`, `processMessage` ile tam RFC 9420 `TreeKEM`,
 *    `GroupContext`, `confirmedTranscriptHash`, `interimTranscriptHash` ve `ConfirmationTag`
 *    durum makinesini yürütür.
 * 3. `Welcome` paketleri yalnızca gruba yeni eklenen cihazlara gönderilir; mevcut üyeler
 *    yalnızca `Commit` (`MLSMessage`) paketini `processMessage` ile işler ve mevcut üyelerin
 *    `KeyPackage` havuzu rotasyon sırasında tüketilmez.
 * 4. `Welcome` doğrulaması ve `joinGroup` başarıyla tamamlandıktan sonra tek kullanımlık
 *    `PrivateKeyPackage` özel anahtarları yerel kasadan kalıcı olarak silinir ve bellekte
 *    `zeroOutUint8Array` ile sıfırlanır (Forward Secrecy).
 * 5. `createApplicationMessage` ve `unprotectPrivateMessage` ile doğrudan `ts-mls`
 *    `PrivateMessage` (`SecretTree` + `encryptedSenderData` + `FramedContentAuthData`
 *    `Ed25519` gönderici imzası) üretilir ve çözülür.
 * 6. Sohbet başına asenkron kilit (`withConversationMlsLock`) ile paralel Socket.IO ve
 *    kullanıcı işlemlerinde yarış durumu (race condition) engellenir.
 */

import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  mlsExporter,
  processMessage,
  zeroOutUint8Array,
  type CiphersuiteImpl,
  type ClientState,
  type KeyPackage as TsMlsKeyPackage,
  type PrivateKeyPackage as TsMlsPrivateKeyPackage,
  type Proposal
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { unprotectPrivateMessage } from 'ts-mls/messageProtection.js';
import {
  decodeKeyPackage,
  encodeKeyPackage,
  verifyKeyPackage as verifyTsMlsKeyPackage
} from 'ts-mls/keyPackage.js';
import {
  decodePrivateMessage,
  encodePrivateMessage
} from 'ts-mls/privateMessage.js';
import { toLeafIndex } from 'ts-mls/treemath.js';
import {
  decodeWelcome,
  encodeWelcome
} from 'ts-mls/welcome.js';
import { api } from '../api/httpClient';
import type { Message } from '../types/chat';
import {
  base64ToBytes,
  bytesToBase64,
  cacheDecryptedMessage,
  getCachedDecryptedMessage,
  getCachedOutgoingPlaintextByCiphertext,
  getConversationMlsState,
  getStoredDeviceIdentity,
  peekEphemeralKeyPackageBundle,
  pinAccountRoot,
  isVaultUnlocked,
  readPendingMlsCommit,
  savePendingMlsCommit,
  readQueuedMlsDelivery,
  removeQueuedMlsDelivery,
  listQueuedMlsDeliveries,
  type MlsDeliveryFields,
  type StoredMlsDelivery,
  saveConversationMlsState,
  saveDeviceIdentity,
  saveEphemeralKeyPackageKey,
  type EncryptedFileMetadata,
  type MlsRatchetNode,
  type StoredConversationMlsState,
  type StoredDeviceIdentity
} from './vault';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const MLS_CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const;

let cachedCiphersuitePromise: Promise<CiphersuiteImpl> | null = null;

/**
 * `ts-mls` RFC 9420 Ciphersuite (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`)
 * somutlaştırmasını tekil (singleton) olarak döner.
 */
export const getTsMlsCiphersuite = (): Promise<CiphersuiteImpl> => {
  if (!cachedCiphersuitePromise) {
    cachedCiphersuitePromise = getCiphersuiteImpl(
      getCiphersuiteFromName(MLS_CIPHERSUITE_NAME)
    );
  }
  return cachedCiphersuitePromise;
};

const mlsConfig = {
  ...defaultClientConfig,
  keyRetentionConfig: { ...defaultClientConfig.keyRetentionConfig, retainKeysForEpochs: 0 }
};

export const serializeTsMlsClientState = (state: ClientState): string => {
  return bytesToBase64(encodeGroupState(state));
};

export const deserializeTsMlsClientState = (base64: string): ClientState => {
  const decoded = decodeGroupState(base64ToBytes(base64), 0);
  if (!decoded) {
    throw new Error('ts-mls GroupState çözümlenemedi.');
  }
  return {
    ...decoded[0],
    clientConfig: mlsConfig
  };
};

/**
 * Sohbet başına asenkron işlem kuyruğu (Mutex - H4):
 * Paralel Socket.IO olayları (`mls:commit`, `mls:welcome`, `yeni_mesaj_geldi`) ve
 * mesaj gönderme çağrılarının aynı konuşmanın `ClientState` kaydını ezmesini önler.
 */
const conversationLocks = new Map<string, Promise<unknown>>();

const withConversationMlsLock = async <T>(
  userId: string,
  conversationId: string,
  task: () => Promise<T>
): Promise<T> => {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(JSON.stringify(['mls', userId, conversationId]), task);
  }
  if (typeof indexedDB !== 'undefined') throw new Error('Bu tarayıcı güvenli sekme kilidini desteklemiyor.');
  const lockKey = `${userId}:${conversationId}`;
  const previous = conversationLocks.get(lockKey) || Promise.resolve();
  let release!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => currentGate);
  conversationLocks.set(lockKey, chained);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (conversationLocks.get(lockKey) === chained) {
      conversationLocks.delete(lockKey);
    }
  }
};

export interface SignedKeyPackagePayload {
  keyPackageRef: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  signaturePublicKeyBase64: string;
  hpkePublicKeyBase64: string;
  /** `ts-mls` `encodeKeyPackage(publicPackage)` TLS ikili verisinin Base64 karşılığı (Zorunlu) */
  tlsKeyPackageBase64: string;
  issuedAt: string;
  signatureBase64: string;
}

export interface MlsCommitWirePayload {
  version: 2;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  /** `ts-mls` `encodeMlsMessage(commitResult.commit)` TLS ikili verisinin Base64 karşılığı */
  tsMlsCommitBase64: string;
}

export interface MlsWelcomeWirePayload {
  version: 2;
  groupId: string;
  conversationId: string;
  epoch: number;
  senderDeviceId: string;
  keyPackageRef: string;
  /** `ts-mls` `encodeWelcome(commitResult.welcome)` TLS ikili verisinin Base64 karşılığı */
  tsMlsWelcomeBase64: string;
}

export interface MlsApplicationPlaintext {
  binding: { conversationId: string; clientId: string; kind: 'message' | 'edit'; editId?: string };
  content: string;
  encryptedFileMetadata?: EncryptedFileMetadata | null;
}

// ============================================================================
// 1. CİHAZ KİMLİĞİ VE RFC 9420 KEYPACKAGE ÜRETİMİ / DOĞRULAMASI (`ts-mls`)
// ============================================================================

const sha256Bytes = async (data: Uint8Array): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(digest);
};

const computeSafetyFingerprint = async (
  sigPubBase64: string,
  hpkePubBase64: string
): Promise<string> => {
  const combined = textEncoder.encode(`${sigPubBase64}:${hpkePubBase64}`);
  const digest = await sha256Bytes(combined);
  const groups: string[] = [];
  for (let i = 0; i < 24; i += 2) {
    const val = ((digest[i] << 8) | digest[i + 1]) % 100000;
    groups.push(String(val).padStart(5, '0'));
  }
  return groups.join(' ');
};

export const generateEphemeralX25519KeyPair = async (): Promise<{
  publicKeyBase64: string;
  privateKeyPkcs8Base64: string;
}> => {
  const cs = await getTsMlsCiphersuite();
  const kp = await cs.hpke.generateKeyPair();
  const pubRaw = await cs.hpke.exportPublicKey(kp.publicKey);
  const privRaw = await cs.hpke.exportPrivateKey(kp.privateKey);
  return {
    publicKeyBase64: bytesToBase64(pubRaw),
    privateKeyPkcs8Base64: bytesToBase64(privRaw)
  };
};

/**
 * Yeni bir cihaz için `ts-mls` Ciphersuite (`Ed25519` + `DHKEM-X25519`) kimlik anahtarlarını üretir.
 */
export const generateDeviceCryptoIdentity = async (
  userId: string,
  deviceName: string,
  deviceId: string = crypto.randomUUID()
): Promise<StoredDeviceIdentity> => {
  const cs = await getTsMlsCiphersuite();
  const sigKeyPair = await cs.signature.keygen();
  const initPair = await generateEphemeralX25519KeyPair();

  const signaturePublicKeyBase64 = bytesToBase64(sigKeyPair.publicKey);
  const signaturePrivateKeyPkcs8Base64 = bytesToBase64(sigKeyPair.signKey);
  const safetyFingerprint = await computeSafetyFingerprint(
    signaturePublicKeyBase64,
    initPair.publicKeyBase64
  );

  const credentialJson = JSON.stringify({
    credentialType: 'BasicCredential',
    cipherSuite: MLS_CIPHERSUITE_NAME,
    engine: 'ts-mls/RFC9420',
    userId,
    deviceId,
    deviceName,
    signaturePublicKeyBase64,
    safetyFingerprint
  });

  return {
    userId,
    deviceId,
    deviceName,
    signaturePublicKeyBase64,
    signaturePrivateKeyPkcs8Base64,
    initPublicKeyBase64: initPair.publicKeyBase64,
    initPrivateKeyPkcs8Base64: initPair.privateKeyPkcs8Base64,
    credentialJson,
    safetyFingerprint,
    createdAt: new Date().toISOString()
  };
};

/**
 * `ts-mls` `generateKeyPackageWithKey` kullanarak her KeyPackage için gerçek RFC 9420
 * `KeyPackage` (`initKey` + `LeafNode` `encryptionKey` + `KeyPackageTBS` `Ed25519` imzası) üretir;
 * `PrivateKeyPackage` özel anahtarlarını şifreli yerel kasaya kaydeder ve bellekte sıfırlar.
 */
export const generateSignedKeyPackages = async (
  identity: StoredDeviceIdentity,
  count: number = 10
): Promise<Array<{ keyPackageRef: string; keyPackage: string }>> => {
  const cs = await getTsMlsCiphersuite();
  const signKeyBytes = base64ToBytes(identity.signaturePrivateKeyPkcs8Base64);
  const publicKeyBytes = base64ToBytes(identity.signaturePublicKeyBase64);
  const credential = {
    credentialType: 'basic' as const,
    identity: textEncoder.encode(`${identity.userId}:${identity.deviceId}`)
  };

  const packages: Array<{ keyPackageRef: string; keyPackage: string }> = [];
  for (let i = 0; i < count; i++) {
    const keyPackageRef = `kp_${identity.deviceId.slice(0, 8)}_${crypto.randomUUID()}`;
    const generated = await generateKeyPackageWithKey(
      credential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      {
        signKey: new Uint8Array(signKeyBytes),
        publicKey: new Uint8Array(publicKeyBytes)
      },
      cs
    );

    const tlsKeyPackageBytes = encodeKeyPackage(generated.publicPackage);
    const tlsKeyPackageBase64 = bytesToBase64(tlsKeyPackageBytes);
    const initPublicKeyBase64 = bytesToBase64(generated.publicPackage.initKey);
    const initPrivateKeyBase64 = bytesToBase64(generated.privatePackage.initPrivateKey);
    const hpkePrivateKeyBase64 = bytesToBase64(generated.privatePackage.hpkePrivateKey);
    const sigPrivateKeyBase64 = bytesToBase64(generated.privatePackage.signaturePrivateKey);

    await saveEphemeralKeyPackageKey(identity.userId, keyPackageRef, initPrivateKeyBase64, {
      publicKeyPackageBase64: tlsKeyPackageBase64,
      initPrivateKeyBase64,
      hpkePrivateKeyBase64,
      signaturePrivateKeyBase64: sigPrivateKeyBase64
    });

    zeroOutUint8Array(generated.privatePackage.initPrivateKey);
    zeroOutUint8Array(generated.privatePackage.hpkePrivateKey);

    const issuedAt = new Date().toISOString();
    const canonicalToSign = textEncoder.encode(
      `MLS-KeyPackage-v2:${keyPackageRef}:${identity.userId}:${identity.deviceId}:${initPublicKeyBase64}:${issuedAt}`
    );
    const sigBytes = await cs.signature.sign(signKeyBytes, canonicalToSign);

    const payload: SignedKeyPackagePayload = {
      keyPackageRef,
      userId: identity.userId,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      signaturePublicKeyBase64: identity.signaturePublicKeyBase64,
      hpkePublicKeyBase64: initPublicKeyBase64,
      tlsKeyPackageBase64,
      issuedAt,
      signatureBase64: bytesToBase64(sigBytes)
    };

    packages.push({
      keyPackageRef,
      keyPackage: JSON.stringify(payload)
    });
  }
  return packages;
};

/**
 * Alınan bir KeyPackage'ın:
 * 1. `tlsKeyPackageBase64` ve `keyPackageRef` alanlarının zorunlu olarak bulunduğunu (M3 - downgrade engeli),
 * 2. Beklenen `userId`, `deviceId` ve `signaturePublicKeyBase64` ile eşleştiğini,
 * 3. `ts-mls` `decodeKeyPackage` + `verifyKeyPackage` ile gerçek RFC 9420 `KeyPackageTBS`
 *    imzasını, `Lifetime` geçerlilik süresini (`notBefore <= now <= notAfter`) ve
 *    `LeafNode` `BasicCredential` kimliğini (`userId:deviceId`),
 * 4. Dış `MLS-KeyPackage-v2` `Ed25519` imzasını
 * doğrular.
 */
export const verifySignedKeyPackage = async (
  pkg: SignedKeyPackagePayload,
  expectedUserId?: string,
  expectedDeviceId?: string,
  expectedSignaturePublicKeyBase64?: string
): Promise<boolean> => {
  try {
    if (!pkg || !pkg.tlsKeyPackageBase64 || !pkg.keyPackageRef) {
      return false;
    }
    if (expectedUserId && pkg.userId !== expectedUserId) return false;
    if (expectedDeviceId && pkg.deviceId !== expectedDeviceId) return false;
    if (
      expectedSignaturePublicKeyBase64 &&
      pkg.signaturePublicKeyBase64 !== expectedSignaturePublicKeyBase64
    ) {
      return false;
    }

    const cs = await getTsMlsCiphersuite();

    // 1. ts-mls RFC 9420 KeyPackageTBS, Lifetime ve Credential doğrulaması
    const decoded = decodeKeyPackage(base64ToBytes(pkg.tlsKeyPackageBase64), 0);
    if (!decoded) return false;
    const tsMlsKp = decoded[0];

    const isRfc9420Valid = await verifyTsMlsKeyPackage(tsMlsKp, cs.signature);
    if (!isRfc9420Valid) return false;

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const lifetime = tsMlsKp.leafNode.lifetime;
    if (nowSeconds < lifetime.notBefore || nowSeconds > lifetime.notAfter) {
      return false;
    }

    if (bytesToBase64(tsMlsKp.initKey) !== pkg.hpkePublicKeyBase64) {
      return false;
    }
    if (bytesToBase64(tsMlsKp.leafNode.signaturePublicKey) !== pkg.signaturePublicKeyBase64) {
      return false;
    }
    if (tsMlsKp.leafNode.credential.credentialType !== 'basic') {
      return false;
    }
    const credIdentity = textDecoder.decode(tsMlsKp.leafNode.credential.identity);
    if (credIdentity !== `${pkg.userId}:${pkg.deviceId}`) {
      return false;
    }

    // 2. Dış v2 Ed25519 kimlik bağlama imzası doğrulaması (v1 kabul edilmez - M3)
    const canonicalV2 = textEncoder.encode(
      `MLS-KeyPackage-v2:${pkg.keyPackageRef}:${pkg.userId}:${pkg.deviceId}:${pkg.hpkePublicKeyBase64}:${pkg.issuedAt}`
    );
    return await cs.signature.verify(
      base64ToBytes(pkg.signaturePublicKeyBase64),
      canonicalV2,
      base64ToBytes(pkg.signatureBase64)
    );
  } catch (err) {
    console.warn('[MLS] KeyPackage doğrulama hatası:', err);
    return false;
  }
};

/**
 * RFC 9420 MLS-Exporter (`ts-mls` `mlsExporter` fonksiyonu):
 * Sesli ve görüntülü aramalar (LiveKit E2EE) için aktif konuşma `exporter_secret`
 * değerinden RFC 9420 §8.5 standardına göre 256-bit (32-byte) medya şifreleme anahtarı türetir.
 */
export const exportCallMediaKeyFromEpoch = async (
  exporterSecretBase64: string,
  conversationId: string,
  epoch: number,
  callId: string
): Promise<string> => {
  const cs = await getTsMlsCiphersuite();
  const exportedBytes = await mlsExporter(
    base64ToBytes(exporterSecretBase64),
    'MLS 1.0 LiveKit Media E2EE Key',
    textEncoder.encode(JSON.stringify([conversationId, epoch, callId])),
    32,
    cs
  );
  return bytesToBase64(exportedBytes);
};

// ============================================================================
// 2. `ts-mls` CLIENTSTATE VE RATCHET TREE YARDIMCILARI
// ============================================================================

export const extractRatchetNodesFromTsMlsTree = (state: ClientState): MlsRatchetNode[] => {
  const nodes: MlsRatchetNode[] = [];
  for (let i = 0; i < state.ratchetTree.length; i++) {
    const node = state.ratchetTree[i];
    if (node && node.nodeType === 'leaf') {
      let userId = '';
      let deviceId = '';
      if (node.leaf.credential.credentialType === 'basic') {
        const idStr = textDecoder.decode(node.leaf.credential.identity);
        const parts = idStr.split(':');
        userId = parts[0] || '';
        deviceId = parts[1] || idStr;
      }
      nodes.push({
        leafIndex: Math.floor(i / 2),
        userId,
        deviceId,
        signaturePublicKeyBase64: bytesToBase64(node.leaf.signaturePublicKey),
        hpkePublicKeyBase64: bytesToBase64(node.leaf.hpkePublicKey)
      });
    }
  }
  return nodes;
};

const buildStoredStateFromTsMls = (
  conversationId: string,
  existing: StoredConversationMlsState | null,
  clientState: ClientState
): StoredConversationMlsState => {
  const epoch = Number(clientState.groupContext.epoch);
  const serialized = serializeTsMlsClientState(clientState);
  const exporterSecretBase64 = bytesToBase64(clientState.keySchedule.exporterSecret);
  const ratchetTree = extractRatchetNodesFromTsMlsTree(clientState);
  const groupId =
    textDecoder.decode(clientState.groupContext.groupId) ||
    existing?.groupId ||
    `mls:${conversationId}`;

  return {
    conversationId,
    groupId,
    currentEpoch: epoch,
    tsMlsStateBase64: serialized,
    tsMlsStatesByEpoch: {
      ...(existing?.tsMlsStatesByEpoch || {}),
      [epoch]: serialized
    },
    epochSecrets: {
      ...(existing?.epochSecrets || {}),
      [epoch]: exporterSecretBase64
    },
    ratchetTree,
    retainedEpochAt: {
      ...existing?.retainedEpochAt,
      [epoch]: existing?.retainedEpochAt?.[epoch] ?? Date.now()
    },
    updatedAt: new Date().toISOString()
  };
};

const getBrowserDeviceName = (): string => {
  if (typeof navigator === 'undefined') return 'Web İstemcisi';
  const ua = navigator.userAgent;
  const platform = ua.includes('Win')
    ? 'Windows'
    : ua.includes('Mac')
      ? 'macOS'
      : ua.includes('Linux')
        ? 'Linux'
        : ua.includes('Android')
          ? 'Android'
          : ua.includes('iPhone') || ua.includes('iPad')
            ? 'iOS'
            : 'Tarayıcı';
  const browser = ua.includes('Edg')
    ? 'Edge'
    : ua.includes('Chrome')
      ? 'Chrome'
      : ua.includes('Firefox')
        ? 'Firefox'
        : ua.includes('Safari')
          ? 'Safari'
          : 'Web';
  return `${browser} (${platform})`;
};

let activeRegistrationPromise: Promise<StoredDeviceIdentity | null> | null = null;
let activeRegistrationUserId: string | null = null;

export const ensureDeviceRegistered = async (
  userId: string
): Promise<StoredDeviceIdentity | null> => {
  if (!userId || !isVaultUnlocked(userId)) return null;
  if (activeRegistrationPromise && activeRegistrationUserId === userId) {
    return activeRegistrationPromise;
  }

  activeRegistrationUserId = userId;
  const register = async () => {
    try {
      let identity = await getStoredDeviceIdentity(userId);
      const isNewIdentity = !identity;
      if (!identity) {
        identity = await generateDeviceCryptoIdentity(userId, getBrowserDeviceName());
      }

      if (isNewIdentity) await saveDeviceIdentity(identity);
      const initialKeyPackages = await generateSignedKeyPackages(identity, isNewIdentity ? 15 : 5);
      const res = await api.post<{
        device: { id: string; approvedAt: string | null };
        availableKeyPackageCount: number;
      }>('/mls/devices', {
        deviceId: identity.deviceId,
        deviceName: identity.deviceName,
        signaturePublicKey: identity.signaturePublicKeyBase64,
        credential: identity.credentialJson,
        initialKeyPackages
      });

      if (!res.data?.device?.approvedAt) return null;

      if (res.data?.device?.id && res.data.device.id !== identity.deviceId) {
        identity = { ...identity, deviceId: res.data.device.id };
        await saveDeviceIdentity(identity);
        const reSignedPackages = await generateSignedKeyPackages(identity, 10);
        await api.post('/mls/key-packages', {
          deviceId: identity.deviceId,
          keyPackages: reSignedPackages
        });
      } else {
        await saveDeviceIdentity(identity);
      }

      return identity;
    } catch (err) {
      console.warn('[MLS] Cihaz kaydı uyarısı:', err);
      return null;
    } finally {
      activeRegistrationPromise = null;
      activeRegistrationUserId = null;
    }
  };
  activeRegistrationPromise = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('mls-device-registration:' + userId, register)
    : register();
  return activeRegistrationPromise;
};

type DirectoryDevice = {
  id: string;
  userId: string;
  signaturePublicKey: string;
  approvedByDeviceId: string | null;
  approvalSignature: string | null;
  revokedAt: string | null;
};

type DeviceDirectory = { userIds: string[]; devices: DirectoryDevice[]; isGroup: boolean; adminId: string | null };

const approvalBytes = (userId: string, approverId: string, deviceId: string, publicKey: string) =>
  textEncoder.encode(JSON.stringify(['mls-device-approval-v1', userId, approverId, deviceId, publicKey]));

export const deviceApprovalCode = async (publicKey: string) => {
  const hash = await sha256Bytes(base64ToBytes(publicKey));
  return Array.from(hash.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const approveMlsDevice = async (identity: StoredDeviceIdentity, target: { id: string; signaturePublicKey: string }, code: string) => {
  if (code.trim().toLowerCase() !== await deviceApprovalCode(target.signaturePublicKey)) {
    throw new Error('Cihaz doğrulama kodu eşleşmedi.');
  }
  const cs = await getTsMlsCiphersuite();
  const signature = await cs.signature.sign(base64ToBytes(identity.signaturePrivateKeyPkcs8Base64),
    approvalBytes(identity.userId, identity.deviceId, target.id, target.signaturePublicKey));
  await api.post('/mls/devices/' + target.id + '/approve', {
    approverId: identity.deviceId, signature: bytesToBase64(signature)
  });
};

export const revokeMlsDevice = async (identity: StoredDeviceIdentity, deviceId: string) => {
  const cs = await getTsMlsCiphersuite();
  const signature = await cs.signature.sign(
    base64ToBytes(identity.signaturePrivateKeyPkcs8Base64),
    textEncoder.encode(JSON.stringify(['mls-device-revoke-v1', identity.userId, identity.deviceId, deviceId]))
  );
  await api.delete('/mls/devices/' + deviceId, {
    data: { approverId: identity.deviceId, signature: bytesToBase64(signature) }
  });
};

const loadDevicePolicy = async (localUserId: string, conversationId: string) => {
  const { data } = await api.get<DeviceDirectory>('/mls/conversations/' + conversationId + '/devices');
  const cs = await getTsMlsCiphersuite();
  const active = new Map<string, DirectoryDevice>();
  for (const userId of data.userIds) {
    const devices = data.devices.filter((device) => device.userId === userId);
    const roots = devices.filter((device) => !device.approvedByDeviceId && !device.approvalSignature);
    if (roots.length !== 1) continue;
    const [root] = roots;
    if (!await pinAccountRoot(localUserId, userId, root.id, root.signaturePublicKey)) {
      throw new Error('Hesabın güvenlik anahtarı değişti.');
    }
    const verified = new Set([root.id]);
    for (let pass = 0; pass < devices.length; pass++) {
      let changed = false;
      for (const device of devices) {
        if (verified.has(device.id) || !device.approvedByDeviceId || !device.approvalSignature ||
            !verified.has(device.approvedByDeviceId)) continue;
        const signer = devices.find((candidate) => candidate.id === device.approvedByDeviceId)!;
        if (await cs.signature.verify(base64ToBytes(signer.signaturePublicKey),
          approvalBytes(userId, signer.id, device.id, device.signaturePublicKey),
          base64ToBytes(device.approvalSignature))) {
          verified.add(device.id);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const device of devices) {
      if (verified.has(device.id) && !device.revokedAt) active.set(device.id, device);
    }
  }
  return {
    active,
    userIds: data.userIds,
    canAdd: (sender: string, recipient: string) => !data.isGroup || sender === data.adminId || sender === recipient,
    canCreate: (sender: string) => !data.isGroup || sender === data.adminId,
    valid: (node: MlsRatchetNode) => {
      const device = active.get(node.deviceId);
      return device?.userId === node.userId && device.signaturePublicKey === node.signaturePublicKeyBase64;
    }
  };
};

export const replenishKeyPackages = async (
  userId: string,
  count: number = 15
): Promise<number> => {
  const identity = await ensureDeviceRegistered(userId);
  if (!identity) return 0;

  const keyPackages = await generateSignedKeyPackages(identity, count);
  const res = await api.post<{ availableKeyPackageCount: number }>('/mls/key-packages', {
    deviceId: identity.deviceId,
    keyPackages
  });
  return res.data?.availableKeyPackageCount ?? 0;
};

// ============================================================================
// 3. RFC 9420 WELCOME, COMMIT, EXTERNAL JOIN VE SYNC AKIŞLARI (`ts-mls`)
// ============================================================================

const _handleIncomingWelcomeUnlocked = async (
  userId: string,
  welcomeRecord: {
    conversationId: string;
    epoch: number;
    recipientDeviceId: string;
    welcomeData: string;
    ratchetTree?: string | null;
  }
): Promise<StoredConversationMlsState | null> => {
  const identity = await getStoredDeviceIdentity(userId);
  if (!identity || identity.deviceId !== welcomeRecord.recipientDeviceId) return null;

  const existing = await getConversationMlsState(userId, welcomeRecord.conversationId);
  // Eğer cihaz zaten bu epoch veya daha ileri bir ts-mls durumundaysa eski Welcome'ı tekrar işleme (K1)
  if (existing?.tsMlsStateBase64 && existing.currentEpoch >= welcomeRecord.epoch) {
    return existing;
  }

  try {
    const parsedWelcome = JSON.parse(welcomeRecord.welcomeData) as MlsWelcomeWirePayload;
    if (!parsedWelcome?.tsMlsWelcomeBase64 || !parsedWelcome.keyPackageRef) {
      console.warn('[MLS] Geçersiz Welcome yükü: tsMlsWelcomeBase64 veya keyPackageRef eksik.');
      return null;
    }

    // 1. Önce özel anahtarı SİLMEDEN oku (doğrulama ve joinGroup başarılı olursa silinecek - K1)
    const kpBundle = await peekEphemeralKeyPackageBundle(userId, parsedWelcome.keyPackageRef);
    if (
      !kpBundle ||
      !kpBundle.tsMlsPublicKeyPackageBase64 ||
      !kpBundle.tsMlsInitPrivateKeyBase64 ||
      !kpBundle.tsMlsHpkePrivateKeyBase64 ||
      !kpBundle.tsMlsSignaturePrivateKeyBase64
    ) {
      console.warn('[MLS] Welcome için eşleşen yerel KeyPackage bulunamadı:', parsedWelcome.keyPackageRef);
      return null;
    }

    const cs = await getTsMlsCiphersuite();
    const decodedWelcome = decodeWelcome(base64ToBytes(parsedWelcome.tsMlsWelcomeBase64), 0);
    const decodedPubKp = decodeKeyPackage(
      base64ToBytes(kpBundle.tsMlsPublicKeyPackageBase64),
      0
    );
    if (!decodedWelcome || !decodedPubKp) {
      console.warn('[MLS] Welcome veya KeyPackage TLS ikili verisi çözümlenemedi.');
      return null;
    }

    const privKp: TsMlsPrivateKeyPackage = {
      initPrivateKey: base64ToBytes(kpBundle.tsMlsInitPrivateKeyBase64),
      hpkePrivateKey: base64ToBytes(kpBundle.tsMlsHpkePrivateKeyBase64),
      signaturePrivateKey: base64ToBytes(kpBundle.tsMlsSignaturePrivateKeyBase64)
    };

    const policy = await loadDevicePolicy(userId, welcomeRecord.conversationId);
    const inviter = policy.active.get(parsedWelcome.senderDeviceId);
    if (!inviter || !policy.canAdd(inviter.userId, userId)) return null;
    let checkingSigner = true;

    // 2. ts-mls joinGroup: GroupInfo imzasını, TreeKEM treeHash'ini ve ConfirmationTag'i doğrular!
    const joinedClientState = await joinGroup(
      decodedWelcome[0],
      decodedPubKp[0],
      privKp,
      emptyPskIndex,
      cs,
      undefined,
      undefined,
      {
        ...mlsConfig,
        authService: {
          validateCredential: async (credential, key) => {
            if (credential.credentialType !== 'basic') return false;
            const [account, deviceId] = textDecoder.decode(credential.identity).split(':');
            const device = policy.active.get(deviceId);
            const signerMatches = !checkingSigner || inviter.id === deviceId;
            checkingSigner = false;
            return signerMatches && device?.userId === account && device.signaturePublicKey === bytesToBase64(key);
          }
        }
      }
    );

    if (textDecoder.decode(joinedClientState.groupContext.groupId) !== 'mls:' + welcomeRecord.conversationId ||
        Number(joinedClientState.groupContext.epoch) !== welcomeRecord.epoch) {
      console.warn('[MLS] Welcome epoch uyuşmazlığı.');
      return null;
    }

    // 3. Doğrulama başarılı! Şimdi tek kullanımlık KeyPackage initPrivateKey'i kasadan KALICI OLARAK SİL (FS)
    // Not: privKp.hpkePrivateKey artık joinedClientState.privatePath.privateKeys[leaf] tarafından referans
    // tutulduğu için sıfırlanmamalıdır (sonraki UpdatePath/Commit şifre çözümü için gereklidir).
    zeroOutUint8Array(privKp.initPrivateKey);

    const nextState = buildStoredStateFromTsMls(
      welcomeRecord.conversationId,
      existing,
      joinedClientState
    );
    await saveConversationMlsState(userId, nextState, { consumeKeyPackage: parsedWelcome.keyPackageRef });
    return nextState;
  } catch (err) {
    console.warn('[MLS] Welcome işleme hatası:', err);
    return null;
  }
};

export const handleIncomingWelcome = async (
  userId: string,
  welcomeRecord: {
    conversationId: string;
    epoch: number;
    recipientDeviceId: string;
    welcomeData: string;
    ratchetTree?: string | null;
  }
): Promise<StoredConversationMlsState | null> => {
  return withConversationMlsLock(userId, welcomeRecord.conversationId, () =>
    _handleIncomingWelcomeUnlocked(userId, welcomeRecord)
  );
};

const _handleIncomingCommitUnlocked = async (
  userId: string,
  commitRecord: {
    conversationId: string;
    epoch: number;
    senderDeviceId: string;
    commitData: string;
    ratchetTree?: string | null;
  }
): Promise<StoredConversationMlsState | null> => {
  const identity = await getStoredDeviceIdentity(userId);
  if (!identity) return null;

  const existing = await getConversationMlsState(userId, commitRecord.conversationId);
  if (!existing?.tsMlsStateBase64) {
    return null;
  }

  // Zaten bu epoch veya daha ilerideysek tekrar uygulama
  if (existing.currentEpoch >= commitRecord.epoch) {
    return existing;
  }

  // Commit'ler sıralı olarak (epoch = currentEpoch + 1) uygulanmalıdır
  if (commitRecord.epoch !== existing.currentEpoch + 1) {
    return null;
  }

  try {
    const parsedCommit = JSON.parse(commitRecord.commitData) as MlsCommitWirePayload;
    if (!parsedCommit?.tsMlsCommitBase64) {
      console.warn('[MLS] Geçersiz Commit yükü: tsMlsCommitBase64 eksik.');
      return null;
    }

    const clientState = deserializeTsMlsClientState(existing.tsMlsStateBase64);
    const decodedMlsMsg = decodeMlsMessage(base64ToBytes(parsedCommit.tsMlsCommitBase64), 0);
    if (
      !decodedMlsMsg ||
      (decodedMlsMsg[0].wireformat !== 'mls_private_message' &&
        decodedMlsMsg[0].wireformat !== 'mls_public_message')
    ) {
      console.warn('[MLS] Commit MLSMessage formatı geçersiz.');
      return null;
    }

    const policy = await loadDevicePolicy(userId, commitRecord.conversationId);
    const leaves = extractRatchetNodesFromTsMlsTree(clientState);
    const cs = await getTsMlsCiphersuite();
    const procResult = await processMessage(
      decodedMlsMsg[0], clientState, emptyPskIndex, (incoming) => {
        if (incoming.kind !== 'commit') return 'reject';
        const sender = leaves.find((node) => node.leafIndex === incoming.senderLeafIndex);
        if (!sender || sender.deviceId !== commitRecord.senderDeviceId || !policy.valid(sender)) return 'reject';
        return incoming.proposals.every(({ proposal }) => {
          if (proposal.proposalType === 'remove') {
            const removed = leaves.find((node) => node.leafIndex === proposal.remove.removed);
            return removed && !policy.valid(removed);
          }
          if (proposal.proposalType !== 'add') return false;
          const leaf = proposal.add.keyPackage.leafNode;
          if (leaf.credential.credentialType !== 'basic') return false;
          const [account, deviceId] = textDecoder.decode(leaf.credential.identity).split(':');
          const device = policy.active.get(deviceId);
          return device?.userId === account && device.signaturePublicKey === bytesToBase64(leaf.signaturePublicKey) &&
            policy.canAdd(sender.userId, account);
        }) ? 'accept' : 'reject';
      }, cs
    );

    if (procResult.kind !== 'newState' || procResult.actionTaken !== 'accept' ||
        Number(procResult.newState.groupContext.epoch) !== commitRecord.epoch ||
        !extractRatchetNodesFromTsMlsTree(procResult.newState).every(policy.valid)) return null;

    for (const c of procResult.consumed) {
      zeroOutUint8Array(c);
    }

    const roster = extractRatchetNodesFromTsMlsTree(procResult.newState);
    if (commitRecord.ratchetTree && JSON.stringify(roster) !== JSON.stringify(JSON.parse(commitRecord.ratchetTree))) return null;

    const nextState = buildStoredStateFromTsMls(
      commitRecord.conversationId,
      existing,
      procResult.newState
    );
    await saveConversationMlsState(userId, nextState);
    return nextState;
  } catch (err) {
    console.warn('[MLS] Commit işleme hatası:', err);
    return null;
  }
};

export const handleIncomingCommit = async (
  userId: string,
  commitRecord: {
    conversationId: string;
    epoch: number;
    senderDeviceId: string;
    commitData: string;
    ratchetTree?: string | null;
  }
): Promise<StoredConversationMlsState | null> => {
  return withConversationMlsLock(userId, commitRecord.conversationId, () =>
    _handleIncomingCommitUnlocked(userId, commitRecord)
  );
};

const _syncConversationFromServerUnlocked = async (
  userId: string,
  conversationId: string
): Promise<StoredConversationMlsState | null> => {
  const identity = await ensureDeviceRegistered(userId);
  if (!identity) return null;

  let currentState = await getConversationMlsState(userId, conversationId);
  const sinceEpoch = currentState?.tsMlsStateBase64 ? currentState.currentEpoch : 0;

  try {
    const res = await api.get<{
      conversationId: string;
      currentEpoch: number;
      commits: Array<{
        id: string;
        conversationId: string;
        epoch: number;
        senderDeviceId: string;
        commitData: string;
        ratchetTree?: string | null;
      }>;
      welcomes: Array<{
        id: string;
        conversationId: string;
        epoch: number;
        recipientDeviceId: string;
        welcomeData: string;
        ratchetTree?: string | null;
      }>;
    }>(`/mls/conversations/${conversationId}/sync`, {
      params: { deviceId: identity.deviceId, sinceEpoch }
    });

    const welcomes = [...(res.data?.welcomes || [])].sort((a, b) => a.epoch - b.epoch);
    const commits = [...(res.data?.commits || [])].sort((a, b) => a.epoch - b.epoch);

    const pending = await readPendingMlsCommit(userId, conversationId);
    if (pending && commits.some((commit) => commit.epoch === pending.state.currentEpoch &&
        commit.senderDeviceId === identity.deviceId && commit.commitData === pending.commitData)) {
      await saveConversationMlsState(userId, pending.state, { clearPendingCommit: true });
      currentState = pending.state;
    }

    // 1. Henüz bir ts-mls grup durumumuz yoksa yalnızca kendi cihazımıza ait Welcome paketini işle
    if (!currentState?.tsMlsStateBase64 && welcomes.length > 0) {
      for (const welcome of welcomes) {
        const joined = await _handleIncomingWelcomeUnlocked(userId, welcome);
        if (joined?.tsMlsStateBase64) {
          currentState = joined;
          break;
        }
      }
    }

    // 2. Mevcut epoch'umuzdan sonraki Commit paketlerini sırayla (epoch + 1) uygula
    if (currentState?.tsMlsStateBase64) {
      for (const commit of commits) {
        if (commit.epoch === currentState.currentEpoch + 1) {
          const updated = await _handleIncomingCommitUnlocked(userId, commit);
          if (updated) {
            currentState = updated;
          }
        }
      }
    }

    if ((currentState?.currentEpoch ?? 0) !== res.data.currentEpoch) return null;
    return currentState;
  } catch {
    return null;
  }
};

/**
 * `ts-mls` (`createGroup`, `createCommit` + `ProposalAdd`/`ProposalRemove`, `encodeWelcome`,
 * `encodeMlsMessage`, `encodeGroupState`) kullanarak yeni bir RFC 9420 MLS Epoch oluşturur.
 *
 * K1 & M2 Çözümü:
 * - Mevcut üyeler zaten `clientState.ratchetTree` içinde yer aldığı için onların `KeyPackage`
 *   havuzu tüketilmez ve mevcut üyelere `Welcome` gönderilmez!
 * - `Welcome` YALNIZCA ağaca yeni eklenen (`ProposalAdd`) cihazlara gönderilir.
 */
const _rotateConversationEpochUnlocked = async (
  userId: string,
  conversationId: string,
  _activeParticipantUserIds: string[]
): Promise<StoredConversationMlsState | null> => {
  const identity = await ensureDeviceRegistered(userId);
  if (!identity) return null;

  const cs = await getTsMlsCiphersuite();
  const syncedState = await _syncConversationFromServerUnlocked(userId, conversationId);
  const groupId = syncedState?.groupId || `mls:${conversationId}`;
  const policy = await loadDevicePolicy(userId, conversationId);
  const uniqueUserIds = policy.userIds;
  if (!policy.active.has(identity.deviceId)) return null;

  let tsMlsClientState: ClientState;
  if (syncedState?.tsMlsStateBase64) {
    tsMlsClientState = deserializeTsMlsClientState(syncedState.tsMlsStateBase64);
  } else {
    if (!policy.canCreate(userId) || await getConversationMlsState(userId, conversationId)) return null;
    // Epoch 0: Grubu tek bir kez oluştur
    const myCredential = {
      credentialType: 'basic' as const,
      identity: textEncoder.encode(`${identity.userId}:${identity.deviceId}`)
    };
    const myKp = await generateKeyPackageWithKey(
      myCredential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      {
        signKey: base64ToBytes(identity.signaturePrivateKeyPkcs8Base64),
        publicKey: base64ToBytes(identity.signaturePublicKeyBase64)
      },
      cs
    );
    tsMlsClientState = await createGroup(
      textEncoder.encode(groupId),
      myKp.publicPackage,
      myKp.privatePackage,
      [],
      cs
    );
    zeroOutUint8Array(myKp.privatePackage.initPrivateKey);
  }

  const existingNodes = extractRatchetNodesFromTsMlsTree(tsMlsClientState);
  const existingDeviceIdsInTree = new Set(existingNodes.map((n) => n.deviceId));
  const newUserIdsToClaim = uniqueUserIds.filter((uid) => policy.canAdd(userId, uid) &&
    Array.from(policy.active.values()).some((device) => device.userId === uid && !existingDeviceIdsInTree.has(device.id)));
  const newlyAddedDevices: Array<{
    userId: string;
    deviceId: string;
    keyPackageRef: string;
    tsMlsKeyPackage: TsMlsKeyPackage;
  }> = [];

  if (newUserIdsToClaim.length > 0) {
    const claimRes = await api.post<{
      claimedPackages: Array<{
        userId: string;
        deviceId: string;
        deviceName: string;
        signaturePublicKey: string;
        credential: string;
        keyPackageRef: string;
        keyPackage: string;
      }>;
    }>('/mls/key-packages/claim', {
      conversationId,
      userIds: newUserIdsToClaim,
      excludeDeviceId: identity.deviceId,
      excludeDeviceIds: Array.from(existingDeviceIdsInTree)
    });

    for (const claimed of claimRes.data?.claimedPackages || []) {
      if (existingDeviceIdsInTree.has(claimed.deviceId)) continue;
      try {
        const parsedPkg = JSON.parse(claimed.keyPackage) as SignedKeyPackagePayload;
        const trusted = policy.active.get(claimed.deviceId);
        if (!trusted || !newUserIdsToClaim.includes(trusted.userId) || trusted.userId !== claimed.userId) continue;
        const isValid = await verifySignedKeyPackage(
          parsedPkg,
          claimed.userId,
          claimed.deviceId,
          trusted.signaturePublicKey
        );
        if (!isValid) continue;

        const decoded = decodeKeyPackage(base64ToBytes(parsedPkg.tlsKeyPackageBase64), 0);
        if (!decoded) continue;

        newlyAddedDevices.push({
          userId: claimed.userId,
          deviceId: claimed.deviceId,
          keyPackageRef: claimed.keyPackageRef,
          tsMlsKeyPackage: decoded[0]
        });
      } catch (err) {
        console.warn('[MLS] Claimed KeyPackage ayrıştırma hatası:', err);
      }
    }
  }

  // 2. RFC 9420 ProposalRemove (ayrılan üyeler) ve ProposalAdd (yeni cihazlar) listesini hazırla
  const extraProposals: Proposal[] = [];

  for (let i = 0; i < tsMlsClientState.ratchetTree.length; i++) {
    const node = tsMlsClientState.ratchetTree[i];
    if (node && node.nodeType === 'leaf' && node.leaf.credential.credentialType === 'basic') {
      const idStr = textDecoder.decode(node.leaf.credential.identity);
      const [leafUserId, leafDeviceId] = idStr.split(':');
      if (leafDeviceId !== identity.deviceId && !policy.valid({
        leafIndex: Math.floor(i / 2), userId: leafUserId, deviceId: leafDeviceId,
        signaturePublicKeyBase64: bytesToBase64(node.leaf.signaturePublicKey),
        hpkePublicKeyBase64: bytesToBase64(node.leaf.hpkePublicKey)
      })) {
        extraProposals.push({
          proposalType: 'remove',
          remove: { removed: toLeafIndex(Math.floor(i / 2)) }
        });
      }
    }
  }

  for (const added of newlyAddedDevices) {
    extraProposals.push({
      proposalType: 'add',
      add: { keyPackage: added.tsMlsKeyPackage }
    });
  }

  // 3. ts-mls createCommit ile yeni epoch oluştur (TreeKEM UpdatePath + ConfirmationTag)
  const commitRes = await createCommit(
    { state: tsMlsClientState, cipherSuite: cs },
    { extraProposals, ratchetTreeExtension: true }
  );
  for (const c of commitRes.consumed) {
    zeroOutUint8Array(c);
  }

  const nextClientState = commitRes.newState;
  const nextEpoch = Number(nextClientState.groupContext.epoch);
  const tsMlsCommitBase64 = bytesToBase64(encodeMlsMessage(commitRes.commit));
  const updatedRatchetNodes = extractRatchetNodesFromTsMlsTree(nextClientState);
  const ratchetTreeJson = JSON.stringify(updatedRatchetNodes);

  // 4. Welcome paketini YALNIZCA yeni eklenen cihazlara gönder (mevcut üyelere ASLA gönderme - K1)
  const welcomes: Array<{
    recipientDeviceId: string;
    welcomeData: string;
    ratchetTree: string;
  }> = [];

  if (commitRes.welcome && newlyAddedDevices.length > 0) {
    const tsMlsWelcomeBase64 = bytesToBase64(encodeWelcome(commitRes.welcome));
    for (const added of newlyAddedDevices) {
      const welcomeWire: MlsWelcomeWirePayload = {
        version: 2,
        groupId,
        conversationId,
        epoch: nextEpoch,
        senderDeviceId: identity.deviceId,
        keyPackageRef: added.keyPackageRef,
        tsMlsWelcomeBase64
      };
      welcomes.push({
        recipientDeviceId: added.deviceId,
        welcomeData: JSON.stringify(welcomeWire),
        ratchetTree: ratchetTreeJson
      });
    }
  }

  const commitWire: MlsCommitWirePayload = {
    version: 2,
    groupId,
    epoch: nextEpoch,
    senderDeviceId: identity.deviceId,
    tsMlsCommitBase64
  };

  const commitData = JSON.stringify(commitWire);
  const deliverySignature = bytesToBase64(await cs.signature.sign(
    base64ToBytes(identity.signaturePrivateKeyPkcs8Base64),
    textEncoder.encode(JSON.stringify([
      'mls-delivery-commit-v1', conversationId, nextEpoch, identity.deviceId, commitData,
      ratchetTreeJson, welcomes.map((welcome) => [welcome.recipientDeviceId, welcome.welcomeData])
    ]))
  ));
  const newState = buildStoredStateFromTsMls(
    conversationId,
    syncedState,
    nextClientState
  );
  await savePendingMlsCommit(userId, newState, commitData);
  try {
    await api.post(`/mls/conversations/${conversationId}/commits`, {
      epoch: nextEpoch,
      senderDeviceId: identity.deviceId,
      commitData,
      deliverySignature,
      ratchetTree: ratchetTreeJson,
      welcomes
    });

    await saveConversationMlsState(userId, newState, { clearPendingCommit: true });
    return newState;
  } catch (err: any) {
    if (err?.response?.status === 409) {
      return await _syncConversationFromServerUnlocked(userId, conversationId);
    }
    console.warn('[MLS] Commit gönderim hatası:', err);
    return null;
  }
};

export const rotateConversationEpoch = async (
  userId: string,
  conversationId: string,
  activeParticipantUserIds: string[]
): Promise<StoredConversationMlsState | null> => {
  return withConversationMlsLock(userId, conversationId, () =>
    _rotateConversationEpochUnlocked(userId, conversationId, activeParticipantUserIds)
  );
};

const _ensureConversationMlsEpochUnlocked = async (
  userId: string,
  conversationId: string,
  participantUserIds: string[]
): Promise<StoredConversationMlsState | null> => {
  const synced = await _syncConversationFromServerUnlocked(userId, conversationId);
  const policy = await loadDevicePolicy(userId, conversationId);
  if (synced?.tsMlsStateBase64 && synced.currentEpoch > 0) {
    const roster = synced.ratchetTree;
    const pending = Array.from(policy.active.values()).some((device) =>
      policy.canAdd(userId, device.userId) && !roster.some((node) => node.deviceId === device.id));
    if (roster.every(policy.valid) && !pending) return synced;
  }
  const updated = await _rotateConversationEpochUnlocked(userId, conversationId, participantUserIds);
  return updated && updated.ratchetTree.every(policy.valid) ? updated : null;
};

/**
 * Gönderilecek bir mesajı doğrudan `ts-mls` `createApplicationMessage` (`PrivateMessage`)
 * ile şifreler (K3), düz metni gönderici önbelleğine yazar (K2) ve güncellenen `ClientState`
 * verisini şifreli yerel kasaya kaydeder.
 */
export const encryptOutgoingMessage = async (
  userId: string,
  conversationId: string,
  participantUserIds: string[],
  plainContent: string,
  encryptedFileMetadata?: EncryptedFileMetadata | null,
  binding: { clientId?: string; editId?: string; delivery?: MlsDeliveryFields } = {}
): Promise<{
  clientId: string;
  protocolVersion: 2;
  epoch: number;
  senderDeviceId: string;
  ciphertext: string;
  encryptedFileMetadata: null;
} | null> => {
  return withConversationMlsLock(userId, conversationId, async () => {
    const identity = await ensureDeviceRegistered(userId);
    if (!identity) return null;

    const state = await _ensureConversationMlsEpochUnlocked(
      userId,
      conversationId,
      participantUserIds
    );
    if (!state || !state.tsMlsStateBase64) return null;

    try {
      const cs = await getTsMlsCiphersuite();
      const clientState = deserializeTsMlsClientState(state.tsMlsStateBase64);
      const clientId = binding.clientId ?? crypto.randomUUID();
      const queued = await readQueuedMlsDelivery(userId, conversationId, clientId);
      if (queued) {
        if (queued.epoch !== state.currentEpoch || queued.senderDeviceId !== identity.deviceId) return null;
        return { clientId, protocolVersion: 2, epoch: queued.epoch, senderDeviceId: queued.senderDeviceId,
          ciphertext: queued.ciphertext, encryptedFileMetadata: null };
      }
      const appPayload: MlsApplicationPlaintext = {
        binding: { conversationId, clientId, kind: binding.editId ? 'edit' : 'message', editId: binding.editId },
        content: plainContent,
        encryptedFileMetadata: encryptedFileMetadata || null
      };

      const appMsgRes = await createApplicationMessage(
        clientState,
        textEncoder.encode(JSON.stringify(appPayload)),
        cs
      );
      for (const c of appMsgRes.consumed) {
        zeroOutUint8Array(c);
      }

      const ciphertext = bytesToBase64(encodePrivateMessage(appMsgRes.privateMessage));
      const epoch = Number(appMsgRes.newState.groupContext.epoch);

      const updatedState = buildStoredStateFromTsMls(
        conversationId,
        state,
        appMsgRes.newState
      );
      await saveConversationMlsState(userId, updatedState, {
        outgoing: { ...appPayload, ciphertext, clientId, epoch, senderDeviceId: identity.deviceId, editId: binding.editId, conversationId, delivery: binding.delivery }
      });

      return {
        clientId,
        protocolVersion: 2,
        epoch,
        senderDeviceId: identity.deviceId,
        ciphertext,
        encryptedFileMetadata: null
      };
    } catch (err) {
      console.warn('[MLS] Mesaj şifreleme hatası:', err);
      return null;
    }
  });
};

/**
 * Aktif konuşma için LiveKit sesli/görüntülü arama E2EE medya anahtarını
 * yalnızca `ts-mls` `ClientState.keySchedule.exporterSecret` üzerinden türetir (M5).
 */
const deliverQueued = async (userId: string, item: StoredMlsDelivery) => {
  const payload = {
    content: '', protocolVersion: 2, epoch: item.epoch,
    senderDeviceId: item.senderDeviceId, ciphertext: item.ciphertext
  };
  const response = item.editId ? await api.put<Message>('/messages/' + item.editId, payload) :
    await api.post<Message>('/messages', {
      ...payload, ...item.delivery, conversationId: item.conversationId, clientId: item.clientId,
      fileName: item.delivery?.fileKey ? 'encrypted.enc' : undefined
    });
  await removeQueuedMlsDelivery(userId, item.conversationId, item.clientId);
  return response;
};

export const deliverMlsMessage = (userId: string, conversationId: string, clientId: string) =>
  withConversationMlsLock(userId, conversationId, async () => {
    const item = await readQueuedMlsDelivery(userId, conversationId, clientId);
    if (!item) throw new Error('Gönderim kaydı bulunamadı.');
    return deliverQueued(userId, item);
  });

export const retryQueuedMlsMessages = async (userId: string) => {
  for (const item of await listQueuedMlsDeliveries(userId)) {
    if (item.editId) continue;
    await withConversationMlsLock(userId, item.conversationId, async () => {
      const queued = await readQueuedMlsDelivery(userId, item.conversationId, item.clientId);
      if (!queued) return;
      const state = await _syncConversationFromServerUnlocked(userId, item.conversationId);
      if (state?.currentEpoch !== queued.epoch) return;
      const policy = await loadDevicePolicy(userId, item.conversationId);
      if (!state.ratchetTree.every(policy.valid)) return;
      await deliverQueued(userId, queued);
    }).catch(() => undefined);
  }
};

export const getActiveConversationCallMediaKey = async (
  userId: string,
  conversationId: string,
  callId: string,
  participantUserIds: string[],
  expectedEpoch?: number
): Promise<{ e2eeKeyBase64: string; epoch: number } | null> => {
  return withConversationMlsLock(userId, conversationId, async () => {
    const state = await _ensureConversationMlsEpochUnlocked(userId, conversationId, participantUserIds);
    if (!state || !state.tsMlsStateBase64 || state.currentEpoch <= 0) return null;
    if (expectedEpoch !== undefined && state.currentEpoch !== expectedEpoch) return null;

    try {
      const clientState = deserializeTsMlsClientState(state.tsMlsStateBase64);
      const exporterSecretBase64 = bytesToBase64(clientState.keySchedule.exporterSecret);
      const e2eeKeyBase64 = await exportCallMediaKeyFromEpoch(
        exporterSecretBase64,
        conversationId,
        state.currentEpoch,
        callId
      );
      return {
        e2eeKeyBase64,
        epoch: state.currentEpoch
      };
    } catch (err) {
      console.warn('[MLS] Arama medya anahtarı türetme hatası:', err);
      return null;
    }
  });
};

/**
 * Gelen veya geçmişten yüklenen bir MLS mesajını doğrudan `ts-mls`
 * `unprotectPrivateMessage` ile çözer, göndericinin `Ed25519` imzasını ilgili epoch'un
 * `RatchetTree` yaprağıyla doğrular (H6) ve şifreli yerel kasaya indeksler.
 */
export const decryptIncomingMessage = async (
  userId: string,
  message: Message
): Promise<Message> => {
  if (!message || message.isDeletedForEveryone || message.content === '🚫 Bu mesaj silindi') {
    return message;
  }

  if (!message.protocolVersion || message.protocolVersion === 0) {
    if (userId && message.id && message.content && !message.content.startsWith('[SYSTEM_')) {
      if (isVaultUnlocked(userId)) await cacheDecryptedMessage(userId, {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderUsername: message.sender?.username,
        content: message.content,
        createdAt: message.createdAt || new Date().toISOString(),
        protocolVersion: 0,
        fileKey: message.fileKey,
        fileType: message.fileType,
        fileName: message.fileName,
        replyToId: message.replyToId
      });
    }
    return message;
  }

  if (!message.ciphertext) return { ...message, content: '🔒 Şifreli mesaj eksik.', fileUrl: undefined };
  if (!isVaultUnlocked(userId)) {
    return { ...message, content: '🔒 Bu cihazda şifreli geçmiş henüz açılamadı.', fileUrl: undefined, encryptedFileMetadata: null };
  }
  return withConversationMlsLock(userId, message.conversationId, async () => {
    const targetEpoch = message.epoch ?? 1;
    const isLegacy = message.protocolVersion === 1;
    const cached = await getCachedDecryptedMessage(userId, message.id);
    const matchesLegacyHistory = cached && isLegacy && cached.ciphertext === undefined &&
      !message.editedAt && Boolean(message.senderDeviceId) &&
      cached.createdAt === message.createdAt && (cached.fileKey ?? null) === (message.fileKey ?? null);
    if (cached && cached.conversationId === message.conversationId &&
        cached.protocolVersion === message.protocolVersion && cached.epoch === targetEpoch &&
        cached.senderId === message.senderId && cached.senderDeviceId === message.senderDeviceId &&
        (matchesLegacyHistory || (cached.ciphertext === message.ciphertext &&
          cached.isEdit === Boolean(message.editedAt) && (cached.isEdit || cached.clientId === message.clientId)))) {
      return {
        ...message,
        content: cached.content,
        fileName: cached.encryptedFileMetadata?.originalFileName || message.fileName,
        encryptedFileMetadata: cached.encryptedFileMetadata
          ? JSON.stringify(cached.encryptedFileMetadata)
          : null
      };
    }

    // 2. K2: Göndericinin kendi şifrelediği mesaj mı? (Ciphertext özetiyle önbellekten oku)
    const selfSentCached = await getCachedOutgoingPlaintextByCiphertext(
      userId,
      message.ciphertext!
    );
    const isBoundToMessage = (binding: MlsApplicationPlaintext['binding'] | undefined) => {
      if (binding === undefined) return isLegacy && !message.editedAt;
      return binding?.conversationId === message.conversationId &&
        (binding.kind === 'edit' ? Boolean(message.editedAt) && binding.editId === message.id :
          binding.kind === 'message' && !message.editedAt && typeof binding.clientId === 'string' &&
            binding.clientId === message.clientId);
    };
    const localIdentity = await getStoredDeviceIdentity(userId);
    if (selfSentCached && typeof selfSentCached.content === 'string' && localIdentity &&
        localIdentity.deviceId === message.senderDeviceId &&
        message.senderId === userId && isBoundToMessage(selfSentCached.binding)) {
      const parsedMeta = selfSentCached.encryptedFileMetadata || null;
      if (message.id) {
        await cacheDecryptedMessage(userId, {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          senderUsername: message.sender?.username,
          content: selfSentCached.content,
          createdAt: message.createdAt || new Date().toISOString(),
          protocolVersion: message.protocolVersion!,
          ciphertext: message.ciphertext!,
          clientId: message.clientId,
          isEdit: Boolean(message.editedAt),
          epoch: message.epoch ?? 1,
          senderDeviceId: message.senderDeviceId,
          fileKey: message.fileKey,
          fileType: message.fileType,
          fileName: parsedMeta?.originalFileName || message.fileName,
          encryptedFileMetadata: parsedMeta,
          replyToId: message.replyToId
        });
      }
      return {
        ...message,
        content: selfSentCached.content,
        fileName: parsedMeta?.originalFileName || message.fileName,
        encryptedFileMetadata: parsedMeta ? JSON.stringify(parsedMeta) : null
      };
    }

    // 3. Konuşmanın ilgili epoch durumunu kontrol et; gerideysek sunucudan senkronize et
    let state = await getConversationMlsState(userId, message.conversationId);
    if (!state || !state.tsMlsStateBase64 || state.currentEpoch < targetEpoch) {
      state = await _syncConversationFromServerUnlocked(userId, message.conversationId);
    }

    if (!state || !state.tsMlsStateBase64) {
      return {
        ...message,
        content:
          '🔒 Bu cihazda mesajın anahtarı bulunamadı.',
        fileUrl: undefined,
        encryptedFileMetadata: null
      };
    }

    try {
      const cs = await getTsMlsCiphersuite();
      const ciphertextBytes = base64ToBytes(message.ciphertext!);
      const decodedPm = decodePrivateMessage(ciphertextBytes, 0);
      if (!decodedPm) {
        throw new Error('PrivateMessage TLS ikili verisi çözümlenemedi.');
      }

      const isHistoricalEpoch = targetEpoch < state.currentEpoch;
      const stateBase64ForDecrypt = isHistoricalEpoch
        ? state.tsMlsStatesByEpoch?.[targetEpoch] : state.tsMlsStateBase64;
      if (!stateBase64ForDecrypt ||
          (isHistoricalEpoch && Date.now() - (state.retainedEpochAt?.[targetEpoch] ?? 0) > 86_400_000)) {
        return { ...message, content: '🔒 Bu cihazda mesajın anahtarı bulunamadı.', fileUrl: undefined, encryptedFileMetadata: null };
      }
      const clientState = deserializeTsMlsClientState(stateBase64ForDecrypt);

      const pm = decodedPm[0];
      if (decodedPm[1] !== ciphertextBytes.length ||
          Number(pm.epoch) !== targetEpoch ||
          textDecoder.decode(pm.groupId) !== 'mls:' + message.conversationId) {
        throw new Error('MLS mesaj bağlamı eşleşmedi.');
      }
      const result = await unprotectPrivateMessage(
        clientState.keySchedule.senderDataSecret, pm, clientState.secretTree, clientState.ratchetTree,
        clientState.groupContext, clientState.clientConfig.keyRetentionConfig, cs
      );
      const frame = result.content.content;
      const sender = frame.sender;
      const leaf = sender.senderType === 'member'
        ? extractRatchetNodesFromTsMlsTree(clientState).find((node) => node.leafIndex === sender.leafIndex)
        : undefined;
      if (frame.contentType !== 'application' || !leaf ||
          leaf.userId !== message.senderId || leaf.deviceId !== message.senderDeviceId) {
        throw new Error('Mesaj göndereni doğrulanamadı.');
      }

      const decrypted = JSON.parse(textDecoder.decode(frame.applicationData)) as MlsApplicationPlaintext;
      if (typeof decrypted.content !== 'string' || !isBoundToMessage(decrypted.binding)) {
        throw new Error('Mesaj kimliği doğrulanamadı.');
      }
      const parsedMeta = decrypted.encryptedFileMetadata || null;
      const newState = { ...clientState, secretTree: result.tree };
      const nextStored = isHistoricalEpoch ? {
        ...state,
        tsMlsStatesByEpoch: { ...state.tsMlsStatesByEpoch, [targetEpoch]: serializeTsMlsClientState(newState) }
      } : buildStoredStateFromTsMls(message.conversationId, state, newState);
      await saveConversationMlsState(userId, nextStored, { received: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: leaf.userId,
        senderUsername: message.sender?.username,
        content: decrypted.content,
        createdAt: message.createdAt || new Date().toISOString(),
        protocolVersion: message.protocolVersion!,
        ciphertext: message.ciphertext!,
        clientId: message.clientId,
        isEdit: Boolean(message.editedAt),
        epoch: targetEpoch,
        senderDeviceId: leaf.deviceId,
        fileKey: message.fileKey,
        fileType: message.fileType,
        fileName: parsedMeta?.originalFileName || message.fileName,
        encryptedFileMetadata: parsedMeta,
        replyToId: message.replyToId
      } });
      for (const consumed of result.consumed) zeroOutUint8Array(consumed);

      let hydratedReplyTo = message.replyTo;
      if (message.replyTo && (message.replyTo as any).id) {
        const cachedReply = await getCachedDecryptedMessage(userId, (message.replyTo as any).id);
        if (cachedReply) {
          hydratedReplyTo = {
            ...message.replyTo,
            content: cachedReply.content,
            fileName: cachedReply.fileName || message.replyTo.fileName
          };
        }
      }

      return {
        ...message,
        content: decrypted.content,
        fileName: parsedMeta?.originalFileName || message.fileName,
        encryptedFileMetadata: parsedMeta ? JSON.stringify(parsedMeta) : null,
        replyTo: hydratedReplyTo
      };
    } catch (err) {
      console.warn('[MLS] PrivateMessage çözme hatası:', err);
      return { ...message, content: '🔒 Şifreli mesaj doğrulanamadı.', fileUrl: undefined, encryptedFileMetadata: null };
    }
  });
};

export const decryptMessageList = async (
  userId: string,
  messages: Message[]
): Promise<Message[]> => {
  if (!userId || !messages || messages.length === 0) return messages;
  const results: Message[] = [];
  for (const msg of messages) {
    results.push(await decryptIncomingMessage(userId, msg));
  }
  return results;
};
