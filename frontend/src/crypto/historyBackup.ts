/**
 * ============================================================================
 * KULLANICI KONTROLLÜ SIFIR-BİLGİ ŞİFRELİ GEÇMİŞ YEDEĞİ (Zero-Knowledge Backup)
 * ============================================================================
 *
 * Bu modül, kullanıcının şifreli yerel kasasındaki (IndexedDB) mesaj geçmişini
 * ve MLS konuşma epoch durumlarını yalnızca kullanıcının bildiği Kurtarma
 * Anahtarı (Recovery Key) ile şifreleyerek Cloudflare R2'ye yedekler ve yeni
 * cihazlarda geri yükler.
 *
 * KRİPTOGRAFİK AKIŞ:
 * 1. Kurtarma Anahtarı (Recovery Key): 160-bit CSPRNG entropili, okunabilir
 *    Base32 formatında (`XXXX-XXXX-...`) üretilir.
 * 2. Anahtar Türetme (KDF): `PBKDF2-SHA256` (600.000 iterasyon + 128-bit rastgele salt)
 *    ile 256-bit `AES-256-GCM` şifreleme anahtarı türetilir.
 * 3. Paketleme ("MSE1"): `[MSE1 (4B)] + [IV (12B)] + [AES-256-GCM Ciphertext + Tag]`
 *    formatında R2'ye yüklenir, manifesti `/mls/backups` uç noktasına kaydedilir.
 */

import { api } from '../api/httpClient';
import { computeSha256Hex } from './fileCrypto';
import {
  base64ToBytes,
  bytesToBase64,
  exportVaultHistory,
  importVaultHistory,
  saveRecoveryKeyHint,
  type VaultBackupSnapshot
} from './vault';

const MSE1_MAGIC = new Uint8Array([0x4d, 0x53, 0x45, 0x31]);
const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export interface EncryptedBackupManifestMeta {
  kdfSalt: string;
  kdfAlgorithm: 'PBKDF2-SHA256';
  kdfParams: string;
  cipherNonce: string;
  checksum: string;
  sizeBytes: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Kullanıcıya gösterilecek yüksek entropili (160-bit) Kurtarma Anahtarı üretir.
 * Örnek: "K7M9-P4X2-R8W3-N5V6-J2H4-T9L8-B3C7-Q6F5"
 */
export const generateRecoveryKey = (): string => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const chars: string[] = [];
  for (let i = 0; i < 32; i++) {
    chars.push(BASE32_ALPHABET[randomBytes[i] % BASE32_ALPHABET.length]);
  }
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    groups.push(chars.slice(i, i + 4).join(''));
  }
  return groups.join('-');
};

export const normalizeRecoveryKey = (recoveryKey: string): string =>
  recoveryKey.replace(/[\s-]+/g, '').toUpperCase();

const deriveBackupAesKey = async (
  recoveryKey: string,
  saltBytes: Uint8Array,
  iterations: number
): Promise<CryptoKey> => {
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 16) {
    throw new Error('Kurtarma anahtarı en az 16 karakter olmalıdır.');
  }

  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(normalized),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Yerel kasadaki geçmişi Kurtarma Anahtarı ile şifreleyip "MSE1" ikili zarfı ve manifest meta verisi üretir.
 */
export const createEncryptedBackupPayload = async (
  userId: string,
  recoveryKey: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<{
  encryptedBytes: Uint8Array;
  manifest: EncryptedBackupManifestMeta;
  snapshot: VaultBackupSnapshot;
}> => {
  const snapshot = await exportVaultHistory(userId);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveBackupAesKey(recoveryKey, saltBytes, iterations);

  const plaintextBytes = textEncoder.encode(JSON.stringify(snapshot));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    plaintextBytes
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);

  const encryptedBytes = new Uint8Array(
    MSE1_MAGIC.byteLength + ivBytes.byteLength + ciphertextBytes.byteLength
  );
  encryptedBytes.set(MSE1_MAGIC, 0);
  encryptedBytes.set(ivBytes, MSE1_MAGIC.byteLength);
  encryptedBytes.set(ciphertextBytes, MSE1_MAGIC.byteLength + ivBytes.byteLength);

  const checksum = await computeSha256Hex(encryptedBytes);

  return {
    encryptedBytes,
    snapshot,
    manifest: {
      kdfSalt: bytesToBase64(saltBytes),
      kdfAlgorithm: 'PBKDF2-SHA256',
      kdfParams: JSON.stringify({ iterations }),
      cipherNonce: bytesToBase64(ivBytes),
      checksum,
      sizeBytes: encryptedBytes.byteLength
    }
  };
};

/**
 * Şifreli "MSE1" yedek zarfını Kurtarma Anahtarı ve manifest parametreleriyle çözer.
 */
