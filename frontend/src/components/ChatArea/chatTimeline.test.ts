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
  formatDetailedDate,
  getMessagePreview,
  getUnixEpoch
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
    expect(getMessagePreview({ ...message('file', '2026-08-01T10:00:00.000Z', ''), fileKey: 'x', fileName: 'rapor.pdf' })).toContain('rapor.pdf');
    expect(getMessagePreview(null)).toBe('');
  });

  it('provides stable detail and epoch representations', () => {
    expect(getUnixEpoch('1970-01-01T00:00:01.000Z')).toBe(1);
    expect(getUnixEpoch()).toBe('-');
    expect(formatDetailedDate()).toBe('-');
    expect(formatDetailedDate('2026-08-01T10:00:00.000Z')).toContain('2026');
  });
});
