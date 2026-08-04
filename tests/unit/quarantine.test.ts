/**
 * ============================================================================
 * DOSYA KARANTİNA VE GÜVENLİK AKIŞI BİRİM TESTLERİ (Quarantine Asset Security Tests)
 * ============================================================================
 * 
 * Bu dosya, yeni yüklenen dosyaların varsayılan olarak `QUARANTINE` statüsünde 
 * kaydedildiğini, taranmadan mesaja bağlanamadığını, onaylandıktan sonra `READY` 
 * statüsüne geçtiğini ve Cloudflare R2 doğrudan yükleme URL'lerinin oluşturulmasını test eder.
 */

import { UploadedAssetStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.R2_ENDPOINT = 'https://r2.example.com';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
});

const {
  findUniqueMock,
  createMock,
  updateMock,
  getSignedUrlMock
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  getSignedUrlMock: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: {
    uploadedAsset: {
      findUnique: findUniqueMock,
      create: createMock,
      update: updateMock
    }
  }
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = vi.fn();
  },
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  CopyObjectCommand: vi.fn()
}));

import { createPresignedUploadUrl } from '../../src/services/fileStorage';
import { attachOwnedAsset, confirmAndApproveAsset, registerUploadedAsset } from '../../src/services/uploadedAssetService';

describe('Quarantine Asset Security Flow unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register uploaded assets in QUARANTINE status by default', async () => {
    // Yüklenen dosyalar ilk adımda varsayılan olarak QUARANTINE durumunda kaydedilmelidir
    createMock.mockResolvedValueOnce({
      id: 'asset-1',
      fileKey: 'test.png',
      status: UploadedAssetStatus.QUARANTINE
    });

    const res = await registerUploadedAsset({
      fileKey: 'test.png',
      ownerId: 'user-1',
      mimeType: 'image/png',
      sizeBytes: 1024,
      checksum: 'sha256'
    });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: UploadedAssetStatus.QUARANTINE
      })
    }));
    expect(res.status).toBe(UploadedAssetStatus.QUARANTINE);
  });

  it('should block attaching quarantined assets until approved', async () => {
    // Henüz onaylanmamış karantina altındaki dosyalar mesaja eklenememeli ve hata fırlatmalıdır
    findUniqueMock.mockResolvedValueOnce({
      id: 'asset-1',
      fileKey: 'test.png',
      ownerId: 'user-1',
      status: UploadedAssetStatus.QUARANTINE
    });

    await expect(attachOwnedAsset('test.png', 'user-1')).rejects.toThrow('karantinada');
  });

  it('should approve quarantined asset to READY status', async () => {
    // Taramadan başarıyla geçen dosya onaylanarak READY statüsüne getirilmelidir
    findUniqueMock.mockResolvedValueOnce({
      id: 'asset-1',
      fileKey: 'test.png',
      ownerId: 'user-1',
      status: UploadedAssetStatus.QUARANTINE
    });

    updateMock.mockResolvedValueOnce({
      id: 'asset-1',
      fileKey: 'test.png',
      status: UploadedAssetStatus.READY
    });

    const approved = await confirmAndApproveAsset('test.png', 'user-1');
    expect(approved.status).toBe(UploadedAssetStatus.READY);
  });

  it('should generate presigned upload URLs for Direct-to-R2 uploads', async () => {
    // İstemci doğrudan Cloudflare R2'ye yükleme yapabilsin diye presigned PUT URL üretilmelidir
    getSignedUrlMock.mockResolvedValueOnce('https://r2.example.com/upload-presigned-url');

    const result = await createPresignedUploadUrl('image.png', 'image/png');
    expect(result.uploadUrl).toBe('https://r2.example.com/upload-presigned-url');
    expect(result.fileKey).toContain('.png');
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

