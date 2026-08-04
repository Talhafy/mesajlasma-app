/**
 * ============================================================================
 * CLOUDFLARE R2 / S3 DEPOLAMA SERVİSİ (Private Asset Storage & Presigned URLs)
 * ============================================================================
 * 
 * Bu servis, kullanıcıların yüklediği dosya/resim/ses kayıtlarını güvenli ve private
 * olarak Cloudflare R2 (S3 Uyumlu Nesne Depolama) üzerinde yönetir.
 * 
 * GÜVENLİK İLKELERİ:
 * 1. Hiçbir dosya sunucu yerel diskinde tutulmaz (Direct-to-R2 veya Stream modeli).
 * 2. Orijinal dosya adları depolama anahtarı (key) olarak kullanılmaz (`randomUUID()`).
 *    Bu sayede Path Traversal (dizin gezinme) ve çakışma riski engellenir.
 * 3. Dosyalar public URL'ye sahip değildir; yalnızca süreli (10-15 dk) Presigned URL ile okunabilir.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import { Readable } from 'stream';
import { logger } from '../config/logger';

/** Zorunlu Cloudflare R2 ortam değişkenleri listesi */
const requiredVariables = [
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME'
] as const;

const missingVariables = requiredVariables.filter((key) => !process.env[key]);
if (missingVariables.length > 0) {
  throw new Error(`Eksik Cloudflare R2 değişkenleri: ${missingVariables.join(', ')}`);
}

/** R2 Kovası (Bucket) Adı */
const bucketName = process.env.R2_BUCKET_NAME!;

/** İmzalı URL geçerlilik süresi (Saniye) */
const signedUrlTtlSeconds = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 900);

if (!Number.isInteger(signedUrlTtlSeconds) || signedUrlTtlSeconds < 60 || signedUrlTtlSeconds > 3600) {
  throw new Error('R2_SIGNED_URL_TTL_SECONDS 60 ile 3600 arasında olmalıdır.');
}

/** AWS S3 İstemcisi - Cloudflare R2 entegrasyonu */
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
  }
});

/**
 * DIRECT-TO-R2 PRESIGNED PUT URL ÜRETİCİ
 * İstemcinin dosyayı sunucuya göndermeden doğrudan Cloudflare R2'ye yüklemesini sağlar.
 * Sunucu RAM ve CPU yükünü sıfırlar. 10 dakika geçerlidir.
 */
export const createPresignedUploadUrl = async (
  originalName: string,
  contentType: string
) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  const fileKey = `${randomUUID()}${extension}`;

  try {
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType
      }),
      { expiresIn: 600 }
    );

    return { fileKey, uploadUrl, expiresAt: new Date(Date.now() + 600_000) };
  } catch (error) {
    logger.error({
      event: 'storage.r2_presigned_url_failed',
      err: error,
      originalName,
      contentType
    }, 'Direct-to-R2 presigned upload URL generation failed');
    throw error;
  }
};

/**
 * STREAM YÜKLEME (Stream Direct-to-R2)
 * Büyük dosyaları RAM tamponuna almadan doğrudan akış (stream) halinde R2'ye yazar.
 */
export const uploadStreamToR2 = async (
  stream: Readable,
  contentType: string,
  originalName: string
) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  const fileKey = `${randomUUID()}${extension}`;

  try {
    const parallelUpload = new Upload({
      client: s3,
      params: {
        Bucket: bucketName,
        Key: fileKey,
        Body: stream,
        ContentType: contentType
      }
    });

    await parallelUpload.done();
    return fileKey;
  } catch (error) {
    logger.error({
      event: 'storage.r2_stream_upload_failed',
      err: error,
      fileKey,
      contentType
    }, 'R2 stream upload failed');
    throw error;
  }
};

/**
 * BUFFER İLE ÖZEL DOSYA YÜKLEME
 * Küçük boyutlu dosyaları (profil resmi vb.) R2'ye yükler.
 */
export const uploadPrivateFile = async (
  buffer: Buffer,
  contentType: string,
  originalName: string
) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  const fileKey = `${randomUUID()}${extension}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: buffer,
      ContentType: contentType
    }));
  } catch (error) {
    logger.error({
      event: 'storage.r2_upload_failed',
      err: error,
      fileKey,
      contentType,
      size: buffer.length
    }, 'R2 object upload failed');
    throw error;
  }

  return fileKey;
};

/**
 * SÜRELİ İMZALI ERİŞİM URL'Sİ ÜRETİCİ (Presigned Get URL)
 * İstemcinin private olan dosyayı güvenle görüntüleyebilmesi için 15 dakikalık geçici erişim adresi döner.
 */
export const createSignedFileUrl = async (fileKey: string) => {
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucketName, Key: fileKey }),
      { expiresIn: signedUrlTtlSeconds }
    );
  } catch (error) {
    logger.error({ event: 'storage.signed_url_failed', err: error, fileKey }, 'Signed URL generation failed');
    throw error;
  }
};

/**
 * ÖZEL DOSYAYI R2'DEN SİLME
 */
export const deletePrivateFile = async (fileKey: string) => {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey }));
  } catch (error) {
    logger.error({ event: 'storage.r2_delete_failed', err: error, fileKey }, 'R2 object deletion failed');
    throw error;
  }
};

/**
 * İLETİLEN MESAJ DOSYASINI KOPYALAMA (Copy Object)
 * İletilen medya dosyası için yeni ve bağımsız bir nesne anahtarı türetir.
 */
export const copyPrivateFile = async (sourceFileKey: string, originalName: string) => {
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  const fileKey = `${randomUUID()}${extension}`;
  try {
    await s3.send(new CopyObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      CopySource: `${bucketName}/${encodeURIComponent(sourceFileKey).replace(/%2F/g, '/')}`
    }));
    return fileKey;
  } catch (error) {
    logger.error({ event: 'storage.r2_copy_failed', err: error, sourceFileKey, fileKey }, 'R2 object copy failed');
    throw error;
  }
};

/**
 * KAYIT NESNESİNE SÜRELİ EŞLEŞEN DOSYA URL'Sİ EKLEYİCİ
 */
export const withSignedFileUrl = async <T extends { fileKey?: string | null }>(record: T) => {
  return {
    ...record,
    fileUrl: record.fileKey ? await createSignedFileUrl(record.fileKey) : null
  };
};

