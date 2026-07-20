import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ControlBar,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useRoomContext
} from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { TypedSocket } from '../../types/socket';
import { api } from '../../api/httpClient';
import type { Conversation, GameChannel, GameChannelType, Message, User } from '../../types/chat';
import AvatarViewerModal from '../Modals/AvatarViewerModal';
import '@livekit/components-styles';
import './GameHub.css';
import { useConfirm } from '../../context/useConfirm';

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
  socket: TypedSocket | null;
  onExit: () => void;
  onStartDirectChat?: (targetUser: User) => void;
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
  socket: TypedSocket | null;
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

export default function GameHub({ currentUser, groups, users, socket, onExit, onStartDirectChat }: GameHubProps) {
  const confirm = useConfirm();
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
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(new Set());
  const [channelUnreadCounts, setChannelUnreadCounts] = useState<Record<string, number>>({});
  const [channelTypings, setChannelTypings] = useState<Record<string, string>>({});
  const [editingChannel, setEditingChannel] = useState<GameChannel | null>(null);
  const [editName, setEditName] = useState('');
  const [editLimit, setEditLimit] = useState(8);
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [dragOverChannelId, setDragOverChannelId] = useState<string | null>(null);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<User | null>(null);
  const [viewerUser, setViewerUser] = useState<{ avatarUrl: string | null; username: string } | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentTypingRef = useRef<{ channelId: string; isTyping: boolean } | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const isAdmin = selectedGroup?.adminId === currentUser.id;
  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');
  const onlineCount = useMemo(() => {
    return members.filter((m) => m.isOnline).length;
  }, [members]);
  const onlineMembers = useMemo(() => {
    return members.filter((m) => m.isOnline).sort((a, b) => a.username.localeCompare(b.username));
  }, [members]);
  const offlineMembers = useMemo(() => {
    return members.filter((m) => !m.isOnline).sort((a, b) => a.username.localeCompare(b.username));
  }, [members]);
  const availableUsersToAdd = useMemo(() => {
    return users.filter((u) => u.id !== currentUser.id && !members.some((m) => m.id === u.id));
  }, [users, members, currentUser.id]);

  const exitGameMode = useCallback(() => {
    if (voiceConnection) {
      socket?.emit('game:voice-presence', { action: 'leave', conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id });
      setVoiceConnection(null);
      setVoicePresences((previous) => previous.filter((presence) => presence.userId !== currentUser.id));
    }
    onExit();
  }, [currentUser.id, onExit, socket, voiceConnection]);

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
    setChannelUnreadCounts({});
    setChannelTypings({});
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/game/groups/${selectedGroupId}/channels`),
      api.get(`/conversations/group/${selectedGroupId}/participants`)
    ]).then(([channelResponse, memberResponse]) => {
      if (cancelled) return;
      setChannels(channelResponse.data.channels.filter((channel: GameChannel) => channel.conversationId === selectedGroupId));
      setMutedChannelIds(new Set(channelResponse.data.mutedChannelIds || []));
      const mapped = memberResponse.data.map((member: User) => {
        if (member.id === currentUser.id) return { ...member, ...currentUser, isOnline: true };
        const liveUser = users.find((u) => u.id === member.id);
        return liveUser ? { ...member, ...liveUser } : { ...member, isOnline: false };
      });
      setMembers(mapped);
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
  }, [currentUser, selectedGroupId, users]);

  useEffect(() => {
    setMembers((previous) => previous.map((member) => {
      if (member.id === currentUser.id) return { ...member, ...currentUser, isOnline: true };
      const liveUser = users.find((u) => u.id === member.id);
      return liveUser ? { ...member, ...liveUser } : { ...member, isOnline: false };
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
      if (message.conversationId !== selectedGroupId) return;
      if (message.gameChannelId === selectedChannel?.id) {
        setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
      } else if (message.gameChannelId) {
        const isMuted = mutedChannelIds.has(message.gameChannelId);
        if (!isMuted) {
          setChannelUnreadCounts((prev) => ({
            ...prev,
            [message.gameChannelId!]: (prev[message.gameChannelId!] || 0) + 1
          }));
        }
      }
    };
    const receiveGeneralMessage = (message: Message) => {
      if (message.conversationId !== selectedGroupId || message.gameChannelId) return;
      if (selectedChannel?.id === 'general') {
        setMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
      } else {
        const isMuted = mutedChannelIds.has('general');
        if (!isMuted) {
          setChannelUnreadCounts((prev) => ({
            ...prev,
            general: (prev.general || 0) + 1
          }));
        }
      }
    };
    const receiveTyping = ({ conversationId, gameChannelId, username, isTyping }: { conversationId: string; gameChannelId?: string | null; username: string; isTyping: boolean }) => {
      if (conversationId !== selectedGroupId || username === currentUser.username) return;
      const targetChannelId = gameChannelId || 'general';
      setChannelTypings((prev) => ({
        ...prev,
        [targetChannelId]: isTyping ? username : ''
      }));
      const currentChannelId = selectedChannel?.id === 'general' ? null : selectedChannel?.id;
      if (gameChannelId === currentChannelId) {
        setTypingUsername(isTyping ? username : '');
      }
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
    const channelUpdated = (channel: GameChannel) => {
      if (channel.conversationId !== selectedGroupId) return;
      setChannels((previous) => previous.map((item) => item.id === channel.id ? channel : item));
      setSelectedChannel((prev) => prev && prev.id === channel.id ? channel : prev);
    };
    const channelsReordered = ({ groupId, channels: nextChannels }: { groupId: string; channels: GameChannel[] }) => {
      if (groupId !== selectedGroupId) return;
      setChannels(nextChannels);
    };
    const channelDeleted = ({ channelId, groupId }: { channelId: string; groupId: string }) => {
      if (groupId !== selectedGroupId) return;
      setChannels((previous) => previous.filter((item) => item.id !== channelId));
      if (selectedChannel?.id === channelId) {
        setSelectedChannel({ id: 'general', conversationId: groupId, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() });
      }
    };
    const membersAdded = ({ groupId, newMembers }: { groupId: string; newMembers: User[] }) => {
      if (groupId !== selectedGroupId) return;
      setMembers((prev) => {
        const existingIds = new Set(prev.map(m => m.id));
        const filtered = newMembers.filter(m => !existingIds.has(m.id)).map(m => {
          if (m.id === currentUser.id) return { ...m, ...currentUser, isOnline: true };
          const liveUser = users.find((u) => u.id === m.id);
          return liveUser ? { ...m, ...liveUser } : { ...m, isOnline: false };
        });
        return [...prev, ...filtered];
      });
    };
    const gruptanAtildi = ({ groupId, removedUserId }: { groupId: string; removedUserId: string }) => {
      if (groupId !== selectedGroupId) return;
      setMembers((prev) => prev.filter((m) => m.id !== removedUserId));
      if (removedUserId === currentUser.id) {
        exitGameMode();
      }
    };

    socket.on('game:message', receiveGameMessage);
    socket.on('yeni_mesaj_geldi', receiveGeneralMessage);
    socket.on('game:channel-created', channelCreated);
    socket.on('game:channel-updated', channelUpdated);
    socket.on('game:channels-reordered', channelsReordered);
    socket.on('game:channel-deleted', channelDeleted);
    socket.on('typing_changed', receiveTyping);
    socket.on('mesajlar_okundu', receiveReadReceipt);
    socket.on('grup_uyeleri_eklendi', membersAdded);
    socket.on('gruptan_atildi', gruptanAtildi);

    return () => {
      socket.off('game:message', receiveGameMessage);
      socket.off('yeni_mesaj_geldi', receiveGeneralMessage);
      socket.off('game:channel-created', channelCreated);
      socket.off('game:channel-updated', channelUpdated);
      socket.off('game:channels-reordered', channelsReordered);
      socket.off('game:channel-deleted', channelDeleted);
      socket.off('typing_changed', receiveTyping);
      socket.off('mesajlar_okundu', receiveReadReceipt);
      socket.off('grup_uyeleri_eklendi', membersAdded);
      socket.off('gruptan_atildi', gruptanAtildi);
    };
  }, [socket, selectedGroupId, selectedChannel?.id, currentUser, users, mutedChannelIds, exitGameMode]);

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
    } catch (requestError) {
      const err = requestError as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Kanal oluşturulamadı.');
    }
  };

  const handleAddMembers = async () => {
    if (!selectedGroupId || selectedNewMembers.length === 0) return;
    setError('');
    try {
      await api.post(`/conversations/group/${selectedGroupId}/participants`, { userIdsToAdd: selectedNewMembers });
      setIsAddingMember(false);
      setSelectedNewMembers([]);
    } catch {
      setError('Kullanıcılar eklenemedi.');
    }
  };

  const deleteChannel = async (channel: GameChannel) => {
    if (!selectedGroupId) return;
    const isConfirmed = await confirm({
      title: "Kanalı Sil",
      message: `“${channel.name}” kanalını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
      confirmText: "Kanalı Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/game/groups/${selectedGroupId}/channels/${channel.id}`);
      setChannels((previous) => previous.filter((item) => item.id !== channel.id));
      if (selectedChannel?.id === channel.id) setSelectedChannel({ id: 'general', conversationId: selectedGroupId, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() });
    } catch (requestError) {
      const err = requestError as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Kanal silinemedi.');
    }
  };

  const handleDragStart = (e: React.DragEvent, channelId: string) => {
    if (!isAdmin) return;
    setDraggedChannelId(channelId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, channelId: string, type: GameChannelType) => {
    if (!isAdmin || !draggedChannelId) return;
    const dragged = channels.find(c => c.id === draggedChannelId);
    if (!dragged || dragged.type !== type) return;
    e.preventDefault();
    setDragOverChannelId(channelId);
  };

  const handleDragEnd = () => {
    setDraggedChannelId(null);
    setDragOverChannelId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetChannelId: string, type: GameChannelType) => {
    if (!isAdmin || !draggedChannelId || draggedChannelId === targetChannelId) return;
    const dragged = channels.find(c => c.id === draggedChannelId);
    if (!dragged || dragged.type !== type) return;

    e.preventDefault();

    const sameTypeChannels = channels.filter(c => c.type === type);
    const dragIndex = sameTypeChannels.findIndex(c => c.id === draggedChannelId);
    const hoverIndex = sameTypeChannels.findIndex(c => c.id === targetChannelId);

    if (dragIndex === -1 || hoverIndex === -1) return;

    const result = [...sameTypeChannels];
    const [removed] = result.splice(dragIndex, 1);
    result.splice(hoverIndex, 0, removed);

    const orderedIds = result.map(c => c.id);

    const otherTypeChannels = channels.filter(c => c.type !== type);
    const updatedSameType = result.map((c, i) => ({ ...c, position: i }));
    const updatedAll = [...otherTypeChannels, ...updatedSameType].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.position - b.position;
    });

    setChannels(updatedAll);

    try {
      const response = await api.put(`/game/groups/${selectedGroupId}/channels/reorder`, { orderedIds });
      setChannels(response.data);
    } catch {
      setError('Kanal sıralaması güncellenemedi.');
    }

    setDraggedChannelId(null);
    setDragOverChannelId(null);
  };

  const toggleMute = async (channelId: string) => {
    if (!selectedGroupId) return;
    try {
      const response = await api.post(`/game/groups/${selectedGroupId}/channels/${channelId}/mute`);
      setMutedChannelIds(prev => {
        const next = new Set(prev);
        if (response.data.muted) {
          next.add(channelId);
        } else {
          next.delete(channelId);
        }
        return next;
      });
    } catch {
      setError('Bildirim ayarı değiştirilemedi.');
    }
  };

  const openEditModal = (channel: GameChannel) => {
    setEditingChannel(channel);
    setEditName(channel.name);
    setEditLimit(channel.maxParticipants || 8);
  };

  const handleUpdateChannel = async () => {
    console.log("handleUpdateChannel called: ", { selectedGroupId, channelId: editingChannel?.id, editName, editLimit });
    if (!selectedGroupId || !editingChannel || !editName.trim()) {
      console.warn("handleUpdateChannel skipped: missing required values");
      return;
    }
    try {
      const response = await api.patch(`/game/groups/${selectedGroupId}/channels/${editingChannel.id}`, {
        name: editName,
        maxParticipants: editingChannel.type === 'VOICE' ? editLimit : null
      });
      console.log("handleUpdateChannel response: ", response.data);
      setChannels((prev) => prev.map((c) => c.id === editingChannel.id ? response.data : c));
      if (selectedChannel?.id === editingChannel.id) {
        setSelectedChannel(response.data);
      }
      setEditingChannel(null);
    } catch (requestError) {
      const err = requestError as { response?: { data?: { error?: string } } };
      console.error("handleUpdateChannel error: ", err);
      setError(err.response?.data?.error || 'Kanal güncellenemedi.');
    }
  };

  const selectChannel = (channel: SelectedChannel) => {
    setSelectedChannel(channel);
    setTypingUsername(channelTypings[channel.id] || '');
    setChannelUnreadCounts((prev) => {
      if (prev[channel.id] > 0) {
        return { ...prev, [channel.id]: 0 };
      }
      return prev;
    });
  };

  const joinVoiceChannel = async (channel: GameChannel) => {
    if (voiceConnection && voiceConnection.channel.id !== channel.id) {
      socket?.emit('game:voice-presence', { action: 'leave', conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id });
      setVoicePresences((previous) => previous.filter((item) => item.userId !== currentUser.id));
    }
    setError('');
    try {
      const response = await api.post(`/game/channels/${channel.id}/token`);
      setVoiceConnection(response.data);
    } catch (requestError) {
      const err = requestError as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Ses kanalına bağlanılamadı.');
    }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if ((!content && !selectedFile) || !selectedGroupId || !selectedChannel || selectedChannel.type !== 'TEXT') return;
    setMessageText('');
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    socket?.emit('typing_changed', { conversationId: selectedGroupId, gameChannelId: selectedChannel.id === 'general' ? null : selectedChannel.id, isTyping: false });
    lastSentTypingRef.current = { channelId: selectedChannel.id, isTyping: false };
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
    
    const isCurrentlyTyping = Boolean(value.trim());
    const channelId = selectedChannel.id;
    const current = lastSentTypingRef.current;
    
    if (!current || current.channelId !== channelId || current.isTyping !== isCurrentlyTyping) {
      lastSentTypingRef.current = { channelId, isTyping: isCurrentlyTyping };
      socket.emit('typing_changed', { 
        conversationId: selectedGroupId, 
        gameChannelId: channelId === 'general' ? null : channelId, 
        isTyping: isCurrentlyTyping 
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isCurrentlyTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing_changed', { 
          conversationId: selectedGroupId, 
          gameChannelId: channelId === 'general' ? null : channelId, 
          isTyping: false 
        });
        lastSentTypingRef.current = { channelId, isTyping: false };
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
          <div>
            <span>OYUN GRUBU</span>
            <h2>{selectedGroup?.name}</h2>
            <div className="game-server-online-info">
              <span className="online-indicator-dot" />
              <span>{onlineCount}/{members.length} Çevrimiçi</span>
            </div>
          </div>
          <div className="game-server-actions">
            <button className="game-return-icon" onClick={exitGameMode} title="Mesajlara dön" aria-label="Mesajlara dön">←</button>
            <button onClick={() => setIsCreating(true)} title="Kanal oluştur"><Icon name="plus" /></button>
          </div>
        </header>

        <div className="channel-scroll">
          <ChannelSection title="YAZI KANALLARI" canCreate onAdd={() => { setChannelType('TEXT'); setIsCreating(true); }}>
            <ChannelRow
              channel={{ id: 'general', name: 'genel', type: 'TEXT' }}
              active={selectedChannel?.id === 'general'}
              canDelete={false}
              canEdit={false}
              isMuted={mutedChannelIds.has('general')}
              unreadCount={channelUnreadCounts.general}
              typingUser={channelTypings.general}
              onSelect={() => selectChannel({ id: 'general', conversationId: selectedGroupId!, createdById: '', name: 'genel', type: 'TEXT', position: -1, createdAt: new Date(0).toISOString() })}
              onMuteToggle={() => toggleMute('general')}
            />
            {textChannels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                active={selectedChannel?.id === channel.id}
                canDelete={isAdmin || channel.createdById === currentUser.id}
                canEdit={isAdmin || channel.createdById === currentUser.id}
                isMuted={mutedChannelIds.has(channel.id)}
                unreadCount={channelUnreadCounts[channel.id]}
                typingUser={channelTypings[channel.id]}
                isAdmin={isAdmin}
                dragOver={dragOverChannelId === channel.id}
                onSelect={() => selectChannel(channel)}
                onDelete={() => deleteChannel(channel)}
                onEdit={() => openEditModal(channel)}
                onMuteToggle={() => toggleMute(channel.id)}
                onDragStart={(e) => handleDragStart(e, channel.id)}
                onDragOver={(e) => handleDragOver(e, channel.id, 'TEXT')}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, channel.id, 'TEXT')}
              />
            ))}
          </ChannelSection>

          <ChannelSection title="SES KANALLARI" canCreate onAdd={() => { setChannelType('VOICE'); setIsCreating(true); }}>
            {voiceChannels.length === 0 && <p className="channel-empty">Henüz ses kanalı yok.</p>}
            {voiceChannels.map((channel) => {
              const channelPresences = voicePresences.filter((presence) => presence.channelId === channel.id);
              return (
                <div key={channel.id}>
                  <ChannelRow
                    channel={channel}
                    active={voiceConnection?.channel.id === channel.id}
                    canDelete={isAdmin || channel.createdById === currentUser.id}
                    canEdit={isAdmin || channel.createdById === currentUser.id}
                    isMuted={mutedChannelIds.has(channel.id)}
                    isAdmin={isAdmin}
                    dragOver={dragOverChannelId === channel.id}
                    onSelect={() => void joinVoiceChannel(channel)}
                    onDelete={() => deleteChannel(channel)}
                    onEdit={() => openEditModal(channel)}
                    onMuteToggle={() => toggleMute(channel.id)}
                    onDragStart={(e) => handleDragStart(e, channel.id)}
                    onDragOver={(e) => handleDragOver(e, channel.id, 'VOICE')}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, channel.id, 'VOICE')}
                  />
                  {channelPresences.length > 0 && (
                    <div className="voice-channel-members">
                      {channelPresences.map((presence) => {
                        const member = members.find((item) => item.id === presence.userId);
                        return (
                          <div className={`voice-channel-member ${presence.isSpeaking ? 'speaking' : ''}`} key={presence.userId}>
                            <Avatar user={member || { username: presence.username }} size={27} speaking={presence.isSpeaking} />
                            <span>{member?.username || presence.username}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
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

      <aside className="game-member-sidebar">
        <header className="member-sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 8px 20px', borderBottom: '1px solid var(--game-border)' }}>
          <h3 style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: 'var(--game-muted)', letterSpacing: '0.05em' }}>ÜYELER</h3>
          {isAdmin && (
            <button 
              onClick={() => setIsAddingMember(true)} 
              title="Yeni Üye Ekle" 
              style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </button>
          )}
        </header>
        <div className="member-scroll">
          <div className="member-section">
            <h3 className="member-section-title">ÇEVRİMİÇİ — {onlineMembers.length}</h3>
            {onlineMembers.map((member) => (
              <button key={member.id} className="member-row" onClick={() => setSelectedMemberProfile(member)}>
                <Avatar user={member} size={32} />
                <span className="member-name">{member.username}</span>
                <span className="online-status-dot" />
              </button>
            ))}
          </div>
          
          <div className="member-section">
            <h3 className="member-section-title">ÇEVRİMDIŞI — {offlineMembers.length}</h3>
            {offlineMembers.map((member) => (
              <button key={member.id} className="member-row offline" onClick={() => setSelectedMemberProfile(member)}>
                <Avatar user={member} size={32} />
                <span className="member-name">{member.username}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {voiceConnection && (
        <LiveKitRoom key={voiceConnection.channel.id} serverUrl={voiceConnection.serverUrl} token={voiceConnection.token} connect audio video={false} onConnected={() => { const presence: VoicePresence = { conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id, userId: currentUser.id, username: currentUser.username, isSpeaking: false }; setVoicePresences((previous) => [...previous.filter((item) => item.userId !== currentUser.id), presence]); socket?.emit('game:voice-presence', { action: 'join', conversationId: presence.conversationId, channelId: presence.channelId }); }} onDisconnected={() => { socket?.emit('game:voice-presence', { action: 'leave', conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id }); setVoicePresences((previous) => previous.filter((item) => item.userId !== currentUser.id || item.channelId !== voiceConnection.channel.id)); setVoiceConnection(null); }} onError={() => setError('Ses bağlantısında bir hata oluştu.')} className="game-livekit-room">
          <VoiceChannelConnection channelId={voiceConnection.channel.id} currentUserId={currentUser.id} socket={socket} controlsTarget={voiceControlsTarget} onLeave={() => { socket?.emit('game:voice-presence', { action: 'leave', conversationId: voiceConnection.channel.conversationId, channelId: voiceConnection.channel.id }); setVoiceConnection(null); }} />
        </LiveKitRoom>
      )}

      {isCreating && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreating(false); }}>
          <div className="channel-modal" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">{selectedGroup?.name}</span><h2>Yeni kanal oluştur</h2><p>Grubuna bağlı kalıcı bir yazı veya ses kanalı ekle.</p>
            <div className="channel-type-picker"><button className={channelType === 'TEXT' ? 'active' : ''} onClick={() => setChannelType('TEXT')}><Icon name="hash" /><span><strong>Yazı kanalı</strong><small>Grup içinde ayrı mesaj akışı</small></span></button><button className={channelType === 'VOICE' ? 'active' : ''} onClick={() => setChannelType('VOICE')}><Icon name="voice" /><span><strong>Ses kanalı</strong><small>Anında konuşma ve ekran paylaşımı</small></span></button></div>
            <label>KANAL ADI<input autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} maxLength={40} placeholder={channelType === 'VOICE' ? 'Örn. Valorant Takımı' : 'örn-oyun-planı'} /></label>
            {channelType === 'VOICE' && <label>KİŞİ LİMİTİ<select value={channelLimit} onChange={(event) => setChannelLimit(Number(event.target.value))}>{[2, 4, 5, 8, 10, 15, 20, 25].map((limit) => <option key={limit} value={limit}>{limit} kişi</option>)}</select></label>}
            <div className="channel-modal-actions"><button onClick={() => setIsCreating(false)}>Vazgeç</button><button className="primary" disabled={!channelName.trim()} onClick={() => void createChannel()}>Kanalı oluştur</button></div>
          </div>
        </div>
      )}

      {editingChannel && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingChannel(null); }}>
          <div className="channel-modal" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">{selectedGroup?.name}</span>
            <h2>Kanalı düzenle</h2>
            <p>“{editingChannel.name}” kanalının ayarlarını güncelleyin.</p>
            <label>KANAL ADI<input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={40} placeholder={editingChannel.type === 'VOICE' ? 'Örn. Valorant Takımı' : 'örn-oyun-planı'} /></label>
            {editingChannel.type === 'VOICE' && <label>KİŞİ LİMİTİ<select value={editLimit} onChange={(event) => setEditLimit(Number(event.target.value))}>{[2, 4, 5, 8, 10, 15, 20, 25].map((limit) => <option key={limit} value={limit}>{limit} kişi</option>)}</select></label>}
            <div className="channel-modal-actions"><button onClick={() => setEditingChannel(null)}>Vazgeç</button><button className="primary" disabled={!editName.trim()} onClick={() => void handleUpdateChannel()}>Değişiklikleri kaydet</button></div>
          </div>
        </div>
      )}

      {selectedMemberProfile && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMemberProfile(null); }}>
          <div className="channel-modal game-profile-card" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">{selectedGroup?.name}</span>
            <h2>Kullanıcı Profili</h2>
            <div className="game-profile-header" style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '20px 0' }}>
              <div 
                className="game-profile-avatar-wrap" 
                onClick={() => setViewerUser({ 
                  avatarUrl: selectedMemberProfile.avatarUrl || null, 
                  username: selectedMemberProfile.username 
                })}
                title="Profil resmini görüntüle"
                style={{ position: 'relative', cursor: 'pointer' }}
              >
                <Avatar user={selectedMemberProfile} size={64} />
                <span 
                  className={`game-profile-status-dot ${selectedMemberProfile.isOnline ? 'online' : 'offline'}`} 
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 2,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    border: '2px solid #131c2a',
                    background: selectedMemberProfile.isOnline ? '#34d399' : '#94a3b8'
                  }}
                />
              </div>
              <div className="game-profile-user-details" style={{ minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>{selectedMemberProfile.username}</h3>
                <span className="game-profile-email" style={{ color: 'var(--game-muted)', fontSize: '12px' }}>{selectedMemberProfile.email || 'E-posta adresi yok'}</span>
              </div>
            </div>
            
            <div className="game-profile-body" style={{ background: '#0d1521', padding: '14px', borderRadius: '10px', display: 'grid', gap: '10px', marginBottom: '20px', fontSize: '13px' }}>
              <div className="profile-info-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: 'var(--game-muted)' }}>Durum:</strong>
                <span style={{ color: selectedMemberProfile.isOnline ? '#34d399' : '#94a3b8', fontWeight: 600 }}>{selectedMemberProfile.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
              </div>
              {selectedMemberProfile.lastSeenAt && (
                <div className="profile-info-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: 'var(--game-muted)' }}>Son Görülme:</strong>
                  <span>{new Date(selectedMemberProfile.lastSeenAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
              )}
            </div>

            <div className="channel-modal-actions" style={{ gap: '10px' }}>
              <button onClick={() => setSelectedMemberProfile(null)}>Kapat</button>
              {selectedMemberProfile.id !== currentUser.id && onStartDirectChat && (
                <button className="primary" onClick={async () => {
                  const isConfirmed = await confirm({
                    title: "Sohbete Geçiş Yap",
                    message: "Mesajlaşma moduna geçmek ve bu kullanıcıyla doğrudan sohbet başlatmak istediğinize emin misiniz?",
                    confirmText: "Sohbete Geç",
                    cancelText: "Vazgeç",
                    isDanger: false
                  });
                  if (isConfirmed) {
                    setSelectedMemberProfile(null);
                    onStartDirectChat(selectedMemberProfile);
                  }
                }}>
                  Sohbete Başla
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isAddingMember && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setIsAddingMember(false); setSelectedNewMembers([]); } }}>
          <div className="channel-modal" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ width: '380px' }}>
            <span className="eyebrow">{selectedGroup?.name}</span>
            <h2>Yeni Üye Ekle</h2>
            <p>Grubunuza eklemek istediğiniz kullanıcıları seçin.</p>
            <div className="new-member-list" style={{ maxHeight: '250px', overflowY: 'auto', margin: '15px 0', border: '1px solid var(--game-border)', borderRadius: '8px', background: '#0d1521' }}>
              {availableUsersToAdd.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--game-muted)' }}>Eklenebilecek yeni kullanıcı bulunamadı.</div>
              ) : (
                availableUsersToAdd.map((user) => {
                  const isSelected = selectedNewMembers.includes(user.id);
                  return (
                    <button 
                      key={user.id} 
                      onClick={() => {
                        setSelectedNewMembers(prev => prev.includes(user.id) ? prev.filter(id => id !== user.id) : [...prev, user.id]);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 14px',
                        background: isSelected ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
                        border: 0,
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <div 
                        className={`game-custom-checkbox ${isSelected ? 'checked' : ''}`}
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          border: isSelected ? '2px solid var(--game-orange)' : '2px solid rgba(255, 255, 255, 0.18)',
                          background: isSelected ? 'var(--game-orange)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                          flexShrink: 0
                        }}
                      >
                        {isSelected && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <Avatar user={user} size={28} />
                      <span style={{ color: isSelected ? '#f5f7fa' : '#cbd5e1', fontSize: '13.5px', fontWeight: 600 }}>{user.username}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="channel-modal-actions">
              <button onClick={() => { setIsAddingMember(false); setSelectedNewMembers([]); }}>Vazgeç</button>
              <button 
                className="primary" 
                disabled={selectedNewMembers.length === 0} 
                onClick={() => void handleAddMembers()}
              >
                Gruba Ekle
              </button>
            </div>
          </div>
        </div>
      )}
      {viewerUser && (
        <AvatarViewerModal
          avatarUrl={viewerUser.avatarUrl}
          username={viewerUser.username}
          onClose={() => setViewerUser(null)}
        />
      )}
    </main>
  );
}

function ChannelSection({ title, canCreate, onAdd, children }: { title: string; canCreate: boolean; onAdd: () => void; children: React.ReactNode }) {
  return <section className="channel-section"><div className="channel-section-title"><span>{title}</span>{canCreate && <button onClick={onAdd}><Icon name="plus" /></button>}</div>{children}</section>;
}

interface ChannelRowProps {
  channel: GameChannel | { id: 'general'; name: string; type: 'TEXT' };
  active: boolean;
  canDelete: boolean;
  canEdit: boolean;
  isMuted: boolean;
  unreadCount?: number;
  typingUser?: string;
  isAdmin?: boolean;
  dragOver?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onMuteToggle: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

function ChannelRow({
  channel,
  active,
  canDelete,
  canEdit,
  isMuted,
  unreadCount = 0,
  typingUser,
  isAdmin = false,
  dragOver = false,
  onSelect,
  onDelete,
  onEdit,
  onMuteToggle,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop
}: ChannelRowProps) {
  const isGeneral = channel.id === 'general';
  
  return (
    <div
      className={`channel-row-wrap ${active ? 'active' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable={isAdmin && !isGeneral}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      <button className="channel-row" onClick={onSelect}>
        <Icon name={channel.type === 'VOICE' ? 'voice' : 'hash'} />
        <div className="channel-info-wrap">
          <span className="channel-name">{channel.name}</span>
          {typingUser && <span className="channel-typing-indicator">{typingUser} yazıyor...</span>}
        </div>
        {channel.type === 'VOICE' && 'maxParticipants' in channel && (
          <small className="channel-limit-badge">max {channel.maxParticipants || 8}</small>
        )}
        {unreadCount > 0 && (
          <span className="game-channel-unread">{unreadCount}</span>
        )}
      </button>
      
      <div className="channel-row-actions">
        <button
          className={`channel-mute-btn ${isMuted ? 'muted' : ''}`}
          onClick={(e) => { e.stopPropagation(); onMuteToggle(); }}
          title={isMuted ? "Bildirimleri Aç" : "Bildirimleri Sessize Al"}
        >
          {isMuted ? (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          )}
        </button>

        {canEdit && onEdit && (
          <button className="edit-channel" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Kanalı Düzenle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        )}

        {canDelete && onDelete && (
          <button className="delete-channel" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Kanalı Sil">
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  );
}
