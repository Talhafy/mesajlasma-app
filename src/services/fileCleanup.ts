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
 * Belirtilen `fileKey` nesnesinin veritabanındaki (Mesajlar, Zamanlanmış Mesajlar, 
 * Kullanıcı Avatarları, Grup Avatarları) referans sayılarını kontrol eder.
 * Hiçbir yerde kullanılmıyorsa dosyayı Cloudflare R2'den ve `uploadedAsset` tablosundan siler.
 */
export const deleteFileIfUnreferenced = async (fileKey: string | null) => {
  if (!fileKey) return;

  // Aynı R2 nesnesi birden fazla mesajda, zamanlanmış mesajda veya avatar olarak referanslanabilir.
  // Bu yüzden dosyayı silmeden önce dört tablodaki referansları sıralı sorguluyoruz (adapter-pg uyumu için).
  const messageReferences = await prisma.message.count({ where: { fileKey } });
  const scheduledReferences = await prisma.scheduledMessage.count({ where: { fileKey } });
  const userAvatarReferences = await prisma.user.count({ where: { avatarFileKey: fileKey } });
  const groupAvatarReferences = await prisma.conversation.count({ where: { avatarFileKey: fileKey } });

  // İletilen mesajlar aynı R2 nesnesini paylaşabildiği için son referans silinmeden nesne kaldırılmaz.
  if (messageReferences === 0 && scheduledReferences === 0 && userAvatarReferences === 0 && groupAvatarReferences === 0) {
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

