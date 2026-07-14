import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useRoomContext
} from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { Socket } from 'socket.io-client';
import { api } from '../../api/httpClient';
import type { Conversation, GameChannel, GameChannelType, Message, User } from '../../types/chat';
import '@livekit/components-styles';
import './GameHub.css';

type SelectedChannel = GameChannel | {
  id: 'general';
  conversationId: string;
  createdById: string;
  name: 'genel';
  type: 'TEXT';
  position: -1;
  createdAt: string;
};

interface VoiceConnection {
  serverUrl: string;
  token: string;
  roomName: string;
  channel: GameChannel;
}

interface VoicePresence {
  conversationId: string;
  channelId: string;
  userId: string;
  username: string;
  isSpeaking: boolean;
}

interface GameHubProps {
  currentUser: User;
  groups: Conversation[];
  users: User[];
  socket: Socket | null;
  onExit: () => void;
}

const Icon = ({ name }: { name: 'hash' | 'voice' | 'plus' | 'trash' | 'users' | 'game' }) => {
  const paths = {
    hash: <path d="M10 3 8.5 21M16 3l-1.5 18M4 9h16M3 15h16" />,
    voice: <path d="M5 9v6h4l5 4V5L9 9H5Zm12.5-.5a5 5 0 0 1 0 7M19.5 6a9 9 0 0 1 0 12" />,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />,
    users: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
    game: <path d="M8.5 8h7a5 5 0 0 1 4.7 3.3l1.3 3.7a3 3 0 0 1-5.1 3l-1.5-1.8H9.1L7.6 18a3 3 0 0 1-5.1-3l1.3-3.7A5 5 0 0 1 8.5 8ZM7 11v4m-2-2h4m8-1h.01M19 14h.01" />
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

function Avatar({ user, size = 38, speaking = false }: { user?: Pick<User, 'username' | 'avatarUrl'>; size?: number; speaking?: boolean }) {
  return (
    <div className={`game-avatar ${speaking ? 'speaking' : ''}`} style={{ width: size, height: size }}>
      {user?.avatarUrl
        ? <img src={user.avatarUrl} alt="" />
        : <span>{user?.username?.[0]?.toUpperCase() || '?'}</span>}
    </div>
  );
}

function VoiceChannelConnection({
  controlsTarget,
  onLeave,
  channelId,
  currentUserId,
  socket
}: {
  controlsTarget: HTMLDivElement | null;
  onLeave: () => void;
  channelId: string;
  currentUserId: string;
  socket: Socket | null;
}) {
  const room = useRoomContext();
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const updateSpeaking = (speakers: Array<{ identity: string }>) => setIsSpeaking(speakers.some((speaker) => speaker.identity === currentUserId));
    updateSpeaking(room.activeSpeakers);
    room.on(RoomEvent.ActiveSpeakersChanged, updateSpeaking);
    return () => { room.off(RoomEvent.ActiveSpeakersChanged, updateSpeaking); };
  }, [room, currentUserId]);

  useEffect(() => {
    socket?.emit('game:voice-speaking', { channelId, isSpeaking });
  }, [socket, channelId, isSpeaking]);
  const controls = controlsTarget && createPortal(
    <div className="voice-dock-controls"><ControlBar controls={{ microphone: true, camera: false, screenShare: true, chat: false }} variation="minimal" /><button onClick={onLeave}>Ayrıl</button></div>,
    controlsTarget
  );

  return <><RoomAudioRenderer /><StartAudio label="Sesi etkinleştir" />{controls}</>;
}

