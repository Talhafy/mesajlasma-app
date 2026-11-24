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

/** Dosya ekleri doğrulama alanları */
const fileFields = {
  fileKey: z.string().min(1).max(300).optional().nullable(),
  fileType: z.enum(['image', 'video', 'audio', 'document']).optional().nullable(),
  fileName: z.string().max(255).optional().nullable()
};

const historyDelivery = z.object({
  iv: z.base64().length(16),
  payload: z.base64().min(24).max(60_000),
  signature: z.base64().length(88),
  keys: z.record(uuid, z.base64().length(344)).refine((keys) => Object.keys(keys).length <= 400),
  deviceKeys: z.record(uuid, z.base64().length(344)).refine((keys) => Object.keys(keys).length <= 800).optional()
}).strict();

/** MLS (RFC 9420) uçtan uca şifreli mesaj zarfı alanları */
const mlsEnvelopeFields = {
  content: z.literal('').optional().default(''),
  protocolVersion: z.literal(2),
  epoch: z.number().int().min(1).max(1_000_000),
  senderDeviceId: uuid,
  ciphertext: z.string().min(1).max(60_000),
  encryptedFileMetadata: z.null().optional(),
  historyDelivery: historyDelivery.optional()
};

/** Güçlü Şifre Politikası (Strong Password Rule) */
const strongPassword = z.string()
  .min(8, 'Şifre en az 8 karakter uzunluğunda olmalıdır.')
  .max(128)
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/,
    'Şifre en az bir küçük harf, bir büyük harf, bir rakam ve bir özel karakter (@$!%*?&.) içermelidir.'
  );

const historyKeyFields = {
  salt: z.base64().length(24),
  iv: z.base64().length(16),
  wrappedKey: z.base64().length(64)
};

const vaultRecovery = z.object({
  publicKey: z.base64().length(44),
  iv: z.base64().length(16),
  payload: z.base64().min(128).max(256)
}).strict();
const vaultAccessFields = {
  revision: z.number().int().min(1),
  proof: z.base64().length(88),
  authorization: z.base64().length(88)
};

export const accountHistorySchemas = {
  recipientsQuery: z.object({ messageId: uuid.optional() }).strict(),
  setupVault: z.object({ ...historyKeyFields, publicKey: z.base64().length(392), inboxIv: z.base64().length(16),
    inboxKey: z.base64().min(1_500).max(1_800), revision: z.number().int().min(0),
    authority: z.object({ publicKey: z.base64().length(44), privateKey: z.base64().min(60).max(180),
      iv: z.base64().length(16), issuerId: uuid, signature: z.base64().length(88) }).strict(),
    recovery: vaultRecovery.optional(), proof: z.base64().length(88) }).strict(),
  updateVaultAccess: z.discriminatedUnion('method', [
    z.object({
      ...vaultAccessFields, method: z.literal('device'), deviceId: uuid,
      password: z.object(historyKeyFields).strict().optional(), recovery: vaultRecovery.optional()
    }).strict(),
    z.object({
      ...vaultAccessFields, method: z.literal('recovery'),
      password: z.object(historyKeyFields).strict(), recovery: vaultRecovery
    }).strict()
  ]).refine((input) => input.password || input.recovery, 'Yeni kasa parolası veya kurtarma kodu gerekli.'),
  approveVaultDevice: z.object({ deviceId: uuid, signature: z.base64().length(88) }).strict(),
  device: z.object({ deviceId: uuid, publicKey: z.base64().length(392), signature: z.base64().length(88) }).strict(),
  repairQuery: z.object({ deviceId: uuid, cursor: uuid.optional() }).strict(),
  repairMessage: z.object({ deviceId: uuid, version: z.string().regex(/^[0-9a-f]{64}$/), delivery: historyDelivery }).strict(),
  enroll: z.object({ ...historyKeyFields, publicKey: z.base64().length(392), inboxIv: z.base64().length(16),
    inboxKey: z.base64().min(1_500).max(1_800), password: z.string().min(1).max(128) }).strict(),
  messages: z.object({ entries: z.array(z.object({
    messageId: uuid,
    version: z.string().regex(/^[0-9a-f]{64}$/),
    iv: z.base64().length(16),
    payload: z.base64().min(24).max(60_000)
  }).strict()).min(1).max(24) }).strict()
};

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
    newPassword: strongPassword,
    accountHistoryKey: z.object({ ...historyKeyFields, revision: z.number().int().positive() }).strict().optional()
  }).strict(),
  readReceipts: z.object({ isEnabled: z.boolean() }).strict(),
  avatar: z.object({ fileKey: z.string().min(1).max(300).nullable() }).strict()
};

