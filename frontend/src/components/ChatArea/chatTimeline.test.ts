/**
 * ============================================================================
 * CHAT TIMELINE BİRİM TESTLERİ (chatTimeline.test.ts)
 * ============================================================================
 * 
 * Bu test dosyası, sohbet zaman çizelgesinin (Timeline) ve yardımcı fonksiyonlarının
 * doğruluğunu test eder.
 * 
 * KAPSAM:
 * 1. Mesaj ve sistem bildirimlerinin kronolojik sıralanması ve gün başına 1 tarih ayracı eklenmesi.
 * 2. Mesaj önizleme metinlerinin (metin, görsel, ses kaydı, dosya) doğru oluşturulması.
 * 3. Unix epoch ve detaylı Türkçe tarih formatlama işlevleri.
 */

import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/chat';
import {
  buildTimelineWithDateSeparators,
  formatSystemMessage,
  formatDetailedDate,
  getMessagePreview,
  getUnixEpoch,
  hasReadReceipt,
  isDeletedForEveryoneMessage,
  mergeMessage
} from './chatTimeline';

/** Testler için sahte mesaj üreten yardımcı mock fonksiyon */
const message = (id: string, createdAt: string, content = id): Message => ({
  id,
  createdAt,
  content,
  senderId: 'user-1',
  conversationId: 'conversation-1'
});

