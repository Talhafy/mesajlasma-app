/**
 * ============================================================================
 * UÇTAN UCA ŞİFRELİ MEDYA VE DOSYA KATMANI (E2EE Attachment Crypto)
 * ============================================================================
 *
 * Bu modül, sohbet eklerini (resim, ses, video, belge) Cloudflare R2 veya
 * `/upload` uç noktasına yüklemeden önce istemcide tek kullanımlık 256-bit
 * `AES-256-GCM` anahtarı ile şifreler.
 *
 * IKİLİ FORMAT ("MSE1"):
 * - [0..3]   : "MSE1" sihirli baytları (0x4D 0x53 0x45 0x31) -> Backend MIME doğrulayıcısı için
 * - [4..15]  : 96-bit (12 bayt) rastgele AES-GCM IV (Nonce)
 * - [16..N]  : AES-256-GCM şifreli veri + 128-bit Auth Tag
 *
 * Dosyanın şifreleme anahtarı (`keyBase64`), IV (`ivBase64`), gerçek MIME tipi,
 * orijinal dosya adı ve SHA-256 bütünlük özeti yalnızca MLS ile uçtan uca
 * şifrelenen mesaj zarfının içindeki `encryptedFileMetadata` alanında taşınır.
 */

import {
  base64ToBytes,
  bytesToBase64,
  readGroupAttachment,
  saveGroupAttachment,
  type EncryptedFileMetadata
} from './vault';
import type { Message } from '../types/chat';

const MSE1_MAGIC = new Uint8Array([0x4d, 0x53, 0x45, 0x31]); // "MSE1"
const decryptedObjectUrlCache = new Map<string, string>();

export const computeSha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Ham bayt dizisini tek kullanımlık AES-256-GCM anahtarıyla "MSE1" zarfında şifreler.
 */
export const encryptBytesWithMse1 = async (
  plainBytes: Uint8Array,
  originalFileName: string,
  mimeType: string
): Promise<{
  encryptedBytes: Uint8Array;
  metadata: EncryptedFileMetadata;
}> => {
  const fileKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const rawKeyBuffer = await crypto.subtle.exportKey('raw', fileKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    fileKey,
    plainBytes as unknown as BufferSource
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);

  const combined = new Uint8Array(MSE1_MAGIC.byteLength + iv.byteLength + ciphertextBytes.byteLength);
  combined.set(MSE1_MAGIC, 0);
  combined.set(iv, MSE1_MAGIC.byteLength);
  combined.set(ciphertextBytes, MSE1_MAGIC.byteLength + iv.byteLength);

  const sha256Hex = await computeSha256Hex(combined);

  return {
    encryptedBytes: combined,
    metadata: {
      version: 1,
      algorithm: 'AES-256-GCM',
      keyBase64: bytesToBase64(new Uint8Array(rawKeyBuffer)),
      ivBase64: bytesToBase64(iv),
      mimeType: mimeType || 'application/octet-stream',
      originalFileName,
      sizeBytes: plainBytes.byteLength,
      sha256Hex
    }
  };
};

/**
 * "MSE1" zarfındaki şifreli baytları doğrular ve çözer.
 */
export const decryptBytesFromMse1 = async (
  encryptedBytes: Uint8Array,
  metadata: EncryptedFileMetadata
): Promise<Uint8Array> => {
  if (
    encryptedBytes.byteLength < 16 ||
    encryptedBytes[0] !== MSE1_MAGIC[0] ||
    encryptedBytes[1] !== MSE1_MAGIC[1] ||
    encryptedBytes[2] !== MSE1_MAGIC[2] ||
    encryptedBytes[3] !== MSE1_MAGIC[3]
  ) {
    throw new Error('Geçersiz MSE1 şifreli dosya başlığı.');
  }

  const actualHash = await computeSha256Hex(encryptedBytes);
  if (metadata.sha256Hex && actualHash !== metadata.sha256Hex) {
    throw new Error('Şifreli dosya bütünlük doğrulaması (SHA-256) başarısız oldu.');
  }

  const iv = encryptedBytes.slice(4, 16);
  const ciphertext = encryptedBytes.slice(16);
  const rawKey = base64ToBytes(metadata.keyBase64);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext as unknown as BufferSource
  );
  return new Uint8Array(plainBuffer);
};

/**
 * Bir `File` nesnesini R2'ye yüklenmeye hazır `.enc` (`application/octet-stream`) dosyasına dönüştürür.
 */
export const encryptAttachmentFile = async (
  file: File
): Promise<{
  encryptedFile: File;
  metadata: EncryptedFileMetadata;
}> => {
  const arrayBuffer = await file.arrayBuffer();
  const plainBytes = new Uint8Array(arrayBuffer);
  const { encryptedBytes, metadata } = await encryptBytesWithMse1(
    plainBytes,
    file.name,
    file.type || 'application/octet-stream'
  );

  const safeBaseName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
  const encryptedFile = new File(
    [encryptedBytes as unknown as BlobPart],
    `${safeBaseName}.enc`,
    { type: 'application/octet-stream' }
  );

  return { encryptedFile, metadata };
};

/**
 * R2 imzalı URL'sinden "MSE1" şifreli dosyayı indirir, bütünlüğünü doğrular,
 * çözer ve tarayıcıda görüntülenebilir bir `blob:` Object URL döner.
 */
export const decryptAttachmentToBlobUrl = async (
  fileUrl: string,
  metadataInput: string | EncryptedFileMetadata
): Promise<string> => {
  const metadata: EncryptedFileMetadata =
    typeof metadataInput === 'string' ? JSON.parse(metadataInput) : metadataInput;

  const cacheKey = `${metadata.sha256Hex}:${metadata.originalFileName}`;
  const cached = decryptedObjectUrlCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Şifreli medya indirilemedi (${response.status})`);
  }

  const encryptedBuffer = await response.arrayBuffer();
  const decryptedBytes = await decryptBytesFromMse1(new Uint8Array(encryptedBuffer), metadata);
  const blob = new Blob([decryptedBytes as unknown as BlobPart], {
    type: metadata.mimeType || 'application/octet-stream'
  });
  const objectUrl = URL.createObjectURL(blob);
  decryptedObjectUrlCache.set(cacheKey, objectUrl);
  return objectUrl;
};

export const cacheGroupAttachment = async (userId: string, message: Message, signal: AbortSignal) => {
  const { conversationId, fileKey, fileUrl } = message;
  if (!fileKey || !fileUrl || await readGroupAttachment(userId, conversationId, fileKey)) return;
  const response = await fetch(fileUrl, { signal });
  if (!response.ok) throw new Error(`Grup eki indirilemedi (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    signal.throwIfAborted();
    await saveGroupAttachment(userId, conversationId, fileKey, bytes, response.headers.get('content-type') || '');
  } finally {
    bytes.fill(0);
  }
};

export const openGroupAttachment = async (userId: string, message: Message): Promise<string | null> => {
  if (!message.fileKey) return null;
  const cached = await readGroupAttachment(userId, message.conversationId, message.fileKey);
  if (!cached) return null;
  const bytes = base64ToBytes(cached.bytes);
  const metadata: EncryptedFileMetadata | null = message.encryptedFileMetadata ? JSON.parse(message.encryptedFileMetadata) : null;
  const decoded = metadata ? await decryptBytesFromMse1(bytes, metadata) : bytes;
  try {
    const mimeType = metadata?.mimeType || cached.mimeType || 'application/octet-stream';
    return URL.createObjectURL(new Blob([decoded as unknown as BlobPart], { type: mimeType }));
  } finally {
    bytes.fill(0);
    decoded.fill(0);
  }
};
