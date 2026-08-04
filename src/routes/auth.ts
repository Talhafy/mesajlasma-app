/**
 * ============================================================================
 * KİMLİK DOĞRULAMA VE OTURUM ROTALARI (Authentication & Session Routes)
 * ============================================================================
 * 
 * Bu dosya, kullanıcı kaydı, girişi, oturum yenileme (Refresh Token Rotation),
 * tekli çıkış ve tüm cihazlardan toplu çıkış süreçlerini yönetir.
 * 
 * GÜVENLİK İLKELERİ:
 * 1. Çift Token Modeli (Dual-Token System):
 *    - Access Token: 15 dakika ömürlü, Authorization Header'da taşınır.
 *    - Refresh Token: 7 gün ömürlü, yalnızca HttpOnly & Secure çerezde taşınır.
 * 2. Token Hırsızlığı Tespiti (Refresh Token Reuse Detection):
 *    - Kullanılmış bir Refresh Token tekrar sunucuya gelirse, sistem bunun çalındığını
 *      anlar ve kullanıcının tüm cihazlardaki oturumlarını anında iptal eder.
 * 3. Zamanlama Saldırısı Koruması (Timing Attack Prevention):
 *    - Olmayan kullanıcı adı denemelerinde rastgele gecikmeler eklenir.
 */

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
import { disconnectUserSockets } from '../socket/sessionControl';

const router = express.Router();

/** İstek için uniq ID üretir veya okur */
const getRequestId = (req: Request) => (req as Request & { id?: string }).id;

/** Güvenlik ve oturum logları için bağlam nesnesi üreticisi */
const authLogContext = (req: Request, extra: Record<string, unknown> = {}) => ({
  requestId: getRequestId(req),
  method: req.method,
  url: req.originalUrl,
  ip: req.ip,
  ...extra
});

/**
 * CSRF VE GÜVENİLİR ORIGIN KONTROLÜ
 * HttpOnly çerez taşıyan kritik uç noktalarda istek kaynağını (Origin) doğrular.
 */
const requireTrustedOrigin = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && origin !== clientOrigin) {
    logger.warn(authLogContext(req, {
      event: 'security.untrusted_origin',
      origin
    }), 'Untrusted request origin');
    return res.status(403).json({ error: 'İsteğin kaynağına izin verilmiyor.', code: 'FORBIDDEN' });
  }
  next();
};

/**
 * HASSAS VERİLERDEN ARINDIRILMIŞ KULLANICI NESNESİ ÜRETİCİ
 * Şifre hash'i veya oturum detayları response'a asla eklenmez. Profil fotoğrafı için imzalı URL üretilir.
 */
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

/**
 * POST /api/v1/register -> Yeni Kullanıcı Kaydı
 * Şifreyi bcrypt (cost factor 10) ile hash'ler ve yeni hesabı veritabanına kaydeder.
 */
router.post('/register', requireTrustedOrigin, validateRequest({ body: authSchemas.register }), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { username, email, password_hash: hashedPassword }
    });

    // Yeni kullanıcı katıldı bildirimini tüm Socket odalarına yayınla
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
    return res.status(400).json({ error: 'Kullanıcı adı veya e-posta zaten kullanılıyor.', code: 'BAD_REQUEST' });
  }
});

/**
 * POST /api/v1/login -> Kullanıcı Girişi ve Oturum Açma
 * Kullanıcı kimliğini doğrular, Access Token döndürür ve HttpOnly Refresh Cookie yerleştirir.
 */
