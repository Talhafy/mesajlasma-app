import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisconnectReason } from 'livekit-client';
import { LiveKitRoom } from '@livekit/components-react';
import CallModal, { type ActiveCall } from './CallModal';

const mocks = vi.hoisted(() => ({
  room: vi.fn(), encryptionSupported: vi.fn(), setE2EEEnabled: vi.fn(),
}));
vi.mock('livekit-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('livekit-client')>(),
  isE2EESupported: mocks.encryptionSupported,
  ExternalE2EEKeyProvider: class { async setKey() {} },
  Room: class {
    setE2EEEnabled = mocks.setE2EEEnabled;
    async disconnect() {}
  },
}));
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: (props: { children: React.ReactNode }) => { mocks.room(props); return props.children; },
  RoomAudioRenderer: () => null,
  VideoConference: () => null,
  VideoTrack: () => null,
  TrackToggle: ({ children, title, disabled }: { children: React.ReactNode; title: string; disabled: boolean }) => <button title={title} disabled={disabled}>{children}</button>,
  MediaDeviceMenu: ({ children, title }: { children: React.ReactNode; title: string }) => <button title={title}>{children}</button>,
  StartAudio: () => null,
  useParticipants: () => [],
  useTracks: () => [],
  useMaybeRoomContext: () => undefined,
  useLocalParticipant: () => ({ isCameraEnabled: false, isMicrophoneEnabled: true, isScreenShareEnabled: false, localParticipant: { name: 'Siz' } }),
  useConnectionState: () => 'connecting',
}));

const call: ActiveCall = {
  conversationId: 'conversation-1', callId: 'call-1', callType: 'audio',
  serverUrl: 'ws://localhost:7880', token: 'test-token', roomName: 'test-room',
  mlsEpoch: 1, e2eeKeyBase64: btoa('01234567890123456789012345678901'),
};
const roomProps = () => mocks.room.mock.lastCall![0] as ComponentProps<typeof LiveKitRoom>;
beforeEach(() => {
  mocks.room.mockClear();
  mocks.setE2EEEnabled.mockReset().mockResolvedValue(undefined);
  mocks.encryptionSupported.mockReturnValue(true);
  vi.stubGlobal('Worker', class extends EventTarget { terminate() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CallModal connection failures', () => {
  it('keeps unexpected disconnects visible without ending the call', async () => {
    const onClose = vi.fn();
    render(<CallModal call={call} title="Test" onClose={onClose} />);
    await waitFor(() => expect(mocks.room).toHaveBeenCalled());
    act(() => roomProps().onDisconnected?.(DisconnectReason.SIGNAL_CLOSE));
    expect(screen.getByRole('alert')).toHaveTextContent('Görüşme bağlantısı kesildi');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar bağlan' }));
    await waitFor(() => expect(mocks.setE2EEEnabled).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains duplicate sessions and allows explicit hangup', async () => {
    const onClose = vi.fn();
    render(<CallModal call={call} title="Test" onClose={onClose} />);
    await waitFor(() => expect(mocks.room).toHaveBeenCalled());
    act(() => roomProps().onDisconnected?.(DisconnectReason.DUPLICATE_IDENTITY));
    expect(screen.getByRole('alert')).toHaveTextContent('aynı hesapla');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Aramayı kapat' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows media permission errors and keeps connection callbacks stable on rerender', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(<CallModal call={call} title="Test" onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.room).toHaveBeenCalled());
    const initialProps = roomProps();
    act(() => initialProps.onError?.(new DOMException('Denied', 'NotAllowedError')));
    expect(screen.getByRole('alert')).toHaveTextContent('Mikrofon veya kamera izni verilmedi');
    const nextClose = vi.fn();
    rerender(<CallModal call={call} title="Updated" onClose={nextClose} />);
    expect(roomProps().onError).toBe(initialProps.onError);
    expect(roomProps().onDisconnected).toBe(initialProps.onDisconnected);
    act(() => roomProps().onDisconnected?.(DisconnectReason.CLIENT_INITIATED));
    expect(nextClose).toHaveBeenCalledOnce();
  });

  it('does not connect or publish until room encryption is enabled', async () => {
    let enableEncryption!: () => void;
    mocks.setE2EEEnabled.mockReturnValueOnce(new Promise<void>((resolve) => { enableEncryption = resolve; }));
    render(<CallModal call={call} title="Test" onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.setE2EEEnabled).toHaveBeenCalledWith(true));
    expect(mocks.room).not.toHaveBeenCalled();
    await act(async () => enableEncryption());
    expect(roomProps().connect).toBe(true);
  });

  it('shows an error instead of starting an unencrypted call', async () => {
    mocks.encryptionSupported.mockReturnValue(false);
    render(<CallModal call={call} title="Test" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('uçtan uca şifreli görüşme başlatılamıyor');
    expect(mocks.room).not.toHaveBeenCalled();
  });
});
