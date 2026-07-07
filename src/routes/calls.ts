import express, { Response } from 'express';
import prisma from '../db';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { logger } from '../config/logger';
import { chatSchemas } from '../validation/schemas';
import { getAuthenticatedUserId as getUserId } from '../utils/request';
import {
  createConversationCallToken,
  isLivekitConfigured,
  type CallType
} from '../services/livekit';

const router = express.Router();

router.use(authenticateToken);

router.post('/calls/token', validateRequest({ body: chatSchemas.callToken }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    if (!isLivekitConfigured()) {
      return res.status(503).json({ error: 'LiveKit yapılandırması eksik. LIVEKIT_URL, LIVEKIT_API_KEY ve LIVEKIT_API_SECRET tanımlayın.' });
    }

    const userId = getUserId(req);
    const { conversationId, callId, callType } = req.body as {
      conversationId: string;
      callId: string;
      callType: CallType;
    };

    const membership = await prisma.participant.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
      select: {
        user: { select: { id: true, username: true } },
        conversation: { select: { id: true, isGroup: true, name: true } }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Bu görüşmeye katılma yetkiniz yok.' });
    }

    const livekit = await createConversationCallToken({
      conversationId,
      callId,
      callType,
      user: membership.user
    });

    logger.info({
      event: 'call.token_created',
      userId,
      conversationId,
      callId,
      callType
    }, 'LiveKit call token created');

    return res.status(200).json({
      ...livekit,
      callId,
      callType,
      conversationId,
      conversation: membership.conversation
    });
  } catch (error) {
    logger.error({ event: 'call.token_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'LiveKit token creation failed');
    return res.status(500).json({ error: 'Görüşme bağlantısı hazırlanamadı.' });
  }
});

export default router;
