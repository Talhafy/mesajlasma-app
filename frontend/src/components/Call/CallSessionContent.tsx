import { useEffect, useRef, useState } from 'react';
import { ConnectionState, Track, type Participant } from 'livekit-client';
import {
  MediaDeviceMenu, RoomAudioRenderer, StartAudio, TrackToggle, VideoTrack,
  useConnectionState, useIsSpeaking, useLocalParticipant, useParticipants, useTracks,
} from '@livekit/components-react';
import CallAvatar from './CallAvatar';
import CallIcon from './CallIcon';

interface Props {
  title: string;
  isVideoCall: boolean;
  avatarUrl?: string | null;
  localAvatarUrl?: string | null;
  e2eeLabel?: string | null;
  connectionError: string | null;
  onDeviceError: (error: Error) => void;
  onRetry: () => void;
  onClose: () => void;
}

function ParticipantRow({ participant, avatarUrl }: { participant: Participant; avatarUrl?: string | null }) {
  const speaking = useIsSpeaking(participant);
  const name = participant.name || 'Katılımcı';
  return (
    <li className={speaking ? 'is-speaking' : ''}>
      <CallAvatar name={name} src={avatarUrl} />
      <div><strong>{name}{participant.isLocal ? ' (Siz)' : ''}</strong><span>{speaking ? 'Konuşuyor' : 'Görüşmede'}</span></div>
      <CallIcon name={participant.isMicrophoneEnabled ? 'mic' : 'mic-off'} width="18" height="18" />
    </li>
  );
}

