/**
 * ============================================================================
 * CİHAZ BAZLI ŞİFRELİ YEREL KASA (Per-Device Encrypted Local Vault)
 * ============================================================================
 *
 * Bu modül; MLS cihaz kimlik anahtarlarını (Ed25519), tek kullanımlık (ephemeral)
 * KeyPackage özel anahtarlarını (X25519), konuşma bazlı RFC 9420 MLS durumlarını
 * (TreeKEM Ratchet Tree, GroupContext, Transcript Hash, Secret Tree mesaj zincirleri)
 * ve çözülmüş mesaj geçmişini tarayıcının IndexedDB (`mesajlasma_secure_vault_v1`)
 * alanında Web Crypto API (`AES-256-GCM`) ile şifrelenmiş olarak saklar.
 *
 * GÜVENLİK MİMARİSİ:
 * 1. Master Key (`extractable: false`): IndexedDB'de `CryptoKey` nesnesi olarak
 *    saklanır; JavaScript tarafından ham baytları dışarı aktarılamaz (`exportKey` kapalıdır).
 * 2. Ephemeral KeyPackage İmhası (Forward Secrecy): Her KeyPackage kendi tek kullanımlık
 *    X25519 özel anahtarıyla üretilir; `consumeEphemeralKeyPackageKey` çağrıldığında
 *    anahtar okunur ve yerel kasadan kalıcı olarak silinir.
 * 3. Secret Tree Mesaj Zinciri (Per-Message Forward Secrecy): Her gönderici yaprağı için
 *    zincir sırrı (`chainSecretBase64`) her mesajda (`generation`) tek yönlü HKDF ile
 *    ilerletilir ve tüketilen mesaj anahtarları hemen silinir.
 */

export interface StoredDeviceIdentity {
  userId: string;
  deviceId: string;
  deviceName: string;
  signaturePublicKeyBase64: string;
  signaturePrivateKeyPkcs8Base64: string;
  initPublicKeyBase64: string;
  initPrivateKeyPkcs8Base64: string;
  credentialJson: string;
  safetyFingerprint: string;
  createdAt: string;
}

export interface MlsRatchetNode {
  leafIndex?: number;
  deviceId: string;
  userId: string;
  deviceName?: string;
  signaturePublicKeyBase64: string;
  hpkePublicKeyBase64: string;
  parentHashBase64?: string;
}

export interface MlsGroupContext {
  version: 1;
  cipherSuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';
  groupId: string;
  epoch: number;
  treeHashBase64: string;
  confirmedTranscriptHashBase64: string;
}

export interface MlsEpochSecretsSchedule {
  joinerSecretBase64: string;
  epochSecretBase64: string;
  encryptionSecretBase64: string;
  exporterSecretBase64: string;
  confirmationKeyBase64: string;
  nextInitSecretBase64: string;
}

export interface MlsSenderRatchetState {
  nextGeneration: number;
  chainSecretBase64: string;
  /** Sırası karışık (out-of-order) gelen mesajlar için geçici tutulan ve kullanılınca silinen anahtarlar */
  skippedMessageKeys: Record<number, { keyBase64: string; nonceBase64: string }>;
}

export interface EphemeralKeyPackageVaultBundle {
  keyPackageRef: string;
  privateKeyPkcs8Base64: string;
  /** ts-mls TLS-encoded KeyPackage (publicPackage) */
  tsMlsPublicKeyPackageBase64?: string;
  /** ts-mls PrivateKeyPackage alanları */
  tsMlsInitPrivateKeyBase64?: string;
  tsMlsHpkePrivateKeyBase64?: string;
  tsMlsSignaturePrivateKeyBase64?: string;
  createdAt: string;
}

