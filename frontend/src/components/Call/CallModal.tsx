import {
  AudioConference,
  LiveKitRoom,
  VideoConference
} from '@livekit/components-react';
import '@livekit/components-styles';
import type { Conversation } from '../../types/chat';
import './CallModal.css';

export type CallType = 'audio' | 'video';

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

export default function CallModal({ call, title, onClose }: CallModalProps) {
  const isVideoCall = call.callType === 'video';

  return (
    <div className="call-overlay">
      <div className="call-shell">
        <div className="call-topbar">
          <div>
            <div className="call-kicker">{isVideoCall ? 'Görüntülü görüşme' : 'Sesli görüşme'}</div>
            <h2>{title}</h2>
          </div>
          <button className="call-close-button" onClick={onClose} title="Görüşmeden çık">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.3-6.29z" />
            </svg>
          </button>
        </div>

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
          className="call-room"
        >
          {isVideoCall ? <VideoConference /> : <AudioConference />}
        </LiveKitRoom>
      </div>
    </div>
  );
}
