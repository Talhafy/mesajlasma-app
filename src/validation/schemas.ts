/**
 * ============================================================================
 * ZOD VERİ DOĞRULAMA ŞEMALARI (Zod Request Validation Schemas)
 * ============================================================================
 * 
 * Bu dosya; uygulamanın tüm endpoint'leri için gelen HTTP İstek Parametreleri
 * (params, query, body) için Zod doğrulama şemalarını barındırır.
 * 
 * GÜVENLİK İLKELERİ:
 * 1. Katı Nesne Kontrolü (`.strict()`): İstemcinin isteğe fazladan yetkisiz alanlar 
 *    (örn. `adminId`, `userId`, `role`) enjekte etmesini önler.
 * 2. Güçlü Şifre Politikası (`strongPassword`): En az 8 karakter, büyük harf, 
 *    küçük harf, rakam ve özel karakter zorunluluğu getirir.
 * 3. Idempotency ve UUID Güvenliği: Tüm ID'lerin geçerli UUID v4 olduğunu doğrular.
 */

import { z } from 'zod';

/** UUID v4 doğrulayıcı */
const uuid = z.string().uuid('Geçerli bir UUID gönderilmelidir.');

/** İstemci mesaj kimliği (Idempotency Key) */
const clientId = uuid;

/** Mesaj metni doğrulayıcı (En fazla 10.000 karakter, boş metin kabul edilir) */
const messageContent = z.string().max(10_000).optional().default('');

/** Dosya ekleri doğrulama alanları */
const fileFields = {
  fileKey: z.string().min(1).max(300).optional().nullable(),
  fileType: z.enum(['image', 'audio', 'document']).optional().nullable(),
  fileName: z.string().max(255).optional().nullable()
};

/** Güçlü Şifre Politikası (Strong Password Rule) */
const strongPassword = z.string()
  .min(8, 'Şifre en az 8 karakter uzunluğunda olmalıdır.')
  .max(128)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/,
    'Şifre en az bir küçük harf, bir büyük harf, bir rakam ve bir özel karakter (@$!%*?&.) içermelidir.'
  );

/** Kimlik Doğrulama (Auth) Şemaları */
export const authSchemas = {
  register: z.object({
    username: z.string().trim().min(3).max(30).regex(/^[\p{L}\p{N}_.-]+$/u),
    email: z.string().trim().email().max(254),
    password: strongPassword
  }).strict(),
  login: z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128)
  }).strict()
};

/** Kullanıcı Profili ve Ayarları Şemaları */
export const userSchemas = {
  username: z.object({ newUsername: z.string().trim().min(3).max(30) }).strict(),
  email: z.object({ newEmail: z.string().trim().email().max(254) }).strict(),
  password: z.object({
    oldPassword: z.string().min(1).max(128),
    newPassword: strongPassword
  }).strict(),
  readReceipts: z.object({ isEnabled: z.boolean() }).strict(),
  avatar: z.object({ fileKey: z.string().min(1).max(300).nullable() }).strict()
};

/** Mesaj İsteği Gövdesi */
const messageBody = z.object({
  conversationId: uuid,
  clientId,
  content: messageContent,
  replyToId: uuid.optional().nullable(),
  isForwarded: z.boolean().optional(),
  ...fileFields
}).strict().refine(
  // Metin veya dosya yoksa mesaj anlamsızdır; backend boş mesaj kaydı oluşturmaz.
  (data) => Boolean(data.content.trim() || data.fileKey),
  { message: 'Mesaj içeriği veya dosya gereklidir.' }
);

/** Zamanlanmış Mesaj İsteği Gövdesi */
const scheduledMessageBody = z.object({
  conversationId: uuid,
  clientId,
  content: messageContent,
  sendAt: z.string().datetime(),
  ...fileFields
}).strict().refine(
  // Zamanlanmış mesaj da normal mesaj gibi en az metin veya dosya taşımalıdır.
  (data) => Boolean(data.content.trim() || data.fileKey),
  { message: 'Mesaj içeriği veya dosya gereklidir.' }
);