export interface StoredConversationMlsState {
  conversationId: string;
  groupId: string;
  currentEpoch: number;
  /** ts-mls encodeGroupState(clientState) ikili verisinin Base64 temsili (Tam RFC 9420 ClientState) */
  tsMlsStateBase64?: string;
  /** Geçmiş epoch mesajlarını ve gruptan ayrılmış üyelerin eski imzalarını doğrulamak için epoch bazlı ts-mls durumları (H6) */
  retainedEpochAt?: Record<number, number>;
  tsMlsStatesByEpoch?: Record<number, string>;
  /** Yeni cihazların External Commit (joinGroupExternal) ile katılabilmesi için en son GroupInfo (H2) */
  latestGroupInfoBase64?: string;
  /** epoch numarası -> base64(32-byte exporter_secret / epoch secret) */
  epochSecrets: Record<number, string>;
  /** epoch numarası -> tam RFC 9420 anahtar çizelgesi (Key Schedule) */
  epochSchedules?: Record<number, MlsEpochSecretsSchedule>;
  /** epoch numarası -> RFC 9420 GroupContext (treeHash + confirmedTranscriptHash) */
  groupContextByEpoch?: Record<number, MlsGroupContext>;
  /** Cihazın aktif epoch için tek kullanımlık TreeKEM yaprak özel anahtarı (Eski epoch yaprak anahtarları PCS için silinir) */
  myCurrentLeafPrivateKeyPkcs8Base64?: string;
  myCurrentLeafPublicKeyBase64?: string;
  /** epoch numarası -> (senderDeviceId -> SecretTree gönderici zinciri) */
  secretTreeByEpoch?: Record<number, Record<string, MlsSenderRatchetState>>;
  ratchetTree: MlsRatchetNode[];
  updatedAt: string;
}

export interface EncryptedFileMetadata {
  version: 1;
  algorithm: 'AES-256-GCM';
  keyBase64: string;
  ivBase64: string;
  mimeType: string;
  originalFileName: string;
  sizeBytes: number;
  sha256Hex: string;
}

export interface VaultMessageEntry {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername?: string;
  content: string;
  createdAt: string;
  ciphertext?: string;
  clientId?: string;
  isEdit?: boolean;
  protocolVersion: number;
  epoch?: number | null;
  senderDeviceId?: string | null;
  fileKey?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  encryptedFileMetadata?: EncryptedFileMetadata | null;
  replyToId?: string | null;
}

export interface VaultBackupSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  userId: string;
  conversationStates: StoredConversationMlsState[];
  messages: VaultMessageEntry[];
}

const DB_NAME = 'mesajlasma_secure_vault_v1';
const DB_VERSION = 1;
const STORE_KEYS = 'vault_keys';
const STORE_RECORDS = 'vault_records';
const MASTER_KEY_ID = 'local_vault_master_aes_gcm_v1';
const MAX_RETAINED_EPOCHS = 2;
const MAX_HISTORICAL_AGE_MS = 24 * 60 * 60 * 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** IndexedDB bulunmayan test/SSR ortamları için bellek içi şifreli yedek depo */
const memoryKeyStore = new Map<string, CryptoKey>();
const memoryRecordStore = new Map<string, { iv: string; ciphertext: string }>();

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const hasIndexedDb = (): boolean => typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

const openVaultDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KEYS)) {
        db.createObjectStore(STORE_KEYS);
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        db.createObjectStore(STORE_RECORDS);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
};

const idbGet = async <T>(storeName: string, key: string): Promise<T | undefined> => {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
};

