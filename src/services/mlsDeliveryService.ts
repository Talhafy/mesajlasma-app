/**
 * ============================================================================
 * MLS (RFC 9420) DAĞITIM VE KİMLİK DOĞRULAMA SERVİSİ (MLS Delivery & Auth Service)
 * ============================================================================
 * 
 * Bu servis, RFC 9420 Messaging Layer Security (MLS) mimarisindeki iki sunucu rolünü yürütür:
 * 1. Authentication Service (AS): Kullanıcı cihazlarının (`UserDevice`) imza açık anahtarlarını
 *    (`Ed25519`) ve kimlik bilgilerini (`Credential`) kayıt altına alır, yüklenen her
 *    `KeyPackage` paketinin `Ed25519` imzasını ve kullanıcı/cihaz kimlik bağlamasını doğrular.
 * 2. Delivery Service (DS):
 *    - Çevrimdışı cihazların sohbete/gruba eklenebilmesi için tek kullanımlık `KeyPackage`
 *      havuzunu yönetir (yalnızca ortak aktif sohbet üyeleri talep edebilir - DoS koruması).
 *    - Aynı `epoch` için yarışan `Commit` paketlerini atomik olarak sıralar; çakışan
 *      ikinci isteği `409 Conflict (MLS_EPOCH_MISMATCH)` ile reddederek ağaç çatallanmasını (fork) önler.
 *    - `Welcome` alıcı cihazlarının gerçekten o sohbetin aktif üyelerine ait olduğunu denetler.
 */

import prisma from '../db';
import { deviceSessionRoom } from './deviceSessionService';
import { AppError } from '../errors/AppError';
import { requireActiveParticipant, requireHistoryParticipant } from './conversationAccess';
import { publicVaultAuthority } from './accountHistoryService';

const LOW_KEY_PACKAGE_THRESHOLD = 5;
const textEncoder = new TextEncoder();

interface ParsedSignedKeyPackage {
  keyPackageRef?: string;
  userId: string;
  deviceId: string;
  deviceName?: string;
  signaturePublicKeyBase64: string;
  hpkePublicKeyBase64: string;
  issuedAt: string;
  signatureBase64: string;
}

/**
 * Sunucuya yüklenen bir KeyPackage'ın JSON yapısını, kullanıcı/cihaz kimlik bağlamasını
 * ve Ed25519 kriptografik imzasını doğrular.
 */
export const verifyKeyPackageForDevice = async (
  expectedUserId: string,
  expectedDeviceId: string,
  expectedSignaturePublicKeyBase64: string,
  item: { keyPackageRef: string; keyPackage: string }
): Promise<void> => {
  let parsed: ParsedSignedKeyPackage;
  try {
    parsed = JSON.parse(item.keyPackage) as ParsedSignedKeyPackage;
  } catch {
    throw AppError.badRequest('MLS_INVALID_KEY_PACKAGE', 'KeyPackage geçerli bir JSON formatında değil.');
  }

  if (
    !parsed ||
    parsed.userId !== expectedUserId ||
    parsed.deviceId !== expectedDeviceId ||
    parsed.signaturePublicKeyBase64 !== expectedSignaturePublicKeyBase64 ||
    (parsed.keyPackageRef && parsed.keyPackageRef !== item.keyPackageRef) ||
    !parsed.hpkePublicKeyBase64 ||
    !parsed.issuedAt ||
    !parsed.signatureBase64
  ) {
    throw AppError.badRequest(
      'MLS_INVALID_KEY_PACKAGE',
      'KeyPackage kullanıcı veya cihaz kimlik bilgileriyle eşleşmiyor.'
    );
  }

  try {
    const pubKeyBytes = Buffer.from(expectedSignaturePublicKeyBase64, 'base64');
    const sigBytes = Buffer.from(parsed.signatureBase64, 'base64');
    const pubKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      'Ed25519',
      false,
      ['verify']
    );

    const canonicalV2 = textEncoder.encode(
      `MLS-KeyPackage-v2:${item.keyPackageRef}:${parsed.userId}:${parsed.deviceId}:${parsed.hpkePublicKeyBase64}:${parsed.issuedAt}`
    );
    const isValidV2 = await crypto.subtle.verify('Ed25519', pubKey, sigBytes, canonicalV2);
    if (!isValidV2) {
      throw new Error('Ed25519 v2 signature mismatch');
    }
  } catch {
    throw AppError.badRequest(
      'MLS_INVALID_KEY_PACKAGE',
      'KeyPackage Ed25519 kriptografik imza doğrulaması başarısız oldu.'
    );
  }
};

