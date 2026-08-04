/**
 * ============================================================================
 * ANA SOHBET VE MESAJLAŞMA ROTALARI (Chat, Group & Message Routes)
 * ============================================================================
 * 
 * Bu dosya; dosya yükleme (Direct-to-R2 & ClamAV karantina taraması), kullanıcı engelleme/listeleme,
 * sohbet/grup yönetimi, mesaj gönderme/düzenleme/silme, okundu bilgisi gönderme ve mesaj arama
 * gibi tüm mesajlaşma API uç noktalarını (endpoints) içerir.
 */

import express, { Response } from 'express';
import { uploadSingleFile } from '../config/fileUpload';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { chatSchemas } from '../validation/schemas';
import {
  createPresignedUploadUrl,
  deletePrivateFile,
  uploadPrivateFile,
  withSignedFileUrl
} from '../services/fileStorage';
import { MalwareDetectedError, MalwareScannerUnavailableError, scanBufferForMalware } from '../services/malwareScan';
import { confirmAndApproveAsset, registerUploadedAsset, sha256 } from '../services/uploadedAssetService';
import { UploadedAssetStatus } from '@prisma/client';
import { logger } from '../config/logger';
import { getAuthenticatedUserId as getUserId, getRouteParam as getParam } from '../utils/request';
import { verifyFileSignature } from '../utils/fileValidation';
import * as userService from '../services/userService';
import * as conversationService from '../services/conversationService';
import * as messageService from '../services/messageService';

import { AppError, respondWithError } from '../errors/AppError';

const router = express.Router();

// Bu router altındaki tüm mesaj, sohbet ve dosya endpoint'leri access token gerektirir.
router.use(authenticateToken);

// ============================================================================
// 1. DOSYA YÜKLEME VE GÜVENLİK API'LERİ (File Storage & Scan)
// ============================================================================

/**
 * POST /api/v1/upload/presigned -> Doğrudan Cloudflare R2'ye Yükleme Adresi Üretme
 * İstemciye önceden imzalanmış yükleme adresi (Presigned URL) verir ve varlığı QUARANTINE statüsünde kaydeder.
 */
router.post('/upload/presigned', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { fileName, contentType, sizeBytes } = req.body;
    if (!fileName || !contentType || !sizeBytes) {
      return res.status(400).json({ error: 'fileName, contentType ve sizeBytes zorunludur.', code: 'VALIDATION_ERROR' });
    }

    const userId = getUserId(req);
    const { fileKey, uploadUrl, expiresAt } = await createPresignedUploadUrl(fileName, contentType);

    // Dosya doğrudan R2'ye yüklenmeden önce veritabanında QUARANTINE statüsünde açılır.
    await registerUploadedAsset({
      fileKey,
      ownerId: userId,
      mimeType: contentType,
      sizeBytes: Number(sizeBytes),
      checksum: 'pending_direct_upload',
      status: UploadedAssetStatus.QUARANTINE
    });

    return res.status(200).json({ fileKey, uploadUrl, expiresAt });
  } catch (error) {
    return respondWithError(res, error, 'Presigned yükleme adresi üretilemedi.');
  }
});

/**
 * POST /api/v1/upload/confirm -> Doğrudan Yükleme Karantina Onayı ve Tarama
 * Cloudflare R2'ye yüklenen dosyanın karantinadan çıkarılıp READY statüsüne geçirilmesini sağlar.
 */
router.post('/upload/confirm', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { fileKey } = req.body;
    if (!fileKey) {
      return res.status(400).json({ error: 'fileKey zorunludur.', code: 'VALIDATION_ERROR' });
    }
    const userId = getUserId(req);

    // Karantinadaki dosya taramadan geçirilip READY statüsüne getirilir.
    const approvedAsset = await confirmAndApproveAsset(fileKey, userId);
    return res.status(200).json({ fileKey: approvedAsset.fileKey, status: approvedAsset.status });
  } catch (error) {
    return respondWithError(res, error, 'Karantinadaki dosya doğrulanamadı.');
  }
});