export default function GameHub({ currentUser, groups, users, socket, onExit }: GameHubProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groups[0]?.id || null);
  const [channels, setChannels] = useState<GameChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<SelectedChannel | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [typingUsername, setTypingUsername] = useState('');
  const [voiceConnection, setVoiceConnection] = useState<VoiceConnection | null>(null);
  const [voicePresences, setVoicePresences] = useState<VoicePresence[]>([]);
  const [voiceControlsTarget, setVoiceControlsTarget] = useState<HTMLDivElement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [channelType, setChannelType] = useState<GameChannelType>('VOICE');
  const [channelName, setChannelName] = useState('');
  const [channelLimit, setChannelLimit] = useState(8);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const isAdmin = selectedGroup?.adminId === currentUser.id;
  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');

  const exitGameMode = () => {
    if (voiceConnection) {
      socket?.emit('game:voice-presence', { action: 'leave', channelId: voiceConnection.channel.id });
      setVoiceConnection(null);
      setVoicePresences((previous) => previous.filter((presence) => presence.userId !== currentUser.id));
    }
    onExit();
  };

  const selectGroup = (groupId: string) => {
    if (groupId === selectedGroupId) return;
    setChannels([]);
    setMembers([]);
    setMessages([]);
    setSelectedChannel(null);
    setVoicePresences([]);
    setTypingUsername('');
    setMessageText('');
    setSelectedFile(null);
    setError('');
    setSelectedGroupId(groupId);
  };

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    if (!groups.some((group) => group.id === selectedGroupId)) setSelectedGroupId(groups[0].id);
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) return;
    let cancelled = false;
    setChannels([]);
    setMembers([]);
    setMessages([]);
    setSelectedChannel(null);
    setVoicePresences([]);
    setTypingUsername('');
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/game/groups/${selectedGroupId}/channels`),
      api.get(`/conversations/group/${selectedGroupId}/participants`)
    ]).then(([channelResponse, memberResponse]) => {
      if (cancelled) return;
      setChannels(channelResponse.data.channels.filter((channel: GameChannel) => channel.conversationId === selectedGroupId));
      setMembers(memberResponse.data);
      setSelectedChannel({
        id: 'general', conversationId: selectedGroupId, createdById: '', name: 'genel',
        type: 'TEXT', position: -1, createdAt: new Date(0).toISOString()
      });
    }).catch(() => {
      if (!cancelled) setError('Oyun alanı yüklenemedi.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedGroupId]);

  useEffect(() => {
    setMembers((previous) => previous.map((member) => {
      if (member.id === currentUser.id) return { ...member, ...currentUser, isOnline: true };
      const liveUser = users.find((user) => user.id === member.id);
      return liveUser ? { ...member, ...liveUser } : member;
    }));
  }, [users, currentUser]);

  useEffect(() => {
    if (!socket || !selectedGroupId) return;
    const snapshot = ({ groupId, presences }: { groupId: string; presences: VoicePresence[] }) => {
      if (groupId === selectedGroupId) setVoicePresences(presences);
    };
    const joined = (presence: VoicePresence) => {
      if (presence.conversationId !== selectedGroupId) return;
      setVoicePresences((previous) => previous.some((item) => item.channelId === presence.channelId && item.userId === presence.userId) ? previous : [...previous, presence]);
    };
    const speaking = ({ conversationId, channelId, userId, isSpeaking }: Pick<VoicePresence, 'conversationId' | 'channelId' | 'userId' | 'isSpeaking'>) => {
      if (conversationId !== selectedGroupId) return;
      setVoicePresences((previous) => previous.map((presence) => presence.channelId === channelId && presence.userId === userId ? { ...presence, isSpeaking } : presence));
    };
    const left = ({ conversationId, channelId, userId }: Pick<VoicePresence, 'conversationId' | 'channelId' | 'userId'>) => {
      if (conversationId !== selectedGroupId) return;
      setVoicePresences((previous) => previous.filter((item) => item.channelId !== channelId || item.userId !== userId));
    };
    socket.on('game:voice-presence-snapshot', snapshot);
    socket.on('game:voice-presence-joined', joined);
    socket.on('game:voice-presence-left', left);
    socket.on('game:voice-speaking', speaking);
    socket.emit('game:voice-presence-snapshot', selectedGroupId);
    return () => {
      socket.off('game:voice-presence-snapshot', snapshot);
      socket.off('game:voice-presence-joined', joined);
      socket.off('game:voice-presence-left', left);
      socket.off('game:voice-speaking', speaking);
    };
  }, [socket, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId || !selectedChannel || selectedChannel.type !== 'TEXT' || selectedChannel.conversationId !== selectedGroupId) return;
    let cancelled = false;
    const url = selectedChannel.id === 'general'
      ? `/conversations/${selectedGroupId}/messages`
      : `/game/groups/${selectedGroupId}/channels/${selectedChannel.id}/messages`;
    setLoading(true);
    api.get(url).then((response) => {
      if (!cancelled) setMessages(response.data);
    }).catch(() => {
      if (!cancelled) setError('Mesajlar yüklenemedi.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedGroupId, selectedChannel]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!selectedGroupId || !selectedChannel || selectedChannel.type !== 'TEXT' || messages.length === 0) return;
    if (!messages.some((message) => message.senderId !== currentUser.id && !message.readByIds?.includes(currentUser.id))) return;
    const lastReadMessageId = messages[messages.length - 1]?.id;
    const endpoint = selectedChannel.id === 'general'
      ? `/conversations/${selectedGroupId}/read`
      : `/game/groups/${selectedGroupId}/channels/${selectedChannel.id}/read`;
    void api.post(endpoint, selectedChannel.id === 'general' ? { emitReceipt: true, lastReadMessageId } : { lastReadMessageId }).catch(() => undefined);
  }, [messages, selectedChannel, selectedGroupId, currentUser.id]);

  useEffect(() => {
    if (!socket) return;
    const receiveGameMessage = (message: Message) => {
      if (message.conversationId !== selectedGroupId || message.gameChannelId !== selectedChannel?.id) return;
      setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
    };
    const receiveGeneralMessage = (message: Message) => {
      if (message.conversationId !== selectedGroupId || selectedChannel?.id !== 'general' || message.gameChannelId) return;
      setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
    };
    const receiveTyping = ({ conversationId, gameChannelId, username, isTyping }: { conversationId: string; gameChannelId?: string | null; username: string; isTyping: boolean }) => {
      const currentChannelId = selectedChannel?.id === 'general' ? null : selectedChannel?.id;
      if (conversationId !== selectedGroupId || gameChannelId !== currentChannelId || username === currentUser.username) return;
      setTypingUsername(isTyping ? username : '');
    };
    const receiveReadReceipt = ({ conversationId, gameChannelId, readByUserId }: { conversationId: string; gameChannelId?: string | null; readByUserId: string }) => {
      const currentChannelId = selectedChannel?.id === 'general' ? null : selectedChannel?.id;
      if (conversationId !== selectedGroupId || (gameChannelId || null) !== currentChannelId) return;
      setMessages((previous) => {
        let changed = false;
        const next = previous.map((message) => {
          if (message.senderId === readByUserId || message.readByIds?.includes(readByUserId)) return message;
          changed = true;
          return { ...message, readByIds: [...(message.readByIds || []), readByUserId] };
        });
        return changed ? next : previous;
      });
    };
    const channelCreated = (channel: GameChannel) => {
      if (channel.conversationId !== selectedGroupId) return;
      setChannels((previous) => previous.some((item) => item.id === channel.id) ? previous : [...previous, channel]);
    };
    const channelDeleted = ({ channelId, groupId }: { channelId: string; groupId: string }) => {
      if (groupId !== selectedGroupId) return;
      setChannels((previous) => previous.filter((item) => item.id !== channelId));
      if (selectedChannel?.id === channelId) {
        setSelectedChannel({ id: 'general', conversationId: groupId, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() });
      }
    };
    socket.on('game:message', receiveGameMessage);
    socket.on('yeni_mesaj_geldi', receiveGeneralMessage);
    socket.on('game:channel-created', channelCreated);
    socket.on('game:channel-deleted', channelDeleted);
    socket.on('typing_changed', receiveTyping);
    socket.on('mesajlar_okundu', receiveReadReceipt);
    return () => {
      socket.off('game:message', receiveGameMessage);
      socket.off('yeni_mesaj_geldi', receiveGeneralMessage);
      socket.off('game:channel-created', channelCreated);
      socket.off('game:channel-deleted', channelDeleted);
      socket.off('typing_changed', receiveTyping);
      socket.off('mesajlar_okundu', receiveReadReceipt);
    };
  }, [socket, selectedGroupId, selectedChannel?.id, currentUser.username]);

  const createChannel = async () => {
    if (!selectedGroupId || !channelName.trim()) return;
    setError('');
    try {
      const response = await api.post(`/game/groups/${selectedGroupId}/channels`, {
        name: channelName,
        type: channelType,
        maxParticipants: channelType === 'VOICE' ? channelLimit : null
      });
      setChannels((previous) => previous.some((item) => item.id === response.data.id) ? previous : [...previous, response.data]);
      setChannelName('');
      setIsCreating(false);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Kanal oluşturulamadı.');
    }
  };

  const deleteChannel = async (channel: GameChannel) => {
    if (!selectedGroupId || !window.confirm(`“${channel.name}” kanalını silmek istiyor musunuz?`)) return;
    try {
      await api.delete(`/game/groups/${selectedGroupId}/channels/${channel.id}`);
      setChannels((previous) => previous.filter((item) => item.id !== channel.id));
      if (selectedChannel?.id === channel.id) setSelectedChannel({ id: 'general', conversationId: selectedGroupId, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() });
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Kanal silinemedi.');
    }
  };

  const joinVoiceChannel = async (channel: GameChannel) => {
    if (voiceConnection && voiceConnection.channel.id !== channel.id) {
      socket?.emit('game:voice-presence', { action: 'leave', channelId: voiceConnection.channel.id });
      setVoicePresences((previous) => previous.filter((item) => item.userId !== currentUser.id));
    }
    setError('');
    try {
      const response = await api.post(`/game/channels/${channel.id}/token`);
      setVoiceConnection(response.data);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Ses kanalına bağlanılamadı.');
    }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if ((!content && !selectedFile) || !selectedGroupId || !selectedChannel || selectedChannel.type !== 'TEXT') return;
    setMessageText('');
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    socket?.emit('typing_changed', { conversationId: selectedGroupId, gameChannelId: selectedChannel.id === 'general' ? null : selectedChannel.id, isTyping: false });
    try {
      let fileData: { fileKey?: string; fileType?: string; fileName?: string } = {};
      if (selectedFile) {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', selectedFile);
        const upload = await api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        fileData = { fileKey: upload.data.fileKey, fileType: upload.data.fileType, fileName: upload.data.fileName };
      }
      const body = { clientId: crypto.randomUUID(), content, ...fileData };
      const response = selectedChannel.id === 'general'
        ? await api.post('/messages', { ...body, conversationId: selectedGroupId })
        : await api.post(`/game/groups/${selectedGroupId}/channels/${selectedChannel.id}/messages`, body);
      setMessages((previous) => previous.some((item) => item.id === response.data.id) ? previous : [...previous, response.data]);
      setSelectedFile(null);
    } catch {
      setMessageText(content);
      setError('Mesaj gönderilemedi.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleComposerChange = (value: string) => {
    setMessageText(value);
    if (!socket || !selectedGroupId || !selectedChannel) return;
    socket.emit('typing_changed', { conversationId: selectedGroupId, gameChannelId: selectedChannel.id === 'general' ? null : selectedChannel.id, isTyping: Boolean(value.trim()) });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (value.trim()) {
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing_changed', { conversationId: selectedGroupId, gameChannelId: selectedChannel.id === 'general' ? null : selectedChannel.id, isTyping: false });
      }, 1800);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('En fazla 50 MB dosya gönderebilirsiniz.');
      return;
    }
    setSelectedFile(file);
    event.target.value = '';
  };

  if (groups.length === 0) {
    return (
      <main className="game-hub empty-game-hub">
        <div className="empty-game-card"><Icon name="game" /><h1>Oyun alanın hazır</h1><p>Ses ve yazı kanalı kullanabilmek için önce mesajlaşma bölümünde bir grup oluşturmalısın.</p><button className="game-return-button" onClick={exitGameMode}>Mesajlara dön</button></div>
      </main>
    );
  }

  return (
    <main className="game-hub">
      <aside className="game-group-rail">
        {groups.map((group) => (
          <button key={group.id} className={`game-group-button ${group.id === selectedGroupId ? 'active' : ''}`} title={group.name} onClick={() => selectGroup(group.id)}>
            {group.avatarUrl ? <img src={group.avatarUrl} alt="" /> : <span>{group.name?.[0]?.toUpperCase() || 'G'}</span>}
          </button>
        ))}
      </aside>

      <aside className="game-channel-sidebar">
        <header className="game-server-header">
          <div><span>OYUN GRUBU</span><h2>{selectedGroup?.name}</h2></div>
          <div className="game-server-actions"><button className="game-return-icon" onClick={exitGameMode} title="Mesajlara dön" aria-label="Mesajlara dön">←</button><button onClick={() => setIsCreating(true)} title="Kanal oluştur"><Icon name="plus" /></button></div>
        </header>

        <div className="channel-scroll">
          <ChannelSection title="YAZI KANALLARI" canCreate onAdd={() => { setChannelType('TEXT'); setIsCreating(true); }}>
            <button className={`channel-row ${selectedChannel?.id === 'general' ? 'active' : ''}`} onClick={() => { setSelectedChannel({ id: 'general', conversationId: selectedGroupId!, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() }); }}>
              <Icon name="hash" /><span>genel</span>
            </button>
            {textChannels.map((channel) => <ChannelRow key={channel.id} channel={channel} active={selectedChannel?.id === channel.id} canDelete={isAdmin || channel.createdById === currentUser.id} onSelect={() => { setSelectedChannel(channel); }} onDelete={() => deleteChannel(channel)} />)}
          </ChannelSection>

          <ChannelSection title="SES KANALLARI" canCreate onAdd={() => { setChannelType('VOICE'); setIsCreating(true); }}>
            {voiceChannels.length === 0 && <p className="channel-empty">Henüz ses kanalı yok.</p>}
            {voiceChannels.map((channel) => {
              const channelPresences = voicePresences.filter((presence) => presence.channelId === channel.id);
              return <div key={channel.id}><ChannelRow channel={channel} active={voiceConnection?.channel.id === channel.id} canDelete={isAdmin || channel.createdById === currentUser.id} onSelect={() => void joinVoiceChannel(channel)} onDelete={() => deleteChannel(channel)} />{channelPresences.length > 0 && <div className="voice-channel-members">{channelPresences.map((presence) => { const member = members.find((item) => item.id === presence.userId); return <div className={`voice-channel-member ${presence.isSpeaking ? 'speaking' : ''}`} key={presence.userId}><Avatar user={member || { username: presence.username }} size={27} speaking={presence.isSpeaking} /><span>{member?.username || presence.username}</span></div>; })}</div>}</div>;
            })}
          </ChannelSection>
        </div>

        <footer className="game-user-dock">
          <Avatar user={currentUser} size={40} />
          <div><strong>{currentUser.username}</strong><span>{voiceConnection ? 'Ses kanalında' : 'Çevrimiçi'}</span></div>
          {voiceConnection ? <div className="voice-controls-mount" ref={setVoiceControlsTarget} /> : <span className="online-dot" />}
        </footer>
      </aside>

      <section className="game-main-stage">
        {error && <button className="game-error" onClick={() => setError('')}>{error}<span>×</span></button>}
        {selectedChannel?.type === 'TEXT' ? (
          <>
            <header className="game-stage-header"><Icon name="hash" /><div><h1>{selectedChannel.name}</h1><p>{typingUsername ? `${typingUsername} yazıyor...` : `${selectedGroup?.name} grubunun yazı kanalı`}</p></div></header>
            <div className="game-message-list">
              {loading && messages.length === 0 && <p className="game-muted">Mesajlar yükleniyor...</p>}
              {!loading && messages.length === 0 && <div className="channel-welcome"><div><Icon name="hash" /></div><h2>#{selectedChannel.name} kanalına hoş geldin</h2><p>Bu kanalın başlangıcı. İlk mesajı sen gönder.</p></div>}
              {messages.map((message) => {
                const sender = members.find((member) => member.id === message.senderId);
                const isMine = message.senderId === currentUser.id;
                const isRead = (message.readByIds || []).some((id) => id !== currentUser.id);
                return <article className="game-message" key={message.id}><Avatar user={sender || { username: message.sender?.username || 'Oyuncu' }} size={42} /><div><div className="game-message-meta"><strong>{sender?.username || message.sender?.username}</strong><time>{message.createdAt ? new Date(message.createdAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}{isMine && <span className={isRead ? 'game-read-receipt read' : 'game-read-receipt'}>✓✓</span>}</time></div>{message.content && <p>{message.content}</p>}{message.fileUrl && (message.fileType === 'image' || message.fileType?.startsWith('image')) && <img className="game-message-image" src={message.fileUrl} alt={message.fileName || 'Gönderilen görsel'} />}{message.fileUrl && message.fileType !== 'image' && !message.fileType?.startsWith('image') && <a className="game-message-file" href={message.fileUrl} target="_blank" rel="noreferrer">📎 {message.fileName || 'Dosya'}</a>}</div></article>;
              })}
              <div ref={messageEndRef} />
            </div>
            <div className="game-message-composer">{selectedFile && <div className="game-file-preview">📎 {selectedFile.name}<button onClick={() => setSelectedFile(null)} aria-label="Dosyayı kaldır">×</button></div>}<button aria-label="Dosya ekle" onClick={() => fileInputRef.current?.click()}><Icon name="plus" /></button><input value={messageText} onChange={(event) => handleComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={`#${selectedChannel.name} kanalına mesaj gönder`} /><button className="send-game-message" disabled={isUploading || (!messageText.trim() && !selectedFile)} onClick={() => void sendMessage()}>{isUploading ? 'Yükleniyor' : 'Gönder'}</button><input ref={fileInputRef} type="file" hidden onChange={handleFileChange} /></div>
          </>
        ) : null}
      </section>

      {voiceConnection && (
        <LiveKitRoom key={voiceConnection.channel.id} serverUrl={voiceConnection.serverUrl} token={voiceConnection.token} connect audio video={false} onConnected={() => { const presence: VoicePresence = { conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id, userId: currentUser.id, username: currentUser.username, isSpeaking: false }; setVoicePresences((previous) => [...previous.filter((item) => item.userId !== currentUser.id), presence]); socket?.emit('game:voice-presence', { action: 'join', conversationId: presence.conversationId, channelId: presence.channelId }); }} onDisconnected={() => { socket?.emit('game:voice-presence', { action: 'leave', channelId: voiceConnection.channel.id }); setVoicePresences((previous) => previous.filter((item) => item.userId !== currentUser.id || item.channelId !== voiceConnection.channel.id)); setVoiceConnection(null); }} onError={() => setError('Ses bağlantısında bir hata oluştu.')} className="game-livekit-room">
          <VoiceChannelConnection channelId={voiceConnection.channel.id} currentUserId={currentUser.id} socket={socket} controlsTarget={voiceControlsTarget} onLeave={() => { socket?.emit('game:voice-presence', { action: 'leave', channelId: voiceConnection.channel.id }); setVoiceConnection(null); }} />
        </LiveKitRoom>
      )}

      {isCreating && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreating(false); }}>
          <div className="channel-modal">
            <span className="eyebrow">{selectedGroup?.name}</span><h2>Yeni kanal oluştur</h2><p>Grubuna bağlı kalıcı bir yazı veya ses kanalı ekle.</p>
            <div className="channel-type-picker"><button className={channelType === 'TEXT' ? 'active' : ''} onClick={() => setChannelType('TEXT')}><Icon name="hash" /><span><strong>Yazı kanalı</strong><small>Grup içinde ayrı mesaj akışı</small></span></button><button className={channelType === 'VOICE' ? 'active' : ''} onClick={() => setChannelType('VOICE')}><Icon name="voice" /><span><strong>Ses kanalı</strong><small>Anında konuşma ve ekran paylaşımı</small></span></button></div>
            <label>KANAL ADI<input autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} maxLength={40} placeholder={channelType === 'VOICE' ? 'Örn. Valorant Takımı' : 'örn-oyun-planı'} /></label>
            {channelType === 'VOICE' && <label>KİŞİ LİMİTİ<select value={channelLimit} onChange={(event) => setChannelLimit(Number(event.target.value))}>{[2, 4, 5, 8, 10, 15, 20, 25].map((limit) => <option key={limit} value={limit}>{limit} kişi</option>)}</select></label>}
            <div className="channel-modal-actions"><button onClick={() => setIsCreating(false)}>Vazgeç</button><button className="primary" disabled={!channelName.trim()} onClick={() => void createChannel()}>Kanalı oluştur</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

function ChannelSection({ title, canCreate, onAdd, children }: { title: string; canCreate: boolean; onAdd: () => void; children: React.ReactNode }) {
  return <section className="channel-section"><div className="channel-section-title"><span>{title}</span>{canCreate && <button onClick={onAdd}><Icon name="plus" /></button>}</div>{children}</section>;
}

function ChannelRow({ channel, active, canDelete, onSelect, onDelete }: { channel: GameChannel; active: boolean; canDelete: boolean; onSelect: () => void; onDelete: () => void }) {
  return <div className={`channel-row-wrap ${active ? 'active' : ''}`}><button className="channel-row" onClick={onSelect}><Icon name={channel.type === 'VOICE' ? 'voice' : 'hash'} /><span>{channel.name}</span>{channel.type === 'VOICE' && <small>en fazla {channel.maxParticipants || 8}</small>}</button>{canDelete && <button className="delete-channel" onClick={onDelete} title="Kanalı sil"><Icon name="trash" /></button>}</div>;
}