/**
 * Kullanıcının tarayıcı/cihaz kimlik anahtarını kaydeder veya günceller.
 */
export const registerOrUpdateDevice = async (
  userId: string,
  input: {
    deviceId?: string;
    deviceName?: string;
    signaturePublicKey: string;
    credential: string;
    initialKeyPackages?: Array<{ keyPackageRef: string; keyPackage: string }>;
    keyPackages?: Array<{ keyPackageRef: string; keyPackage: string }>;
  },
  io?: any
) => {
  const packagesToStore = input.initialKeyPackages ?? input.keyPackages ?? [];

  // İptal edilmiş (revokedAt !== null) bir cihazın kendini tekrar aktif etmesini engelle (H5a)
  const existingByKey = await prisma.userDevice.findUnique({
    where: {
      userId_signaturePublicKey: {
        userId,
        signaturePublicKey: input.signaturePublicKey
      }
    }
  });
  if (existingByKey?.revokedAt) {
    throw AppError.forbidden(
      'DEVICE_ACCESS_REVOKED',
      'İptal edilmiş bir cihaz anahtarı yeniden aktifleştirilemez. Lütfen yeni bir cihaz kimliği oluşturun.'
    );
  }
  if (input.deviceId) {
    const existingById = await prisma.userDevice.findUnique({
      where: { id: input.deviceId }
    });
    if (existingById?.userId === userId && existingById.revokedAt) {
      throw AppError.forbidden('DEVICE_ACCESS_REVOKED', 'Bu cihazın erişimi kaldırıldı.');
    }
    if (existingById && existingById.userId !== userId) {
      throw AppError.forbidden(
        'MLS_DEVICE_NOT_FOUND',
        'Belirtilen cihaz kimliği başka bir kullanıcıya ait.'
      );
    }
  }

  const device = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const anyDevice = await tx.userDevice.findFirst({ where: { userId }, select: { id: true } });
    return tx.userDevice.upsert({
    where: {
      userId_signaturePublicKey: {
        userId,
        signaturePublicKey: input.signaturePublicKey
      }
    },
    create: {
      ...(input.deviceId ? { id: input.deviceId } : {}),
      userId,
      deviceName: input.deviceName || 'Web Browser',
      signaturePublicKey: input.signaturePublicKey,
      credential: input.credential,
      lastActiveAt: new Date(),
      revokedAt: null,
      approvedAt: anyDevice ? null : new Date()
    },
    update: {
      deviceName: input.deviceName || 'Web Browser',
      credential: input.credential,
      lastActiveAt: new Date()
    }
    });
  });

  if (packagesToStore.length > 0) {
    for (const pkg of packagesToStore) {
      await verifyKeyPackageForDevice(userId, device.id, device.signaturePublicKey, pkg);
    }

    await prisma.mlsKeyPackage.createMany({
      data: packagesToStore.map((pkg) => ({
        userId,
        deviceId: device.id,
        keyPackageRef: pkg.keyPackageRef,
        keyPackage: pkg.keyPackage
      })),
      skipDuplicates: true
    });
  }

  const availableKeyPackageCount = await prisma.mlsKeyPackage.count({
    where: { deviceId: device.id, consumedAt: null }
  });

  if (io && device.approvedAt) {
    io.to(userId).emit('mls:device_registered', {
      deviceId: device.id,
      userId,
      deviceName: device.deviceName,
      signaturePublicKey: device.signaturePublicKey
    });
  }

  return { device, availableKeyPackageCount };
};

/**
 * Kullanıcının aktif MLS cihazlarını ve kullanılabilir KeyPackage sayılarını listeler.
 */
