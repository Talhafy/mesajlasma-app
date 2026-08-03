/**
 * ============================================================================
 * LIVEKIT WEBRTC SESLİ VE GÖRÜNTÜLÜ ARAMA MODALI (CallModal Component)
 * ============================================================================
 * 
 * Bu bileşen, LiveKit WebRTC altyapısını kullanarak kullanıcılar arasında birebir
 * veya grup halinde gerçek zamanlı sesli ve görüntülü görüşme yapmayı sağlar.
 * 
 * TEKNİK YAPILANDIRMA:
 * 1. LiveKitRoom          -> WebRTC soket bağlantısını ve medya akışlarını (Audio/Video Tracks) başlatır.
 * 2. RoomAudioRenderer    -> Karşı tarafın ses akışını (Remote Audio Track) otomatik hoparlöre yönlendirir.
 * 3. VideoConference      -> Katılımcıların kamera görüntülerini ızgara (grid) şeklinde ekrana yerleştirir.
 * 4. useParticipants      -> Odadaki katılımcıları ve bağlantı durumunu anlık takip eder.
 */

import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
  useParticipants
} from '@livekit/components-react';
import '@livekit/components-styles';
import type { Conversation } from '../../types/chat';
import './CallModal.css';

export type CallType = 'audio' | 'video';

/** Aktif Arama Detay Arayüzü */
export interface ActiveCall {
  conversationId: string;
  callId: string;
  callType: CallType;
  serverUrl: string;
  token: string;
  roomName: string;
  conversation?: Pick<Conversation, 'id' | 'isGroup' | 'name'>;
}

interface CallModalProps {
  call: ActiveCall;
  title: string;
  onClose: () => void;
}

interface CallSessionContentProps {
  title: string;
  isVideoCall: boolean;
  onClose: () => void;
}

/**
 * ARAMA İÇERİK VE KONTROL EKRANI (Call Session Content)
 * Katılımcı durumuna göre bekliyor veya görüşme devam ediyor arayüzü sunar.
 */
function CallSessionContent({ title, isVideoCall, onClose }: CallSessionContentProps) {
  const participants = useParticipants();
  // Kendimiz dışındaki uzak katılımcı var mı kontrolü
  const hasRemoteParticipant = participants.some((participant) => !participant.isLocal);
  const avatarLetter = title?.[0]?.toUpperCase() || '?';
  const isWaitingVideoCall = isVideoCall && !hasRemoteParticipant;

  const statusLabel = hasRemoteParticipant
    ? (isVideoCall ? 'görüntülü görüşme devam ediyor' : 'sesli görüşme devam ediyor')
    : (isVideoCall ? 'giden görüntülü arama' : 'giden sesli arama');

  return (
    <div className={`call-session-shell ${isWaitingVideoCall ? 'waiting-video' : ''}`}>
      {/* Sesli aramada veya henüz görüntülü arama açılmadığında ses işleyicisi */}
      {(!isVideoCall || !hasRemoteParticipant) && <RoomAudioRenderer />}

      {/* Görüntülü Arama Bağlandıysa Video Grid Göster */}
      {isVideoCall && hasRemoteParticipant ? (
        <div className="call-video-shell">
          <div className="call-video-stage">
            <VideoConference />
          </div>

          <div className="call-video-overlay">
            <div className="call-video-header">
              <div className="call-video-partner">
                <div className="call-avatar tiny">{avatarLetter}</div>
                <div className="call-video-copy">
                  <h2>{title}</h2>
                  <p>{statusLabel}</p>
                </div>
              </div>
            </div>

            <div className="call-actions single">
              <div className="call-action">
                <button className="call-action-button decline" onClick={onClose} title="Aramayı kapat">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z" />
                  </svg>
                </button>
                <span>Aramayı Kapat</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Sesli Arama veya Karşı Taraf Bekleniyor Ekranı */
        <div className="call-prompt-card">
          <div className="call-top-icons">
            <span>{isVideoCall ? '◖' : '◐'}</span>
            <span>{isVideoCall ? '◗' : '◑'}</span>
          </div>

          <div className="call-avatar">{avatarLetter}</div>

          <div className="call-copy">
            <h2>{title}</h2>
            <p>{statusLabel}</p>
          </div>

          <div className="call-actions single">
            <div className="call-action">
              <button className="call-action-button decline" onClick={onClose} title="Aramayı kapat">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                  <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z" />
                </svg>
              </button>
              <span>Aramayı Kapat</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * LIVEKIT ROOM SARMALAYICI BİLEŞENİ (Main Call Modal Entry)
 */
export default function CallModal({ call, title, onClose }: CallModalProps) {
  const isVideoCall = call.callType === 'video';

  return (
    <div className="call-overlay">
      <LiveKitRoom
        serverUrl={call.serverUrl}
        token={call.token}
        connect
        audio
        video={isVideoCall}
        onDisconnected={onClose}
        onError={(error) => {
          console.error('LiveKit bağlantı hatası:', error);
        }}
        className={`call-room ${isVideoCall ? 'video-mode' : 'audio-mode'}`}
      >
        <CallSessionContent title={title} isVideoCall={isVideoCall} onClose={onClose} />
      </LiveKitRoom>
    </div>
  );
}
