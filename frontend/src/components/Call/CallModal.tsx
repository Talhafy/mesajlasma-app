import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionError, ConnectionErrorReason, DisconnectReason, ExternalE2EEKeyProvider, isE2EESupported, Room } from 'livekit-client';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import type { Conversation } from '../../types/chat';
import { base64ToBytes } from '../../crypto/vault';
import CallSessionContent from './CallSessionContent';
import './CallModal.css';

export type CallType = 'audio' | 'video';
export interface ActiveCall {
  conversationId: string;
  callId: string;
  callType: CallType;
  serverUrl: string;
  token: string;
  roomName: string;
  e2eeKeyBase64: string;
  mlsEpoch: number;
  conversation?: Pick<Conversation, 'id' | 'isGroup' | 'name'>;
}
interface CallModalProps {
  call: ActiveCall;
  title: string;
  avatarUrl?: string | null;
  localAvatarUrl?: string | null;
  onClose: () => void;
}

export default function CallModal({ call, title, avatarUrl, localAvatarUrl, onClose }: CallModalProps) {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') || []).filter((item) => item.getClientRects().length > 0 && getComputedStyle(item).visibility !== 'hidden');
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => { document.removeEventListener('keydown', keepFocusInside); previousFocus?.focus(); };
  }, []);

  // Stable callbacks prevent parent updates from retriggering LiveKit's connection effect.
  const handleError = useCallback((error: Error) => {
    const rawMsg = (error?.message || '').toLowerCase();
    // React StrictMode çift-mount sırasında iptal edilen ilk bağlantıyı hata olarak gösterme
    if (rawMsg.includes('client initiated disconnect') || error.name === 'AbortError' ||
        (error instanceof ConnectionError && error.reason === ConnectionErrorReason.Cancelled)) {
      return;
    }
    const message = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
      ? 'Mikrofon veya kamera izni verilmedi. Tarayıcı izinlerini kontrol edip tekrar deneyin.'
      : error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError'
      ? 'Mikrofon veya kamera bulunamadı. Cihazınızı bağlayıp tekrar deneyin.'
      : error.name === 'NotReadableError'
      ? 'Mikrofon veya kamera kullanılamıyor. Başka bir uygulamanın cihazı kullanıp kullanmadığını kontrol edin.'
      : error instanceof ConnectionError && error.reason === ConnectionErrorReason.NotAllowed
      ? 'Görüşme erişimi reddedildi. Aramayı kapatıp yeniden başlatın.'
      : 'Görüşme sunucusuna bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.';
    setConnectionError(message);
    console.error('LiveKit bağlantı hatası:', { name: error.name });
  }, []);
  const handleDisconnected = useCallback((reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) { onCloseRef.current(); return; }
    setConnectionError(reason === DisconnectReason.DUPLICATE_IDENTITY
      ? 'Bu görüşme aynı hesapla başka bir sekmede veya tarayıcıda açıldı.'
      : 'Görüşme bağlantısı kesildi. Tekrar bağlanmayı deneyebilirsiniz.');
  }, []);
  const handleConnected = useCallback(() => setConnectionError(null), []);
  const handleEncryptionError = useCallback(() => {
    setConnectionError('Görüşme medyasının şifresi çözülemedi. Aramayı kapatıp yeniden başlatın.');
  }, []);

  const [preparedRoom, setPreparedRoom] = useState<{ attempt: number; room: Room } | null>(null);

  // React StrictMode uyumlu E2EE Worker yaşam döngüsü:
  // Worker'ı useMemo yerine useEffect içinde oluşturup aynı cleanup'ta sonlandırıyoruz.
  useEffect(() => {
    if (!call.e2eeKeyBase64 || typeof Worker === 'undefined' || !isE2EESupported()) {
      setConnectionError('Bu tarayıcıda uçtan uca şifreli görüşme başlatılamıyor.');
      return;
    }

    let cancelled = false;
    let failed = false;
    let worker: Worker | null = null;

    let room: Room | null = null;
    let mounted = false;
    const initE2ee = async () => {
      try {
        const keyProvider = new ExternalE2EEKeyProvider();
        const keyBytes = base64ToBytes(call.e2eeKeyBase64);
        try { await keyProvider.setKey(keyBytes.buffer as ArrayBuffer); }
        finally { keyBytes.fill(0); }

        if (cancelled) return;

        worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), {
          type: 'module',
          name: `livekit-e2ee-${attempt}`
        });

        worker.addEventListener('error', () => {
          if (cancelled) return;
          failed = true;
          setPreparedRoom(null);
          setConnectionError('Görüşme şifrelemesi başlatılamadı. Tekrar deneyin.');
        });
        room = new Room({ encryption: { keyProvider, worker } });
        await room.setE2EEEnabled(true);
        if (!cancelled && !failed) {
          mounted = true;
          setPreparedRoom({ attempt, room });
        }
      } catch {
        if (!cancelled) {
          setConnectionError('Görüşme şifrelemesi başlatılamadı. Tekrar deneyin.');
        }
      }
    };

    void initE2ee();

    return () => {
      cancelled = true;
      if (!mounted) void room?.disconnect();
      worker?.terminate();
    };
  }, [call.e2eeKeyBase64, attempt]);

  const room = preparedRoom?.attempt === attempt ? preparedRoom.room : undefined;
  const retry = () => { setConnectionError(null); setAttempt((value) => value + 1); };

  return (
    <div ref={dialogRef} className="call-overlay" role="dialog" aria-modal="true" aria-label={title + ' ile arama'} tabIndex={-1}>
      {room ? (
        <LiveKitRoom
          key={call.callId + ':' + attempt}
          serverUrl={call.serverUrl}
          token={call.token}
          room={room}
          connect audio video={call.callType === 'video'}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          onError={handleError}
          onEncryptionError={handleEncryptionError}
          className="call-room"
        >
          <CallSessionContent
            title={title}
            isVideoCall={call.callType === 'video'}
            avatarUrl={avatarUrl}
            localAvatarUrl={localAvatarUrl}
            e2eeLabel={`MLS E2EE • Epoch #${call.mlsEpoch}`}
            onClose={onClose}
            connectionError={connectionError}
            onDeviceError={handleError}
            onRetry={retry}
          />
        </LiveKitRoom>
      ) : <div className="call-session">
        {connectionError ? (
          <div className="call-connection-error" role="alert">
            <p>{connectionError}</p>
            <div><button onClick={retry}>Tekrar bağlan</button><button onClick={onClose}>Aramayı kapat</button></div>
          </div>
        ) : <p role="status">Şifreli görüşme hazırlanıyor…</p>}
      </div>}
    </div>
  );
}