/** Sohbet ve Grup İşlemleri Şemaları */
export const chatSchemas = {
  directConversation: z.object({ targetUserId: uuid }).strict(),
  message: messageBody,
  conversationMessagesQuery: z.object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  }),
  paginationQuery: z.object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  }),
  conversationParams: z.object({ conversationId: uuid }),
  group: z.object({
    name: z.string().trim().min(1).max(100),
    participantIds: z.array(uuid).min(1).max(100)
  }).strict(),
  groupParams: z.object({ id: uuid }),
  conversationIdParams: z.object({ id: uuid }),
  disappearingMode: z.object({
    // Kaybolan mesaj süresi sabit seçeneklerle (1sa, 24sa, 7gün veya kapalı) sınırlıdır.
    durationSeconds: z.union([
      z.literal(0),
      z.literal(3600),
      z.literal(86400),
      z.literal(604800)
    ]).nullable()
  }).strict(),
  groupMemberParams: z.object({ id: uuid, userId: uuid }),
  groupName: z.object({ newName: z.string().trim().min(1).max(100) }).strict(),
  groupAvatar: z.object({ fileKey: z.string().min(1).max(300).nullable() }).strict(),
  addGroupMembers: z.object({ userIdsToAdd: z.array(uuid).min(1).max(100) }).strict(),
  transferAdmin: z.object({ newAdminId: uuid }).strict(),
  readConversation: z.object({
    emitReceipt: z.boolean().optional(),
    lastReadMessageId: uuid.optional()
  }).strict(),
  callToken: z.object({
    conversationId: uuid,
    callId: uuid,
    callType: z.enum(['audio', 'video'])
  }).strict(),
  searchQuery: z.object({ q: z.string().trim().min(2).max(100) }),
  scheduledMessage: scheduledMessageBody,
  scheduledConversationParams: z.object({ conversationId: uuid }),
  idParams: z.object({ id: uuid }),
  editScheduledMessage: z.object({
    content: z.string().trim().max(10_000).optional(),
    ...fileFields
  }).strict().refine((data) => Object.keys(data).length > 0, { message: 'En az bir alan güncellenmelidir.' }),
  editMessage: z.object({ content: z.string().trim().min(1).max(10_000) }).strict(),
  deleteMessageQuery: z.object({ forEveryone: z.enum(['true', 'false']).optional() })
};

/** Oyun Grupları ve Kanalları Şemaları */
export const gameSchemas = {
  groupParams: z.object({ groupId: uuid }),
  channelParams: z.object({ groupId: uuid, channelId: uuid }),
  channelIdParams: z.object({ channelId: uuid }),
  channelMessagesQuery: z.object({ cursor: uuid.optional() }),
  createChannel: z.object({
    name: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} _.-]+$/u),
    type: z.enum(['TEXT', 'VOICE']),
    maxParticipants: z.number().int().min(2).max(25).optional().nullable()
  }).strict().superRefine((data, context) => {
    // İş kuralı: Yazı kanalları katılımcı sınırı desteklemez.
    if (data.type === 'TEXT' && data.maxParticipants != null) {
      context.addIssue({ code: 'custom', path: ['maxParticipants'], message: 'Yazı kanallarında katılımcı limiti kullanılamaz.' });
    }
  }),
  channelMessage: z.object({
    clientId,
    content: messageContent,
    ...fileFields
  }).strict().refine(
    (data) => Boolean(data.content.trim() || data.fileKey),
    { message: 'Mesaj içeriği veya dosya gereklidir.' }
  ),
  readChannel: z.object({
    lastReadMessageId: uuid.optional()
  }).strict(),
  updateChannel: z.object({
    name: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} _.-]+$/u).optional(),
    maxParticipants: z.number().int().min(2).max(25).optional().nullable()
  }).strict(),
  reorderChannels: z.object({
    orderedIds: z.array(uuid)
  }).strict()
};