export const listUserDevices = async (targetUserId: string) => {
  const devices = await prisma.userDevice.findMany({
    where: { userId: targetUserId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      deviceName: true,
      signaturePublicKey: true,
      credential: true,
      lastActiveAt: true,
      approvedAt: true,
      createdAt: true
    }
  });

  return Promise.all(
    devices.map(async (dev) => ({
      ...dev,
      availableKeyPackageCount: await prisma.mlsKeyPackage.count({
        where: { deviceId: dev.id, consumedAt: null }
      })
    }))
  );
};

/**
 * Belirtilen cihazı iptal eder ve kullanılmamış KeyPackage kayıtlarını temizler.
 */
export const approveDevice = async (
  userId: string,
  deviceId: string,
  approverId: string,
  signature: string
) => prisma.$transaction(async (tx) => {
  const approver = await tx.userDevice.findUnique({ where: { id: approverId } });
  const target = await tx.userDevice.findUnique({ where: { id: deviceId } });
  if (!approver?.approvedAt || approver.revokedAt || approver.userId !== userId ||
      !target || target.userId !== userId || target.revokedAt || target.approvedAt ||
      target.id === approverId) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz onayı geçerli değil.');
  }
  const key = await crypto.subtle.importKey(
    'raw', Buffer.from(approver.signaturePublicKey, 'base64'), 'Ed25519', false, ['verify']
  );
  const data = Buffer.from(JSON.stringify(['mls-device-approval-v1', userId, approverId, target.id, target.signaturePublicKey]));
  if (!await crypto.subtle.verify('Ed25519', key, Buffer.from(signature, 'base64'), data)) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz onay imzası geçersiz.');
  }
  const result = await tx.userDevice.updateMany({
    where: { id: target.id, approvedAt: null, revokedAt: null },
    data: { approvedAt: new Date(), approvedByDeviceId: approverId, approvalSignature: signature }
  });
  if (result.count !== 1) throw AppError.conflict('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz kaydı değişti.');
  return { approved: true };
}, { isolationLevel: 'Serializable' });

export const getConversationDeviceDirectory = async (userId: string, conversationId: string) => {
  await requireActiveParticipant(conversationId, userId);
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { isGroup: true, adminId: true, participants: {
      where: { isActive: true }, select: { userId: true }
    } }
  });
  const userIds = conversation.participants.map((member) => member.userId);
  const devices = await prisma.userDevice.findMany({
    where: { userId: { in: userIds }, approvedAt: { not: null } },
    select: {
      id: true, userId: true, signaturePublicKey: true, approvedByDeviceId: true,
      approvalSignature: true, approvedByVault: true, revokedAt: true
    }
  });
  const vaults = await prisma.accountHistoryKey.findMany({ where: { userId: { in: userIds } },
    select: { userId: true, publicKey: true, vaultApproval: true } });
  const vaultAuthorities = vaults.flatMap((vault) => publicVaultAuthority(vault.userId, vault.publicKey, vault.vaultApproval));
  return { userIds, devices, vaultAuthorities, isGroup: conversation.isGroup, adminId: conversation.adminId };
};

export const listDeviceConversationIds = async (userId: string) => (
  await prisma.participant.findMany({
    where: { userId, isActive: true }, select: { conversationId: true }
  })
).map((membership) => membership.conversationId);

