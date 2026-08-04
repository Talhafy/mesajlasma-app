/**
 * ============================================================================
 * ZOD İSTEK ŞEMALARI BİRİM TESTLERİ (Zod Request Schemas Unit Tests)
 * ============================================================================
 * 
 * Bu dosya, Zod doğrulama şemalarının (authSchemas, chatSchemas, gameSchemas vb.)
 * geçerli ve geçersiz istek şemalarını doğru ayrıştırıp ayrıştırmadığını denetler.
 */

import { describe, expect, it } from 'vitest';
import { authSchemas, chatSchemas, gameSchemas } from '../../src/validation/schemas';

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

  it('requires either text or an uploaded file for a message', () => {
    // Mesaj metni veya ek dosya anahtarı olmalıdır; tamamen boş mesajlar reddedilmelidir
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: 'Merhaba' }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: '', fileKey: 'asset.pdf', fileType: 'document' }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: '   ' }).success).toBe(false);
  });

  it('only accepts supported disappearing-message durations', () => {
    // Kaybolan mesaj modunda yalnızca izin verilen sabit saniye değerleri (86400, 3600 vb.) kabul edilmelidir
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 86400 }).success).toBe(true);
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 120 }).success).toBe(false);
  });

  it('validates scheduled-message creation and partial edits', () => {
    // Zamanlanmış mesaj oluşturma ve güncelleme (partial edit) kuralları doğrulanmalıdır
    expect(chatSchemas.scheduledMessage.safeParse({
      conversationId,
      clientId,
      content: 'Daha sonra gönder',
      sendAt: '2026-08-04T10:00:00.000Z'
    }).success).toBe(true);
    expect(chatSchemas.scheduledMessage.safeParse({
      conversationId,
      clientId,
      content: '',
      sendAt: '2026-08-04T10:00:00.000Z'
    }).success).toBe(false);
    expect(chatSchemas.editScheduledMessage.safeParse({ content: 'Güncellendi' }).success).toBe(true);
    expect(chatSchemas.editScheduledMessage.safeParse({}).success).toBe(false);
  });

  it('rejects participant limits for text game channels', () => {
    // Oyun kanallarında TEXT türü katılımcı limiti alamaz; VOICE türü alabilir
    expect(gameSchemas.createChannel.safeParse({ name: 'sohbet', type: 'TEXT', maxParticipants: 5 }).success).toBe(false);
    expect(gameSchemas.createChannel.safeParse({ name: 'takım sesi', type: 'VOICE', maxParticipants: 5 }).success).toBe(true);
  });

  it('requires content or a file in game channel messages', () => {
    // Oyun kanalı mesajlarında en az içerik veya dosya zorunludur
    expect(gameSchemas.channelMessage.safeParse({ clientId, content: 'Takım hazır' }).success).toBe(true);
    expect(gameSchemas.channelMessage.safeParse({ clientId, content: ' ' }).success).toBe(false);
  });
});

