/**
 * ============================================================================
 * KULLANICI KONTROLLÜ ŞİFRELİ GEÇMİŞ YEDEĞİ SERVİSİ (Zero-Knowledge History Backup)
 * ============================================================================
 * 
 * Bu servis, kullanıcının yalnızca kendisinin bildiği Kurtarma Anahtarı (Recovery Key)
 * ile istemcide şifreleyip Cloudflare R2'ye yüklediği mesaj geçmişi yedeğinin
 * meta verilerini (KDF salt, algoritma parametreleri, nonce, sürüm ve R2 anahtarı) yönetir.
 * 
 * SIFIR-BİLGİ (ZERO-KNOWLEDGE) PRENSİBİ:
 * - Sunucu Kurtarma Anahtarını veya türetilmiş şifreleme anahtarını asla görmez.
 * - R2 üzerindeki yedek dosyası istemcide AES-256-GCM ("MSE1" başlığı) ile şifrelenmiştir.
 * - Sürüm çakışmalarını önlemek için `expectedPreviousVersion` ile iyimser kilitleme
 *   (optimistic concurrency control) uygulanır.
 */

import prisma from '../db';
import { AppError } from '../errors/AppError';
import { deleteFileIfUnreferenced } from './fileCleanup';
import { createSignedFileUrl } from './fileStorage';
import { attachOwnedAsset } from './uploadedAssetService';

/**
 * Kullanıcının şifreli geçmiş yedeği manifestini kaydeder ve eski yedek dosyasını temizler.
 */
export const saveEncryptedBackupManifest = async (
  userId: string,
  input: {
    fileKey: string;
    kdfSalt: string;
    kdfAlgorithm?: string;
    kdfParams: string;
    cipherNonce: string;
    checksum: string;
    sizeBytes: number;
    expectedPreviousVersion?: number;
  }
) => {
  const existing = await prisma.encryptedHistoryBackup.findUnique({
    where: { userId }
  });

  if (
    input.expectedPreviousVersion !== undefined &&
    existing &&
    existing.backupVersion !== input.expectedPreviousVersion
  ) {
    throw new AppError(
      'BACKUP_VERSION_CONFLICT',
      'Şifreli yedek başka bir cihaz tarafından güncellendi. Lütfen önce son yedeği birleştirin.',
      409,
      { currentVersion: existing.backupVersion }
    );
  }

  const nextVersion = existing ? existing.backupVersion + 1 : 1;

  const saved = await prisma.$transaction(async (tx) => {
    await attachOwnedAsset(input.fileKey, userId, tx);

    return tx.encryptedHistoryBackup.upsert({
      where: { userId },
      create: {
        userId,
        fileKey: input.fileKey,
        kdfSalt: input.kdfSalt,
        kdfAlgorithm: input.kdfAlgorithm || 'PBKDF2-SHA256',
        kdfParams: input.kdfParams,
        cipherNonce: input.cipherNonce,
        checksum: input.checksum,
        backupVersion: 1,
        sizeBytes: input.sizeBytes
      },
      update: {
        fileKey: input.fileKey,
        kdfSalt: input.kdfSalt,
        kdfAlgorithm: input.kdfAlgorithm || 'PBKDF2-SHA256',
        kdfParams: input.kdfParams,
        cipherNonce: input.cipherNonce,
        checksum: input.checksum,
        backupVersion: nextVersion,
        sizeBytes: input.sizeBytes
      }
    });
  });

  if (existing && existing.fileKey !== input.fileKey) {
    await deleteFileIfUnreferenced(existing.fileKey);
  }

  return {
    ...saved,
    downloadUrl: await createSignedFileUrl(saved.fileKey)
  };
};

/**
 * Kullanıcının en güncel şifreli geçmiş yedeği manifestini ve imzalı R2 indirme adresini döner.
 */
export const getEncryptedBackupManifest = async (userId: string) => {
  const backup = await prisma.encryptedHistoryBackup.findUnique({
    where: { userId }
  });
  if (!backup) return null;

  return {
    ...backup,
    downloadUrl: await createSignedFileUrl(backup.fileKey)
  };
};
