import type { CallType } from './CallModal';
import './IncomingCallPrompt.css';

export interface IncomingCall {
  conversationId: string;
  callId: string;
  callType: CallType;
  isGroup?: boolean;
  conversationName?: string | null;
  caller: {
    id: string;
    username: string;
  };
}

interface IncomingCallPromptProps {
  call: IncomingCall;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallPrompt({ call, onAccept, onDecline }: IncomingCallPromptProps) {
  const title = call.isGroup && call.conversationName
    ? call.conversationName
    : call.caller.username;
  const isVideo = call.callType === 'video';

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-card">
        <div className="incoming-call-top-icons">
          <span>{isVideo ? '▦' : '◖'}</span>
          <span>{isVideo ? '◼' : '◗'}</span>
        </div>

        <div className="incoming-call-avatar">{title[0]?.toUpperCase()}</div>

        <div className="incoming-call-copy">
          <h2>{title}</h2>
          <p>{isVideo ? 'gelen görüntülü arama' : 'gelen sesli arama'}</p>
        </div>

        <div className="incoming-call-actions">
          <div className="incoming-call-action">
            <button className="incoming-call-button decline" onClick={onDecline} title="Reddet">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z" />
              </svg>
            </button>
            <span>Reddet</span>
          </div>

          <div className="incoming-call-action">
            <button className="incoming-call-button accept" onClick={onAccept} title="Kabul et">
              {isVideo ? (
                <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true">
                  <path d="M17 10.5V6c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-4.5l4 4v-11z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                  <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z" />
                </svg>
              )}
            </button>
            <span>Kabul Et</span>
          </div>
        </div>
      </div>
    </div>
  );
}
