import { createHash } from 'crypto';
import { Prisma, UploadedAssetStatus } from '@prisma/client';
import { uploadedAssetTtlHours } from '../config/env';
import { logger } from '../config/logger';
import prisma from '../db';
import { copyPrivateFile, deletePrivateFile } from './fileStorage';

type AssetClient = Pick<Prisma.TransactionClient, 'uploadedAsset'>;
const pendingExpiry = () => new Date(Date.now() + uploadedAssetTtlHours * 60 * 60 * 1000);

export const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export const registerUploadedAsset = async (input: {
  fileKey: string;
  ownerId: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}) => prisma.uploadedAsset.create({
  data: {
    ...input,
    status: UploadedAssetStatus.READY,
    expiresAt: pendingExpiry()
  }
});

export const attachOwnedAsset = async (
  fileKey: string,
  ownerId: string,
  client: AssetClient = prisma
) => {
  const asset = await client.uploadedAsset.findUnique({ where: { fileKey } });
  if (!asset || asset.ownerId !== ownerId) {
    throw new Error('Yalnızca kendi yüklediğiniz dosyayı kullanabilirsiniz.');
  }
  if (asset.status === UploadedAssetStatus.REJECTED || (asset.expiresAt && asset.expiresAt <= new Date())) {
    throw new Error('Bu dosyanın yükleme süresi dolmuş veya dosya reddedilmiş.');
  }

  if (asset.status === UploadedAssetStatus.READY) {
    await client.uploadedAsset.update({
      where: { id: asset.id },
      data: { status: UploadedAssetStatus.ATTACHED, expiresAt: null, attachedAt: new Date() }
    });
  }
  return asset;
};

// Callers must establish that the user is allowed to read the source message before calling this.
// The copied object becomes a new READY asset owned by the forwarding user, then is attached by the
// surrounding message creation flow.
export const cloneAssetForOwner = async (input: {
  sourceFileKey: string;
  sourceAsset: { mimeType: string; sizeBytes: number; checksum: string };
  ownerId: string;
  originalName: string;
}) => {
  const copiedFileKey = await copyPrivateFile(input.sourceFileKey, input.originalName);
  try {
    await registerUploadedAsset({
      fileKey: copiedFileKey,
      ownerId: input.ownerId,
      mimeType: input.sourceAsset.mimeType,
      sizeBytes: input.sourceAsset.sizeBytes,
      checksum: input.sourceAsset.checksum
    });
    return copiedFileKey;
  } catch (error) {
    await deletePrivateFile(copiedFileKey).catch(() => undefined);
    throw error;
  }
};

export const removeExpiredUnattachedAssets = async () => {
  const now = new Date();
  const candidates = await prisma.uploadedAsset.findMany({
    where: { status: UploadedAssetStatus.READY, expiresAt: { lte: now } },
    take: 100,
    orderBy: { expiresAt: 'asc' }
  });

  for (const asset of candidates) {
    // Claiming the row prevents a concurrent attachment from being removed by this cleanup pass.
    const claimed = await prisma.uploadedAsset.updateMany({
      where: { id: asset.id, status: UploadedAssetStatus.READY, expiresAt: { lte: now } },
      data: { status: UploadedAssetStatus.REJECTED }
    });
    if (claimed.count !== 1) continue;

    try {
      await deletePrivateFile(asset.fileKey);
      await prisma.uploadedAsset.delete({ where: { id: asset.id } });
      logger.info({ event: 'storage.unattached_asset_deleted', fileKey: asset.fileKey }, 'Expired unattached asset deleted');
    } catch (error) {
      // REJECTED is intentionally retained if object deletion fails so no caller can attach it.
      logger.error({ event: 'storage.unattached_asset_cleanup_failed', err: error, fileKey: asset.fileKey }, 'Expired unattached asset cleanup failed');
    }
  }
};
