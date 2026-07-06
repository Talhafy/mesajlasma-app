import express, { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { authSchemas } from '../validation/schemas';
import { clientOrigin } from '../config/env';
import { createSignedFileUrl } from '../services/fileStorage';
import {
  clearRefreshCookie,
  createAccessToken,
  createRefreshToken,
  getRefreshExpiry,
  hashRefreshToken,
  readRefreshToken,
  setRefreshCookie
} from '../services/authTokens';

const router = express.Router();
const requireTrustedOrigin = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  // HttpOnly cookie kullanan durum değiştiren endpoint'lerde CSRF kaynağı kontrol edilir.
  if (origin && origin !== clientOrigin) {
    return res.status(403).json({ error: 'İsteğin kaynağına izin verilmiyor.' });
  }
  next();
};

const publicUser = async (user: {
  id: string;
  username: string;
  email: string;
  readReceiptsOn: boolean;
  lastSeenAt: Date;
  avatarFileKey: string | null;
}) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  readReceiptsOn: user.readReceiptsOn,
  lastSeenAt: user.lastSeenAt,
  avatarFileKey: user.avatarFileKey,
  avatarUrl: user.avatarFileKey ? await createSignedFileUrl(user.avatarFileKey) : null
});

router.post('/register', requireTrustedOrigin, validateRequest({ body: authSchemas.register }), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { username, email, password_hash: hashedPassword }
    });
    res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu!',
      user: { id: newUser.id, username: newUser.username, email: newUser.email }
    });
  } catch (error) {
    console.error('Veritabanı kayıt hatası:', error);
    res.status(400).json({ error: 'Kullanıcı adı veya e-posta zaten kullanılıyor.' });
  }
});

router.post('/login', requireTrustedOrigin, validateRequest({ body: authSchemas.login }), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] }
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Giriş bilgileri veya şifre hatalı.' });
    }

    const refreshToken = createRefreshToken();
    const refreshExpiresAt = getRefreshExpiry();
    await prisma.$transaction([
      prisma.refreshSession.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      }),
      prisma.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshExpiresAt
        }
      })
    ]);

    setRefreshCookie(res, refreshToken, refreshExpiresAt);
    return res.status(200).json({
      message: 'Giriş başarılı!',
      accessToken: createAccessToken(user),
      user: await publicUser(user)
    });
  } catch (error) {
    console.error('Giriş hatası:', error);
    return res.status(500).json({ error: 'Giriş işlemi sırasında sunucu hatası oluştu.' });
  }
});

router.post('/refresh', requireTrustedOrigin, async (req, res) => {
  const presentedToken = readRefreshToken(req.headers.cookie);
  if (!presentedToken) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh oturumu bulunamadı.' });
  }

  const tokenHash = hashRefreshToken(presentedToken);
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!session) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh oturumu geçersiz.' });
  }

  // Daha önce döndürülmüş token'ın yeniden kullanılması token hırsızlığı göstergesidir.
  if (session.revokedAt) {
    await prisma.refreshSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh token tekrar kullanımı algılandı. Tüm oturumlar kapatıldı.' });
  }

  if (session.expiresAt <= new Date()) {
    await prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Refresh oturumunun süresi doldu.' });
  }

  const nextRefreshToken = createRefreshToken();
  // Eski token'ı iptal etme ve yenisini oluşturma tek transaction'da gerçekleşir.
  const rotated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() }
    });
    if (revoked.count !== 1) return false;

    await tx.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash: hashRefreshToken(nextRefreshToken),
        expiresAt: session.expiresAt
      }
    });
    return true;
  });

  if (!rotated) {
    return res.status(409).json({ error: 'Refresh oturumu başka bir istek tarafından yenilendi. İsteği tekrar deneyin.' });
  }

  setRefreshCookie(res, nextRefreshToken, session.expiresAt);
  return res.status(200).json({
    accessToken: createAccessToken(session.user),
    user: await publicUser(session.user)
  });
});

router.post('/logout', requireTrustedOrigin, async (req, res) => {
  const refreshToken = readRefreshToken(req.headers.cookie);
  if (refreshToken) {
    await prisma.refreshSession.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
  clearRefreshCookie(res);
  return res.status(204).send();
});

router.post('/logout-all', requireTrustedOrigin, authenticateToken, async (req: CustomRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Kimliği doğrulanmış kullanıcı bulunamadı.' });
  await prisma.refreshSession.updateMany({
    where: { userId: req.user.userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  clearRefreshCookie(res);
  return res.status(204).send();
});

export default router;
