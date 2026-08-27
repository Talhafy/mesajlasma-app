/**
 * ============================================================================
 * LIVEKIT WEBRTC VE SESLİ GÖRÜŞME SERVİSİ (LiveKit Audio/Video Call Service)
 * ============================================================================
 * 
 * Bu servis, birebir ve grup sohbetlerindeki sesli/görüntülü aramalar
 * için LiveKit WebRTC sunucusuyla iletişim kurar, dinamik odalar (room) oluşturur
 * ve istemciler için katılım jetonları (JWT Video Grant) üretir.
 */

import { createHash } from 'crypto';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import {
  livekitApiKey,
  livekitApiSecret,
  livekitTokenTtlSeconds,
  livekitUrl
} from '../config/env';
import { AppError } from '../errors/AppError';

/** Arama Türü ('audio' -> Sesli, 'video' -> Görüntülü) */
export type CallType = 'audio' | 'video';

/**
 * LiveKit konfigürasyonunun (URL, API Key, Secret) tam ve geçerli olup olmadığını denetler.
 * Bu kontrol, LiveKit servisi kurulmamışsa uygulamanın hata vermesini engellemek için kullanılır.
 */
export const isLivekitConfigured = () => Boolean(livekitUrl && livekitApiKey && livekitApiSecret);

/**
 * LiveKit sunucusunda kullanılacak benzersiz ve güvenli oda adı türetir.
 * Oda adında gerçek `conversationId` ve `callId` bilgilerini açık metin olarak tutmak yerine
 * SHA-256 hash kullanarak uygulama içi ID'lerin tahmin edilmesini zorlaştırır.
 */
export const createLivekitRoomName = (conversationId: string, callId: string) => {
  const digest = createHash('sha256')
    .update(`${conversationId}:${callId}`)
    .digest('hex')
    .slice(0, 32);

  return `mesajlasma-call-${digest}`;
};

/**
 * Kullanıcının belirli bir sesli/görüntülü odaya katılması için imzalı LiveKit JWT erişim jetonu üretir.
 * Kullanıcıya sadece ilgili oda için gerekli (VideoGrant) yetkilerini tanımlar.
 */
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
