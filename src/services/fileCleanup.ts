import prisma from '../db';
import { logger } from '../config/logger';
import { deletePrivateFile } from './fileStorage';

export const deleteFileIfUnreferenced = async (fileKey: string | null) => {
  if (!fileKey) return;

  // Aynı R2 nesnesi birden fazla mesajda, zamanlanmış mesajda veya avatar olarak referanslanabilir.
  // Bu yüzden dosyayı silmeden önce üç tablodaki referansları tek tek kontrol ediyoruz.
  // Sorguları bilinçli olarak paralel değil sıralı çalıştırıyoruz; Prisma 7 + adapter-pg transaction uyarılarını azaltır.
  const messageReferences = await prisma.message.count({ where: { fileKey } });
  const scheduledReferences = await prisma.scheduledMessage.count({ where: { fileKey } });
  const avatarReferences = await prisma.user.count({ where: { avatarFileKey: fileKey } });

  // İletilen mesajlar aynı R2 nesnesini paylaşabildiği için son referans silinmeden nesne kaldırılmaz.
  if (messageReferences === 0 && scheduledReferences === 0 && avatarReferences === 0) {
    try {
      await deletePrivateFile(fileKey);
    } catch (error) {
      logger.error({ event: 'storage.r2_delete_failed', err: error, fileKey }, 'R2 object deletion failed');
    }
  }
};