export const revokeDevice = async (
  userId: string, deviceId: string, approverId: string, signature: string, io?: any
) => {
  const approver = await prisma.userDevice.findUnique({ where: { id: approverId } });
  if (!approver?.approvedAt || approver.revokedAt || approver.userId !== userId) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz iptali için onaylı cihaz gerekir.');
  }
  const key = await crypto.subtle.importKey(
    'raw', Buffer.from(approver.signaturePublicKey, 'base64'), 'Ed25519', false, ['verify']
  );
  const payload = Buffer.from(JSON.stringify(['mls-device-revoke-v1', userId, approverId, deviceId]));
  if (!await crypto.subtle.verify('Ed25519', key, Buffer.from(signature, 'base64'), payload)) {
    throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz iptal imzası geçersiz.');
  }
  const device = await prisma.userDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== userId) {
    throw AppError.notFound('MLS_DEVICE_NOT_FOUND', 'Cihaz bulunamadı.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const stillApproved = await tx.userDevice.findFirst({
      where: { id: approverId, userId, approvedAt: { not: null }, revokedAt: null }, select: { id: true }
    });
    if (!stillApproved) throw AppError.forbidden('MLS_DEVICE_APPROVAL_INVALID', 'Cihaz iptali için onaylı cihaz gerekir.');
    const revokedAt = new Date();
    await tx.userDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { revokedAt } });
    await tx.refreshSession.updateMany({ where: { deviceId, userId, revokedAt: null }, data: { revokedAt } });
    await tx.mlsKeyPackage.deleteMany({ where: { deviceId, consumedAt: null } });
  });

  if (io) {
    const room = io.in(deviceSessionRoom(deviceId));
    room.emit('auth:session-revoked', { reason: 'device_revoked' });
    room.disconnectSockets(true);
    const conversationIds = await listDeviceConversationIds(userId);
    const targetRooms = [...new Set([userId, ...conversationIds])];
    io.to(targetRooms).emit('mls:device_revoked', {
      userId,
      deviceId,
      conversationIds
    });
  }

  return { revoked: true, deviceId };
};

/**
 * Cihaza ait yeni tek kullanımlık KeyPackage paketlerini doğrular ve havuza ekler.
 */
export const uploadKeyPackages = async (
  userId: string,
  deviceId: string,
  keyPackages: Array<{ keyPackageRef: string; keyPackage: string }>
) => {
  const device = await prisma.userDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== userId || device.revokedAt || !device.approvedAt) {
    throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Geçerli ve aktif bir cihaz kaydı bulunamadı.');
  }

  for (const pkg of keyPackages) {
    await verifyKeyPackageForDevice(userId, device.id, device.signaturePublicKey, pkg);
  }

  const created = await prisma.mlsKeyPackage.createMany({
    data: keyPackages.map((pkg) => ({
      userId,
      deviceId,
      keyPackageRef: pkg.keyPackageRef,
      keyPackage: pkg.keyPackage
    })),
    skipDuplicates: true
  });

  const availableKeyPackageCount = await prisma.mlsKeyPackage.count({
    where: { deviceId, consumedAt: null }
  });

  return { uploadedCount: created.count, availableKeyPackageCount };
};

/**
 * Belirli bir sohbetin aktif katılımcılarının cihazları için 1'er adet imzalı KeyPackage tahsis eder.
 * Yalnızca hem talep edenin hem de hedef kullanıcıların aktif üyesi olduğu sohbetler için çalışır (DoS koruması).
 */
export const claimKeyPackagesForUsers = async (
  requesterUserId: string,
  conversationId: string,
  targetUserIds: string[],
  excludeDeviceId?: string,
  io?: any,
  excludeDeviceIds?: string[]
) => {
  await requireActiveParticipant(
    conversationId,
    requesterUserId,
    'Bu sohbette KeyPackage talep etme yetkiniz yok.'
  );

  const uniqueUserIds = [...new Set(targetUserIds)];
  const activeMemberships = await prisma.participant.findMany({
    where: {
      conversationId,
      userId: { in: uniqueUserIds },
      isActive: true
    },
    select: { userId: true }
  });

  if (activeMemberships.length !== uniqueUserIds.length) {
    throw AppError.forbidden(
      'MLS_RECIPIENT_FORBIDDEN',
      'Yalnızca aynı aktif sohbette bulunduğunuz kullanıcıların KeyPackage paketlerini talep edebilirsiniz.'
    );
  }

  const excludedSet = new Set<string>([
    ...(excludeDeviceId ? [excludeDeviceId] : []),
    ...(excludeDeviceIds || [])
  ]);

  const activeDevices = await prisma.userDevice.findMany({
    where: {
      userId: { in: uniqueUserIds },
      approvedAt: { not: null },
      revokedAt: null,
      ...(excludedSet.size > 0 ? { id: { notIn: Array.from(excludedSet) } } : {})
    },
    orderBy: { createdAt: 'asc' }
  });

  const claimedPackages: Array<{
    userId: string;
    deviceId: string;
    deviceName: string;
    signaturePublicKey: string;
    credential: string;
    keyPackageRef: string;
    keyPackage: string;
  }> = [];

  for (const device of activeDevices) {
    const candidate = await prisma.mlsKeyPackage.findFirst({
      where: { deviceId: device.id, consumedAt: null },
      orderBy: { createdAt: 'asc' }
    });

    if (!candidate) {
      if (io) {
        io.to(device.userId).emit('mls:key_package_low', {
          deviceId: device.id,
          remainingCount: 0
        });
      }
      continue;
    }

    const claimed = await prisma.mlsKeyPackage.updateMany({
      where: { id: candidate.id, consumedAt: null },
      data: { consumedAt: new Date() }
    });

    if (claimed.count === 1) {
      claimedPackages.push({
        userId: device.userId,
        deviceId: device.id,
        deviceName: device.deviceName,
        signaturePublicKey: device.signaturePublicKey,
        credential: device.credential,
        keyPackageRef: candidate.keyPackageRef,
        keyPackage: candidate.keyPackage
      });

      const remainingCount = await prisma.mlsKeyPackage.count({
        where: { deviceId: device.id, consumedAt: null }
      });
      if (remainingCount < LOW_KEY_PACKAGE_THRESHOLD && io) {
        io.to(device.userId).emit('mls:key_package_low', {
          deviceId: device.id,
          remainingCount
        });
      }
    }
  }

  return { claimedPackages };
};