/**
 * POST /api/v1/upload -> Sunucu Üzerinden Güvenli Tekli Dosya Yükleme
 * İmzayı doğrular, ClamAV antivirüs taraması yapar ve R2'ye yükleyip geçici URL döndürür.
 */
router.post('/upload', uploadSingleFile, async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    if (!req.file) return res.status(400).json({ error: "Dosya bulunamadı." });

    // Multer/busboy Türkçe karakterleri latin1 olarak çözümler. 
    // Karakter bozulmalarını önlemek için UTF-8'e dönüştürüyoruz.
    const originalNameDecoded = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // Dosya içeriğinin beyan edilen MIME tipi ile uyuşup uyuşmadığını doğrula.
    if (!verifyFileSignature(req.file.buffer, req.file.mimetype)) {
      logger.warn({
        event: 'security.file_signature_mismatch',
        userId: req.user?.userId,
        fileName: originalNameDecoded,
        mimetype: req.file.mimetype
      }, 'File signature mismatch detected');
      return res.status(400).json({ error: 'Dosya içeriği beyan edilen dosya türü (MIME tipi) ile uyuşmuyor.', code: 'VALIDATION_ERROR' });
    }

    // ClamAV Antivirüs Taraması
    await scanBufferForMalware(req.file.buffer);

    const fileKey = await uploadPrivateFile(
      req.file.buffer,
      req.file.mimetype,
      originalNameDecoded
    );
    try {
      // Yüklenen dosya kayıt anında QUARANTINE statüsünde başlatılır, başarıyla taranınca READY yapılır.
      await registerUploadedAsset({
        fileKey,
        ownerId: getUserId(req),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        checksum: sha256(req.file.buffer),
        status: UploadedAssetStatus.QUARANTINE
      });
      await confirmAndApproveAsset(fileKey, getUserId(req));
    } catch (error) {
      await deletePrivateFile(fileKey).catch(() => undefined);
      throw error;
    }

    const signedFile = await withSignedFileUrl({ fileKey });
    return res.status(200).json({
      fileKey,
      fileUrl: signedFile.fileUrl,
      fileName: originalNameDecoded,
      fileType: req.file.mimetype.startsWith('image/') ? 'image' :
        req.file.mimetype.startsWith('audio/') || req.file.mimetype.startsWith('video/') ? 'audio' : 'document'
    });
  } catch (error) {
    if (error instanceof MalwareDetectedError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof MalwareScannerUnavailableError) {
      return res.status(503).json({ error: error.message });
    }
    logger.error({ event: 'chat.file_upload_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'File upload failed');
    return res.status(500).json({ error: 'Dosya buluta yüklenemedi.' });
  }
});

// ============================================================================
// 2. KULLANICI YÖNETİMİ API'LERİ (UserService)
// ============================================================================

/** GET /api/v1/users -> Rehberdeki Kullanıcıları Listeleme */
router.get('/users', validateRequest({ query: chatSchemas.paginationQuery }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const users = await userService.listUsers(currentUserId, cursor, limit);
    return res.status(200).json(users);
  } catch (error) {
    logger.error({ event: 'chat.list_users_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'List users failed');
    return res.status(500).json({ error: "Kullanıcılar getirilemedi." });
  }
});

/** GET /api/v1/users/:id -> Kullanıcı Profilini Getirme */
router.get('/users/:id', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const targetId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    const profile = await userService.getUserProfile(targetId, currentUserId);
    if (!profile) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    return res.status(200).json(profile);
  } catch (error) {
    logger.error({ event: 'chat.get_profile_failed', err: error, userId: req.user?.userId, targetId: req.params.id, ip: req.ip }, 'Get profile failed');
    return res.status(500).json({ error: "Kullanıcı profili alınamadı." });
  }
});

/** GET /api/v1/users/blocked/list -> Engellenen Kullanıcıları Listeleme */
router.get('/users/blocked/list', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const blockedList = await userService.getBlockedUsers(currentUserId);
    return res.status(200).json(blockedList);
  } catch (error) {
    logger.error({ event: 'chat.get_blocked_list_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Get blocked list failed');
    return res.status(500).json({ error: "Engellenen kullanıcılar getirilemedi." });
  }
});