export default function CallSessionContent({ title, isVideoCall, avatarUrl, localAvatarUrl, e2eeLabel, connectionError, onDeviceError, onRetry, onClose }: Props) {
  const participants = useParticipants();
  const connectionState = useConnectionState();
  const { isCameraEnabled, isMicrophoneEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  const remoteParticipants = participants.filter((participant) => !participant.isLocal);
  const hasRemoteParticipant = remoteParticipants.length > 0;
  const cameraTracks = tracks.filter((track) => track.source === Track.Source.Camera && !track.publication.isMuted);
  const remoteCameras = cameraTracks.filter((track) => !track.participant.isLocal);
  const screenTrack = tracks.find((track) => track.source === Track.Source.ScreenShare && !track.publication.isMuted);
  const localCamera = cameraTracks.find((track) => track.participant.isLocal);
  const showVideo = !!screenTrack || remoteCameras.length > 0;
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  // Start the clock when the other person joins; camera changes and reconnects keep it running.
  useEffect(() => {
    if (hasRemoteParticipant && connectionState === ConnectionState.Connected && startedAt.current === null) startedAt.current = Date.now();
    if (startedAt.current === null) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt.current!) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [hasRemoteParticipant, connectionState]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const connected = connectionState === ConnectionState.Connected;
  const statusLabel = connectionState === ConnectionState.Connecting
    ? 'Bağlanılıyor…'
    : connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting
    ? 'Yeniden bağlanılıyor…'
    : connectionState === ConnectionState.Disconnected
    ? 'Bağlantı kesildi'
    : hasRemoteParticipant ? duration : startedAt.current ? 'Karşı taraf bekleniyor…' : 'Aranıyor…';
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch { /* The browser may decline fullscreen; the call continues in its current size. */ }
  };

  return (
    <section ref={shellRef} className={`call-session ${showVideo ? 'has-video' : ''}`} aria-label={`${title} ile görüşme`}>
      <RoomAudioRenderer />
      <StartAudio className="call-enable-audio" label="Görüşmenin sesini etkinleştir" />

      <header className="call-header">
        <div className="call-header-kind">
          <CallIcon name={isVideoCall || isCameraEnabled || showVideo ? 'camera' : 'phone'} width="18" height="18" />
          <span>{isVideoCall || isCameraEnabled || showVideo ? 'Görüntülü arama' : 'Sesli arama'}</span>
          {e2eeLabel && (
            <span
              style={{
                padding: '3px 9px',
                borderRadius: '999px',
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#a7f3d0',
                fontSize: '11px',
                fontWeight: 600,
                lineHeight: 1.2
              }}
              title="RFC 9420 MLS-Exporter ile türetilmiş uçtan uca medya şifreleme anahtarı aktif"
            >
              {e2eeLabel}
            </span>
          )}
        </div>
        {showVideo && <div className="call-header-person"><strong>{title}</strong><span>{statusLabel}</span></div>}
        <div className={`call-connection-badge ${connected && hasRemoteParticipant ? 'is-connected' : ''}`}><span />{connected && hasRemoteParticipant ? 'Bağlandı' : 'Görüşme'}</div>
      </header>

      <main className="call-main-stage">
        {showVideo ? (
          <div className={`call-video-grid ${screenTrack ? 'is-screen-share' : ''} ${!screenTrack && remoteParticipants.length > 1 ? 'is-group' : ''}`}>
            {screenTrack ? (
              <div className="call-video-tile"><VideoTrack trackRef={screenTrack} /><span className="call-tile-name"><CallIcon name="share" width="16" height="16" />{screenTrack.participant.isLocal ? 'Ekranınız paylaşılıyor' : `${screenTrack.participant.name || title} · Ekran paylaşımı`}</span></div>
            ) : remoteParticipants.map((participant) => {
              const camera = remoteCameras.find((track) => track.participant.identity === participant.identity);
              return <div className="call-video-tile" key={participant.identity}>
                {camera ? <VideoTrack trackRef={camera} /> : <CallAvatar name={participant.name || title} src={remoteParticipants.length === 1 ? avatarUrl : undefined} />}
                <span className="call-tile-name">{participant.name || title}{!participant.isMicrophoneEnabled && <CallIcon name="mic-off" width="15" height="15" />}</span>
              </div>;
            })}
          </div>
        ) : (
          <div className={`call-person ${!hasRemoteParticipant && connected ? 'is-ringing' : ''}`}>
            <div className="call-person-avatar"><CallAvatar name={title} src={avatarUrl} /></div>
            <h2>{title}</h2>
            <p className="call-person-status" aria-live={hasRemoteParticipant && connected ? 'off' : 'polite'} role={hasRemoteParticipant && connected ? 'timer' : 'status'}>{statusLabel}</p>
            {hasRemoteParticipant && connected && <span className="call-person-caption">Görüşme devam ediyor</span>}
          </div>
        )}

        {(isVideoCall || isCameraEnabled) && (
          <aside className="call-self-preview" aria-label="Kamera önizlemeniz">
            {localCamera ? <VideoTrack trackRef={localCamera} /> : <div className="call-self-placeholder"><CallAvatar name={localParticipant.name || 'Siz'} src={localAvatarUrl} /><span>Kamera kapalı</span></div>}
            <span className="call-tile-name">Siz{!isMicrophoneEnabled && <CallIcon name="mic-off" width="14" height="14" />}</span>
          </aside>
        )}
      </main>

      {connectionError && <div className="call-connection-error" role="alert"><p>{connectionError}</p><div><button onClick={onRetry}>Tekrar bağlan</button><button onClick={onClose}>Aramayı kapat</button></div></div>}

      {participantsOpen && <aside className="call-participants-panel" aria-label="Görüşmedeki kişiler">
        <div className="call-panel-heading"><h3>Katılımcılar <span>{participants.length}</span></h3><button aria-label="Katılımcıları kapat" onClick={() => setParticipantsOpen(false)}><CallIcon name="close" width="20" height="20" /></button></div>
        <ul>{participants.map((participant) => <ParticipantRow key={participant.identity} participant={participant} avatarUrl={participant.isLocal ? localAvatarUrl : remoteParticipants.length === 1 ? avatarUrl : undefined} />)}</ul>
        {!hasRemoteParticipant && <p>Diğer kişi katıldığında burada görünecek.</p>}
      </aside>}

      <footer className="call-toolbar" aria-label="Arama kontrolleri">
        <div className="call-toolbar-group call-device-controls">
          <div className={`call-device-pill ${!isCameraEnabled ? 'is-off' : ''}`}>
            <TrackToggle source={Track.Source.Camera} showIcon={false} onDeviceError={onDeviceError} disabled={!connected} className="call-control" title={isCameraEnabled ? 'Kamerayı kapat' : 'Kamerayı aç'} aria-label={isCameraEnabled ? 'Kamerayı kapat' : 'Kamerayı aç'}><CallIcon name={isCameraEnabled ? 'camera' : 'camera-off'} /></TrackToggle>
            <MediaDeviceMenu kind="videoinput" className="call-device-menu" disabled={!connected} title="Kamera seç" aria-label="Kamera seç"><CallIcon name="chevron" width="19" height="19" /></MediaDeviceMenu>
          </div>
          <div className={`call-device-pill ${!isMicrophoneEnabled ? 'is-off' : ''}`}>
            <TrackToggle source={Track.Source.Microphone} showIcon={false} onDeviceError={onDeviceError} disabled={!connected} className="call-control" title={isMicrophoneEnabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'} aria-label={isMicrophoneEnabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'}><CallIcon name={isMicrophoneEnabled ? 'mic' : 'mic-off'} /></TrackToggle>
            <MediaDeviceMenu kind="audioinput" className="call-device-menu" disabled={!connected} title="Mikrofon seç" aria-label="Mikrofon seç"><CallIcon name="chevron" width="19" height="19" /></MediaDeviceMenu>
          </div>
        </div>
        <div className="call-toolbar-group call-extra-controls">
          {typeof navigator.mediaDevices?.getDisplayMedia === 'function' && <TrackToggle source={Track.Source.ScreenShare} showIcon={false} onDeviceError={onDeviceError} disabled={!connected} className={`call-control call-utility ${isScreenShareEnabled ? 'is-active' : ''}`} title={isScreenShareEnabled ? 'Paylaşımı durdur' : 'Ekranı paylaş'} aria-label={isScreenShareEnabled ? 'Paylaşımı durdur' : 'Ekranı paylaş'}><CallIcon name="share" /></TrackToggle>}
          <button className={`call-control call-utility ${participantsOpen ? 'is-active' : ''}`} title="Katılımcılar" aria-label="Katılımcılar" aria-expanded={participantsOpen} onClick={() => setParticipantsOpen((open) => !open)}><CallIcon name="users" /></button>
        </div>
        <div className="call-toolbar-group call-end-controls">
          {document.fullscreenEnabled && <button className="call-control call-utility call-fullscreen" title={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} aria-label={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleFullscreen}><CallIcon name={fullscreen ? 'collapse' : 'expand'} /></button>}
          <button className="call-control call-hangup" title="Aramayı kapat" aria-label="Aramayı kapat" onClick={onClose}><CallIcon name="hangup" width="30" height="30" /></button>
        </div>
      </footer>
    </section>
  );
}
