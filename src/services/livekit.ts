/**
 * ============================================================================
 * LIVEKIT WEBRTC VE SESLİ GÖRÜŞME SERVİSİ (LiveKit Audio/Video Call Service)
 * ============================================================================
 * 
 * Bu servis, birebir sohbetlerde ve oyun kanallarındaki sesli/görüntülü aramalar
 * için LiveKit WebRTC sunucusuyla iletişim kurar, dinamik odalar (room) oluşturur
 * ve istemciler için katılım jetonları (JWT Video Grant) üretir.
 */

import { createHash } from 'crypto';
import { AccessToken, RoomServiceClient, type VideoGrant } from 'livekit-server-sdk';
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
 * Ses kanalları için kalıcı (persistent) veya otomatik kapanan LiveKit odasını garanti eder.
 * Oda henüz oluşturulmamışsa yeni bir oda oluşturur, zaten mevcutsa odayı döner.
 * Hatalı durumlarda `AppError` döndürerek servis katmanını bilgilendirir.
 */
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
    // Aynı anda iki katılım olursa ilk istek odayı oluşturmuş olabilir, bu durumda mevcut odayı al.
    const racedRoom = await roomService.listRooms([roomName]);
    if (racedRoom.length > 0) return racedRoom[0];
    throw error;
  }
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