/** POST /api/v1/users/:id/block -> Kullanıcı Engelleme */
router.post('/users/:id/block', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const targetId = getParam(req, 'id');
    const io = req.app.get('io');
    const result = await userService.blockUser(currentUserId, targetId, io);
    if (!result) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.block_user_failed', err: error, userId: req.user?.userId, targetId: req.params.id, ip: req.ip }, 'Block user failed');
    return respondWithError(res, error, 'Engelleme başarısız.');
  }
});

/** DELETE /api/v1/users/:id/block -> Engeli Kaldırma */
router.delete('/users/:id/block', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const targetId = getParam(req, 'id');
    const io = req.app.get('io');
    const result = await userService.unblockUser(currentUserId, targetId, io);
    return res.status(200).json(result);
  } catch (error) {
    logger.error({ event: 'chat.unblock_user_failed', err: error, userId: req.user?.userId, targetId: req.params.id, ip: req.ip }, 'Unblock user failed');
    return res.status(500).json({ error: "Engel kaldırma başarısız." });
  }
});

// ============================================================================
// 3. SOHBET VE GRUP YÖNETİMİ API'LERİ (ConversationService)
// ============================================================================

/** GET /api/v1/conversations -> Kullanıcının Sohbet Listesini Getirme */
router.get('/conversations', validateRequest({ query: chatSchemas.paginationQuery }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const conversations = await conversationService.listConversations(userId, cursor, limit);
    return res.status(200).json(conversations);
  } catch (error) {
    logger.error({ event: 'chat.conversations_fetch_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Conversations fetch failed');
    return res.status(500).json({ error: 'Sohbet listesi alınamadı.' });
  }
});

