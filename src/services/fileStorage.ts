import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { logger } from '../config/logger';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';

const requiredVariables = [
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME'
] as const;

const missingVariables = requiredVariables.filter((key) => !process.env[key]);
// R2 özel/private bucket olarak kullanıldığı için bu değişkenler olmadan sunucuyu başlatmıyoruz.
// Aksi durumda hata ancak kullanıcı dosya yükleyince ortaya çıkar ve teşhis edilmesi zorlaşır.
// R2 eksik ayarla çalışırsa yükleme sırasında belirsiz hata üretmek yerine başlangıçta durur.
if (missingVariables.length > 0) {
  throw new Error(`Eksik Cloudflare R2 değişkenleri: ${missingVariables.join(', ')}`);
}

const bucketName = process.env.R2_BUCKET_NAME!;
const signedUrlTtlSeconds = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 900);
// Signed URL kısa ömürlü olmalı: çok kısa olursa kullanıcı dosyayı açamadan süre dolabilir,
// çok uzun olursa özel bucket mantığının güvenlik avantajı azalır.

if (!Number.isInteger(signedUrlTtlSeconds) || signedUrlTtlSeconds < 60 || signedUrlTtlSeconds > 3600) {
  throw new Error('R2_SIGNED_URL_TTL_SECONDS 60 ile 3600 arasında olmalıdır.');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
  }
});

export const uploadPrivateFile = async (
  buffer: Buffer,
  contentType: string,
  originalName: string
) => {
  // Kullanıcının yüklediği dosya adı yalnızca görünen ad olarak saklanır.
  // R2 object key ise UUID ile üretilir; bu hem çakışmayı hem de path traversal benzeri riskleri engeller.
  // Orijinal isim anahtar olarak kullanılmaz; kullanıcı kontrollü yol ve çakışma riski engellenir.
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

export const createSignedFileUrl = async (fileKey: string) => {
  try {
    // Dosyalar public URL ile değil, süreli signed URL ile sunulur.
    // Bu URL süresi bitince tekrar backend'den yenisi alınmalıdır.
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

export const deletePrivateFile = async (fileKey: string) => {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey }));
  } catch (error) {
    logger.error({ event: 'storage.r2_delete_failed', err: error, fileKey }, 'R2 object deletion failed');
    throw error;
  }
};

export const withSignedFileUrl = async <T extends { fileKey?: string | null }>(record: T) => {
  // API cevaplarında fileKey kalıcı referans olarak durur; fileUrl ise anlık erişim için üretilen geçici URL'dir.
  // DB kalıcı olarak yalnızca private object key tutar; istemciye süreli URL eklenir.
  return {
    ...record,
    fileUrl: record.fileKey ? await createSignedFileUrl(record.fileKey) : null
  };
};
