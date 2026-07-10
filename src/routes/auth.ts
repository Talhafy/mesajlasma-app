import express, { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { authSchemas } from '../validation/schemas';
import { clientOrigin } from '../config/env';
import { logger } from '../config/logger';
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

// Auth loglarında aynı alanları tekrar tekrar elle yazmamak için ortak bağlam üretiyoruz.
// requestId sayesinde login/refresh/logout akışları HTTP request loglarıyla Kibana'da eşleştirilebilir.
const getRequestId = (req: Request) => (req as Request & { id?: string }).id;
const authLogContext = (req: Request, extra: Record<string, unknown> = {}) => ({
  requestId: getRequestId(req),
  method: req.method,
  url: req.originalUrl,
  ip: req.ip,
  ...extra
});

const requireTrustedOrigin = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  // Refresh token HttpOnly cookie ile taşındığı için tarayıcı otomatik cookie gönderir.
  // Bu endpointlerde origin kontrolü yaparak CSRF riskini azaltıyoruz.
  // HttpOnly cookie kullanan durum değiştiren endpoint'lerde CSRF kaynağı kontrol edilir.
  if (origin && origin !== clientOrigin) {
    logger.warn(authLogContext(req, {
      event: 'security.untrusted_origin',
      origin
    }), 'Untrusted request origin');
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
  // Şifre hash'i, refresh session bilgisi veya hassas alanlar response'a asla eklenmez.
  // Avatar varsa frontend'in doğrudan açabilmesi için anlık signed URL üretilir.
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

    req.app.get('io')?.emit('kullanici_eklendi', await publicUser(newUser));
    logger.info(authLogContext(req, {
      event: 'auth.register_success',
      userId: newUser.id
    }), 'Register successful');

    return res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu!',
      user: { id: newUser.id, username: newUser.username, email: newUser.email }
    });
  } catch (error) {
    logger.warn(authLogContext(req, {
      event: 'auth.register_failed',
      err: error
    }), 'Register failed');
    return res.status(400).json({ error: 'Kullanıcı adı veya e-posta zaten kullanılıyor.' });
  }
});

router.post('/login', requireTrustedOrigin, validateRequest({ body: authSchemas.login }), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] }
    });

    if (!user) {
      // Zamanlama analizini (timing attack) zorlaştırmak için sabit/rastgele gecikme ekliyoruz.
      const fakeDelay = 200 + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, fakeDelay));
      
      logger.warn(authLogContext(req, {
        event: 'auth.login_failed',
        reason: 'user_not_found'
      }), 'Login failed');
      return res.status(401).json({ error: 'Giriş bilgileri veya şifre hatalı.' });
    }

    // Hatalı giriş denemesi varsa progresif gecikme (exponential backoff) uygula (1s, 2s, 4s, 8s, maks 10s).
    // Bu sayede saldırganın hesabı kilitleyerek DoS yapması engellenirken kaba kuvvet hız limiti sağlanır.
    if (user.failedLoginAttempts > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, user.failedLoginAttempts - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const nextAttempts = user.failedLoginAttempts + 1;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts
        }
      });

      logger.warn(authLogContext(req, {
        event: 'auth.login_failed',
        userId: user.id,
        reason: 'invalid_credentials',
        failedAttempts: nextAttempts
      }), 'Login failed');

      return res.status(401).json({ error: 'Giriş bilgileri veya şifre hatalı.' });
    }

    const refreshToken = createRefreshToken();
    const refreshExpiresAt = getRefreshExpiry();
    
    await prisma.$transaction(async (tx) => {
      await tx.refreshSession.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      });
      await tx.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshExpiresAt
        }
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0
        }
      });
    });

    setRefreshCookie(res, refreshToken, refreshExpiresAt);
    logger.info(authLogContext(req, {
      event: 'auth.login_success',
      userId: user.id
    }), 'Login successful');

    return res.status(200).json({
      message: 'Giriş başarılı!',
      accessToken: createAccessToken(user),
      user: await publicUser(user)
    });
  } catch (error) {
    logger.error(authLogContext(req, {
      event: 'auth.login_error',
      err: error
    }), 'Login server error');
    return res.status(500).json({ error: 'Giriş işlemi sırasında sunucu hatası oluştu.' });
  }
});