/**
 * MLS Commit ve Welcome paketlerini atomik epoch sıralamasıyla kaydeder ve yayınlar.
 * - Beklenen epoch (`currentEpoch + 1`) sağlanmazsa 409 Conflict (MLS_EPOCH_MISMATCH) döner.
 * - Welcome alıcı cihazlarının tamamının o sohbetin aktif katılımcılarına ait olduğunu doğrular.
 */
type CommitLeaf = { deviceId: string; userId: string; signaturePublicKeyBase64: string; leafIndex: number };

const readCommitRoster = (value: string | null | undefined): CommitLeaf[] => {
  try {
    const entries = JSON.parse(value ?? 'null');
    if (!Array.isArray(entries) || !entries.length || entries.length > 200 ||
        entries.some((entry) => typeof entry.deviceId !== 'string' || typeof entry.userId !== 'string' ||
          typeof entry.signaturePublicKeyBase64 !== 'string' || !Number.isSafeInteger(entry.leafIndex)) ||
        new Set(entries.map((entry) => entry.deviceId)).size !== entries.length ||
        new Set(entries.map((entry) => entry.leafIndex)).size !== entries.length) throw new Error();
    return entries;
  } catch {
    throw AppError.badRequest('MLS_INVALID_COMMIT', 'MLS cihaz listesi geçersiz.');
  }
};

