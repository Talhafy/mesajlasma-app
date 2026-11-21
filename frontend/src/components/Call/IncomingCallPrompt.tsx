import type { CallType } from './CallModal';
import CallAvatar from './CallAvatar';
import CallIcon from './CallIcon';
import './CallModal.css';
import './IncomingCallPrompt.css';

export interface IncomingCall {
  conversationId: string;
  callId: string;
  callType: CallType;
  mlsEpoch: number;
  isGroup?: boolean;
  conversationName?: string | null;
  caller: { id: string; username: string };
}
interface IncomingCallPromptProps {
  call: IncomingCall;
  avatarUrl?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallPrompt({ call, avatarUrl, onAccept, onDecline }: IncomingCallPromptProps) {
  const title = call.isGroup && call.conversationName ? call.conversationName : call.caller.username;
  const isVideo = call.callType === 'video';
  return (
    <div className="incoming-call-overlay" role="dialog" aria-modal="true" aria-label={title + ' arıyor'}>
      <header className="call-header">
        <div className="call-header-kind"><CallIcon name={isVideo ? 'camera' : 'phone'} width="18" height="18" /><span>Gelen {isVideo ? 'görüntülü' : 'sesli'} arama</span></div>
      </header>
      <div className="call-person is-ringing">
        <div className="call-person-avatar"><CallAvatar name={title} src={avatarUrl} /></div>
        <h2>{title}</h2>
        <p className="call-person-status">{call.isGroup ? call.caller.username + ' sizi grup görüşmesine davet ediyor' : 'Sizi arıyor…'}</p>
      </div>
      <div className="incoming-call-actions">
        <div className="incoming-call-action"><button className="incoming-call-button decline" onClick={onDecline} aria-label="Reddet"><CallIcon name="hangup" width="30" height="30" /></button><span>Reddet</span></div>
        <div className="incoming-call-action"><button className="incoming-call-button accept" onClick={onAccept} aria-label="Kabul et" autoFocus><CallIcon name={isVideo ? 'camera' : 'phone'} width="28" height="28" /></button><span>Kabul et</span></div>
      </div>
    </div>
  );
}