/** DELETE /api/v1/conversations/:id -> Sohbet Geçmişini Temizleme/Silme */
router.delete('/conversations/:id', validateRequest({ params: chatSchemas.conversationIdParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.deleteConversationHistory(conversationId, userId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.conversation_delete_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Delete conversation history failed');
    return respondWithError(res, error, 'Sohbet silinemedi.');
  }
});

/** PUT /api/v1/conversations/:id/pin -> Sohbeti Başa Sabitleme / Sabitlemeyi Kaldırma */
router.put('/conversations/:id/pin', validateRequest({ params: chatSchemas.conversationIdParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const result = await conversationService.pinConversation(conversationId, userId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.conversation_pin_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Conversation pin status update failed');
    return respondWithError(res, error, 'Sohbet sabitleme durumu güncellenemedi.');
  }
});

/** PUT /api/v1/conversations/:id/archive -> Sohbeti Arşivleme / Arşivden Çıkarma */
router.put('/conversations/:id/archive', validateRequest({ params: chatSchemas.conversationIdParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const result = await conversationService.archiveConversation(conversationId, userId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.conversation_archive_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Conversation archive status update failed');
    return respondWithError(res, error, 'Sohbet arşiv durumu güncellenemedi.');
  }
});

/** PUT /api/v1/conversations/:id/mute -> Sohbet Bildirimlerini Sessize Alma */
router.put('/conversations/:id/mute', validateRequest({ params: chatSchemas.conversationIdParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const result = await conversationService.muteConversation(conversationId, userId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.conversation_mute_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Conversation mute status update failed');
    return respondWithError(res, error, 'Sohbet sessize alma durumu güncellenemedi.');
  }
});

/** PUT /api/v1/conversations/:id/disappearing -> Kaybolan Mesaj Süresini Ayarlama */
router.put('/conversations/:id/disappearing', validateRequest({
  params: chatSchemas.conversationIdParams,
  body: chatSchemas.disappearingMode
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const { durationSeconds } = req.body;
    const io = req.app.get('io');
    const result = await conversationService.updateDisappearingMode(conversationId, userId, durationSeconds, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.conversation_disappearing_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Conversation disappearing mode update failed');
    return respondWithError(res, error, 'Kaybolan mesaj modu güncellenemedi.');
  }
});

/** POST /api/v1/conversations/direct -> Birebir Sohbet Başlatma */
router.post('/conversations/direct', validateRequest({ body: chatSchemas.directConversation }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = getUserId(req);
    const result = await conversationService.createDirectConversation(currentUserId, targetUserId);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.direct_conversation_failed', err: error, userId: req.user?.userId, targetUserId: req.body.targetUserId, ip: req.ip }, 'Direct conversation creation failed');
    return respondWithError(res, error, 'Sohbet odası oluşturulamadı.');
  }
});

/** POST /api/v1/conversations/group -> Yeni Grup Sohbeti Oluşturma */
router.post('/conversations/group', validateRequest({ body: chatSchemas.group }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { name, participantIds } = req.body;
    const currentUserId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.createGroupConversation(currentUserId, name, participantIds, io);
    return res.status(201).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_creation_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Group creation failed');
    return respondWithError(res, error, 'Grup oluşturulamadı.');
  }
});

/** GET /api/v1/conversations/groups -> Üye Olunan Grupları Listeleme */
router.get('/conversations/groups', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const currentUserId = getUserId(req);
    const groups = await conversationService.listGroupConversations(currentUserId);
    return res.status(200).json(groups);
  } catch (error) {
    logger.error({ event: 'chat.groups_fetch_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Groups fetch failed');
    return res.status(500).json({ error: "Gruplar getirilemedi." });
  }
});

/** GET /api/v1/conversations/group/:id/participants -> Grup Üyelerini Listeleme */
router.get('/conversations/group/:id/participants', validateRequest({ params: chatSchemas.groupParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    const participants = await conversationService.listGroupParticipants(groupId, currentUserId);
    return res.status(200).json(participants);
  } catch (error: any) {
    logger.error({ event: 'chat.group_participants_failed', err: error, userId: req.user?.userId, groupId: req.params.id, ip: req.ip }, 'Group participants fetch failed');
    return respondWithError(res, error, 'Grup üyeleri alınamadı.');
  }
});

/** PUT /api/v1/conversations/group/:id/name -> Grup Adını Değiştirme */
router.put('/conversations/group/:id/name', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.groupName
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    const { newName } = req.body;
    const result = await conversationService.updateGroupName(groupId, currentUserId, newName);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_name_failed', err: error, userId: req.user?.userId, groupId: req.params.id, ip: req.ip }, 'Group name update failed');
    return respondWithError(res, error, 'Grup adı güncellenemedi.');
  }
});

/** PUT /api/v1/conversations/group/:id/avatar -> Grup Profil Resmi Güncelleme */
router.put('/conversations/group/:id/avatar', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.groupAvatar
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const currentUserId = getUserId(req);
    const { fileKey } = req.body;
    const io = req.app.get('io');
    const result = await conversationService.updateGroupAvatar(groupId, currentUserId, fileKey, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_avatar_failed', err: error, userId: req.user?.userId, groupId: req.params.id, ip: req.ip }, 'Group avatar update failed');
    return respondWithError(res, error, 'Grup resmi güncellenemedi.');
  }
});

/** DELETE /api/v1/conversations/group/:id/participants/:userId -> Gruptan Üye Çıkarma / Gruptan Ayrılma */
router.delete('/conversations/group/:id/participants/:userId', validateRequest({ params: chatSchemas.groupMemberParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const userId = getParam(req, 'userId');
    const adminId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.removeGroupParticipant(groupId, userId, adminId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_member_remove_failed', err: error, userId: req.user?.userId, groupId: req.params.id, targetUserId: req.params.userId, ip: req.ip }, 'Remove group member failed');
    return respondWithError(res, error, 'Kişi çıkarılamadı.');
  }
});

/** POST /api/v1/conversations/group/:id/participants -> Gruba Yeni Üyeler Ekleme */
router.post('/conversations/group/:id/participants', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.addGroupMembers
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const { userIdsToAdd } = req.body;
    const adminId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.addGroupParticipants(groupId, userIdsToAdd, adminId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_member_add_failed', err: error, userId: req.user?.userId, groupId: req.params.id, ip: req.ip }, 'Add group members failed');
    return respondWithError(res, error, 'Ekleme başarısız.');
  }
});

