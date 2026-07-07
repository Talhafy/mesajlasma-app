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
// R2 eksik ayarla çalışırsa yükleme sırasında belirsiz hata üretmek yerine başlangıçta durur.
if (missingVariables.length > 0) {
  throw new Error(`Eksik Cloudflare R2 değişkenleri: ${missingVariables.join(', ')}`);
}

const bucketName = process.env.R2_BUCKET_NAME!;
const signedUrlTtlSeconds = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 900);

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
  // Orijinal isim anahtar olarak kullanılmaz; kullanıcı kontrollü yol ve çakışma riski engellenir.
  const extension = path.extname(originalName).toLowerCase().slice(0, 12);
  const fileKey = `${randomUUID()}${extension}`;

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: buffer,
    ContentType: contentType
  }));

  return fileKey;
};

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

export const deletePrivateFile = async (fileKey: string) => {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileKey }));
};

export const withSignedFileUrl = async <T extends { fileKey?: string | null }>(record: T) => {
  // DB kalıcı olarak yalnızca private object key tutar; istemciye süreli URL eklenir.
  return {
    ...record,
    fileUrl: record.fileKey ? await createSignedFileUrl(record.fileKey) : null
  };
};