router.post('/login', requireTrustedOrigin, validateRequest({ body: authSchemas.login }), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] }
    });

    if (!user) {
      // Timing Attack önleme: kullanıcı olmasa bile rastgele gecikme ekliyoruz
      const fakeDelay = 200 + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, fakeDelay));

      logger.warn(authLogContext(req, {
        event: 'auth.login_failed',
        reason: 'user_not_found'
      }), 'Login failed');
      return res.status(401).json({ error: 'Giriş bilgileri veya şifre hatalı.', code: 'INVALID_CREDENTIALS' });
    }

    // Üst üste hatalı denemelerde progresif gecikme (Exponential Backoff)
    if (user.failedLoginAttempts > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, user.failedLoginAttempts - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const nextAttempts = user.failedLoginAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: nextAttempts }
      });

      logger.warn(authLogContext(req, {
        event: 'auth.login_failed',
        userId: user.id,
        reason: 'invalid_credentials',
        failedAttempts: nextAttempts
      }), 'Login failed');

      return res.status(401).json({ error: 'Giriş bilgileri veya şifre hatalı.', code: 'INVALID_CREDENTIALS' });
    }

    // Yeni Refresh Token ve Access Token üretiyoruz
    const refreshToken = createRefreshToken();
    const refreshExpiresAt = getRefreshExpiry();

    await prisma.$transaction(async (tx) => {
      // Süresi dolmuş eski oturumları temizle
      await tx.refreshSession.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      });
      // Yeni oturumu kaydet
      await tx.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshExpiresAt
        }
      });
      // Hatalı giriş sayacını sıfırla
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0 }
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
    return res.status(500).json({ error: 'Giriş işlemi sırasında sunucu hatası oluştu.', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/v1/refresh -> Access Token Yenileme (Refresh Token Rotation)
 * HttpOnly cookie'deki refresh token'ı doğrular, eski token'ı iptal edip yenisini verir.
 */
router.post('/refresh', requireTrustedOrigin, async (req, res) => {
  try {
    const presentedToken = readRefreshToken(req.headers.cookie);
    if (!presentedToken) {
      logger.warn(authLogContext(req, { event: 'auth.refresh_missing' }), 'Refresh token missing');
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh oturumu bulunamadı.', code: 'UNAUTHORIZED' });
    }

    const tokenHash = hashRefreshToken(presentedToken);
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!session) {
      logger.warn(authLogContext(req, { event: 'auth.refresh_invalid' }), 'Refresh session invalid');
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh oturumu geçersiz.', code: 'UNAUTHORIZED' });
    }

    // TEKRAR KULLANIM TESPİTİ (Reuse Detection): İptal edilmiş token tekrar kullanılırsa tüm oturumlar kapatılır
    if (session.revokedAt) {
      logger.warn(authLogContext(req, {
        event: 'auth.refresh_reuse_detected',
        userId: session.userId
      }), 'Refresh token reuse detected');
      await prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      disconnectUserSockets(req.app.get('io'), session.userId, 'refresh_token_reuse');
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token tekrar kullanımı algılandı. Tüm oturumlar kapatıldı.', code: 'UNAUTHORIZED' });
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
      return res.status(401).json({ error: 'Refresh oturumunun süresi doldu.', code: 'UNAUTHORIZED' });
    }

    // Refresh Rotation: Eski token iptal edilir, yeni token üretilir
    const nextRefreshToken = createRefreshToken();
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
      return res.status(409).json({ error: 'Refresh oturumu başka bir istek tarafından yenilendi. İsteği tekrar deneyin.', code: 'CONFLICT' });
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
    return res.status(500).json({ error: 'Refresh işlemi sırasında sunucu hatası oluştu.', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/v1/logout -> Tekli Oturum Çıkışı
 * O anki cihazdaki refresh token'ı iptal eder ve cookie'yi temizler.
 */
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
    return res.status(500).json({ error: 'Çıkış işlemi tamamlanamadı.', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/v1/logout-all -> Tüm Cihazlardan Çıkış Yapma
 * Kullanıcının veritabanındaki tüm aktif oturumlarını iptal eder ve canlı WebSocket bağlantılarını kapatır.
 */
router.post('/logout-all', requireTrustedOrigin, authenticateToken, async (req: CustomRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Kimliği doğrulanmış kullanıcı bulunamadı.', code: 'UNAUTHORIZED' });
    await prisma.refreshSession.updateMany({
      where: { userId: req.user.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    disconnectUserSockets(req.app.get('io'), req.user.userId, 'logout_all');
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
    return res.status(500).json({ error: 'Tüm oturumlardan çıkış yapılamadı.', code: 'INTERNAL_ERROR' });
  }
});

export default router;

