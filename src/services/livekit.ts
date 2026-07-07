import { createHash } from 'crypto';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import {
  livekitApiKey,
  livekitApiSecret,
  livekitTokenTtlSeconds,
  livekitUrl
} from '../config/env';

export type CallType = 'audio' | 'video';

export const isLivekitConfigured = () => Boolean(livekitUrl && livekitApiKey && livekitApiSecret);

export const createLivekitRoomName = (conversationId: string, callId: string) => {
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
  const token = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity: user.id,
    name: user.username,
    ttl: livekitTokenTtlSeconds,
    metadata: JSON.stringify({ conversationId, callId, callType })
  });

  const grant: VideoGrant = {
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