router.post('/refresh', requireTrustedOrigin, async (req, res) => {
  try {
    const presentedToken = readRefreshToken(req.headers.cookie);
    if (!presentedToken) {
      logger.warn(authLogContext(req, { event: 'auth.refresh_missing' }), 'Refresh token missing');
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh oturumu bulunamadı.' });
    }

    const tokenHash = hashRefreshToken(presentedToken);
    // Refresh token'ın ham değeri veritabanında tutulmaz; yalnızca HMAC/hash karşılığı aranır.
    // Cookie çalınmadığı sürece DB sızıntısı tek başına oturum açmaya yetmez.
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!session) {
      logger.warn(authLogContext(req, { event: 'auth.refresh_invalid' }), 'Refresh session invalid');
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh oturumu geçersiz.' });
    }

    // Daha önce döndürülmüş token'ın yeniden kullanılması token hırsızlığı göstergesidir.
    if (session.revokedAt) {
      logger.warn(authLogContext(req, {
        event: 'auth.refresh_reuse_detected',
        userId: session.userId
      }), 'Refresh token reuse detected');
      await prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token tekrar kullanımı algılandı. Tüm oturumlar kapatıldı.' });
    }

    if (session.expiresAt <= new Date()) {
      logger.warn(authLogContext(req, {
        event: 'auth.refresh_expired',
        userId: session.userId
      }), 'Refresh token expired');
      await prisma.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh oturumunun süresi doldu.' });
    }

    const nextRefreshToken = createRefreshToken();
    // Refresh rotation: kullanılan refresh token hemen iptal edilir ve yerine yeni token üretilir.
    // Böylece eski token tekrar gelirse reuse detection ile şüpheli oturumları kapatabiliriz.
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
      logger.warn(authLogContext(req, {
        event: 'auth.refresh_conflict',
        userId: session.userId
      }), 'Refresh rotation conflict');
      return res.status(409).json({ error: 'Refresh oturumu başka bir istek tarafından yenilendi. İsteği tekrar deneyin.' });
    }

    setRefreshCookie(res, nextRefreshToken, session.expiresAt);
    logger.info(authLogContext(req, {
      event: 'auth.refresh_success',
      userId: session.userId
    }), 'Refresh token rotated');

    return res.status(200).json({
      accessToken: createAccessToken(session.user),
      user: await publicUser(session.user)
    });
  } catch (error) {
    logger.error(authLogContext(req, {
      event: 'auth.refresh_error',
      err: error
    }), 'Refresh server error');
    clearRefreshCookie(res);
    return res.status(500).json({ error: 'Refresh işlemi sırasında sunucu hatası oluştu.' });
  }
});

router.post('/logout', requireTrustedOrigin, async (req, res) => {
  try {
    const refreshToken = readRefreshToken(req.headers.cookie);
    if (refreshToken) {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }
    clearRefreshCookie(res);
    logger.info(authLogContext(req, { event: 'auth.logout_success' }), 'Logout successful');
    return res.status(204).send();
  } catch (error) {
    logger.error(authLogContext(req, {
      event: 'auth.logout_error',
      err: error
    }), 'Logout failed');
    return res.status(500).json({ error: 'Çıkış işlemi tamamlanamadı.' });
  }
});

router.post('/logout-all', requireTrustedOrigin, authenticateToken, async (req: CustomRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Kimliği doğrulanmış kullanıcı bulunamadı.' });
    await prisma.refreshSession.updateMany({
      where: { userId: req.user.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    clearRefreshCookie(res);
    logger.info(authLogContext(req, {
      event: 'auth.logout_all_success',
      userId: req.user.userId
    }), 'All sessions logged out');
    return res.status(204).send();
  } catch (error) {
    logger.error(authLogContext(req, {
      event: 'auth.logout_all_error',
      userId: req.user?.userId,
      err: error
    }), 'Logout all failed');
    return res.status(500).json({ error: 'Tüm oturumlardan çıkış yapılamadı.' });
  }
});

export default router;
