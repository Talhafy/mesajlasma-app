import express, { Response } from 'express';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { gameSchemas } from '../validation/schemas';
import { getAuthenticatedUserId as getUserId, getRouteParam as getParam } from '../utils/request';
import { createConversationCallToken, ensurePersistentVoiceRoom, isLivekitConfigured } from '../services/livekit';
import * as gameChannelService from '../services/gameChannelService';
import { logger } from '../config/logger';
import { AppError, respondWithError } from '../errors/AppError';

const router = express.Router();
router.use(authenticateToken);

router.get('/game/groups/:groupId/channels', validateRequest({ params: gameSchemas.groupParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    return res.status(200).json(await gameChannelService.listChannels(getParam(req, 'groupId'), getUserId(req)));
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal listesi alınamadı.');
  }
});

router.post('/game/groups/:groupId/channels', validateRequest({ params: gameSchemas.groupParams, body: gameSchemas.createChannel }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const channel = await gameChannelService.createChannel(getParam(req, 'groupId'), getUserId(req), req.body);
    req.app.get('io')?.to(getParam(req, 'groupId')).emit('game:channel-created', channel);
    return res.status(201).json(channel);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal oluşturulamadı.');
  }
});

router.delete('/game/groups/:groupId/channels/:channelId', validateRequest({ params: gameSchemas.channelParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'groupId');
    const result = await gameChannelService.deleteChannel(groupId, getParam(req, 'channelId'), getUserId(req));
    req.app.get('io')?.to(groupId).emit('game:channel-deleted', { ...result, groupId });
    return res.status(200).json(result);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal silinemedi.');
  }
});

router.get('/game/groups/:groupId/channels/:channelId/messages', validateRequest({ params: gameSchemas.channelParams, query: gameSchemas.channelMessagesQuery }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const messages = await gameChannelService.fetchChannelMessages(
      getParam(req, 'groupId'), getParam(req, 'channelId'), getUserId(req), req.query.cursor as string | undefined
    );
    return res.status(200).json(messages);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal mesajları alınamadı.');
  }
});

router.post('/game/groups/:groupId/channels/:channelId/messages', validateRequest({ params: gameSchemas.channelParams, body: gameSchemas.channelMessage }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const message = await gameChannelService.sendChannelMessage(
      getParam(req, 'groupId'), getParam(req, 'channelId'), getUserId(req), req.body, req.app.get('io')
    );
    return res.status(201).json(message);
  } catch (error: any) {
    logger.error({ event: 'game.message_send_failed', err: error, userId: req.user?.userId }, 'Game channel message failed');
    return respondWithError(res, error, 'Kanal mesajı gönderilemedi.');
  }
});

router.post('/game/groups/:groupId/channels/:channelId/read', validateRequest({ params: gameSchemas.channelParams, body: gameSchemas.readChannel }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const result = await gameChannelService.markChannelAsRead(
      getParam(req, 'groupId'), getParam(req, 'channelId'), getUserId(req), req.body.lastReadMessageId, req.app.get('io')
    );
    return res.status(200).json(result);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal okundu olarak işaretlenemedi.');
  }
});

router.post('/game/channels/:channelId/token', validateRequest({ params: gameSchemas.channelIdParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    if (!isLivekitConfigured()) return res.status(503).json({ error: 'LiveKit yapılandırması eksik.' });
    const access = await gameChannelService.getVoiceChannelAccess(getParam(req, 'channelId'), getUserId(req));
    await ensurePersistentVoiceRoom({
      conversationId: access.conversation.id,
      channelId: access.channel.id,
      maxParticipants: access.channel.maxParticipants || 8
    });
    const livekit = await createConversationCallToken({
      conversationId: access.conversation.id,
      callId: access.channel.id,
      callType: 'audio',
      user: access.user
    });
    return res.status(200).json({ ...livekit, channel: access.channel, conversation: access.conversation });
  } catch (error: any) {
    return respondWithError(res, error, 'Ses kanalı tokeni alınamadı.');
  }
});

router.patch('/game/groups/:groupId/channels/:channelId', validateRequest({ params: gameSchemas.channelParams, body: gameSchemas.updateChannel }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'groupId');
    const channelId = getParam(req, 'channelId');
    const channel = await gameChannelService.updateChannel(groupId, channelId, getUserId(req), req.body);
    req.app.get('io')?.to(groupId).emit('game:channel-updated', channel);
    return res.status(200).json(channel);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal güncellenemedi.');
  }
});

router.put('/game/groups/:groupId/channels/reorder', validateRequest({ params: gameSchemas.groupParams, body: gameSchemas.reorderChannels }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'groupId');
    const channels = await gameChannelService.reorderChannels(groupId, getUserId(req), req.body.orderedIds);
    req.app.get('io')?.to(groupId).emit('game:channels-reordered', { groupId, channels });
    return res.status(200).json(channels);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal sıralaması güncellenemedi.');
  }
});

router.post('/game/groups/:groupId/channels/:channelId/mute', validateRequest({ params: gameSchemas.channelParams }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    const groupId = getParam(req, 'groupId');
    const channelId = getParam(req, 'channelId');
    const result = await gameChannelService.toggleChannelMute(groupId, channelId, getUserId(req));
    return res.status(200).json(result);
  } catch (error: any) {
    return respondWithError(res, error, 'Kanal sessize alınamadı.');
  }
});

export default router;
