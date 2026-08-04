/**
 * ============================================================================
 * OWASP ASVS 5.0 GÜVENLİK GEREKSİNİMLERİ OTOMATİZE TESTLERİ (OWASP ASVS Tests)
 * ============================================================================
 * 
 * Bu dosya, OWASP ASVS (Application Security Verification Standard) v5.0
 * standartlarına uyumluluğu otomatikleştirilmiş birim testler ile denetler:
 * 
 * - V12.1: Dosya Yükleme İzin Listesi & Magic Bytes İmzası (EXE -> PNG sahtekarlığı engelleme)
 * - V12.2: Karantina İzolasyonu & Antivirüs Onay Kontrolü (QUARANTINE dosyaları engelleyici)
 * - V5.1: Girdi Doğrulama & Katı Şema Kontrolleri (Beklenmeyen parametre enjeksiyonunu engelleme)
 */

import { UploadedAssetStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.R2_ENDPOINT = 'https://r2.example.com';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
});

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn()
}));

vi.mock('../../src/db', () => ({
  default: {
    uploadedAsset: {
      findUnique: findUniqueMock
    }
  }
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/signed-url')
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

import { attachOwnedAsset } from '../../src/services/uploadedAssetService';
import { verifyFileSignature } from '../../src/utils/fileValidation';
import { authSchemas } from '../../src/validation/schemas';

describe('OWASP ASVS 5.0 Security Requirements Automated Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('V12.1 File Upload Allowlist & Signature Verification', () => {
    it('ASVS V12.1.2: should detect MIME spoofing when an executable header is renamed to PNG', () => {
      // EXE dosyası başlığı (MZ / 4D 5A) PNG uzantısı yapılsa dahi imza doğrulamasından geçememelidir
      const fakePngBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const isValid = verifyFileSignature(fakePngBuffer, 'image/png');
      expect(isValid).toBe(false);
    });

    it('ASVS V12.1.2: should validate legitimate PNG magic bytes', () => {
      // Gerçek PNG imzası (89 50 4E 47) başarıyla onaylanmalıdır
      const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const isValid = verifyFileSignature(validPngBuffer, 'image/png');
      expect(isValid).toBe(true);
    });

    it('ASVS V12.1.2: should validate legitimate JPEG magic bytes', () => {
      // Gerçek JPEG imzası (FF D8 FF E0) başarıyla onaylanmalıdır
      const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const isValid = verifyFileSignature(validJpegBuffer, 'image/jpeg');
      expect(isValid).toBe(true);
    });
  });

  describe('V12.2 Quarantine Isolation & Anti-Malware', () => {
    it('ASVS V12.2.1: should strictly block attaching assets in QUARANTINE status', async () => {
      // Henüz virüs taramasından geçmemiş QUARANTINE statüsündeki dosyalar mesaja bağlanamamalıdır
      findUniqueMock.mockResolvedValueOnce({
        id: 'asset-quarantined',
        fileKey: 'quarantine-file.pdf',
        ownerId: 'user-123',
        status: UploadedAssetStatus.QUARANTINE
      });

      await expect(attachOwnedAsset('quarantine-file.pdf', 'user-123')).rejects.toThrow('karantinada');
    });
  });

  describe('V5.1 Input Validation & Strict Schema Controls', () => {
    it('ASVS V5.1.1: should reject register requests with unexpected parameter injection', () => {
      // İstemcinin kayıt isteğine yetkisiz alanlar (isAdmin, userId) enjekte etmesi engellenmelidir (.strict())
      const payloadWithAdminInjection = {
        username: 'validuser',
        email: 'user@example.com',
        password: 'StrongPassword1!',
        isAdmin: true,
        userId: 'fake-uuid'
      };

      const result = authSchemas.register.safeParse(payloadWithAdminInjection);
      expect(result.success).toBe(false);
    });
  });
});

