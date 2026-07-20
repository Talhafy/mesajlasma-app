import type { Message } from '../../types/chat';

export type SystemTimelineEntry = {
  id: string;
  conversationId: string;
  text: string;
  createdAt: string;
};

type TimelineItem =
  | { type: 'message'; createdAt: string; id: string; message: Message }
  | { type: 'system'; createdAt: string; id: string; entry: SystemTimelineEntry };

export type TimelineRenderItem = TimelineItem | {
  type: 'date';
  id: string;
  label: string;
  createdAt: string;
};

const getDateKey = (dateString?: string) => {
  const date = dateString ? new Date(dateString) : new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const getDateSeparatorLabel = (dateString?: string) => {
  const date = dateString ? new Date(dateString) : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (getDateKey(date.toISOString()) === getDateKey(today.toISOString())) return 'Bugün';
  if (getDateKey(date.toISOString()) === getDateKey(yesterday.toISOString())) return 'Dün';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
};

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

export const formatDetailedDate = (dateString?: string) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

export const getUnixEpoch = (dateString?: string) => dateString ? Math.floor(new Date(dateString).getTime() / 1000) : '-';

export const getMessagePreview = (message?: Message | null) => {
  if (!message) return '';
  if (message.content?.trim()) return message.content;
  if (message.fileType === 'image' || message.fileType?.startsWith('image')) return '📷 Görsel';
  if (message.fileType === 'audio') return '🎤 Ses kaydı';
  if (message.fileKey) return `📎 ${message.fileName || 'Dosya'}`;
  return '';
};
