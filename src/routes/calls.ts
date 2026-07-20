//Livekit jwt koruması

import express, { Response } from 'express';
import { authenticateToken, CustomRequest } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { logger } from '../config/logger';
import { chatSchemas } from '../validation/schemas';
import { getAuthenticatedUserId as getUserId } from '../utils/request';
import { requireActiveParticipant } from '../services/conversationAccess';
import {
  createConversationCallToken,
  isLivekitConfigured,
  type CallType
} from '../services/livekit';

const router = express.Router();

// Çağrı token'ı da diğer chat API'leri gibi JWT ile korunur.
// Kullanıcı sadece üyesi olduğu konuşma için LiveKit odasına katılma token'ı alabilir.
router.use(authenticateToken);

router.post('/calls/token', validateRequest({ body: chatSchemas.callToken }), async (req: CustomRequest, res: Response): Promise<any> => {
  try {
    // LiveKit ayarı eksikse mesajlaşma sistemi çalışmaya devam eder, yalnızca çağrı özelliği kapalı olur.
    if (!isLivekitConfigured()) {
      return res.status(503).json({ error: 'LiveKit yapılandırması eksik. LIVEKIT_URL, LIVEKIT_API_KEY ve LIVEKIT_API_SECRET tanımlayın.' });
    }

    const userId = getUserId(req);
    const { conversationId, callId, callType } = req.body as {
      conversationId: string;
      callId: string;
      callType: CallType;
    };

    const membership = await requireActiveParticipant(
      conversationId,
      userId,
      'Bu görüşmeye katılma yetkiniz yok.'
    ).catch(() => null);
    if (!membership) {
      return res.status(403).json({ error: 'Bu görüşmeye katılma yetkiniz yok.' });
    }

    // LiveKit token yalnızca bu konuşma/callId için üretilen oda adına geçerlidir.
    // bu endpoint üyelik kontrolü yapar.
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
      conversation: {
        id: membership.conversation.id,
        isGroup: membership.conversation.isGroup,
        name: membership.conversation.name
      }
    });
  } catch (error) {
    logger.error({ event: 'call.token_failed', err: error, userId: req.user?.userId, ip: req.ip }, 'LiveKit token creation failed');
    return res.status(500).json({ error: 'Görüşme bağlantısı hazırlanamadı.' });
  }
});

export default router;
