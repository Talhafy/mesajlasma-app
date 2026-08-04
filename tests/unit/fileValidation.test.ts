/**
 * ============================================================================
 * DOSYA İMZASI VE MAGIC BYTES BİRİM TESTLERİ (Magic Bytes Validation Tests)
 * ============================================================================
 * 
 * Bu dosya, `verifyFileSignature` fonksiyonunun JPEG, PNG, GIF, PDF, ZIP, DOC, MP3, 
 * WebP, WAV ve düz metin dosyaları üzerindeki ikili (binary) imza doğrulamasını test eder.
 */

import { describe, expect, it } from 'vitest';
import { verifyFileSignature } from '../../src/utils/fileValidation';

describe('verifyFileSignature', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['image/gif', Buffer.from('GIF89a')],
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ['application/msword', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
    ['audio/mpeg', Buffer.from('ID3\u0004')]
  ])('accepts a valid %s signature', (mimeType, buffer) => {
    // Geçerli ikili imzalara sahip dosyalar onaylanmalıdır
    expect(verifyFileSignature(buffer, mimeType)).toBe(true);
  });

  it('validates RIFF subtypes instead of trusting the common prefix', () => {
    // RIFF kapsayıcısı alt türüne (WEBP veya WAVE) göre doğrulanmalıdır
    expect(verifyFileSignature(Buffer.from('RIFF0000WEBP'), 'image/webp')).toBe(true);
    expect(verifyFileSignature(Buffer.from('RIFF0000WAVE'), 'audio/wav')).toBe(true);
    expect(verifyFileSignature(Buffer.from('RIFF0000FAKE'), 'image/webp')).toBe(false);
  });

  it('rejects binary control characters in plain text', () => {
    // Düz metin (text/plain) dosyasında çalıştırılabilir binary kontrol karakterleri bulunmamalıdır
    expect(verifyFileSignature(Buffer.from('plain text'), 'text/plain')).toBe(true);
    expect(verifyFileSignature(Buffer.from([0x41, 0x00, 0x42, 0x43]), 'text/plain')).toBe(false);
  });

  it('rejects short and mismatched input', () => {
    // Yetersiz uzunlukta veya uyumsuz imzalara sahip tamponlar reddedilmelidir
    expect(verifyFileSignature(Buffer.from([0x01, 0x02]), 'image/png')).toBe(false);
    expect(verifyFileSignature(Buffer.from('NOPE'), 'application/pdf')).toBe(false);
  });
});

