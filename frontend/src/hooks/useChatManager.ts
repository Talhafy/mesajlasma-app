/**
 * ============================================================================
 * SOHBET VE MESAJLAŞMA YÖNETİMİ HOOK'U (useChatManager)
 * ============================================================================
 * 
 * Bu hook; birebir ve grup sohbetlerini (`conversationList`, `groupsList`),
 * aktif sohbet durumunu (`activeConversation`), mesaj geçmişini (`messages`),
 * okunmamış mesaj rozetlerini (`unreadCounts`) ve canlı soket mesaj/yazıyor olaylarını yönetir.
 */

import { useEffect, useRef, useState } from 'react';
import type { Conversation, Message, User } from '../types/chat';
import type { TypedSocket } from '../types/socket';
import { api } from '../api/httpClient';
import { unwrapItems } from '../api/pagination';

interface UseChatManagerOptions {
  socket: TypedSocket | null;
  currentUser: User | null;
  onlineUserIdsRef: React.MutableRefObject<Set<string>>;
}

export function useChatManager({
  socket,
  currentUser,
  onlineUserIdsRef
}: UseChatManagerOptions) {
  const [usersList, setUsersList] = useState<User[]>([]);
  const [groupsList, setGroupsList] = useState<Conversation[]>([]);
  const [conversationList, setConversationList] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  const [recordingByConversation, setRecordingByConversation] = useState<Record<string, string>>({});

  const activeConversationRef = useRef<Conversation | null>(null);
  const selectedUserRef = useRef<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const groupsListRef = useRef<Conversation[]>([]);
  const usersListRef = useRef<User[]>([]);
  const conversationListRef = useRef<Conversation[]>([]);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const autoScrollRef = useRef(true);

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
  useEffect(() => { usersListRef.current = usersList; }, [usersList]);
  useEffect(() => { conversationListRef.current = conversationList; }, [conversationList]);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      const enriched = unwrapItems<User>(res.data).map((user) => {
        const shouldHide = user.isBlocked || user.blockedByOther;
        return {
          ...user,
          isOnline: shouldHide ? false : onlineUserIdsRef.current.has(user.id)
        };
      });
      setUsersList(enriched);
    } catch {
      console.error('Kullanıcılar çekilemedi');
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await api.get('/conversations/groups');
      setGroupsList(res.data);
    } catch {
      console.error('Gruplar çekilemedi');
    }
  };

  const fetchUnreadCounts = async () => {
    try {
      const res = await api.get('/unread-counts');
      setUnreadCounts(res.data);
    } catch {
      console.error('Okunmamış sayılar çekilemedi');
    }
  };

  const mergeLiveUsersIntoConversations = (conversations: Conversation[]) =>
    conversations.map((conversation) => {
      if (!conversation.otherUser) return conversation;
      const liveUser = usersListRef.current.find((user) => user.id === conversation.otherUser?.id);
      return liveUser ? { ...conversation, otherUser: { ...conversation.otherUser, ...liveUser } } : conversation;
    });

  const fetchConversations = async () => {
    try {
      const res = await api.get('/conversations');
      const merged = mergeLiveUsersIntoConversations(unwrapItems<Conversation>(res.data)).map((conversation) => {
        if (!conversation.otherUser) return conversation;
        const shouldHide = conversation.otherUser.isBlocked || conversation.otherUser.blockedByOther;
        return {
          ...conversation,
          otherUser: {
            ...conversation.otherUser,
            isOnline: shouldHide ? false : onlineUserIdsRef.current.has(conversation.otherUser.id)
          }
        };
      });
      setConversationList(merged);
    } catch {
      console.error('Sohbet listesi alınamadı');
    }
  };

  const startChat = async (targetUser: User) => {
    const liveUser = usersListRef.current.find((user) => user.id === targetUser.id);
    const chatUser = liveUser ? { ...targetUser, ...liveUser } : targetUser;
    setSelectedUser(chatUser);
    setHasMore(true);
    try {
      const res = await api.post('/conversations/direct', { targetUserId: chatUser.id });
      setActiveConversation({ ...res.data, otherUser: chatUser });
      const msgs = await api.get(`/conversations/${res.data.id}/messages`);
      autoScrollRef.current = true;
      setMessages(unwrapItems<Message>(msgs.data));

      if (currentUser) {
        await api.post(`/conversations/${res.data.id}/read`, { emitReceipt: currentUser.readReceiptsOn !== false });
        setUnreadCounts((prev) => ({ ...prev, [chatUser.id]: 0, [res.data.id]: 0 }));
      }
      if (socket) socket.emit('odaya_katil', res.data.id);
    } catch {
      alert('Kullanıcı silinmiş veya sohbet yüklenemedi.');
      setSelectedUser(null);
    }
  };

  const startGroupChat = async (group: Conversation) => {
    setSelectedUser(null);
    setHasMore(true);
    try {
      setActiveConversation(group);
      const msgs = await api.get(`/conversations/${group.id}/messages`);
      autoScrollRef.current = true;
      setMessages(unwrapItems<Message>(msgs.data));

      await api.post(`/conversations/${group.id}/read`, { emitReceipt: true });
      setUnreadCounts((prev) => ({ ...prev, [group.id]: 0 }));
      if (socket) socket.emit('odaya_katil', group.id);
    } catch {
      alert('Grup sohbeti yüklenemedi.');
    }
  };

  // Soket Canlı Mesaj ve Gösterge Dinleyicileri
  useEffect(() => {
    if (!socket) return;

    const handleYeniMesaj = (gelenMesaj: Message) => {
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      processedMessagesRef.current.add(gelenMesaj.id);
      void fetchConversations();

      const currentConv = activeConversationRef.current;
      if (currentConv && gelenMesaj.conversationId === currentConv.id) {
        setMessages((prev) => [...prev, gelenMesaj]);
        if (currentUserRef.current) {
          void api.post(`/conversations/${currentConv.id}/read`, {
            emitReceipt: currentConv.isGroup ? true : currentUserRef.current.readReceiptsOn !== false
          });
        }
      } else {
        setUnreadCounts((prev) => ({
          ...prev,
          [gelenMesaj.conversationId]: (prev[gelenMesaj.conversationId] || 0) + 1,
          ...(gelenMesaj.senderId ? { [gelenMesaj.senderId]: (prev[gelenMesaj.senderId] || 0) + 1 } : {})
        }));
      }
    };

    const handleTypingChanged = (payload: { conversationId: string; userId: string; username: string; isTyping: boolean }) => {
      if (!payload || !payload.conversationId || payload.userId === currentUserRef.current?.id) return;
      setTypingByConversation((prev) => {
        if (payload.isTyping) return { ...prev, [payload.conversationId]: payload.username };
        const next = { ...prev };
        delete next[payload.conversationId];
        return next;
      });
    };

    const handleVoiceRecordingChanged = (payload: { conversationId: string; userId: string; username: string; isRecording: boolean }) => {
      if (!payload || !payload.conversationId || payload.userId === currentUserRef.current?.id) return;
      setRecordingByConversation((prev) => {
        if (payload.isRecording) return { ...prev, [payload.conversationId]: payload.username };
        const next = { ...prev };
        delete next[payload.conversationId];
        return next;
      });
    };

    socket.on('yeni_mesaj_geldi', handleYeniMesaj);
    socket.on('typing_changed', handleTypingChanged);
    socket.on('voice_recording_changed', handleVoiceRecordingChanged);

    return () => {
      socket.off('yeni_mesaj_geldi', handleYeniMesaj);
      socket.off('typing_changed', handleTypingChanged);
      socket.off('voice_recording_changed', handleVoiceRecordingChanged);
    };
  }, [socket]);

  return {
    usersList,
    groupsList,
    conversationList,
    selectedUser,
    activeConversation,
    messages,
    newMessage,
    unreadCounts,
    hasMore,
    isLoadingMore,
    typingByConversation,
    recordingByConversation,
    autoScrollRef,
    setUsersList,
    setGroupsList,
    setConversationList,
    setSelectedUser,
    setActiveConversation,
    setMessages,
    setNewMessage,
    setUnreadCounts,
    setHasMore,
    setIsLoadingMore,
    fetchUsers,
    fetchGroups,
    fetchConversations,
    fetchUnreadCounts,
    startChat,
    startGroupChat
  };
}
