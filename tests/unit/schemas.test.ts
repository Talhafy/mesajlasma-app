import { describe, expect, it } from 'vitest';
import { authSchemas, chatSchemas, gameSchemas } from '../../src/validation/schemas';

const conversationId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';

describe('request schemas', () => {
  it('accepts a valid registration and rejects injected fields or weak passwords', () => {
    expect(authSchemas.register.safeParse({
      username: 'test-user', email: 'test@example.com', password: 'Strong1!'
    }).success).toBe(true);
    expect(authSchemas.register.safeParse({
      username: 'test-user', email: 'test@example.com', password: 'weak', admin: true
    }).success).toBe(false);
  });

  it('requires either text or an uploaded file for a message', () => {
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: 'Merhaba' }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: '', fileKey: 'asset.pdf', fileType: 'document' }).success).toBe(true);
    expect(chatSchemas.message.safeParse({ conversationId, clientId, content: '   ' }).success).toBe(false);
  });

  it('only accepts supported disappearing-message durations', () => {
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 86400 }).success).toBe(true);
    expect(chatSchemas.disappearingMode.safeParse({ durationSeconds: 120 }).success).toBe(false);
  });

  it('validates scheduled-message creation and partial edits', () => {
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
    expect(gameSchemas.createChannel.safeParse({ name: 'sohbet', type: 'TEXT', maxParticipants: 5 }).success).toBe(false);
    expect(gameSchemas.createChannel.safeParse({ name: 'takım sesi', type: 'VOICE', maxParticipants: 5 }).success).toBe(true);
  });

  it('requires content or a file in game channel messages', () => {
    expect(gameSchemas.channelMessage.safeParse({ clientId, content: 'Takım hazır' }).success).toBe(true);
    expect(gameSchemas.channelMessage.safeParse({ clientId, content: ' ' }).success).toBe(false);
  });
});
