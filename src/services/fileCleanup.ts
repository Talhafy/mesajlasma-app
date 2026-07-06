import prisma from '../db';
import { deletePrivateFile } from './fileStorage';

export const deleteFileIfUnreferenced = async (fileKey: string | null) => {
  if (!fileKey) return;

  const [messageReferences, scheduledReferences, avatarReferences] = await Promise.all([
    prisma.message.count({ where: { fileKey } }),
    prisma.scheduledMessage.count({ where: { fileKey } }),
    prisma.user.count({ where: { avatarFileKey: fileKey } })
  ]);

  // İletilen mesajlar aynı R2 nesnesini paylaşabildiği için son referans silinmeden nesne kaldırılmaz.
  if (messageReferences === 0 && scheduledReferences === 0 && avatarReferences === 0) {
    try {
      await deletePrivateFile(fileKey);
    } catch (error) {
      console.error(`R2 nesnesi silinemedi (${fileKey}):`, error);
    }
  }
};
