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

/** Kalıcı mesaj olarak gelen sistem kodunu kullanıcıya okunabilir bildirime dönüştürür. */
export const formatSystemMessage = (content: string, currentUsername?: string) => {
  if (content.startsWith('[SYSTEM_LEAVE]:')) {
    const username = content.slice('[SYSTEM_LEAVE]:'.length);
    return username === currentUsername ? 'Gruptan ayrıldınız.' : `${username} gruptan ayrıldı.`;
  }

  const formatActorTargetEvent = (
    prefix: string,
    actorAction: (target: string) => string,
    targetAction: (actor: string) => string,
    neutralAction: (actor: string, target: string) => string
  ) => {
    if (!content.startsWith(prefix)) return null;
    const [actor, target] = content.slice(prefix.length).split(':');
    if (!actor || !target) return 'Grup bilgisi güncellendi.';
    if (actor === currentUsername) return actorAction(target);
    if (target === currentUsername) return targetAction(actor);
    return neutralAction(actor, target);
  };

  const kicked = formatActorTargetEvent(
    '[SYSTEM_KICK]:',
    (target) => `${target} kullanıcısını gruptan çıkardınız.`,
    (actor) => `${actor} sizi gruptan çıkardı.`,
    (actor, target) => `${actor}, ${target} kullanıcısını gruptan çıkardı.`
  );
  if (kicked) return kicked;

  const added = formatActorTargetEvent(
    '[SYSTEM_ADD]:',
    (target) => `${target} kullanıcısını gruba eklediniz.`,
    (actor) => `${actor} sizi gruba ekledi.`,
    (actor, target) => `${actor}, ${target} kullanıcısını gruba ekledi.`
  );
  if (added) return added;

  if (content.startsWith('[SYSTEM_ADMIN_ASSIGN]:')) {
    const username = content.slice('[SYSTEM_ADMIN_ASSIGN]:'.length);
    return username === currentUsername ? 'Grup yöneticisi oldunuz.' : `${username} grup yöneticisi oldu.`;
  }

  const transferred = formatActorTargetEvent(
    '[SYSTEM_ADMIN_TRANSFER]:',
    (target) => `${target} kullanıcısını grup yöneticisi yaptınız.`,
    (actor) => `${actor} sizi grup yöneticisi yaptı.`,
    (actor, target) => `${actor}, ${target} kullanıcısını grup yöneticisi yaptı.`
  );
  if (transferred) return transferred;

  return content.startsWith('[SYSTEM_') ? 'Grup bilgisi güncellendi.' : null;
};

/**
 * MESAJ VE SİSTEM KAYITLARINDAN BİRLEŞİK ZAMAN ÇİZELGESİ OLUŞTURUR
 * 
 * 1. Tüm kayıtları tarihine göre eskiden yeniye doğru sıralar.
 * 2. Gün değişimi olan noktalara otomatik { type: 'date' } nesnesi ekler.
 */
export const buildTimelineWithDateSeparators = (
  messages: Message[],
  systemEntries: SystemTimelineEntry[],
  currentUsername?: string
) => {
  const items: TimelineItem[] = [
    ...messages.filter((message) => !isPendingMessageDecryption(message)).map((message): TimelineItem => {
      const createdAt = message.createdAt || new Date(0).toISOString();
      const systemText = formatSystemMessage(message.content, currentUsername);
      if (systemText) {
        return {
          type: 'system',
          createdAt,
          id: message.id,
          entry: {
            id: message.id,
            conversationId: message.conversationId,
            text: systemText,
            createdAt
          }
        };
      }
      return { type: 'message', createdAt, id: message.id, message };
    }),
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
  if (isPendingMessageDecryption(message)) return '';
  if (isDeletedForEveryoneMessage(message)) return 'Bu mesaj silindi';
  if (message.content?.trim()) return message.content;
  if (message.fileType === 'image' || message.fileType?.startsWith('image')) return '📷 Görsel';
  if (isVideoMessage(message)) return '🎬 Video';
  if (message.fileType === 'audio') return '🎤 Ses kaydı';
  if (message.fileKey) return `📎 ${message.fileName || 'Dosya'}`;
  return '';
};

export const isPendingMessageDecryption = (message: Message) => message.decryptionPending ?? Boolean(
  message.protocolVersion && message.content?.startsWith('🔒 ') && [
    '🔒 Şifreli mesaj eksik.', '🔒 Bu cihazda şifreli geçmiş henüz açılamadı.',
    '🔒 Bu cihazda mesajın anahtarı bulunamadı.', '🔒 Şifreli mesaj doğrulanamadı.'
  ].includes(message.content)
);

/** Herkesten silinen mesajlar backend tarafından bu özel içerikle saklanır. */
export const isDeletedForEveryoneMessage = (message?: Pick<Message, 'content' | 'fileKey'> | null) => {
  if (!message || message.fileKey) return false;
  const content = message.content?.trim();
  return content === '🚫 Bu mesaj silindi' || content === 'Bu mesaj silindi';
};

/** Yeni video türünü ve daha önce yanlışlıkla audio kaydedilmiş video eklerini tanır. */
export const isVideoMessage = (message?: { fileType?: string | null; fileName?: string | null; content?: string; encryptedFileMetadata?: string | null } | null) => {
  if (!message) return false;
  if (message.fileType === 'video' || message.fileType?.startsWith('video')) return true;
  if (message.fileType !== 'audio') return false;
  if (message.encryptedFileMetadata) {
    try {
      const { mimeType } = JSON.parse(message.encryptedFileMetadata);
      if (typeof mimeType === 'string' && /^(audio|video)\//.test(mimeType)) return mimeType.startsWith('video/');
    } catch {
      // Eski mesajlarda dosya adını kullan.
    }
  }
  if (message.fileName?.startsWith('voice-') || /^Sesli mesaj(?:\s*\(\d+:\d{2}\))?$/i.test(message.content?.trim() ?? '')) return false;
  return /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(message.fileName || '');
};

/** HTTP yanıtı ve socket olayıyla gelen aynı mesajı tek kayıtta birleştirir. */
export const hasReadReceipt = (message: Message, isGroup: boolean) => {
  const readers = message.readByIds ?? [];
  if (!isGroup) return readers.some((reader) => reader !== message.senderId);
  const recipients = message.groupRecipientIds ?? [];
  return recipients.length > 0 && recipients.every((recipient) => readers.includes(recipient));
};

export const mergeMessage = (messages: Message[], incoming: Message) => {
  const existingIndex = messages.findIndex((message) => (
    message.id === incoming.id
    || Boolean(incoming.clientId && message.clientId === incoming.clientId)
  ));

  if (existingIndex === -1) return [...messages, incoming];

  const existing = messages[existingIndex];
  const next = [...messages];
  next[existingIndex] = { ...existing, ...incoming };
  if (existing.readByIds && incoming.readByIds) {
    next[existingIndex].readByIds = [...new Set([...existing.readByIds, ...incoming.readByIds])];
  }
  if (incoming.decryptionPending && !isPendingMessageDecryption(existing) && incoming.ciphertext && incoming.ciphertext === existing.ciphertext) {
    next[existingIndex] = {
      ...next[existingIndex], content: existing.content, decryptionPending: false,
      fileName: existing.fileName, fileUrl: incoming.fileUrl ?? existing.fileUrl,
      encryptedFileMetadata: existing.encryptedFileMetadata
    };
  }
  return next;
};