/** Mesaj İsteği Gövdesi */
const messageBody = z.object({
  conversationId: uuid,
  clientId,
  replyToId: uuid.optional().nullable(),
  isForwarded: z.boolean().optional(),
  ...fileFields,
  ...mlsEnvelopeFields
}).strict();

/** Sohbet ve Grup İşlemleri Şemaları */
export const chatSchemas = {
  directConversation: z.object({ targetUserId: uuid }).strict(),
  message: messageBody,
  conversationMessagesQuery: z.object({
    cursor: uuid.optional(),
    anchor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  }).refine(({ cursor, anchor }) => !(cursor && anchor)),
  paginationQuery: z.object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  }),
  userListQuery: z.object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().min(2).max(100).optional()
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
  idParams: z.object({ id: uuid }),
  editMessage: z.object(mlsEnvelopeFields).strict(),
  deleteMessageQuery: z.object({ forEveryone: z.enum(['true', 'false']).optional() }),
  presignedUpload: z.object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(150),
    sizeBytes: z.coerce.number().int().min(1).max(50 * 1024 * 1024)
  }).strict(),
  confirmUpload: z.object({
    fileKey: z.string().trim().min(1).max(300)
  }).strict()
};

const keyPackageItemSchema = z.object({
  keyPackageRef: z.string().trim().min(8).max(256),
  keyPackage: z.string().trim().min(16).max(16_384)
}).strict();

/** MLS (RFC 9420) Cihaz, KeyPackage, Commit/Welcome ve Şifreli Yedekleme Şemaları */
export const mlsSchemas = {
  registerDevice: z.object({
    deviceId: uuid.optional(),
    deviceName: z.string().trim().min(1).max(80).optional().default('Web Browser'),
    signaturePublicKey: z.string().trim().min(16).max(2048),
    credential: z.string().trim().min(8).max(4096),
    initialKeyPackages: z.array(keyPackageItemSchema).max(100).optional(),
    keyPackages: z.array(keyPackageItemSchema).max(100).optional()
  }).strict(),
  deviceParams: z.object({ deviceId: uuid }),
  approveDevice: z.object({
    approverId: uuid,
    signature: z.string().min(80).max(100)
  }).strict(),
  uploadKeyPackages: z.object({
    deviceId: uuid,
    keyPackages: z.array(keyPackageItemSchema).min(1).max(100)
  }).strict(),
  claimKeyPackages: z.object({
    conversationId: uuid,
    userIds: z.array(uuid).min(1).max(100),
    excludeDeviceId: uuid.optional(),
    excludeDeviceIds: z.array(uuid).max(200).optional()
  }).strict(),
  conversationParams: z.object({ id: uuid }),
  syncConversationQuery: z.object({
    deviceId: uuid,
    sinceEpoch: z.coerce.number().int().min(0).optional().default(0)
  }),
  submitCommit: z.object({
    epoch: z.number().int().min(1).max(1_000_000),
    senderDeviceId: uuid,
    deliverySignature: z.string().min(80).max(100),
    commitData: z.string().trim().min(8).max(260_000),
    ratchetTree: z.string().trim().min(8).max(200_000).optional().nullable(),
    welcomes: z.array(z.object({
      recipientDeviceId: uuid,
      welcomeData: z.string().trim().min(8).max(100_000),
      ratchetTree: z.string().trim().min(8).max(200_000).optional().nullable()
    }).strict()).max(200).optional()
  }).strict(),
  publishGroupInfo: z.object({ epoch: z.number().int().min(1), deviceId: uuid,
    groupInfo: z.base64().min(16).max(160_000), signature: z.base64().length(88) }).strict(),
  saveBackup: z.object({
    fileKey: z.string().trim().min(1).max(300),
    kdfSalt: z.string().trim().min(16).max(256),
    kdfAlgorithm: z.enum(['PBKDF2-SHA256', 'ARGON2ID']).optional().default('PBKDF2-SHA256'),
    kdfParams: z.string().trim().min(2).max(1024),
    cipherNonce: z.string().trim().min(12).max(256),
    checksum: z.string().trim().min(32).max(128),
    sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
    expectedPreviousVersion: z.number().int().min(0).optional()
  }).strict()
};
