/**
 * ============================================================================
 * ÇÖP DOSYA VE DEPOLAMA TEMİZLİK SERVİSİ (File Cleanup Service)
 * ============================================================================
 * 
 * Bu modül, Cloudflare R2 üzerindeki yetim (unreferenced) kalan dosyaların ve görsellerin
 * veritabanından ve nesne depolamasından güvenle silinmesini sağlar.
 */

import prisma from '../db';
import { logger } from '../config/logger';
import { deletePrivateFile } from './fileStorage';

/**
 * Mesaj, avatar ve şifreli yedek referanslarını kontrol eder.
 * Hiçbir yerde kullanılmıyorsa dosyayı Cloudflare R2'den ve `uploadedAsset` tablosundan siler.
 */
export const deleteFileIfUnreferenced = async (fileKey: string | null) => {
  if (!fileKey) return;

  // Referansları sıralı sorgula (adapter-pg uyumu için).
  const messageReferences = await prisma.message.count({ where: { fileKey } });
  const userAvatarReferences = await prisma.user.count({ where: { avatarFileKey: fileKey } });
  const groupAvatarReferences = await prisma.conversation.count({ where: { avatarFileKey: fileKey } });
  const backupReferences = await prisma.encryptedHistoryBackup?.count
    ? await prisma.encryptedHistoryBackup.count({ where: { fileKey } })
    : 0;

  // İletilen mesajlar aynı R2 nesnesini paylaşabildiği için son referans silinmeden nesne kaldırılmaz.
  if (
    messageReferences === 0 &&
    userAvatarReferences === 0 &&
    groupAvatarReferences === 0 &&
    backupReferences === 0
  ) {
    const asset = await prisma.uploadedAsset.findUnique({ where: { fileKey } });
    if (asset?.status === 'READY') return;
    try {
      await deletePrivateFile(fileKey);
      if (asset) await prisma.uploadedAsset.delete({ where: { id: asset.id } });
    } catch (error) {
      logger.error({ event: 'storage.r2_delete_failed', err: error, fileKey }, 'R2 object deletion failed');
    }
  }
};

