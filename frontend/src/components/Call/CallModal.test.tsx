import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState, DisconnectReason, Track } from 'livekit-client';
import { LiveKitRoom } from '@livekit/components-react';
import CallModal, { type ActiveCall } from './CallModal';

const mocks = vi.hoisted(() => ({
  room: vi.fn(), encryptionSupported: vi.fn(), setE2EEEnabled: vi.fn(),
  connectionState: vi.fn(), participants: vi.fn(), tracks: vi.fn(),
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
  VideoTrack: ({ trackRef }: { trackRef: { participant: { identity: string } } }) => <video data-testid={trackRef.participant.identity} />,
  TrackToggle: ({ children, title, disabled }: { children: React.ReactNode; title: string; disabled: boolean }) => <button title={title} disabled={disabled}>{children}</button>,
  MediaDeviceMenu: ({ children, title }: { children: React.ReactNode; title: string }) => <button title={title}>{children}</button>,
  StartAudio: () => null,
  useParticipants: mocks.participants,
  useTracks: mocks.tracks,
  useMaybeRoomContext: () => undefined,
  useLocalParticipant: () => ({ isCameraEnabled: false, isMicrophoneEnabled: true, isScreenShareEnabled: false, localParticipant: { name: 'Siz' } }),
  useConnectionState: mocks.connectionState,
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
  mocks.connectionState.mockReturnValue(ConnectionState.Connecting);
  mocks.participants.mockReturnValue([]);
  mocks.tracks.mockReturnValue([]);
  vi.stubGlobal('Worker', class extends EventTarget { terminate() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('lets the caller resize their preview before answering and swap views after the other camera joins', async () => {
  const mine = { identity: 'local-camera', isLocal: true };
  const other = { identity: 'remote-camera', name: 'Test', isLocal: false, isMicrophoneEnabled: true };
  const localTrack = { participant: mine, source: Track.Source.Camera, publication: { isMuted: false } };
  const remoteTrack = { participant: other, source: Track.Source.Camera, publication: { isMuted: false } };
  const videoCall: ActiveCall = { ...call, callType: 'video' };
  const onClose = vi.fn();
  mocks.connectionState.mockReturnValue(ConnectionState.Connected);
  mocks.participants.mockReturnValue([mine]);
  mocks.tracks.mockReturnValue([localTrack]);
  const { rerender } = render(<CallModal call={videoCall} title="Test" onClose={onClose} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Kendi görüntünü büyüt' }));
  expect(screen.getByRole('main')).toHaveClass('is-self-expanded');
  expect(screen.getByRole('status')).toHaveTextContent('Aranıyor');
  fireEvent.click(screen.getByRole('button', { name: 'Kendi görüntünü küçült' }));
  expect(screen.getByRole('main')).not.toHaveClass('is-self-expanded');
  fireEvent.click(screen.getByRole('button', { name: 'Kendi görüntünü büyüt' }));

  mocks.participants.mockReturnValue([mine, other]);
  mocks.tracks.mockReturnValue([localTrack, remoteTrack]);
  rerender(<CallModal call={videoCall} title="Test" onClose={onClose} />);
  const localVideo = screen.getByTestId(mine.identity);
  const remoteVideo = screen.getByTestId(other.identity);
  expect(screen.getByRole('main')).toHaveClass('is-self-expanded');

  fireEvent.click(screen.getByRole('button', { name: 'Kendi görüntünü küçült' }));
  expect(screen.getByRole('main')).not.toHaveClass('is-self-expanded');
  expect(screen.getByTestId(mine.identity)).toBe(localVideo);
  expect(screen.getByTestId(other.identity)).toBe(remoteVideo);
  expect(roomProps().video).toBe(true);
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
