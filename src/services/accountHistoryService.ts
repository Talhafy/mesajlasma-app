import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { AppError } from '../errors/AppError';
import { requireActiveParticipant } from './conversationAccess';

export type WrappedAccountHistoryKey = { salt: string; iv: string; wrappedKey: string; publicKey: string; inboxIv: string; inboxKey: string };
type EncryptedEntry = { messageId: string; version: string; payload: string; iv: string };
export type HistoryDelivery = { iv: string; payload: string; signature: string; keys: Record<string, string>; deviceKeys?: Record<string, string> };
type DeviceRecipient = { deviceId: string; userId: string; publicKey: string };
type StoredDelivery = Omit<HistoryDelivery, 'deviceKeys'> & {
  version: string; target: string; signer: string; vaultOnly?: boolean; deviceKeys?: Record<string, { userId: string; key: string }>;
};

type VaultAuthority = { publicKey: string; privateKey: string; iv: string; issuerId: string; signature: string };
type VaultRecovery = { publicKey: string; iv: string; payload: string };
type VaultPassword = Pick<WrappedAccountHistoryKey, 'salt' | 'iv' | 'wrappedKey'>;
type VaultSetup = WrappedAccountHistoryKey & { revision: number; authority: VaultAuthority; recovery?: VaultRecovery; proof: string };
type VaultAccessUpdate = {
  revision: number; proof: string; authorization: string;
} & (
  { method: 'device'; deviceId: string; password?: VaultPassword; recovery?: VaultRecovery } |
  { method: 'recovery'; password: VaultPassword; recovery: VaultRecovery }
);
const keyFields = { salt: true, iv: true, wrappedKey: true, revision: true, publicKey: true, inboxIv: true, inboxKey: true,
  vaultApproval: true, vaultRecovery: true } as const;
const configuredVault = { vaultApproval: { not: Prisma.DbNull } } satisfies Prisma.AccountHistoryKeyWhereInput;

export const userWithAccountVault = {
  accountHistoryKey: { is: configuredVault }
} satisfies Prisma.UserWhereInput;

export const publicVaultAuthority = (userId: string, historyPublicKey: string, value: Prisma.JsonValue | null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const authority = value as unknown as VaultAuthority;
  return [{ userId, historyPublicKey, publicKey: authority.publicKey, issuerId: authority.issuerId, signature: authority.signature }];
};

const verifyDeviceSignature = async (publicKey: string, signature: string, fields: unknown[]) => {
  try {
    const key = await crypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64'), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, Buffer.from(signature, 'base64'), Buffer.from(JSON.stringify(fields)));
  } catch {
    return false;
  }
};

export const historyVersion = (ciphertext: string) => createHash('sha256').update(ciphertext, 'utf8').digest('hex');

export const getAccountHistoryKey = (userId: string) => prisma.accountHistoryKey.findUnique({
  where: { userId },
  select: keyFields
});

