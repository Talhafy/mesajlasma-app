/**
 * ============================================================================
 * SOHBET ZAMAN ÇİZELGESİ VE TARİH AYRAÇLARI MANTIĞI (Chat Timeline Helpers)
 * ============================================================================
 * 
 * Bu dosya, sohbet akışında mesajları ve sistem bildirimlerini (katıldı, ayrıldı vb.)
 * kronolojik sıraya dizip aralarına "Bugün", "Dün" veya "15 Ağustos 2026" gibi
 * tarih ayraçları (Date Separators) yerleştiren yardımcı fonksiyonları içerir.
 * 
 * İŞLEVLER:
 * 1. buildTimelineWithDateSeparators -> Mesaj ve sistem kayıtlarını harmanlayıp tarih başlıkları ekler.
 * 2. getMessagePreview               -> Son mesaj metnini veya medya tipine göre önizleme metnini döner.
 * 3. formatDetailedDate & getUnixEpoch -> Tarihleri okunabilir Türkçe formata dönüştürür.
 */

import type { Message } from '../../types/chat';

/** Sistem Bildirimi Zaman Çizelgesi Girdisi */
export type SystemTimelineEntry = {
  id: string;
  conversationId: string;
  text: string;
  createdAt: string;
};

type TimelineItem =
  | { type: 'message'; createdAt: string; id: string; message: Message }
  | { type: 'system'; createdAt: string; id: string; entry: SystemTimelineEntry };

/** Zaman Çizelgesinde Render Edilecek Son Tip (Mesaj, Sistem Uyarısı veya Tarih Ayracı) */
export type TimelineRenderItem = TimelineItem | {
  type: 'date';
  id: string;
  label: string;
  createdAt: string;
};

/** Tarihi YYYY-MM-DD formatında string anahtara çevirir */
const getDateKey = (dateString?: string) => {
  const date = dateString ? new Date(dateString) : new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/** Tarih Ayracı Etiketini Belirler ("Bugün", "Dün" veya "15 Ağustos 2026") */
const getDateSeparatorLabel = (dateString?: string) => {
  const date = dateString ? new Date(dateString) : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (getDateKey(date.toISOString()) === getDateKey(today.toISOString())) return 'Bugün';
  if (getDateKey(date.toISOString()) === getDateKey(yesterday.toISOString())) return 'Dün';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * MESAJ VE SİSTEM KAYITLARINDAN BİRLEŞİK ZAMAN ÇİZELGESİ OLUŞTURUR
 * 
 * 1. Tüm kayıtları tarihine göre eskiden yeniye doğru sıralar.
 * 2. Gün değişimi olan noktalara otomatik { type: 'date' } nesnesi ekler.
 */
export const buildTimelineWithDateSeparators = (
  messages: Message[],
  systemEntries: SystemTimelineEntry[]
) => {
  const items: TimelineItem[] = [
    ...messages.map((message) => ({
      type: 'message' as const,
      createdAt: message.createdAt || new Date(0).toISOString(),
      id: message.id,
      message
    })),
    ...systemEntries.map((entry) => ({ type: 'system' as const, createdAt: entry.createdAt, id: entry.id, entry }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return items.reduce<TimelineRenderItem[]>((result, item) => {
    const dateKey = getDateKey(item.createdAt);
    const previous = [...result].reverse().find((existing) => existing.type !== 'date');
    const previousDateKey = previous ? getDateKey(previous.createdAt) : null;
    if (dateKey !== previousDateKey) {
      result.push({ type: 'date', id: `date-${dateKey}`, label: getDateSeparatorLabel(item.createdAt), createdAt: item.createdAt });
    }
    result.push(item);
    return result;
  }, []);
};

/** Tarihi Türkçe gün ve saat bilgisiyle detaylı formatlar */
export const formatDetailedDate = (dateString?: string) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

/** Unix Epoch zaman damgasını saniye cinsinden döner */
export const getUnixEpoch = (dateString?: string) => dateString ? Math.floor(new Date(dateString).getTime() / 1000) : '-';

/**
 * MESAJ ÖNİZLEME METNİ OLUŞTURUCU (Last Message Preview)
 * Sohbet listesinde son mesajın metnini veya medya ikonu temsilini döner.
 */
export const getMessagePreview = (message?: Message | null) => {
  if (!message) return '';
  if (message.content?.trim()) return message.content;
  if (message.fileType === 'image' || message.fileType?.startsWith('image')) return '📷 Görsel';
  if (message.fileType === 'audio') return '🎤 Ses kaydı';
  if (message.fileKey) return `📎 ${message.fileName || 'Dosya'}`;
  return '';
};
