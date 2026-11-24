/**
 * ============================================================================
 * MLS (RFC 9420) VE ŞİFRELİ GEÇMİŞ YEDEĞİ ROTALARI (MLS & E2EE Backup Routes)
 * ============================================================================
 * 
 * Bu dosya; MLS cihaz kaydı, KeyPackage yükleme/talep etme, atomik Commit/Welcome
 * dağıtımı ve kullanıcı kontrollü şifreli geçmiş yedeği API uç noktalarını içerir.
 */

import express, { Response } from 'express';
import { logger } from '../config/logger';
import { respondWithError } from '../errors/AppError';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import * as backupService from '../services/backupService';
import * as accountHistoryService from '../services/accountHistoryService';
import * as mlsDeliveryService from '../services/mlsDeliveryService';
import { getAuthenticatedUserId as getUserId, getRouteParam as getParam } from '../utils/request';
import { accountHistorySchemas, mlsSchemas } from '../validation/schemas';
import { bindDeviceSession } from '../services/deviceSessionService';

const router = express.Router();

router.use(authenticateToken);

router.get('/mls/account-history/key', async (req: CustomRequest, res: Response) => {
  try {
    return res.set('Cache-Control', 'no-store').json({ key: await accountHistoryService.getAccountHistoryKey(getUserId(req)) });
  } catch (error) {
    return respondWithError(res, error, 'Şifreli hesap geçmişi açılamadı.');
  }
});

router.post('/mls/account-history/key', validateRequest({ body: accountHistorySchemas.enroll }), async (req: CustomRequest, res: Response) => {
  try {
    const { password, ...wrappedKey } = req.body;
    return res.json({ key: await accountHistoryService.enrollAccountHistory(getUserId(req), password, wrappedKey) });
  } catch (error) {
    return respondWithError(res, error, 'Şifreli hesap geçmişi ayarlanamadı.');
  }
});

router.post('/mls/account-history/vault', validateRequest({ body: accountHistorySchemas.setupVault }), async (req: CustomRequest, res: Response) => {
  try {
    const key = await accountHistoryService.setupAccountVault(getUserId(req), req.body);
    req.app.get('io')?.emit('user_directory_changed');
    return res.set('Cache-Control', 'no-store').json({ key });
  } catch (error) {
    return respondWithError(res, error, 'Kasa kurulamadı.');
  }
});

router.put('/mls/account-history/vault/access', validateRequest({ body: accountHistorySchemas.updateVaultAccess }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    await accountHistoryService.updateAccountVaultAccess(getUserId(req), req.body);
    return res.sendStatus(204);
  } catch (error) {
    return respondWithError(res, error, 'Kasa erişimi güncellenemedi.');
  }
});

router.post('/mls/account-history/approve-device', validateRequest({ body: accountHistorySchemas.approveVaultDevice }), async (req: CustomRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const { deviceId, signature } = req.body;
    if (req.deviceId && req.deviceId !== deviceId) {
      return res.status(403).json({ error: 'Bu oturum başka bir cihaza bağlı.', code: 'FORBIDDEN' });
    }
    const approved = await accountHistoryService.approveAccountVaultDevice(userId, deviceId, signature);
    await bindDeviceSession(userId, req.user!.sessionId, deviceId);
    if (approved) {
      const conversationIds = await mlsDeliveryService.listDeviceConversationIds(userId);
      req.app.get('io')?.to([userId, ...conversationIds]).emit('mls:device_approved', { userId, deviceId, conversationIds });
    }
    return res.json({ approved: true });
  } catch (error) {
    return respondWithError(res, error, 'Cihaz onaylanamadı.');
  }
});

router.put('/mls/account-history/messages', validateRequest({ body: accountHistorySchemas.messages }), async (req: CustomRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const entries: Parameters<typeof accountHistoryService.storeAccountHistory>[1] = req.body.entries;
    const result = await accountHistoryService.storeAccountHistory(userId, entries);
    if (result.accepted.length) {
      const versions = new Map(result.accepted.map((entry) => [entry.messageId, entry.version]));
      req.app.get('io')?.to(userId).emit('account_history_synced', entries.filter((entry) => versions.get(entry.messageId) === entry.version));
    }
    return res.json(result);
  } catch (error) {
    return respondWithError(res, error, 'Şifreli hesap geçmişi eşitlenemedi.');
  }
});

router.get('/mls/account-history/recipients/:id', validateRequest({ params: mlsSchemas.conversationParams, query: accountHistorySchemas.recipientsQuery }), async (req: CustomRequest, res: Response) => {
  try {
    return res.json(await accountHistoryService.listAccountHistoryRecipients(getUserId(req), getParam(req, 'id'), req.query.messageId as string | undefined));
  } catch (error) {
    return respondWithError(res, error, 'Geçmiş alıcıları yüklenemedi.');
  }
});