export const enrollAccountHistory = async (userId: string, password: string, wrappedKey: WrappedAccountHistoryKey) => {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { password_hash: true } });
  if (!account || !await bcrypt.compare(password, account.password_hash)) {
    throw AppError.forbidden('INVALID_CREDENTIALS', 'Hesap parolası doğrulanamadı.');
  }
  try {
    await crypto.subtle.importKey('spki', Buffer.from(wrappedKey.publicKey, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  } catch {
    throw AppError.badRequest('BAD_REQUEST', 'Geçmiş dağıtım anahtarı geçersiz.');
  }
  return prisma.$transaction(async (tx) => {
    const current = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} AND "password_hash" = ${account.password_hash} FOR UPDATE
    `;
    if (!current.length) throw AppError.conflict('CONFLICT', 'Hesap parolası değişti.');
    return tx.accountHistoryKey.upsert({
      where: { userId }, create: { userId, ...wrappedKey }, update: {},
      select: keyFields
    });
  });
};

export const loadHistoryRecipients = async (userIds: string[], client: Pick<typeof prisma, 'accountHistoryKey' | 'userDevice'> = prisma) => {
  const [recipients, rows] = await Promise.all([
    client.accountHistoryKey.findMany({ where: { userId: { in: userIds } }, select: { userId: true, publicKey: true } }),
    client.userDevice.findMany({ where: { userId: { in: userIds }, approvedAt: { not: null }, revokedAt: null, historyPublicKey: { not: null } },
      select: { id: true, userId: true, historyPublicKey: true } })
  ]);
  const devices = rows.map((device) => ({
    userId: device.userId, deviceId: device.id, publicKey: device.historyPublicKey!
  }));
  return { recipients, devices };
};

export const requireVaultRecipients = async (userIds: string[], client: Pick<typeof prisma, 'accountHistoryKey'> = prisma) => {
  const recipients = await client.accountHistoryKey.findMany({
    where: { userId: { in: userIds }, ...configuredVault }, select: { userId: true, publicKey: true }
  });
  if (recipients.length !== new Set(userIds).size) {
    throw AppError.conflict('HISTORY_VAULT_REQUIRED', 'Gönderim için tüm alıcıların mesaj kasası kurulmuş olmalı.');
  }
  return recipients;
};

export const listAccountHistoryRecipients = async (userId: string, conversationId: string, messageId?: string) => {
  await requireActiveParticipant(conversationId, userId);
  if (messageId) {
    const message = await prisma.message.findFirst({ where: { id: messageId, conversationId, senderId: userId },
      select: { id: true, conversationId: true, createdAt: true } });
    if (!message) throw AppError.notFound('MESSAGE_NOT_FOUND', 'Düzenlenecek mesaj bulunamadı.');
    return { recipients: await requireVaultRecipients(await listHistoryReaders(message)) };
  }
  const members = await prisma.participant.findMany({ where: { conversationId, isActive: true }, select: { userId: true } });
  return { recipients: await requireVaultRecipients(members.map((member) => member.userId)) };
};

const requireHistoryDevice = async (userId: string, deviceId: string) => {
  const device = await prisma.userDevice.findFirst({ where: { id: deviceId, userId, revokedAt: null, approvedAt: { not: null } } });
  if (!device) throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Onaylı cihaz bulunamadı.');
  return device;
};

export const setupAccountVault = async (userId: string, input: VaultSetup) => {
  const { revision, authority, recovery, proof, ...wrapped } = input;
  const issuer = await requireHistoryDevice(userId, authority.issuerId);
  const certificate = ['account-vault-authority-v1', userId, authority.issuerId, wrapped.publicKey, authority.publicKey];
  const setup = ['account-vault-setup-v1', ...certificate.slice(1), revision, wrapped.salt, wrapped.iv, wrapped.wrappedKey,
    wrapped.inboxIv, wrapped.inboxKey, authority.iv, authority.privateKey, authority.signature,
    ...(recovery ? [recovery.publicKey, recovery.iv, recovery.payload] : [])];
  if (!await verifyDeviceSignature(issuer.signaturePublicKey, authority.signature, certificate) ||
      !await verifyDeviceSignature(issuer.signaturePublicKey, proof, setup)) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Kasa kurulumu onaylı cihaz tarafından doğrulanamadı.');
  }
  try {
    await crypto.subtle.importKey('spki', Buffer.from(wrapped.publicKey, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    await crypto.subtle.importKey('raw', Buffer.from(authority.publicKey, 'base64'), 'Ed25519', false, ['verify']);
  } catch {
    throw AppError.badRequest('BAD_REQUEST', 'Kasa anahtarı geçersiz.');
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const current = await tx.accountHistoryKey.findUnique({ where: { userId } });
    if ((current?.revision ?? 0) !== revision || current?.vaultApproval || (current && current.publicKey !== wrapped.publicKey)) {
      throw AppError.conflict('CONFLICT', 'Kasa durumu değişti. Yeniden deneyin.');
    }
    const data = { ...wrapped, vaultApproval: authority, ...(recovery && { vaultRecovery: recovery }), revision: revision + 1 };
    return tx.accountHistoryKey.upsert({ where: { userId }, create: { userId, ...data }, update: data, select: keyFields });
  });
};

export const updateAccountVaultAccess = async (userId: string, input: VaultAccessUpdate) =>
  prisma.$transaction(async (tx) => {
    const { revision, password, recovery, proof, authorization, method } = input;
    const vault = await tx.accountHistoryKey.findUnique({ where: { userId }, select: keyFields });
    const authority = vault?.vaultApproval as VaultAuthority | null;
    if (!authority || vault?.revision !== revision) {
      throw AppError.conflict('CONFLICT', 'Kasa bilgileri değişti. Yeniden deneyin.');
    }

    const deviceId = method === 'device' ? input.deviceId : null;
    const fields = ['account-vault-access-v1', userId, revision, method, deviceId,
      password ? [password.salt, password.iv, password.wrappedKey] : null,
      recovery ? [recovery.publicKey, recovery.iv, recovery.payload] : null];
    if (!await verifyDeviceSignature(authority.publicKey, proof, fields)) {
      throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Kasa değişikliği doğrulanamadı.');
    }

    const currentRecovery = vault.vaultRecovery as VaultRecovery | null;
    let authorizer = currentRecovery?.publicKey;
    if (deviceId) {
      await tx.$queryRaw`SELECT "id" FROM "UserDevice" WHERE "id" = ${deviceId} AND "userId" = ${userId} FOR UPDATE`;
      const device = await tx.userDevice.findFirst({
        where: { id: deviceId, userId, approvedAt: { not: null }, revokedAt: null },
        select: { signaturePublicKey: true }
      });
      authorizer = device?.signaturePublicKey;
    }
    if (!authorizer || !await verifyDeviceSignature(authorizer, authorization, fields)) {
      throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Kurtarma yetkisi doğrulanamadı.');
    }

    const result = await tx.accountHistoryKey.updateMany({
      where: { userId, revision },
      data: { ...password, ...(recovery && { vaultRecovery: recovery }), revision: { increment: 1 } }
    });
    if (result.count !== 1) throw AppError.conflict('CONFLICT', 'Kasa bilgileri değişti. Yeniden deneyin.');
  });

export const approveAccountVaultDevice = async (userId: string, deviceId: string, signature: string) => {
  const [vault, device] = await Promise.all([
    prisma.accountHistoryKey.findUnique({ where: { userId }, select: { vaultApproval: true } }),
    prisma.userDevice.findFirst({ where: { id: deviceId, userId, revokedAt: null } })
  ]);
  const authority = vault?.vaultApproval as VaultAuthority | null;
  if (!authority || !device || !await verifyDeviceSignature(authority.publicKey, signature,
    ['account-vault-device-v1', userId, deviceId, device.signaturePublicKey])) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Kasa üzerinden cihaz onayı doğrulanamadı.');
  }
  if (device.approvedAt) return false;
  const result = await prisma.userDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null, approvedAt: null },
    data: { approvedAt: new Date(), approvedByVault: true, approvedByDeviceId: authority.issuerId, approvalSignature: signature } });
  return result.count === 1;
};

export const registerHistoryDevice = async (userId: string, { deviceId, publicKey, signature }: { deviceId: string; publicKey: string; signature: string }) => {
  const device = await requireHistoryDevice(userId, deviceId);
  const signer = await crypto.subtle.importKey('raw', Buffer.from(device.signaturePublicKey, 'base64'), 'Ed25519', false, ['verify']);
  const data = new TextEncoder().encode(JSON.stringify(['account-history-device-v1', userId, deviceId, publicKey]));
  if (!await crypto.subtle.verify('Ed25519', signer, Buffer.from(signature, 'base64'), data)) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihazın geçmiş anahtarı doğrulanamadı.');
  }
  await crypto.subtle.importKey('spki', Buffer.from(publicKey, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const updated = await prisma.userDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null, approvedAt: { not: null },
    OR: [{ historyPublicKey: null }, { historyPublicKey: publicKey }] }, data: { historyPublicKey: publicKey } });
  if (!updated.count) throw AppError.conflict('CONFLICT', 'Onaylı cihazın geçmiş anahtarı değişmiş.');
};

export const verifyHistoryDelivery = async (
  input: HistoryDelivery, conversationId: string, senderId: string, target: string, ciphertext: string, signer: string,
  eligibleUsers: Iterable<string>, devices: DeviceRecipient[] = []
) => {
  const version = historyVersion(ciphertext);
  const signed = new TextEncoder().encode(JSON.stringify(['account-history-delivery-v1', conversationId, senderId, target, version, input.iv, input.payload]));
  const publicKey = await crypto.subtle.importKey('raw', Buffer.from(signer, 'base64'), 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', publicKey, Buffer.from(input.signature, 'base64'), signed)) {
    throw AppError.badRequest('BAD_REQUEST', 'Geçmiş dağıtımının imzası geçersiz.');
  }
  const allowed = new Set(eligibleUsers);
  return {
    iv: input.iv, payload: input.payload, signature: input.signature,
    keys: Object.fromEntries(Object.entries(input.keys).filter(([userId]) => allowed.has(userId))),
    deviceKeys: Object.fromEntries(devices.flatMap(({ deviceId, userId }) => {
      const key = input.deviceKeys?.[deviceId];
      return key && allowed.has(userId) ? [[deviceId, { userId, key }] as const] : [];
    })),
    version, target, signer
  };
};

export const historyDeliveryFor = (value: unknown, viewerId: string | undefined) => {
  if (!value || typeof value !== 'object' || !('keys' in value) || !viewerId) return undefined;
  const { keys, deviceKeys, ...envelope } = value as StoredDelivery;
  const viewerDevices = Object.fromEntries(Object.entries(deviceKeys ?? {}).filter(([, entry]) => entry.userId === viewerId));
  return keys[viewerId] || Object.keys(viewerDevices).length ? { ...envelope, key: keys[viewerId], deviceKeys: viewerDevices } : undefined;
};

export const removeHistoryDeliveryFor = (tx: Pick<typeof prisma, '$executeRaw'>, userId: string, target: { messageId: string } | { conversationId: string; through?: Date }) => {
  const where = 'messageId' in target ? Prisma.sql`"id" = ${target.messageId}` :
    Prisma.sql`"conversationId" = ${target.conversationId}${target.through ? Prisma.sql` AND "createdAt" <= ${target.through}` : Prisma.empty}`;
  return tx.$executeRaw`
    UPDATE "Message"
    SET "historyDelivery" = jsonb_set("historyDelivery" #- ARRAY['keys', ${userId}::text], '{deviceKeys}',
      COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each("historyDelivery"->'deviceKeys') WHERE value->>'userId' <> ${userId}), '{}'::jsonb))
    WHERE ${where} AND "historyDelivery" IS NOT NULL AND (
      ("historyDelivery"->'keys') ? ${userId}::text OR EXISTS (
        SELECT 1 FROM jsonb_each("historyDelivery"->'deviceKeys') WHERE value->>'userId' = ${userId}
      )
    )
  `;
};

type HistoryMember = { userId: string; isActive: boolean; joinedAt: Date; leftAt: Date | null; historyPeriods: { joinedAt: Date; leftAt: Date }[] };
const canReadHistory = (member: HistoryMember, createdAt: Date) => (member.isActive || member.leftAt) &&
  [member, ...member.historyPeriods].some((period) => createdAt >= period.joinedAt && (!period.leftAt || createdAt <= period.leftAt));

const repairSelect = {
  id: true, clientId: true, conversationId: true, senderId: true, senderDeviceId: true, createdAt: true, editedAt: true,
  ciphertext: true, epoch: true, protocolVersion: true, historyDelivery: true, fileKey: true,
  deletions: { select: { userId: true } }
} as const;

const repairWhere = (userId: string, deviceId: string) => ({
  senderId: userId, senderDeviceId: deviceId, ciphertext: { not: null }, isDeletedForEveryone: false,
  deletions: { none: { userId } }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  conversation: { participants: { some: { userId } } }
});

const repairMembers = (conversationIds: string[], client: Pick<typeof prisma, 'participant'> = prisma) => client.participant.findMany({
  where: { conversationId: { in: conversationIds } },
  select: { conversationId: true, userId: true, isActive: true, joinedAt: true, leftAt: true, historyPeriods: { select: { joinedAt: true, leftAt: true } } }
});

const eligibleReaders = (message: { createdAt: Date; conversationId: string; deletions: { userId: string }[] },
  members: (HistoryMember & { conversationId: string })[]) => members.filter((member) => member.conversationId === message.conversationId &&
    canReadHistory(member, message.createdAt) && !message.deletions.some((entry) => entry.userId === member.userId)).map((member) => member.userId);

export const listHistoryReaders = async (message: { id: string; conversationId: string; createdAt: Date },
  client: Pick<typeof prisma, 'participant' | 'messageDeletion'> = prisma) => {
  const [members, deletions] = await Promise.all([repairMembers([message.conversationId], client),
    client.messageDeletion.findMany({ where: { messageId: message.id }, select: { userId: true } })]);
  return eligibleReaders({ ...message, deletions }, members);
};

export const listHistoryRepairs = async (userId: string, deviceId: string, cursor?: string) => {
  await requireHistoryDevice(userId, deviceId);
  const limit = 12;
  const page = await prisma.message.findMany({ where: { ...repairWhere(userId, deviceId), ...(cursor ? { id: { gt: cursor } } : {}) },
    orderBy: { id: 'asc' }, take: limit + 1, select: repairSelect });
  if (!page.length) return { items: [], nextCursor: null };
  const messages = page.slice(0, limit);
  const members = await repairMembers([...new Set(messages.map((message) => message.conversationId))]);
  const available = await loadHistoryRecipients([...new Set(members.map((member) => member.userId))]);
  const items = messages.flatMap(({ deletions, historyDelivery, ...message }) => {
    const allowed = eligibleReaders({ ...message, deletions }, members);
    if (!allowed.includes(userId) || !message.ciphertext) return [];
    const recipients = available.recipients.filter((recipient) => allowed.includes(recipient.userId));
    const devices = available.devices.filter((recipient) => allowed.includes(recipient.userId));
    const delivery = historyDelivery as StoredDelivery | null;
    if (delivery?.vaultOnly) return [];
    const covered = delivery?.version === historyVersion(message.ciphertext) ? delivery : null;
    if (!recipients.some(({ userId }) => !covered?.keys[userId]) && !devices.some(({ deviceId }) => !covered?.deviceKeys?.[deviceId])) return [];
    return [{ ...message, recipients, devices }];
  });
  return { items, nextCursor: page.length > limit ? messages.at(-1)!.id : null };
};

export const repairHistoryMessage = async (userId: string, messageId: string, input: { deviceId: string; version: string; delivery: HistoryDelivery }) => {
  const device = await requireHistoryDevice(userId, input.deviceId);
  const message = await prisma.message.findFirst({ where: { id: messageId, ...repairWhere(userId, input.deviceId) }, select: repairSelect });
  if (!message?.ciphertext || input.version !== historyVersion(message.ciphertext)) return null;
  if ((message.historyDelivery as StoredDelivery | null)?.vaultOnly) return null;
  const allowed = eligibleReaders(message, await repairMembers([message.conversationId]));
  if (!allowed.includes(userId)) return null;
  const { recipients, devices } = await loadHistoryRecipients(allowed);
  if (recipients.some(({ userId }) => !input.delivery.keys[userId]) || devices.some(({ deviceId }) => !input.delivery.deviceKeys?.[deviceId])) return null;
  const target = message.editedAt ? message.id : message.clientId ?? message.id;
  const delivery = await verifyHistoryDelivery(input.delivery, message.conversationId, userId, target, message.ciphertext,
    device.signaturePublicKey, recipients.map((recipient) => recipient.userId).concat(devices.map((recipient) => recipient.userId)), devices);
  const result = await prisma.message.updateMany({ where: { id: messageId, ...repairWhere(userId, input.deviceId), ciphertext: message.ciphertext },
    data: { historyDelivery: delivery } });
  return result.count ? { conversationId: message.conversationId, allowed, delivery } : null;
};

export const storeAccountHistory = async (userId: string, entries: EncryptedEntry[]) => {
  const messages = await prisma.message.findMany({
    where: {
      id: { in: entries.map((entry) => entry.messageId) },
      ciphertext: { not: null },
      isDeletedForEveryone: false,
      deletions: { none: { userId } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      conversation: { participants: { some: { userId } } }
    },
    select: {
      id: true, ciphertext: true, createdAt: true,
      conversation: { select: { participants: {
        where: { userId },
        select: { isActive: true, joinedAt: true, leftAt: true, historyPeriods: { select: { joinedAt: true, leftAt: true } } }
      } } }
    }
  });
  const allowed = new Map(messages.flatMap((message) => {
    const [member] = message.conversation.participants;
    if (!member || (!member.isActive && !member.leftAt) || !message.ciphertext) return [];
    const eligible = [member, ...member.historyPeriods].some(({ joinedAt, leftAt }) =>
      message.createdAt >= joinedAt && (!leftAt || message.createdAt <= leftAt));
    return eligible ? [[message.id, historyVersion(message.ciphertext)] as const] : [];
  }));
  const accepted = entries.filter((entry) => allowed.get(entry.messageId) === entry.version);
  if (accepted.length) {
    await prisma.accountHistoryMessage.createMany({ data: accepted.map((entry) => ({ userId, ...entry })), skipDuplicates: true });
  }
  return { accepted: accepted.map(({ messageId, version }) => ({ messageId, version })) };
};
