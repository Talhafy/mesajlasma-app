/**
 * ============================================================================
 * DOSYA VARLIĞI VE KARANTİNA SERVİSİ (Uploaded Asset & Quarantine Lifecycle)
 * ============================================================================
 * 
 * Bu servis, veritabanındaki 'UploadedAsset' tablosu üzerinden dosyaların yaşam döngüsünü
 * (Life Cycle), karantina statülerini ve sahiplik (ownership) güvenlik kurallarını yönetir.
 * 
 * STATÜ AKIŞI (Lifecycle States):
 * 1. QUARANTINE -> İlk dosya yüklendiğinde veritabanına açılan geçici/izole durum.
 * 2. READY      -> Virüs taraması ve magic-byte doğrulamasını başarıyla geçen güvenli durum.
 * 3. ATTACHED   -> Bir mesaja veya gruba kalıcı olarak bağlanan durum (süresi dolmaz).
 * 4. REJECTED   -> Güvenlik taramasından kalmış veya süresi dolduğu için reddedilmiş durum.
 */

import { createHash } from 'crypto';
import { Prisma, UploadedAssetStatus } from '@prisma/client';
import { uploadedAssetTtlHours } from '../config/env';
import { logger } from '../config/logger';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { copyPrivateFile, deletePrivateFile } from './fileStorage';

type AssetClient = Pick<Prisma.TransactionClient, 'uploadedAsset'>;
const pendingExpiry = () => new Date(Date.now() + uploadedAssetTtlHours * 60 * 60 * 1000);

/** Dosya bütünlüğünü doğrulamak için SHA-256 özeti üretir */
export const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Yüklenen dosyayı veritabanında ilk kez kayıt altına alır (Varsayılan: QUARANTINE).
 */
export const registerUploadedAsset = async (input: {
  fileKey: string;
  ownerId: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  status?: UploadedAssetStatus;
}) => prisma.uploadedAsset.create({
  data: {
    ...input,
    status: input.status ?? UploadedAssetStatus.QUARANTINE,
    expiresAt: pendingExpiry()
  }
});

/**
 * KARANTİNADAKİ DOSYAYI ONAYLAMA VE 'READY' STATÜSÜNE YÜKSELTME
 * Güvenlik taramasını geçen dosya QUARANTINE -> READY yapılır.
 */
export const confirmAndApproveAsset = async (fileKey: string, ownerId: string) => {
  const asset = await prisma.uploadedAsset.findUnique({ where: { fileKey } });
  if (!asset || asset.ownerId !== ownerId) {
    throw AppError.forbidden('ASSET_NOT_OWNED', 'Yalnızca kendi yüklediğiniz dosyayı doğrulayabilirsiniz.');
  }
  if (asset.status === UploadedAssetStatus.REJECTED) {
    throw AppError.badRequest('ASSET_EXPIRED_OR_REJECTED', 'Bu dosya reddedilmiş.');
  }

  return prisma.uploadedAsset.update({
    where: { id: asset.id },
    data: { status: UploadedAssetStatus.READY }
  });
};

/**
 * DOSYAYI BİR MESAJ VEYA GRUBA BAĞLAMA (ATTACHMENT)
 * 
 * Güvenlik Kuralları:
 * 1. Kullanıcı yalnızca KENDİ yüklediği dosyayı mesaja ekleyebilir (ASSET_NOT_OWNED).
 * 2. Karantinada (`QUARANTINE`) olan taranmamış dosyalar eklenemez.
 * 3. Bağlanan dosya `ATTACHED` durumuna geçer ve son kullanma tarihi (`expiresAt`) kaldırılır.
 */
export const attachOwnedAsset = async (
  fileKey: string,
  ownerId: string,
  client: AssetClient = prisma
) => {
  const asset = await client.uploadedAsset.findUnique({ where: { fileKey } });
  if (!asset || asset.ownerId !== ownerId) {
    throw AppError.forbidden('ASSET_NOT_OWNED', 'Yalnızca kendi yüklediğiniz dosyayı kullanabilirsiniz.');
  }
  if (asset.status === UploadedAssetStatus.QUARANTINE) {
    throw AppError.badRequest('ASSET_EXPIRED_OR_REJECTED', 'Dosya henüz güvenlik taramasından geçmedi, karantinada.');
  }
  if (asset.status === UploadedAssetStatus.REJECTED || (asset.expiresAt && asset.expiresAt <= new Date())) {
    throw AppError.badRequest('ASSET_EXPIRED_OR_REJECTED', 'Bu dosyanın yükleme süresi dolmuş veya dosya reddedilmiş.');
  }

  if (asset.status === UploadedAssetStatus.READY) {
    await client.uploadedAsset.update({
      where: { id: asset.id },
      data: { status: UploadedAssetStatus.ATTACHED, expiresAt: null, attachedAt: new Date() }
    });
  }
  return asset;
};

/**
 * İLETİLEN MESAJ İÇİN DOSYA KLONLAMA
 */
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

/**
 * HİÇBİR MESAJA BAĞLANMAMIŞ VEYA SÜRESİ DOLMUŞ YETİM DOSYALARI TEMİZLEME
 */
export const removeExpiredUnattachedAssets = async () => {
  const now = new Date();
  const candidates = await prisma.uploadedAsset.findMany({
    where: { status: UploadedAssetStatus.READY, expiresAt: { lte: now } },
    take: 100,
    orderBy: { expiresAt: 'asc' }
  });

  for (const asset of candidates) {
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
      logger.error({ event: 'storage.unattached_asset_cleanup_failed', err: error, fileKey: asset.fileKey }, 'Expired unattached asset cleanup failed');
    }
  }
};