export const submitCommit = async (
  userId: string,
  conversationId: string,
  input: {
    epoch: number;
    senderDeviceId: string;
    commitData: string;
    deliverySignature: string;
    ratchetTree?: string | null;
    welcomes?: Array<{
      recipientDeviceId: string;
      welcomeData: string;
      ratchetTree?: string | null;
    }>;
  },
  io?: any
) => {
  await requireActiveParticipant(
    conversationId,
    userId,
    'Bu sohbette MLS epoch güncelleme yetkiniz yok.'
  );

  const senderDevice = await prisma.userDevice.findUnique({
    where: { id: input.senderDeviceId }
  });
  if (!senderDevice || senderDevice.userId !== userId || senderDevice.revokedAt || !senderDevice.approvedAt) {
    throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Gönderici cihaz doğrulanamadı.');
  }

  const roster = readCommitRoster(input.ratchetTree);
  const signedCommit = Buffer.from(JSON.stringify([
    'mls-delivery-commit-v1', conversationId, input.epoch, input.senderDeviceId, input.commitData,
    input.ratchetTree, (input.welcomes ?? []).map((welcome) => [welcome.recipientDeviceId, welcome.welcomeData])
  ]));
  const signingKey = await crypto.subtle.importKey(
    'raw', Buffer.from(senderDevice.signaturePublicKey, 'base64'), 'Ed25519', false, ['verify']
  );
  if (!await crypto.subtle.verify('Ed25519', signingKey, Buffer.from(input.deliverySignature, 'base64'), signedCommit)) {
    throw AppError.forbidden('MLS_INVALID_COMMIT', 'Commit imzası doğrulanamadı.');
  }
  let wire: { version?: number; groupId?: string; epoch?: number; senderDeviceId?: string; tsMlsCommitBase64?: string;
    external?: boolean; groupInfoBase64?: string };
  try { wire = JSON.parse(input.commitData); }
  catch { throw AppError.badRequest('MLS_INVALID_COMMIT', 'Commit biçimi geçersiz.'); }
  if (wire?.version !== 2 || wire.groupId !== 'mls:' + conversationId || wire.epoch !== input.epoch ||
      wire.senderDeviceId !== input.senderDeviceId || !wire.tsMlsCommitBase64 ||
      Buffer.from(wire.tsMlsCommitBase64, 'base64').length < 16 ||
      (wire.groupInfoBase64 !== undefined && (typeof wire.groupInfoBase64 !== 'string' || wire.groupInfoBase64.length > 160_000))) {
    throw AppError.badRequest('MLS_INVALID_COMMIT', 'Commit bağlamı geçersiz.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        isDeleted: true,
        isGroup: true,
        adminId: true,
        mlsCurrentEpoch: true,
        participants: {
          where: { isActive: true },
          select: { userId: true }
        }
      }
    });

    if (!conversation || conversation.isDeleted) {
      throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Sohbet bulunamadı.');
    }

    const activeParticipantSet = new Set(conversation.participants.map((p) => p.userId));
    const previous = conversation.mlsCurrentEpoch > 0 ? await tx.mlsCommit.findUnique({
      where: { conversationId_epoch: { conversationId, epoch: conversation.mlsCurrentEpoch } },
      select: { ratchetTree: true, groupInfo: true }
    }) : null;
    const oldRoster = previous ? readCommitRoster(previous.ratchetTree) : [];
    const oldDevices = new Set(oldRoster.map((entry) => entry.deviceId));
    const newDevices = new Set(roster.map((entry) => entry.deviceId));
    const devices = await tx.userDevice.findMany({
      where: { id: { in: Array.from(new Set([...oldDevices, ...newDevices])) }, revokedAt: null, approvedAt: { not: null } }
    });
    const approved = new Map(devices.filter((device) => activeParticipantSet.has(device.userId))
      .map((device) => [device.id, device]));
    const isAdmin = !conversation.isGroup || conversation.adminId === userId;
    const external = wire.external === true;
    const canCommit = external ? previous?.groupInfo && !oldDevices.has(input.senderDeviceId) &&
      roster.length === oldRoster.length + 1 && oldRoster.every((leaf) => roster.some((next) =>
        next.deviceId === leaf.deviceId && next.leafIndex === leaf.leafIndex && next.signaturePublicKeyBase64 === leaf.signaturePublicKeyBase64)) &&
      !(input.welcomes?.length) : previous ? oldDevices.has(input.senderDeviceId) : isAdmin;
    if (!activeParticipantSet.has(userId) || !newDevices.has(input.senderDeviceId) ||
        !canCommit ||
        roster.some((entry) => {
          const device = approved.get(entry.deviceId);
          return device?.userId !== entry.userId || device.signaturePublicKey !== entry.signaturePublicKeyBase64 ||
            (!oldDevices.has(entry.deviceId) && !isAdmin && entry.userId !== userId);
        }) || oldRoster.some((entry) => approved.has(entry.deviceId) && !newDevices.has(entry.deviceId))) {
      throw AppError.forbidden('MLS_INVALID_COMMIT', 'MLS üyelik değişikliği yetkili değil.');
    }
    const joiningDevices = roster.filter((entry) => entry.deviceId !== input.senderDeviceId && !oldDevices.has(entry.deviceId));
    const welcomeIds = new Set((input.welcomes ?? []).map((welcome) => welcome.recipientDeviceId));
    if (welcomeIds.size !== joiningDevices.length || joiningDevices.some((entry) => !welcomeIds.has(entry.deviceId))) {
      throw AppError.badRequest('MLS_INVALID_COMMIT', 'Yeni cihazların Welcome paketleri eksik veya geçersiz.');
    }
    const welcomesToCreate = input.welcomes || [];
    let deviceToUser = new Map<string, string>();

    if (welcomesToCreate.length > 0) {
      const uniqueRecipientDeviceIds = [...new Set(welcomesToCreate.map((w) => w.recipientDeviceId))];
      const recipientDevices = await tx.userDevice.findMany({
        where: {
          id: { in: uniqueRecipientDeviceIds },
          revokedAt: null,
          approvedAt: { not: null }
        },
        select: { id: true, userId: true }
      });

      if (
        recipientDevices.length !== uniqueRecipientDeviceIds.length ||
        recipientDevices.some((dev) => !activeParticipantSet.has(dev.userId))
      ) {
        throw AppError.forbidden(
          'MLS_RECIPIENT_FORBIDDEN',
          'Welcome paketi yalnızca sohbetin aktif katılımcılarına ait geçerli cihazlara gönderilebilir.'
        );
      }
      deviceToUser = new Map(recipientDevices.map((d) => [d.id, d.userId]));
    }

    const expectedEpoch = conversation.mlsCurrentEpoch + 1;
    if (input.epoch !== expectedEpoch) {
      throw new AppError(
        'MLS_EPOCH_MISMATCH',
        `MLS epoch çakışması: beklenen epoch ${expectedEpoch}, gönderilen ${input.epoch}.`,
        409,
        { currentEpoch: conversation.mlsCurrentEpoch, expectedEpoch }
      );
    }

    // Atomik compare-and-swap ile eşzamanlı iki commit'ten yalnızca birinin kazanmasını garanti et
    const updatedConv = await tx.conversation.updateMany({
      where: { id: conversationId, mlsCurrentEpoch: conversation.mlsCurrentEpoch },
      data: { mlsCurrentEpoch: input.epoch }
    });
    if (updatedConv.count !== 1) {
      throw new AppError(
        'MLS_EPOCH_MISMATCH',
        'MLS epoch başka bir cihaz tarafından güncellendi.',
        409,
        { expectedEpoch }
      );
    }

    const commitRecord = await tx.mlsCommit.create({
      data: {
        conversationId,
        epoch: input.epoch,
        senderDeviceId: input.senderDeviceId,
        commitData: input.commitData,
        groupInfo: wire.groupInfoBase64 ?? null,
        ratchetTree: input.ratchetTree || null
      }
    });

    if (welcomesToCreate.length > 0) {
      await tx.mlsWelcome.createMany({
        data: welcomesToCreate.map((w) => ({
          conversationId,
          epoch: input.epoch,
          recipientDeviceId: w.recipientDeviceId,
          welcomeData: w.welcomeData,
          ratchetTree: w.ratchetTree ?? input.ratchetTree ?? null
        }))
      });
    }

    return {
      commitRecord,
      participantUserIds: conversation.participants.map((p) => p.userId),
      deviceToUser
    };
  }, { isolationLevel: 'Serializable' });

  if (io) {
    const targetRooms = [...new Set([conversationId, ...result.participantUserIds])];
    io.to(targetRooms).emit('mls:commit', {
      id: result.commitRecord.id,
      conversationId,
      epoch: result.commitRecord.epoch,
      senderDeviceId: result.commitRecord.senderDeviceId,
      commitData: result.commitRecord.commitData,
      ratchetTree: result.commitRecord.ratchetTree,
      createdAt: result.commitRecord.createdAt
    });

    if (input.welcomes && input.welcomes.length > 0) {
      for (const welcome of input.welcomes) {
        const targetUserId = result.deviceToUser.get(welcome.recipientDeviceId);
        if (targetUserId) {
          io.to(targetUserId).emit('mls:welcome', {
            conversationId,
            epoch: input.epoch,
            recipientDeviceId: welcome.recipientDeviceId,
            welcomeData: welcome.welcomeData,
            ratchetTree: welcome.ratchetTree ?? input.ratchetTree ?? null
          });
        }
      }
    }
  }

  return result.commitRecord;
};