router.put('/mls/account-history/device', validateRequest({ body: accountHistorySchemas.device }), async (req: CustomRequest, res: Response) => {
  try {
    await accountHistoryService.registerHistoryDevice(getUserId(req), req.body);
    return res.sendStatus(204);
  } catch (error) {
    return respondWithError(res, error, 'Cihaz geçmişi ayarlanamadı.');
  }
});

router.get('/mls/account-history/repair', validateRequest({ query: accountHistorySchemas.repairQuery }), async (req: CustomRequest, res: Response) => {
  try {
    const { deviceId, cursor } = req.query as unknown as { deviceId: string; cursor?: string };
    return res.json(await accountHistoryService.listHistoryRepairs(getUserId(req), deviceId, cursor));
  } catch (error) {
    return respondWithError(res, error, 'Geçmiş eşitleme sırası yüklenemedi.');
  }
});

router.put('/mls/account-history/repair/:id', validateRequest({ params: mlsSchemas.conversationParams, body: accountHistorySchemas.repairMessage }), async (req: CustomRequest, res: Response) => {
  try {
    const messageId = getParam(req, 'id');
    const result = await accountHistoryService.repairHistoryMessage(getUserId(req), messageId, req.body);
    const io = req.app.get('io');
    if (result && io) {
      for (const userId of result.allowed) {
        const historyDelivery = accountHistoryService.historyDeliveryFor(result.delivery, userId);
        if (historyDelivery) io.to(userId).emit('account_history_repaired', { messageId, conversationId: result.conversationId, historyDelivery });
      }
    }
    return res.json({ repaired: Boolean(result) });
  } catch (error) {
    return respondWithError(res, error, 'Eski mesaj eşitlenemedi.');
  }
});

/** POST /api/v1/mls/devices -> Cihaz Kimlik Anahtarı Kaydı */
router.post('/mls/devices', validateRequest({ body: mlsSchemas.registerDevice }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await mlsDeliveryService.registerOrUpdateDevice(userId, req.body, io);
    return res.status(200).json(result);
  } catch (error) {
    logger.error({ event: 'mls.register_device_failed', err: error, userId: req.user?.userId }, 'MLS device registration failed');
    return respondWithError(res, error, 'MLS cihaz kaydı oluşturulamadı.');
  }
});

/** GET /api/v1/mls/devices -> Kullanıcının Aktif MLS Cihazlarını Listeleme */
router.get('/mls/devices', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const devices = await mlsDeliveryService.listUserDevices(userId);
    return res.status(200).json({ devices });
  } catch (error) {
    logger.error({ event: 'mls.list_devices_failed', err: error, userId: req.user?.userId }, 'MLS list devices failed');
    return respondWithError(res, error, 'MLS cihazları listelenemedi.');
  }
});

router.post('/mls/devices/:deviceId/approve', validateRequest({
  params: mlsSchemas.deviceParams, body: mlsSchemas.approveDevice
}), async (req: CustomRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const deviceId = getParam(req, 'deviceId');
    const result = await mlsDeliveryService.approveDevice(userId, deviceId, req.body.approverId, req.body.signature);
    const conversationIds = await mlsDeliveryService.listDeviceConversationIds(userId);
    req.app.get('io')?.to(userId).emit('mls:device_approved', { userId, deviceId, conversationIds });
    res.json(result);
  } catch (error) {
    respondWithError(res, error, 'Cihaz onaylanamad?.');
  }
});

router.get('/mls/conversations/:id/devices', validateRequest({
  params: mlsSchemas.conversationParams
}), async (req: CustomRequest, res: Response) => {
  try {
    res.json(await mlsDeliveryService.getConversationDeviceDirectory(getUserId(req), getParam(req, 'id')));
  } catch (error) {
    respondWithError(res, error, 'Sohbet cihazlar? do?rulanamad?.');
  }
});

/** DELETE /api/v1/mls/devices/:deviceId -> Cihaz Kaydını İptal Etme */
router.delete('/mls/devices/:deviceId', validateRequest({ params: mlsSchemas.deviceParams, body: mlsSchemas.approveDevice }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const deviceId = getParam(req, 'deviceId');
    const io = req.app.get('io');
    const result = await mlsDeliveryService.revokeDevice(userId, deviceId, req.body.approverId, req.body.signature, io);
    return res.status(200).json(result);
  } catch (error) {
    logger.error({ event: 'mls.revoke_device_failed', err: error, userId: req.user?.userId }, 'MLS revoke device failed');
    return respondWithError(res, error, 'MLS cihazı iptal edilemedi.');
  }
});

/** POST /api/v1/mls/key-packages -> Tek Kullanımlık KeyPackage Havuzu Yükleme */
router.post('/mls/key-packages', validateRequest({ body: mlsSchemas.uploadKeyPackages }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const { deviceId, keyPackages } = req.body;
    const result = await mlsDeliveryService.uploadKeyPackages(userId, deviceId, keyPackages);
    return res.status(200).json(result);
  } catch (error) {
    logger.error({ event: 'mls.upload_key_packages_failed', err: error, userId: req.user?.userId }, 'MLS upload key packages failed');
    return respondWithError(res, error, 'KeyPackage paketleri yüklenemedi.');
  }
});

