import prisma from '../db';
import { AppError } from '../errors/AppError';
import type { AccessTokenPayload } from './authTokens';

export const deviceSessionRoom = (deviceId: string) => 'auth-device:' + deviceId;
export const browserSessionRoom = (sessionId: string) => 'auth-session:' + sessionId;

export const activeDeviceSession = async ({ userId, sessionId }: AccessTokenPayload) => {
  const session = await prisma.refreshSession.findFirst({
    where: { userId, sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { deviceId: true, device: { select: { revokedAt: true, approvedAt: true } } }
  });
  if (session && (!session.deviceId || (session.device?.approvedAt && !session.device.revokedAt))) return session;

  const revoked = await prisma.refreshSession.findFirst({
    where: { userId, sessionId, device: { revokedAt: { not: null } } },
    select: { id: true }
  });
  if (revoked) throw AppError.unauthorized('DEVICE_ACCESS_REVOKED', 'Bu cihazın erişimi kaldırıldı.');
  throw AppError.unauthorized();
};

export const bindDeviceSession = async (userId: string, sessionId: string, deviceId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const active = await tx.refreshSession.findFirst({
      where: { userId, sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { deviceId: true }
    });
    if (!active) throw AppError.unauthorized();
    if (active.deviceId && active.deviceId !== deviceId) {
      throw AppError.forbidden('FORBIDDEN', 'Bu oturum başka bir cihaza bağlı.');
    }
    const device = await tx.userDevice.findFirst({ where: { userId, id: deviceId, revokedAt: null, approvedAt: { not: null } } });
    if (!device) throw AppError.unauthorized('DEVICE_ACCESS_REVOKED', 'Bu cihazın erişimi kaldırıldı.');
    if (!active.deviceId) await tx.refreshSession.updateMany({ where: { userId, sessionId }, data: { deviceId } });
  });