const idbDelete = async (storeName: string, key: string): Promise<void> => {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const idbGetAllWithPrefix = async (
  prefix: string
): Promise<Array<{ key: string; value: { iv: string; ciphertext: string } }>> => {
  if (!hasIndexedDb()) {
    const results: Array<{ key: string; value: { iv: string; ciphertext: string } }> = [];
    for (const [k, v] of memoryRecordStore.entries()) {
      if (k.startsWith(prefix)) {
        results.push({ key: k, value: v });
      }
    }
    return results;
  }

  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readonly');
    const store = tx.objectStore(STORE_RECORDS);
    const req = store.openCursor();
    const items: Array<{ key: string; value: { iv: string; ciphertext: string } }> = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(items);
        return;
      }
      const key = String(cursor.key);
      if (key.startsWith(prefix)) {
        items.push({ key, value: cursor.value });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
};

type CipherRecord = { iv: string; ciphertext: string; version?: 2 };
type WrappedKey = CipherRecord & { salt: string };
const unlockedKeys = new Map<string, CryptoKey>();
const lockGenerations = new Map<string, number>();

const encryptRecord = async (key: CryptoKey, context: string, bytes: Uint8Array): Promise<CipherRecord> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(context) }, key, bytes as BufferSource
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)), version: 2 };
};

const decryptRecord = (key: CryptoKey, context: string, record: CipherRecord) => crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: base64ToBytes(record.iv) as BufferSource, additionalData: textEncoder.encode(context) },
  key, base64ToBytes(record.ciphertext) as BufferSource
);

const writeRecordsAtomically = async (
  records: Array<[string, CipherRecord]>,
  deletes: string[] = [],
  deviceKey?: { userId: string; key: CryptoKey }
) => {
  if (!hasIndexedDb()) {
    for (const [key, record] of records) memoryRecordStore.set(key, record);
    for (const key of deletes) memoryRecordStore.delete(key);
    return;
  }
  const db = await openVaultDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(deviceKey ? [STORE_RECORDS, STORE_KEYS] : STORE_RECORDS, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Kasa kaydı tamamlanamadı.'));
    const store = tx.objectStore(STORE_RECORDS);
    for (const [key, record] of records) store.put(record, key);
    for (const key of deletes) store.delete(key);
    if (deviceKey) {
      const keys = tx.objectStore(STORE_KEYS);
      keys.put(deviceKey.key, 'device:' + deviceKey.userId);
      keys.delete('wrapped:' + deviceKey.userId);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) keys.delete(MASTER_KEY_ID);
        else if (item.value.version === 2) item.continue();
      };
    }
  });
};

export const isVaultUnlocked = (userId: string) => !hasIndexedDb() || unlockedKeys.has(userId);

export const lockVault = (userId: string) => {
  unlockedKeys.delete(userId);
  lockGenerations.set(userId, (lockGenerations.get(userId) ?? 0) + 1);
};

const unwrapPreviousVaultKey = async (userId: string, passphrase: string, wrapped: WrappedKey): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey('raw', textEncoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: base64ToBytes(wrapped.salt) as BufferSource },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const raw = new Uint8Array(await decryptRecord(wrappingKey, 'wrapped:' + userId, wrapped));
  try { return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  finally { raw.fill(0); }
};

export const openDeviceVault = async (userId: string, loginPassword?: string): Promise<boolean> => {
  if (!hasIndexedDb()) return true;
  if (!navigator.locks) throw new Error('Bu tarayıcı güvenli kasa kilidini desteklemiyor.');
  const generation = lockGenerations.get(userId);
  return navigator.locks.request(JSON.stringify(['vault-unlock', userId]), async () => {
    const savedKey = await idbGet<CryptoKey>(STORE_KEYS, 'device:' + userId);
    const existing = savedKey ?? unlockedKeys.get(userId);
    if (existing) {
      if (generation !== lockGenerations.get(userId)) return false;
      if (!savedKey) await writeRecordsAtomically([], [], { userId, key: existing });
      if (generation !== lockGenerations.get(userId)) return false;
      unlockedKeys.set(userId, existing);
      return true;
    }
    const wrapped = await idbGet<WrappedKey>(STORE_KEYS, 'wrapped:' + userId);
    if (wrapped) {
      if (!loginPassword) return false;
      let key: CryptoKey;
      try { key = await unwrapPreviousVaultKey(userId, loginPassword, wrapped); }
      catch (error) {
        if (error instanceof DOMException && error.name === 'OperationError') return false;
        throw error;
      }
      if (generation !== lockGenerations.get(userId)) return false;
      await writeRecordsAtomically([], [], { userId, key });
      if (generation !== lockGenerations.get(userId)) return false;
      unlockedKeys.set(userId, key);
      return true;
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const legacy = await idbGet<CryptoKey>(STORE_KEYS, MASTER_KEY_ID);
    const records: Array<[string, CipherRecord]> = [];
    if (legacy) {
      for (const { key: id, value } of await idbGetAllWithPrefix('')) {
        if (id.split(':')[1] !== userId) continue;
        const legacyBytes = await decryptRecord(legacy, id, value).catch((error) => {
          if ('version' in value) throw error;
          return crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToBytes(value.iv) as BufferSource },
            legacy, base64ToBytes(value.ciphertext) as BufferSource
          );
        });
        const bytes = new Uint8Array(legacyBytes);
        try { records.push([id, await encryptRecord(key, id, bytes)]); }
        finally { bytes.fill(0); }
      }
    }
    await writeRecordsAtomically(records, [], { userId, key });
    if (generation !== lockGenerations.get(userId)) return false;
    unlockedKeys.set(userId, key);
    return true;
  });
};