/** POST /api/v1/mls/key-packages/claim -> Hedef Kullanıcıların Cihaz KeyPackage'larını Talep Etme */
router.post('/mls/key-packages/claim', validateRequest({ body: mlsSchemas.claimKeyPackages }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const { conversationId, userIds, excludeDeviceId, excludeDeviceIds } = req.body;
    const io = req.app.get('io');
    const result = await mlsDeliveryService.claimKeyPackagesForUsers(
      userId,
      conversationId,
      userIds,
      excludeDeviceId,
      io,
      excludeDeviceIds
    );
    return res.status(200).json(result);
  } catch (error) {
    logger.error({ event: 'mls.claim_key_packages_failed', err: error, userId: req.user?.userId }, 'MLS claim key packages failed');
    return respondWithError(res, error, 'KeyPackage paketleri alınamadı.');
  }
});

/** POST /api/v1/mls/conversations/:id/commits -> Atomik Epoch Sıralamalı Commit ve Welcome Gönderme */
router.post('/mls/conversations/:id/commits', validateRequest({
  params: mlsSchemas.conversationParams,
  body: mlsSchemas.submitCommit
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const conversationId = getParam(req, 'id');
    const io = req.app.get('io');
    const commit = await mlsDeliveryService.submitCommit(userId, conversationId, req.body, io);
    return res.status(201).json(commit);
  } catch (error) {
    logger.warn({ event: 'mls.submit_commit_failed', err: error, userId: req.user?.userId, conversationId: req.params.id }, 'MLS submit commit failed');
    return respondWithError(res, error, 'MLS commit kaydedilemedi.');
  }
});

/** GET /api/v1/mls/conversations/:id/sync -> Eksik Commit ve Welcome Paketlerini Senkronize Etme */
router.get('/mls/conversations/:id/sync', validateRequest({
  params: mlsSchemas.conversationParams,
  query: mlsSchemas.syncConversationQuery
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const conversationId = getParam(req, 'id');
    const deviceId = String(req.query.deviceId);
    const sinceEpoch = req.query.sinceEpoch ? Number(req.query.sinceEpoch) : 0;
    const state = await mlsDeliveryService.syncConversationMlsState(userId, conversationId, deviceId, sinceEpoch);
    return res.status(200).json(state);
  } catch (error) {
    logger.error({ event: 'mls.sync_conversation_failed', err: error, userId: req.user?.userId, conversationId: req.params.id }, 'MLS conversation sync failed');
    return respondWithError(res, error, 'MLS sohbet durumu senkronize edilemedi.');
  }
});

/** POST /api/v1/mls/backups -> Kullanıcı Kontrollü Şifreli Geçmiş Yedeği Kaydetme */
router.get('/mls/conversations/:id/group-info', validateRequest({ params: mlsSchemas.conversationParams,
  query: mlsSchemas.syncConversationQuery }), async (req: CustomRequest, res: Response) => {
  try {
    return res.json(await mlsDeliveryService.getCurrentGroupInfo(getUserId(req), getParam(req, 'id'), String(req.query.deviceId)));
  } catch (error) {
    return respondWithError(res, error, 'Sohbet bilgisi alınamadı.');
  }
});

router.put('/mls/conversations/:id/group-info', validateRequest({ params: mlsSchemas.conversationParams,
  body: mlsSchemas.publishGroupInfo }), async (req: CustomRequest, res: Response) => {
  try {
    await mlsDeliveryService.publishCurrentGroupInfo(getUserId(req), getParam(req, 'id'), req.body);
    return res.sendStatus(204);
  } catch (error) {
    return respondWithError(res, error, 'Sohbet bilgisi yayımlanamadı.');
  }
});

router.post('/mls/backups', validateRequest({ body: mlsSchemas.saveBackup }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const backup = await backupService.saveEncryptedBackupManifest(userId, req.body);
    return res.status(200).json(backup);
  } catch (error) {
    logger.error({ event: 'mls.save_backup_failed', err: error, userId: req.user?.userId }, 'Encrypted history backup save failed');
    return respondWithError(res, error, 'Şifreli geçmiş yedeği kaydedilemedi.');
  }
});

/** GET /api/v1/mls/backups/latest -> En Güncel Şifreli Geçmiş Yedeğini Getirme */
router.get('/mls/backups/latest', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const backup = await backupService.getEncryptedBackupManifest(userId);
    return res.status(200).json({ backup });
  } catch (error) {
    logger.error({ event: 'mls.get_backup_failed', err: error, userId: req.user?.userId }, 'Encrypted history backup fetch failed');
    return respondWithError(res, error, 'Şifreli geçmiş yedeği getirilemedi.');
  }
});

export default router;
