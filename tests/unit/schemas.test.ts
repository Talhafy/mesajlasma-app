/**
 * ============================================================================
 * ZOD İSTEK ŞEMALARI BİRİM TESTLERİ (Zod Request Schemas Unit Tests)
 * ============================================================================
 * 
 * Bu dosya, Zod doğrulama şemalarının (authSchemas ve chatSchemas)
 * geçerli ve geçersiz istek şemalarını doğru ayrıştırıp ayrıştırmadığını denetler.
 */

import { describe, expect, it } from 'vitest';
import { authSchemas, chatSchemas } from '../../src/validation/schemas';

const conversationId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';

describe('request schemas', () => {
  it('accepts a valid registration and rejects injected fields or weak passwords', () => {
    // Geçerli kayıt kabul edilmeli; zayıf şifre veya enjekte edilmiş ek alanlar reddedilmelidir (.strict())
    expect(authSchemas.register.safeParse({
      username: 'test-user', email: 'test@example.com', password: 'Strong1!'
    }).success).toBe(true);
    expect(authSchemas.register.safeParse({
      username: 'test-user', email: 'test@example.com', password: 'weak', admin: true
    }).success).toBe(false);
  });

  it('requires the current encrypted envelope for new and edited messages', () => {
    const envelope = { protocolVersion: 2, epoch: 1, senderDeviceId: clientId, ciphertext: 'encrypted' };
    expect(chatSchemas.message.safeParse({ conversationId, clientId, ...envelope }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, ...envelope, fileKey: 'asset.pdf', fileType: 'document' }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: 'Merhaba' }).success).toBe(false);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, ...envelope, protocolVersion: 1 }).success).toBe(false);
    expect(chatSchemas.editMessage.safeParse(envelope).success).toBe(true);
    expect(chatSchemas.editMessage.safeParse({ content: 'Merhaba' }).success).toBe(false);
  });

  it('only accepts supported disappearing-message durations', () => {
    // Kaybolan mesaj modunda yalnızca izin verilen sabit saniye değerleri (86400, 3600 vb.) kabul edilmelidir
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 86400 }).success).toBe(true);
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 120 }).success).toBe(false);
  });

  it('validates optional user directory search terms', () => {
    expect(chatSchemas.userListQuery.safeParse({ q: 'deniz', limit: '20' }).success).toBe(true);
    expect(chatSchemas.userListQuery.safeParse({ q: 'd' }).success).toBe(false);
    expect(chatSchemas.userListQuery.safeParse({}).success).toBe(true);
  });

});
