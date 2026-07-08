import { createHash } from 'crypto';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import {
  livekitApiKey,
  livekitApiSecret,
  livekitTokenTtlSeconds,
  livekitUrl
} from '../config/env';

export type CallType = 'audio' | 'video';

// LiveKit zorunlu altyapı değildir; ayarlar eksikse çağrı endpoint'i 503 döner.
// Bu sayede mesajlaşma özellikleri çağrı servisi kurulmadan da geliştirilebilir.
export const isLivekitConfigured = () => Boolean(livekitUrl && livekitApiKey && livekitApiSecret);

export const createLivekitRoomName = (conversationId: string, callId: string) => {
  // Oda adında gerçek conversationId/callId'yi düz yazmak yerine hash kullanıyoruz.
  // Böylece LiveKit tarafında oda adı tahmin edilse bile uygulama içi id'ler açıkça görünmez.
  const digest = createHash('sha256')
    .update(`${conversationId}:${callId}`)
    .digest('hex')
    .slice(0, 32);

  return `mesajlasma-call-${digest}`;
};

export const createConversationCallToken = async ({
  conversationId,
  callId,
  callType,
  user
}: {
  conversationId: string;
  callId: string;
  callType: CallType;
  user: { id: string; username: string };
}) => {
  if (!isLivekitConfigured()) {
    throw new Error('LiveKit ayarları eksik.');
  }

  const roomName = createLivekitRoomName(conversationId, callId);
  // Token identity olarak kullanıcı id'si kullanılır; name ise LiveKit client tarafında görünen isimdir.
  // Metadata ile frontend hangi konuşma/çağrı türünde olduğunu tekrar anlayabilir.
  const token = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity: user.id,
    name: user.username,
    ttl: livekitTokenTtlSeconds,
    metadata: JSON.stringify({ conversationId, callId, callType })
  });

  const grant: VideoGrant = {
    // Kullanıcı yalnızca bu oda için publish/subscribe yetkisi alır.
    // Başka bir LiveKit odasına bu token ile katılamaz.
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  };
  token.addGrant(grant);

  return {
    serverUrl: livekitUrl,
    roomName,
    token: await token.toJwt()
  };
};
