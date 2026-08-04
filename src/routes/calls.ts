/**
 * ============================================================================
 * SESLİ VE GÖRÜNTÜLÜ ARAMA ROTALARI (LiveKit Call Token Routes)
 * ============================================================================
 * 
 * Bu dosya, istemcilerin LiveKit WebRTC sunucusuna sesli veya görüntülü arama 
 * başlatarak katılmasını sağlayan güvenli erişim jetonlarını (Call Token) üretir.
 */

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

// Arama token rotalarının tamamı yetkilendirme (JWT Bearer Token) gerektirir.
router.use(authenticateToken);

/**
 * POST /api/v1/calls/token -> Sesli/Görüntülü Görüşme Katılım Jetonu Üretme
 * 
 * 1. LiveKit konfigürasyonunun sunucuda hazır olup olmadığını doğrular (Yoksa 503 döner).
 * 2. İsteği atan kullanıcının hedef sohbetin (birebir veya grup) aktif üyesi olduğunu kontrol eder.
 * 3. Yalnızca bu sohbet/çağrı için geçerli olan süreli (TTL) bir LiveKit JWT token'ı üretip döndürür.
 */
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

    // Kullanıcının sohbete üye olup olmadığını kontrol et
    const membership = await requireActiveParticipant(
      conversationId,
      userId,
      'Bu görüşmeye katılma yetkiniz yok.'
    ).catch(() => null);
    if (!membership) {
      return res.status(403).json({ error: 'Bu görüşmeye katılma yetkiniz yok.' });
    }

    // LiveKit token yalnızca bu konuşma/callId için üretilen oda adına geçerlidir.
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