/** PUT /api/v1/conversations/group/:id/admin -> Grup Yöneticiliğini Devretme */
router.put('/conversations/group/:id/admin', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.transferAdmin
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const { newAdminId } = req.body;
    const currentAdminId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.transferGroupAdmin(groupId, newAdminId, currentAdminId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_admin_transfer_failed', err: error, userId: req.user?.userId, groupId: req.params.id, newAdminId: req.body.newAdminId, ip: req.ip }, 'Transfer group admin failed');
    return respondWithError(res, error, 'İşlem başarısız.');
  }
});

/** DELETE /api/v1/conversations/group/:id -> Grubu Tamamen Silme (Yönetici Yetkisi) */
router.delete('/conversations/group/:id', validateRequest({ params: chatSchemas.groupParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'id');
    const adminId = getUserId(req);
    const io = req.app.get('io');
    const result = await conversationService.deleteGroup(groupId, adminId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.group_delete_failed', err: error, userId: req.user?.userId, groupId: req.params.id, ip: req.ip }, 'Delete group failed');
    return respondWithError(res, error, 'Grup silinemedi.');
  }
});

// ============================================================================
// 4. MESAJLAŞMA VE OKUNDU API'LERİ (MessageService)
// ============================================================================

/** POST /api/v1/messages -> Yeni Mesaj Gönderme */
router.post('/messages', validateRequest({ body: chatSchemas.message }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const senderId = getUserId(req);
    const io = req.app.get('io');
    const result = await messageService.sendMessage(senderId, req.body, io);
    return res.status(201).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.message_send_failed', err: error, userId: req.user?.userId, conversationId: req.body.conversationId, ip: req.ip }, 'Message send failed');
    return respondWithError(res, error, 'Mesaj gönderilemedi.');
  }
});

/** GET /api/v1/conversations/:conversationId/messages -> Sohbet Mesajlarını Sayfalamalı (Cursor) Getirme */
router.get('/conversations/:conversationId/messages', validateRequest({
  params: chatSchemas.conversationParams,
  query: chatSchemas.conversationMessagesQuery
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'conversationId');
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const userId = getUserId(req);
    const messages = await messageService.fetchMessages(conversationId, userId, cursor, limit);
    return res.status(200).json(messages);
  } catch (error: any) {
    logger.error({ event: 'chat.messages_fetch_failed', err: error, userId: req.user?.userId, conversationId: req.params.conversationId, ip: req.ip }, 'Messages fetch failed');
    return respondWithError(res, error, 'Mesajlar yüklenemedi.');
  }
});

/** POST /api/v1/conversations/:id/read -> Okundu Bilgisi Gönderme (Görüldü Atma) */
router.post('/conversations/:id/read', validateRequest({
  params: chatSchemas.groupParams,
  body: chatSchemas.readConversation
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { emitReceipt, lastReadMessageId } = req.body;
    const conversationId = getParam(req, 'id');
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await messageService.markAsRead(conversationId, userId, lastReadMessageId, emitReceipt, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.read_receipt_failed', err: error, userId: req.user?.userId, conversationId: req.params.id, ip: req.ip }, 'Read receipt failed');
    return respondWithError(res, error, 'Görüldü atılamadı.');
  }
});

/** GET /api/v1/unread-counts -> Sohbet Bazlı Okunmamış Mesaj Sayılarını Getirme */
router.get('/unread-counts', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const counts = await messageService.getUnreadCounts(userId);
    return res.status(200).json(counts);
  } catch (error) {
    logger.error({ event: 'chat.unread_counts_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Unread counts failed');
    return res.status(500).json({ error: 'Okunmamış mesajlar getirilemedi.' });
  }
});