describe('chat timeline helpers', () => {
  it('shows a group receipt only after every eligible recipient has read the message', () => {
    const sent = { ...message('sent', '2026-08-02T10:00:00.000Z'), groupRecipientIds: ['user-2', 'user-3'] };
    expect(hasReadReceipt({ ...sent, readByIds: ['user-2', 'other-user'] }, true)).toBe(false);
    expect(hasReadReceipt({ ...sent, readByIds: ['user-2', 'user-3'] }, true)).toBe(true);
    expect(hasReadReceipt({ ...sent, groupRecipientIds: [], readByIds: ['other-user'] }, true)).toBe(false);
    expect(hasReadReceipt({ ...sent, readByIds: ['user-2'] }, false)).toBe(true);
  });

  it('skips pending decryption bubbles and keeps previously decrypted content for the same envelope', () => {
    const plain = { ...message('m1', '2026-08-02T10:00:00.000Z', 'Görünen mesaj'), protocolVersion: 2, ciphertext: 'envelope' };
    const pending = { ...plain, content: '', decryptionPending: true };
    const oldArchive = { ...plain, id: 'm2', content: '🔒 Bu cihazda şifreli geçmiş henüz açılamadı.' };
    expect(buildTimelineWithDateSeparators([plain, { ...pending, id: 'm3' }, oldArchive], []).map(({ type }) => type)).toEqual(['date', 'message']);
    expect(getMessagePreview(pending)).toBe('');
    expect(mergeMessage([plain], pending)[0]).toMatchObject({ content: plain.content, decryptionPending: false });
    expect(mergeMessage([plain], { ...pending, ciphertext: 'new-envelope' })[0]).toMatchObject({ content: '', decryptionPending: true });
  });

  it('sorts messages and system events while inserting one separator per day', () => {
    const result = buildTimelineWithDateSeparators(
      [message('later', '2026-08-02T10:00:00.000Z'), message('first', '2026-08-01T10:00:00.000Z')],
      [{ id: 'system', conversationId: 'conversation-1', text: 'Üye eklendi', createdAt: '2026-08-01T11:00:00.000Z' }]
    );

    // 2 farklı gün için tam 2 adet 'date' ayracı yerleştirilmeli
    expect(result.filter((item) => item.type === 'date')).toHaveLength(2);
    // Öğelerin sıralaması eskiden yeniye olmalı: first -> system -> later
    expect(result.filter((item) => item.type !== 'date').map((item) => item.id)).toEqual(['first', 'system', 'later']);
  });

  it('formats message previews by content and attachment type', () => {
    expect(getMessagePreview(message('text', '2026-08-01T10:00:00.000Z', 'Merhaba'))).toBe('Merhaba');
    expect(getMessagePreview({ ...message('image', '2026-08-01T10:00:00.000Z', ''), fileType: 'image' })).toContain('Görsel');
    expect(getMessagePreview({ ...message('video', '2026-08-01T10:00:00.000Z', ''), fileType: 'video' })).toContain('Video');
    expect(getMessagePreview({ ...message('legacy-video', '2026-08-01T10:00:00.000Z', ''), fileType: 'audio', fileName: 'eski-video.mp4' })).toContain('Video');
    expect(getMessagePreview({ ...message('voice', '2026-08-01T10:00:00.000Z', ''), fileType: 'audio', fileName: 'voice-1.webm' })).toContain('Ses kaydı');
    expect(getMessagePreview({ ...message('file', '2026-08-01T10:00:00.000Z', ''), fileKey: 'x', fileName: 'rapor.pdf' })).toContain('rapor.pdf');
    expect(getMessagePreview(null)).toBe('');
  });

  it('recognizes and normalizes messages deleted for everyone', () => {
    const deletedMessage = message('deleted', '2026-08-01T10:00:00.000Z', '🚫 Bu mesaj silindi');

    expect(isDeletedForEveryoneMessage(deletedMessage)).toBe(true);
    expect(getMessagePreview(deletedMessage)).toBe('Bu mesaj silindi');
    expect(isDeletedForEveryoneMessage(message('regular', '2026-08-01T10:00:00.000Z', 'Normal mesaj'))).toBe(false);
  });

  it('renders persisted admin transfers as system timeline items', () => {
    const result = buildTimelineWithDateSeparators(
      [message('admin-transfer', '2026-08-01T10:00:00.000Z', '[SYSTEM_ADMIN_TRANSFER]:Talhafy:Talha')],
      [],
      'Talha'
    );

    expect(result.find((item) => item.type === 'system')).toMatchObject({
      type: 'system',
      entry: { text: 'Talhafy sizi grup yöneticisi yaptı.' }
    });
    expect(result.some((item) => item.type === 'message')).toBe(false);
  });

  it('formats group system events from the current user perspective', () => {
    expect(formatSystemMessage('[SYSTEM_ADD]:Talha:Ayşe', 'Talha')).toBe('Ayşe kullanıcısını gruba eklediniz.');
    expect(formatSystemMessage('[SYSTEM_KICK]:Ayşe:Talha', 'Talha')).toBe('Ayşe sizi gruptan çıkardı.');
    expect(formatSystemMessage('Normal mesaj', 'Talha')).toBeNull();
  });

  it('provides stable detail and epoch representations', () => {
    expect(getUnixEpoch('1970-01-01T00:00:01.000Z')).toBe(1);
    expect(getUnixEpoch()).toBe('-');
    expect(formatDetailedDate()).toBe('-');
    expect(formatDetailedDate('2026-08-01T10:00:00.000Z')).toContain('2026');
  });

  it('merges the HTTP response and socket event for the same message', () => {
    const socketMessage = { ...message('message-1', '2026-08-01T10:00:00.000Z'), clientId: 'client-1' };
    const httpMessage = { ...socketMessage, readByIds: ['user-2'] };

    const result = mergeMessage(mergeMessage([], socketMessage), httpMessage);

    expect(result).toHaveLength(1);
    expect(result[0].readByIds).toEqual(['user-2']);
  });

  it('uses clientId to replace an optimistic message with the persisted message', () => {
    const optimistic = { ...message('offline-client-1', '2026-08-01T10:00:00.000Z'), clientId: 'client-1' };
    const persisted = { ...message('message-1', '2026-08-01T10:00:01.000Z'), clientId: 'client-1' };

    const result = mergeMessage([optimistic], persisted);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('message-1');
  });
});