export const decryptBackupPayload = async (
  encryptedBytes: Uint8Array,
  recoveryKey: string,
  manifest: Pick<EncryptedBackupManifestMeta, 'kdfSalt' | 'kdfParams' | 'cipherNonce' | 'checksum'>
): Promise<VaultBackupSnapshot> => {
  if (
    encryptedBytes.byteLength < 16 ||
    encryptedBytes[0] !== MSE1_MAGIC[0] ||
    encryptedBytes[1] !== MSE1_MAGIC[1] ||
    encryptedBytes[2] !== MSE1_MAGIC[2] ||
    encryptedBytes[3] !== MSE1_MAGIC[3]
  ) {
    throw new Error('Geçersiz yedek dosyası formatı (MSE1 başlığı bulunamadı).');
  }

  const actualChecksum = await computeSha256Hex(encryptedBytes);
  if (manifest.checksum && actualChecksum !== manifest.checksum) {
    throw new Error('Şifreli yedek dosyasının SHA-256 bütünlük doğrulaması başarısız oldu.');
  }

  const parsedParams = JSON.parse(manifest.kdfParams || '{}') as { iterations?: number };
  const iterations = Number(parsedParams.iterations) || DEFAULT_PBKDF2_ITERATIONS;
  const saltBytes = base64ToBytes(manifest.kdfSalt);
  const ivBytes = encryptedBytes.slice(4, 16);
  const ciphertextBytes = encryptedBytes.slice(16);

  const aesKey = await deriveBackupAesKey(recoveryKey, saltBytes, iterations);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      ciphertextBytes as unknown as BufferSource
    );
    return JSON.parse(textDecoder.decode(plainBuffer)) as VaultBackupSnapshot;
  } catch {
    throw new Error('Kurtarma anahtarı hatalı veya yedek verisi bozulmuş.');
  }
};

/**
 * Yerel kasayı şifreler, R2'ye yükler ve `/mls/backups` manifestini günceller.
 */
export const uploadEncryptedHistoryBackup = async (
  userId: string,
  recoveryKey: string
): Promise<{
  backupVersion: number;
  messageCount: number;
  conversationCount: number;
  updatedAt: string;
}> => {
  const { encryptedBytes, manifest, snapshot } = await createEncryptedBackupPayload(
    userId,
    recoveryKey
  );

  // Mevcut yedek sürümünü kontrol et (optimistic concurrency)
  const latestRes = await api.get<{
    backup: { backupVersion: number } | null;
  }>('/mls/backups/latest');
  const expectedPreviousVersion = latestRes.data?.backup?.backupVersion;

  const backupFile = new File(
    [encryptedBytes as unknown as BlobPart],
    `vault-backup-${Date.now()}.enc`,
    { type: 'application/octet-stream' }
  );
  const formData = new FormData();
  formData.append('file', backupFile);

  const uploadRes = await api.post<{ fileKey: string }>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

  const saveRes = await api.post<{
    backup: { backupVersion: number; updatedAt: string };
  }>('/mls/backups', {
    fileKey: uploadRes.data.fileKey,
    ...manifest,
    ...(expectedPreviousVersion !== undefined ? { expectedPreviousVersion } : {})
  });

  const normalized = normalizeRecoveryKey(recoveryKey);
  await saveRecoveryKeyHint(userId, `${normalized.slice(0, 4)}-****-****-${normalized.slice(-4)}`);

  return {
    backupVersion: saveRes.data.backup.backupVersion,
    messageCount: snapshot.messages.length,
    conversationCount: snapshot.conversationStates.length,
    updatedAt: saveRes.data.backup.updatedAt
  };
};

/**
 * Sunucudan en son şifreli yedeği indirir, Kurtarma Anahtarı ile çözer ve yerel kasaya aktarır.
 */
export const restoreEncryptedHistoryBackup = async (
  userId: string,
  recoveryKey: string
): Promise<{
  backupVersion: number;
  importedConversations: number;
  importedMessages: number;
}> => {
  const latestRes = await api.get<{
    backup: (EncryptedBackupManifestMeta & {
      backupVersion: number;
      downloadUrl: string;
    }) | null;
  }>('/mls/backups/latest');

  const backup = latestRes.data?.backup;
  if (!backup || !backup.downloadUrl) {
    throw new Error('Hesabınıza ait kayıtlı bir şifreli geçmiş yedeği bulunamadı.');
  }

  const blobResponse = await fetch(backup.downloadUrl);
  if (!blobResponse.ok) {
    throw new Error(`Şifreli yedek dosyası indirilemedi (${blobResponse.status}).`);
  }

  const encryptedBytes = new Uint8Array(await blobResponse.arrayBuffer());
  const snapshot = await decryptBackupPayload(encryptedBytes, recoveryKey, backup);
  const { importedConversations, importedMessages } = await importVaultHistory(userId, snapshot);

  const normalized = normalizeRecoveryKey(recoveryKey);
  await saveRecoveryKeyHint(userId, `${normalized.slice(0, 4)}-****-****-${normalized.slice(-4)}`);

  return {
    backupVersion: backup.backupVersion,
    importedConversations,
    importedMessages
  };
};
