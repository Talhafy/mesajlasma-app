import { z } from 'zod';

// Bütün route param/body/query doğrulamaları burada toplanır.
// Böylece controller dosyaları ham input temizlemek yerine doğrulanmış veriyle iş kuralına odaklanır.
const uuid = z.string().uuid('Geçerli bir UUID gönderilmelidir.');
const clientId = uuid;
// Mesaj metni opsiyonel olabilir; dosyalı mesajlarda içerik boş bırakılabilir.
const messageContent = z.string().max(10_000).optional().default('');
// Dosya alanları private R2 object key ve kullanıcıya gösterilecek tip/ad bilgisidir.
// fileUrl schema'da yoktur; backend response sırasında signed URL olarak üretilir.
const fileFields = {
  fileKey: z.string().min(1).max(300).optional().nullable(),
  fileType: z.enum(['image', 'audio', 'document']).optional().nullable(),
  fileName: z.string().max(255).optional().nullable()
};

export const authSchemas = {
  // .strict() body içinde beklenmeyen alanları reddeder; örn. frontend adminId/userId enjekte edemez.
  register: z.object({
    username: z.string().trim().min(3).max(30).regex(/^[\p{L}\p{N}_.-]+$/u),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128)
  }).strict(),
  login: z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128)
  }).strict()
};

export const userSchemas = {
  username: z.object({ newUsername: z.string().trim().min(3).max(30) }).strict(),
  password: z.object({
    oldPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128)
  }).strict(),
  readReceipts: z.object({ isEnabled: z.boolean() }).strict(),
  avatar: z.object({ fileKey: z.string().min(1).max(300).nullable() }).strict()
};

const messageBody = z.object({
  conversationId: uuid,
  clientId,
  content: messageContent,
  replyToId: uuid.optional().nullable(),
  isForwarded: z.boolean().optional(),
  ...fileFields
}).strict().refine(
  // Metin veya dosya yoksa mesaj anlamsızdır; backend boş mesaj kaydı oluşturmaz.
  // Metinsiz mesaj mümkündür ancak mutlaka bir private dosya anahtarı taşımalıdır.
  (data) => Boolean(data.content.trim() || data.fileKey),
  { message: 'Mesaj içeriği veya dosya gereklidir.' }
);

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

export const chatSchemas = {
  // directConversation sadece hedef kullanıcı id'si alır; gönderen kullanıcı JWT'den çıkarılır.
  directConversation: z.object({ targetUserId: uuid }).strict(),
  message: messageBody,
  conversationParams: z.object({ conversationId: uuid }),
  conversationMessagesQuery: z.object({ cursor: uuid.optional() }),
  group: z.object({
    name: z.string().trim().min(1).max(100),
    participantIds: z.array(uuid).min(1).max(100)
  }).strict(),
  groupParams: z.object({ id: uuid }),
  conversationIdParams: z.object({ id: uuid }),
  disappearingMode: z.object({
    // Kaybolan mesaj modu serbest sayı kabul etmez; UI'daki sabit seçeneklerle sınırlıdır.
    durationSeconds: z.union([
      z.literal(0),
      z.literal(3600),
      z.literal(86400),
      z.literal(604800)
    ]).nullable()
  }).strict(),
  groupMemberParams: z.object({ id: uuid, userId: uuid }),
  groupName: z.object({ newName: z.string().trim().min(1).max(100) }).strict(),
  addGroupMembers: z.object({ userIdsToAdd: z.array(uuid).min(1).max(100) }).strict(),
  transferAdmin: z.object({ newAdminId: uuid }).strict(),
  readConversation: z.object({ emitReceipt: z.boolean().optional() }).strict(),
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
  // Partial update olduğu için zamanlanmış mesaj düzenlenirken chat'e yeni mesaj düşmez.
  // Sadece gönderilmemiş ScheduledMessage kaydı güncellenir.
  // Partial update sayesinde dosya değişirken mesaj normal sohbet akışına gönderilmez.
  }).strict().refine((data) => Object.keys(data).length > 0, { message: 'En az bir alan güncellenmelidir.' }),
  editMessage: z.object({ content: z.string().trim().min(1).max(10_000) }).strict(),
  deleteMessageQuery: z.object({ forEveryone: z.enum(['true', 'false']).optional() })
};