/** GET /api/v1/messages/search -> Mesaj Geçmişinde Arama Yapma */
router.get('/messages/search', validateRequest({ query: chatSchemas.searchQuery }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const { q } = req.query;
    const userId = getUserId(req);
    const messages = await messageService.searchMessages(userId, q as string);
    return res.status(200).json(messages);
  } catch (error) {
    logger.error({ event: 'chat.search_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Search failed');
    return res.status(500).json({ error: 'Arama yapılamadı.' });
  }
});

/** GET /api/v1/messages/starred -> Yıldızlanmış Mesajları Listeleme */
router.get('/messages/starred', async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const userId = getUserId(req);
    const messages = await messageService.fetchStarredMessages(userId);
    return res.status(200).json(messages);
  } catch (error) {
    logger.error({ event: 'chat.starred_messages_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'Starred messages fetch failed');
    return res.status(500).json({ error: 'Yıldızlı mesajlar getirilemedi.' });
  }
});

/** PUT /api/v1/messages/:id -> Gönderilen Mesajı Düzenleme */
router.put('/messages/:id', validateRequest({
  params: chatSchemas.idParams,
  body: chatSchemas.editMessage
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);
    const { content } = req.body;
    const io = req.app.get('io');
    const updated = await messageService.editMessage(id, userId, content, io);
    return res.status(200).json(updated);
  } catch (error: any) {
    logger.error({ event: 'chat.message_edit_failed', err: error, userId: req.user?.userId, messageId: req.params.id, ip: req.ip }, 'Message edit failed');
    return respondWithError(res, error, 'Mesaj düzenlenemedi.');
  }
});

/** GET /api/v1/conversations/:conversationId/media -> Sohbet İçi Paylaşılan Medyaları Listeleme */
router.get('/conversations/:conversationId/media', validateRequest({
  params: chatSchemas.conversationParams
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const conversationId = getParam(req, 'conversationId');
    const userId = getUserId(req);
    const media = await messageService.fetchConversationMedia(conversationId, userId);
    return res.status(200).json(media);
  } catch (error: any) {
    logger.error({ event: 'chat.media_fetch_failed', err: error, userId: req.user?.userId, conversationId: req.params.conversationId, ip: req.ip }, 'Media fetch failed');
    return respondWithError(res, error, 'Medya bilgileri getirilemedi.');
  }
});

/** PUT /api/v1/messages/:id/pin -> Mesajı Başa Sabitleme / Sabitlemeyi Kaldırma */
router.put('/messages/:id/pin', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await messageService.pinMessage(id, userId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.message_pin_failed', err: error, userId: req.user?.userId, messageId: req.params.id, ip: req.ip }, 'Message pin failed');
    return respondWithError(res, error, 'Sabitleme işlemi başarısız.');
  }
});

/** PUT /api/v1/messages/:id/star -> Mesajı Yıldızlama / Yıldızı Kaldırma */
router.put('/messages/:id/star', validateRequest({ params: chatSchemas.idParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await messageService.starMessage(id, userId, io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.message_star_failed', err: error, userId: req.user?.userId, messageId: req.params.id, ip: req.ip }, 'Message star failed');
    return respondWithError(res, error, 'Yıldızlama başarısız.');
  }
});

/** DELETE /api/v1/messages/:id -> Mesaj Silme (Benden Sil / Herkesten Sil) */
router.delete('/messages/:id', validateRequest({
  params: chatSchemas.idParams,
  query: chatSchemas.deleteMessageQuery
}), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const id = getParam(req, 'id');
    const { forEveryone } = req.query;
    const userId = getUserId(req);
    const io = req.app.get('io');
    const result = await messageService.deleteMessage(id, userId, forEveryone === 'true', io);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error({ event: 'chat.message_delete_failed', err: error, userId: req.user?.userId, messageId: req.params.id, ip: req.ip }, 'Message delete failed');
    return respondWithError(res, error, 'Silme işlemi başarısız.');
  }
});

export default router;