export const getCurrentGroupInfo = async (userId: string, conversationId: string, deviceId: string) => {
  await requireActiveParticipant(conversationId, userId);
  const device = await prisma.userDevice.findFirst({ where: { id: deviceId, userId, revokedAt: null, approvedAt: { not: null } } });
  if (!device) throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Onaylı cihaz bulunamadı.');
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { mlsCurrentEpoch: true } });
  const latest = await prisma.mlsCommit.findUnique({ where: { conversationId_epoch: { conversationId, epoch: conversation.mlsCurrentEpoch } },
    select: { groupInfo: true } });
  return { epoch: conversation.mlsCurrentEpoch, groupInfo: latest?.groupInfo ?? null };
};

export const publishCurrentGroupInfo = async (userId: string, conversationId: string,
  { epoch, deviceId, groupInfo, signature }: { epoch: number; deviceId: string; groupInfo: string; signature: string }) => {
  await requireActiveParticipant(conversationId, userId);
  const [device, commit] = await Promise.all([
    prisma.userDevice.findFirst({ where: { id: deviceId, userId, revokedAt: null, approvedAt: { not: null } } }),
    prisma.mlsCommit.findUnique({ where: { conversationId_epoch: { conversationId, epoch } }, select: { ratchetTree: true, groupInfo: true } })
  ]);
  if (!device || !commit || !readCommitRoster(commit.ratchetTree).some((leaf) => leaf.deviceId === deviceId &&
    leaf.userId === userId && leaf.signaturePublicKeyBase64 === device.signaturePublicKey)) {
    throw AppError.forbidden('MLS_INVALID_COMMIT', 'Sohbet bilgisi yalnızca mevcut MLS üyelerince yayımlanabilir.');
  }
  const key = await crypto.subtle.importKey('raw', Buffer.from(device.signaturePublicKey, 'base64'), 'Ed25519', false, ['verify']);
  const data = Buffer.from(JSON.stringify(['mls-group-info-v1', conversationId, epoch, deviceId, groupInfo]));
  if (!await crypto.subtle.verify('Ed25519', key, Buffer.from(signature, 'base64'), data)) {
    throw AppError.forbidden('MLS_INVALID_COMMIT', 'Sohbet bilgisi imzası geçersiz.');
  }
  if (!commit.groupInfo) await prisma.mlsCommit.updateMany({ where: { conversationId, epoch, groupInfo: null,
    conversation: { mlsCurrentEpoch: epoch, isDeleted: false } }, data: { groupInfo } });
};