export const unlockVault = async (userId: string, passphrase: string) => {
  if (!navigator.locks) throw new Error('Bu tarayıcı güvenli kasa kilidini desteklemiyor.');
  const generation = lockGenerations.get(userId);
  const rememberKey = (key: CryptoKey) => {
    if (generation !== lockGenerations.get(userId)) throw new Error('Oturum sona erdi.');
    unlockedKeys.set(userId, key);
  };
  await navigator.locks.request(JSON.stringify(['vault-unlock', userId]), async () => {
    const keyId = 'wrapped:' + userId;
    const existing = await idbGet<WrappedKey>(STORE_KEYS, keyId);
    if (!existing) {
      const key = await idbGet<CryptoKey>(STORE_KEYS, 'device:' + userId);
      if (!key) throw new Error('Taşınacak mesaj kasası bulunamadı.');
      rememberKey(key);
      return;
    }
    const key = await unwrapPreviousVaultKey(userId, passphrase, existing);
    if (generation !== lockGenerations.get(userId)) throw new Error('Oturum sona erdi.');
    await writeRecordsAtomically([], [], { userId, key });
    rememberKey(key);
  });
};

const getMasterKey = async (recordKey: string): Promise<CryptoKey> => {
  if (hasIndexedDb()) {
    const key = unlockedKeys.get(recordKey.split(':')[1]);
    if (!key) throw new Error('Güvenlik ayarlarından mesaj kasasını açın.');
    return key;
  }
  // The in-memory store supports non-browser protocol tests.
  const existing = memoryKeyStore.get(MASTER_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  memoryKeyStore.set(MASTER_KEY_ID, key);
  return key;
};

const prepareRecord = async <T>(recordKey: string, payload: T): Promise<[string, CipherRecord]> => {
  const bytes = textEncoder.encode(JSON.stringify(payload));
  try { return [recordKey, await encryptRecord(await getMasterKey(recordKey), recordKey, bytes)]; }
  finally { bytes.fill(0); }
};

const writeEncryptedRecord = async <T>(recordKey: string, payload: T): Promise<void> => {
  await writeRecordsAtomically([await prepareRecord(recordKey, payload)]);
};

const readEncryptedRecord = async <T>(recordKey: string): Promise<T | null> => {
  if (!isVaultUnlocked(recordKey.split(':')[1])) return null;
  const record = hasIndexedDb()
    ? await idbGet<CipherRecord>(STORE_RECORDS, recordKey)
    : memoryRecordStore.get(recordKey);
  if (!record) return null;
  const bytes = new Uint8Array(await decryptRecord(await getMasterKey(recordKey), recordKey, record));
  try { return JSON.parse(textDecoder.decode(bytes)) as T; }
  finally { bytes.fill(0); }
};

export const pinAccountRoot = async (ownerId: string, userId: string, deviceId: string, publicKey: string) => {
  const key = 'trust:' + ownerId + ':' + userId;
  const check = async () => {
    const value = JSON.stringify([deviceId, publicKey]);
    const existing = await readEncryptedRecord<string>(key);
    if (existing) return existing === value;
    await writeEncryptedRecord(key, value);
    return true;
  };
  return hasIndexedDb() ? navigator.locks.request(key, check) : check();
};

export const deleteEncryptedRecord = async (recordKey: string): Promise<void> => {
  if (!hasIndexedDb()) {
    memoryRecordStore.delete(recordKey);
    return;
  }
  await idbDelete(STORE_RECORDS, recordKey);
};

// ============================================================================
// 1. CİHAZ KİMLİK ANAHTARLARI VE EPHEMERAL KEYPACKAGE ÖZEL ANAHTARLARI
// ============================================================================

export const getStoredDeviceIdentity = async (
  userId: string
): Promise<StoredDeviceIdentity | null> => {
  return readEncryptedRecord<StoredDeviceIdentity>(`identity:${userId}`);
};

export const saveDeviceIdentity = async (identity: StoredDeviceIdentity): Promise<void> => {
  await writeEncryptedRecord(`identity:${identity.userId}`, identity);
};

/**
 * Tek kullanımlık (ephemeral) bir KeyPackage için üretilen X25519 özel anahtarını
 * ve ts-mls PrivateKeyPackage paketini yerel kasaya şifreli olarak kaydeder.
 */
export const saveEphemeralKeyPackageKey = async (
  userId: string,
  keyPackageRef: string,
  privateKeyPkcs8Base64: string,
  tsMlsBundle?: {
    publicKeyPackageBase64: string;
    initPrivateKeyBase64: string;
    hpkePrivateKeyBase64: string;
    signaturePrivateKeyBase64: string;
  }
): Promise<void> => {
  const record: EphemeralKeyPackageVaultBundle = {
    keyPackageRef,
    privateKeyPkcs8Base64,
    ...(tsMlsBundle
      ? {
          tsMlsPublicKeyPackageBase64: tsMlsBundle.publicKeyPackageBase64,
          tsMlsInitPrivateKeyBase64: tsMlsBundle.initPrivateKeyBase64,
          tsMlsHpkePrivateKeyBase64: tsMlsBundle.hpkePrivateKeyBase64,
          tsMlsSignaturePrivateKeyBase64: tsMlsBundle.signaturePrivateKeyBase64
        }
      : {}),
    createdAt: new Date().toISOString()
  };
  await writeEncryptedRecord(`ekp:${userId}:${keyPackageRef}`, record);
};

/**
 * Tek kullanımlık KeyPackage paketini silmeden okur (doğrulama tamamlandıktan sonra silmek için - K1).
 */
export const peekEphemeralKeyPackageBundle = async (
  userId: string,
  keyPackageRef: string
): Promise<EphemeralKeyPackageVaultBundle | null> => {
  return readEncryptedRecord<EphemeralKeyPackageVaultBundle>(`ekp:${userId}:${keyPackageRef}`);
};

/**
 * Doğrulaması başarıyla tamamlanan tek kullanımlık KeyPackage özel anahtarını kasadan kalıcı olarak siler.
 */
export const deleteEphemeralKeyPackageBundle = async (
  userId: string,
  keyPackageRef: string
): Promise<void> => {
  await deleteEncryptedRecord(`ekp:${userId}:${keyPackageRef}`);
};

/**
 * Bir Welcome paketini açmak için tek kullanımlık KeyPackage paketini (ts-mls PrivateKeyPackage dahil)
 * okur ve Forward Secrecy (İleri Gizlilik) gereği yerel kasadan KALICI OLARAK SİLER.
 */
export const consumeEphemeralKeyPackageBundle = async (
  userId: string,
  keyPackageRef: string
): Promise<EphemeralKeyPackageVaultBundle | null> => {
  const stored = await peekEphemeralKeyPackageBundle(userId, keyPackageRef);
  if (!stored) return null;

  await deleteEphemeralKeyPackageBundle(userId, keyPackageRef);
  return stored;
};

/**
 * Bir Welcome paketini açmak için tek kullanımlık KeyPackage özel anahtarını okur
 * ve Forward Secrecy (İleri Gizlilik) gereği yerel kasadan KALICI OLARAK SİLER.
 */
export const consumeEphemeralKeyPackageKey = async (
  userId: string,
  keyPackageRef: string
): Promise<string | null> => {
  const bundle = await consumeEphemeralKeyPackageBundle(userId, keyPackageRef);
  return bundle ? bundle.privateKeyPkcs8Base64 : null;
};

/**
 * Test veya inceleme amacıyla belirli bir KeyPackage özel anahtarının hala kasada olup olmadığını kontrol eder.
 */
export const hasEphemeralKeyPackageKey = async (
  userId: string,
  keyPackageRef: string
): Promise<boolean> => {
  const stored = await readEncryptedRecord(`ekp:${userId}:${keyPackageRef}`);
  return Boolean(stored);
};

// ============================================================================
// 2. KONUŞMA BAZLI MLS EPOCH SIRLARI VE SECRET TREE DURUMU
// ============================================================================

export const getConversationMlsState = async (
  userId: string,
  conversationId: string
): Promise<StoredConversationMlsState | null> => {
  const state = await readEncryptedRecord<StoredConversationMlsState>('mls:' + userId + ':' + conversationId);
  if (state && Object.keys(state.epochSecrets).some((key) => {
    const epoch = Number(key);
    return epoch !== state.currentEpoch &&
      (Date.now() - (state.retainedEpochAt?.[epoch] ?? 0) > MAX_HISTORICAL_AGE_MS ||
        epoch < state.currentEpoch - MAX_RETAINED_EPOCHS + 1);
  })) {
    await saveConversationMlsState(userId, state);
  }
  return state;
};

export type MlsDeliveryFields = {
  fileKey?: string;
  fileType?: string;
  replyToId?: string;
  isForwarded?: boolean;
};

export interface StoredMlsDelivery {
  ciphertext: string;
  content: string;
  encryptedFileMetadata?: EncryptedFileMetadata | null;
  clientId: string;
  epoch: number;
  senderDeviceId: string;
  conversationId: string;
  editId?: string;
  delivery?: MlsDeliveryFields;
}

export const readQueuedMlsDelivery = (userId: string, conversationId: string, clientId: string) =>
  readEncryptedRecord<StoredMlsDelivery>('outbox:' + userId + ':' + conversationId + ':' + clientId);

export const removeQueuedMlsDelivery = (userId: string, conversationId: string, clientId: string) =>
  deleteEncryptedRecord('outbox:' + userId + ':' + conversationId + ':' + clientId);

export const listQueuedMlsDeliveries = async (userId: string) => {
  if (!isVaultUnlocked(userId)) return [];
  const records = await idbGetAllWithPrefix('outbox:' + userId + ':');
  const entries = await Promise.all(records.map(({ key }) => readEncryptedRecord<StoredMlsDelivery>(key)));
  return entries.filter((entry): entry is StoredMlsDelivery => Boolean(entry));
};

export const savePendingMlsCommit = (userId: string, state: StoredConversationMlsState, commitData: string) =>
  writeEncryptedRecord('commit:' + userId + ':' + state.conversationId, { state, commitData });

export const readPendingMlsCommit = (userId: string, conversationId: string) =>
  readEncryptedRecord<{ state: StoredConversationMlsState; commitData: string }>('commit:' + userId + ':' + conversationId);

export const saveConversationMlsState = async (
  userId: string,
  state: StoredConversationMlsState,
  options: {
    consumeKeyPackage?: string;
    clearPendingCommit?: boolean;
    outgoing?: StoredMlsDelivery;
    received?: VaultMessageEntry;
  } = {}
): Promise<void> => {
  const epochNumbers = Object.keys(state.epochSecrets)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const retainedEpochAt = Object.fromEntries(epochNumbers.map((epoch) =>
    [epoch, state.retainedEpochAt?.[epoch] ?? (epoch === state.currentEpoch ? Date.now() : 0)]));
  const retained = epochNumbers.filter((epoch) =>
    epoch === state.currentEpoch || Date.now() - retainedEpochAt[epoch] <= MAX_HISTORICAL_AGE_MS
  ).slice(-MAX_RETAINED_EPOCHS);
  const trimmedSecrets: Record<number, string> = {};
  const trimmedSchedules: Record<number, MlsEpochSecretsSchedule> = {};
  const trimmedContexts: Record<number, MlsGroupContext> = {};
  const trimmedSecretTrees: Record<number, Record<string, MlsSenderRatchetState>> = {};
  const trimmedTsMlsStates: Record<number, string> = {};

  for (const ep of retained) {
    trimmedSecrets[ep] = state.epochSecrets[ep];
    if (state.epochSchedules?.[ep]) {
      trimmedSchedules[ep] = state.epochSchedules[ep];
    }
    if (state.groupContextByEpoch?.[ep]) {
      trimmedContexts[ep] = state.groupContextByEpoch[ep];
    }
    if (state.secretTreeByEpoch?.[ep]) {
      trimmedSecretTrees[ep] = state.secretTreeByEpoch[ep];
    }
    if (state.tsMlsStatesByEpoch?.[ep]) {
      trimmedTsMlsStates[ep] = state.tsMlsStatesByEpoch[ep];
    }
  }
  if (state.tsMlsStateBase64 && state.currentEpoch > 0) {
    trimmedTsMlsStates[state.currentEpoch] = state.tsMlsStateBase64;
  }

  const records = [await prepareRecord('mls:' + userId + ':' + state.conversationId, {
    ...state,
    epochSecrets: trimmedSecrets,
    epochSchedules: trimmedSchedules,
    groupContextByEpoch: trimmedContexts,
    secretTreeByEpoch: trimmedSecretTrees,
    tsMlsStatesByEpoch: trimmedTsMlsStates,
    retainedEpochAt: Object.fromEntries(retained.map((epoch) => [epoch, retainedEpochAt[epoch]])),
    updatedAt: new Date().toISOString()
  })];
  if (options.outgoing) {
    const outgoing = options.outgoing;
    const hash = await computeCiphertextLookupKey(outgoing.ciphertext);
    records.push(await prepareRecord('sent_ct:' + userId + ':' + hash, outgoing));
    records.push(await prepareRecord('outbox:' + userId + ':' + state.conversationId + ':' + outgoing.clientId, outgoing));
  }
  if (options.received) records.push(await prepareRecord('msg:' + userId + ':' + options.received.id, options.received));
  const deletes: string[] = [];
  if (options.consumeKeyPackage) deletes.push('ekp:' + userId + ':' + options.consumeKeyPackage);
  if (options.clearPendingCommit) deletes.push('commit:' + userId + ':' + state.conversationId);
  await writeRecordsAtomically(records, deletes);
};

// ============================================================================
// 3. ÇÖZÜLMÜŞ MESAJ ÖNBELLEĞİ VE YEREL ARAMA / MEDYA İNDEKSİ
// ============================================================================

export const cacheDecryptedMessage = async (
  userId: string,
  entry: VaultMessageEntry
): Promise<void> => {
  await writeEncryptedRecord(`msg:${userId}:${entry.id}`, entry);
};

export const getCachedDecryptedMessage = async (
  userId: string,
  messageId: string
): Promise<VaultMessageEntry | null> => {
  return readEncryptedRecord<VaultMessageEntry>(`msg:${userId}:${messageId}`);
};

const computeCiphertextLookupKey = async (ciphertext: string): Promise<string> => {
  const bytes = textEncoder.encode(ciphertext);
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return bytesToBase64(new Uint8Array(digest));
};

export const getCachedOutgoingPlaintextByCiphertext = async (
  userId: string,
  ciphertext: string
): Promise<(import('./mlsClient').MlsApplicationPlaintext) | null> => {
  const lookup = await computeCiphertextLookupKey(ciphertext);
  return readEncryptedRecord<import('./mlsClient').MlsApplicationPlaintext>(`sent_ct:${userId}:${lookup}`);
};

export const listAllLocalMessages = async (userId: string): Promise<VaultMessageEntry[]> => {
  const rawRecords = await idbGetAllWithPrefix(`msg:${userId}:`);
  const entries: VaultMessageEntry[] = [];
  for (const item of rawRecords) {
    const parsed = await readEncryptedRecord<VaultMessageEntry>(item.key);
    if (parsed) entries.push(parsed);
  }
  return entries.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export const searchLocalMessages = async (
  userId: string,
  query: string
): Promise<VaultMessageEntry[]> => {
  const normalized = query.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return [];

  const allMessages = await listAllLocalMessages(userId);
  return allMessages
    .filter((msg) => msg.content && msg.content.toLocaleLowerCase('tr-TR').includes(normalized))
    .slice(0, 30);
};

export const getLocalConversationMedia = async (
  userId: string,
  conversationId: string
): Promise<{
  mediaMessages: VaultMessageEntry[];
  linkItems: Array<{ messageId: string; url: string; createdAt: string }>;
}> => {
  const allMessages = await listAllLocalMessages(userId);
  const convMessages = allMessages.filter((m) => m.conversationId === conversationId);

  const mediaMessages = convMessages.filter((m) => Boolean(m.fileKey));
  const linkItems = convMessages.flatMap((m) => {
    const urls = m.content?.match(/https?:\/\/[^\s]+/g) || [];
    return urls.map((url) => ({
      messageId: m.id,
      url,
      createdAt: m.createdAt
    }));
  });

  return { mediaMessages, linkItems };
};

// ============================================================================
// 4. SIFIR-BİLGİ (ZERO-KNOWLEDGE) YEDEKLEME İÇİN DIŞA / İÇE AKTARIM
// ============================================================================

export const exportVaultHistory = async (userId: string): Promise<VaultBackupSnapshot> => {
  // M4 (Forward Secrecy): Bulut yedeğine ham geçmiş epoch sırları veya özel yaprak anahtarları
  // DAHİL EDİLMEZ; yalnızca çözülmüş mesaj geçmişi yedeklenir. Yeni cihaz aktif sohbetlere
  // kendi yeni anahtarıyla (External Commit / Welcome) katılır.
  const messages = await listAllLocalMessages(userId);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    userId,
    conversationStates: [],
    messages
  };
};

export const importVaultHistory = async (
  userId: string,
  snapshot: VaultBackupSnapshot
): Promise<{ importedConversations: number; importedMessages: number }> => {
  if (snapshot.userId !== userId || snapshot.schemaVersion !== 1 || snapshot.conversationStates?.length) {
    throw new Error('Geçmiş arşivi bu hesaba ait olmalı ve canlı MLS durumu içermemeli.');
  }
  let importedMessages = 0;
  for (const msg of snapshot.messages || []) {
    await cacheDecryptedMessage(userId, msg);
    importedMessages++;
  }

  return { importedConversations: 0, importedMessages };
};

export const getStoredRecoveryKeyHint = async (userId: string): Promise<string | null> => {
  return readEncryptedRecord<string>(`recovery_hint:${userId}`);
};

export const saveRecoveryKeyHint = async (userId: string, hint: string): Promise<void> => {
  await writeEncryptedRecord(`recovery_hint:${userId}`, hint);
};

export const clearMemoryVaultForTests = (): void => {
  memoryKeyStore.clear();
  memoryRecordStore.clear();
};
