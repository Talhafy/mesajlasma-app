import { createHash } from 'crypto';
import { AccessToken, RoomServiceClient, type VideoGrant } from 'livekit-server-sdk';
import {
  livekitApiKey,
  livekitApiSecret,
  livekitTokenTtlSeconds,
  livekitUrl
} from '../config/env';
import { AppError } from '../errors/AppError';

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

export const ensurePersistentVoiceRoom = async ({
  conversationId,
  channelId,
  maxParticipants
}: {
  conversationId: string;
  channelId: string;
  maxParticipants: number;
}) => {
  if (!isLivekitConfigured()) throw AppError.internal('LiveKit ayarları eksik.');
  const roomName = createLivekitRoomName(conversationId, channelId);
  const httpUrl = livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const roomService = new RoomServiceClient(httpUrl, livekitApiKey, livekitApiSecret);
  const existing = await roomService.listRooms([roomName]);
  if (existing.length > 0) return existing[0];

  try {
    return await roomService.createRoom({
      name: roomName,
      maxParticipants,
      emptyTimeout: 60,
      departureTimeout: 20,
      metadata: JSON.stringify({ conversationId, channelId, kind: 'game-voice-channel' })
    });
  } catch (error) {
    // Aynı anda iki katılım olursa ilk istek odayı oluşturmuş olabilir.
    const racedRoom = await roomService.listRooms([roomName]);
    if (racedRoom.length > 0) return racedRoom[0];
    throw error;
  }
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
    throw AppError.internal('LiveKit ayarları eksik.');
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