/**
 * Cihazın bir sohbette kaçırdığı MLS Commit ve Welcome paketlerini senkronize eder.
 */
export const syncConversationMlsState = async (
  userId: string,
  conversationId: string,
  deviceId: string,
  sinceEpoch: number = 0
) => {
  await requireHistoryParticipant(
    conversationId,
    userId,
    'Bu sohbetin MLS durumunu görüntüleme yetkiniz yok.'
  );

  const device = await prisma.userDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== userId || device.revokedAt || !device.approvedAt) {
    throw AppError.forbidden('MLS_DEVICE_NOT_FOUND', 'Cihaz doğrulanamadı.');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      mlsCurrentEpoch: true,
      mlsGroupId: true
    }
  });
  if (!conversation) {
    throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Sohbet bulunamadı.');
  }

  const welcomes = await prisma.mlsWelcome.findMany({
    where: {
      conversationId,
      recipientDeviceId: deviceId
    },
    orderBy: { epoch: 'desc' },
    take: 5
  });

  if (welcomes.some((w) => !w.deliveredAt)) {
    await prisma.mlsWelcome.updateMany({
      where: {
        id: { in: welcomes.filter((w) => !w.deliveredAt).map((w) => w.id) }
      },
      data: { deliveredAt: new Date() }
    });
  }

  const commits = await prisma.mlsCommit.findMany({
    where: {
      conversationId,
      epoch: { gt: sinceEpoch }
    },
    orderBy: { epoch: 'asc' },
    take: 200
  });

  return {
    conversationId,
    currentEpoch: conversation.mlsCurrentEpoch,
    mlsGroupId: conversation.mlsGroupId,
    welcomes,
    commits
  };
};
