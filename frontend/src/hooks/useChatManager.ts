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
import { mergeMessage } from '../components/ChatArea/chatTimeline';
import {
  decryptIncomingMessage,
  decryptMessageList,
  ensureDeviceRegistered,
  handleIncomingCommit,
  handleIncomingWelcome,
  replenishKeyPackages,
  rotateConversationEpoch
} from '../crypto/mlsClient';

interface UseChatManagerOptions {
  socket: TypedSocket | null;
  currentUser: User | null;
  onlineUserIds: Set<string>;
  onlineUserIdsRef: React.MutableRefObject<Set<string>>;
}

export function useChatManager({
  socket,
  currentUser,
  onlineUserIds,
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
  const sessionGenerationRef = useRef(0);

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => {
    currentUserRef.current = currentUser;
    if (currentUser?.id) {
      void ensureDeviceRegistered(currentUser.id);
    }
  }, [currentUser]);
  useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
  useEffect(() => { usersListRef.current = usersList; }, [usersList]);
  useEffect(() => { conversationListRef.current = conversationList; }, [conversationList]);

  useEffect(() => {
    if (groupsList.length === 0) return;
    setConversationList((previous) => {
      const knownIds = new Set(previous.map((conversation) => conversation.id));
      const missingGroups = groupsList.filter((group) => !knownIds.has(group.id));
      return missingGroups.length > 0 ? [...missingGroups, ...previous] : previous;
    });
  }, [groupsList]);

  const resetChatSession = () => {
    sessionGenerationRef.current += 1;
    activeConversationRef.current = null;
    selectedUserRef.current = null;
    currentUserRef.current = null;
    groupsListRef.current = [];
    usersListRef.current = [];
    conversationListRef.current = [];
    processedMessagesRef.current.clear();
    autoScrollRef.current = true;

    setUsersList([]);
    setGroupsList([]);
    setConversationList([]);
    setSelectedUser(null);
    setActiveConversation(null);
    setMessages([]);
    setNewMessage('');
    setUnreadCounts({});
    setHasMore(true);
    setIsLoadingMore(false);
    setTypingByConversation({});
    setRecordingByConversation({});
  };

  useEffect(() => {
    const applyPresence = (user: User) => ({
      ...user,
      isOnline: user.isBlocked || user.blockedByOther ? false : onlineUserIds.has(user.id)
    });

    setUsersList((previous) => previous.map(applyPresence));
    setSelectedUser((previous) => previous ? applyPresence(previous) : null);
    setConversationList((previous) => previous.map((conversation) => (
      conversation.otherUser
        ? { ...conversation, otherUser: applyPresence(conversation.otherUser) }
        : conversation
    )));
    setActiveConversation((previous) => (
      previous?.otherUser
        ? { ...previous, otherUser: applyPresence(previous.otherUser) }
        : previous
    ));
  }, [onlineUserIds]);

  const fetchUsers = async () => {
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const res = await api.get('/users');
      if (sessionGeneration !== sessionGenerationRef.current) return;
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
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const res = await api.get('/conversations/groups');
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setGroupsList(res.data);
    } catch {
      console.error('Gruplar çekilemedi');
    }
  };

  const fetchUnreadCounts = async () => {
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const res = await api.get('/unread-counts');
      if (sessionGeneration !== sessionGenerationRef.current) return;
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

  const fetchConversations = async (userId = currentUserRef.current?.id || '') => {
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const res = await api.get('/conversations');
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const rawItems = mergeLiveUsersIntoConversations(unwrapItems<Conversation>(res.data));
      const merged = await Promise.all(
        rawItems.map(async (conversation) => {
          const decryptedLastMessage =
            conversation.lastMessage && userId
              ? await decryptIncomingMessage(userId, conversation.lastMessage)
              : conversation.lastMessage;
          if (!conversation.otherUser) {
            return { ...conversation, lastMessage: decryptedLastMessage };
          }
          const shouldHide = conversation.otherUser.isBlocked || conversation.otherUser.blockedByOther;
          return {
            ...conversation,
            lastMessage: decryptedLastMessage,
            otherUser: {
              ...conversation.otherUser,
              isOnline: shouldHide ? false : onlineUserIdsRef.current.has(conversation.otherUser.id)
            }
          };
        })
      );
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setConversationList(merged);
    } catch {
      console.error('Sohbet listesi alınamadı');
    }
  };

  const startChat = async (targetUser: User) => {
    const sessionGeneration = sessionGenerationRef.current;
    const liveUser = usersListRef.current.find((user) => user.id === targetUser.id);
    const chatUser = liveUser ? { ...targetUser, ...liveUser } : targetUser;
    setSelectedUser(chatUser);
    setHasMore(true);
    try {
      const res = await api.post('/conversations/direct', { targetUserId: chatUser.id });
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setActiveConversation({ ...res.data, otherUser: chatUser });
      const msgs = await api.get(`/conversations/${res.data.id}/messages`);
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const decryptedMsgs = await decryptMessageList(
        currentUserRef.current?.id || '',
        unwrapItems<Message>(msgs.data)
      );
      if (sessionGeneration !== sessionGenerationRef.current) return;
      autoScrollRef.current = true;
      setMessages(decryptedMsgs);

      if (currentUser) {
        await api.post(`/conversations/${res.data.id}/read`, { emitReceipt: currentUser.readReceiptsOn !== false });
        setUnreadCounts((prev) => ({ ...prev, [chatUser.id]: 0, [res.data.id]: 0 }));
      }
      if (socket) socket.emit('odaya_katil', res.data.id);
    } catch {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      alert('Kullanıcı silinmiş veya sohbet yüklenemedi.');
      setSelectedUser(null);
    }
  };

  const startGroupChat = async (group: Conversation) => {
    const sessionGeneration = sessionGenerationRef.current;
    setSelectedUser(null);
    setHasMore(true);
    try {
      setActiveConversation(group);
      const msgs = await api.get(`/conversations/${group.id}/messages`);
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const decryptedMsgs = await decryptMessageList(
        currentUserRef.current?.id || '',
        unwrapItems<Message>(msgs.data)
      );
      if (sessionGeneration !== sessionGenerationRef.current) return;
      autoScrollRef.current = true;
      setMessages(decryptedMsgs);

      await api.post(`/conversations/${group.id}/read`, { emitReceipt: true });
      setUnreadCounts((prev) => ({ ...prev, [group.id]: 0 }));
      if (socket) socket.emit('odaya_katil', group.id);
    } catch {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      alert('Grup sohbeti yüklenemedi.');
    }
  };

  useEffect(() => {
    const refreshUnlockedMessages = async () => {
      const user = currentUserRef.current;
      if (!user) return;
      const generation = sessionGenerationRef.current;
      const conversationId = activeConversationRef.current?.id;
      void fetchConversations();
      if (!conversationId) return;
      try {
        const { data } = await api.get('/conversations/' + conversationId + '/messages');
        const hydrated = await decryptMessageList(user.id, unwrapItems<Message>(data));
        if (generation === sessionGenerationRef.current && activeConversationRef.current?.id === conversationId) {
          setMessages((previous) => hydrated.reduce(mergeMessage, previous));
        }
      } catch {
        // The next conversation refresh can retry the read.
      }
    };
    const listener = () => void refreshUnlockedMessages();
    window.addEventListener('message-vault-unlocked', listener);
    return () => window.removeEventListener('message-vault-unlocked', listener);
  }, []);

  // Soket Canlı Mesaj ve Gösterge Dinleyicileri
  useEffect(() => {
    if (!socket) return;
    const sessionGeneration = sessionGenerationRef.current;

    const handleYeniMesaj = async (gelenMesaj: Message) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      processedMessagesRef.current.add(gelenMesaj.id);
      const hydrated = currentUserRef.current
        ? await decryptIncomingMessage(currentUserRef.current.id, gelenMesaj)
        : gelenMesaj;
      if (sessionGeneration !== sessionGenerationRef.current) return;
      void fetchConversations();

      const currentConv = activeConversationRef.current;
      if (currentConv && hydrated.conversationId === currentConv.id) {
        setMessages((prev) => mergeMessage(prev, hydrated));
        if (currentUserRef.current) {
          void api.post(`/conversations/${currentConv.id}/read`, {
            emitReceipt: currentConv.isGroup ? true : currentUserRef.current.readReceiptsOn !== false
          });
        }
      } else {
        setUnreadCounts((prev) => ({
          ...prev,
          [hydrated.conversationId]: (prev[hydrated.conversationId] || 0) + 1,
          ...(hydrated.senderId ? { [hydrated.senderId]: (prev[hydrated.senderId] || 0) + 1 } : {})
        }));
      }
    };

    const handleTypingChanged = (payload: { conversationId: string; userId: string; username: string; isTyping: boolean }) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (!payload || !payload.conversationId || payload.userId === currentUserRef.current?.id) return;
      setTypingByConversation((prev) => {
        if (payload.isTyping) return { ...prev, [payload.conversationId]: payload.username };
        const next = { ...prev };
        delete next[payload.conversationId];
        return next;
      });
    };

    const handleVoiceRecordingChanged = (payload: { conversationId: string; userId: string; username: string; isRecording: boolean }) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (!payload || !payload.conversationId || payload.userId === currentUserRef.current?.id) return;
      setRecordingByConversation((prev) => {
        if (payload.isRecording) return { ...prev, [payload.conversationId]: payload.username };
        const next = { ...prev };
        delete next[payload.conversationId];
        return next;
      });
    };

    const handleMessagesRead = (payload: { conversationId: string; readByUserId: string }) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (activeConversationRef.current?.id !== payload.conversationId) return;
      setMessages((previous) => previous.map((message) => {
        if (message.senderId === payload.readByUserId || message.readByIds?.includes(payload.readByUserId)) return message;
        return { ...message, readByIds: [...(message.readByIds || []), payload.readByUserId] };
      }));
    };

    const handleMessageUpdated = async (updatedMessage: Message) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const hydrated = currentUserRef.current
        ? await decryptIncomingMessage(currentUserRef.current.id, updatedMessage)
        : updatedMessage;
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (activeConversationRef.current?.id === hydrated.conversationId) {
        setMessages((previous) => previous.map((message) => (
          message.id === hydrated.id ? { ...message, ...hydrated } : message
        )));
      }
      void fetchConversations();
    };

    const handleMessageDeleted = (payload: { messageId: string; conversationId: string }) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (activeConversationRef.current?.id === payload.conversationId) {
        setMessages((previous) => previous.filter((message) => message.id !== payload.messageId));
      }
      void fetchConversations();
    };

    const handleGroupCreated = (group: Conversation) => {
      if (sessionGeneration !== sessionGenerationRef.current || !group?.id) return;
      setGroupsList((previous) => (
        previous.some((item) => item.id === group.id) ? previous : [group, ...previous]
      ));
      setConversationList((previous) => (
        previous.some((item) => item.id === group.id) ? previous : [group, ...previous]
      ));
      void fetchConversations();
    };

    const handleMlsWelcome = (payload: {
      conversationId: string;
      epoch: number;
      recipientDeviceId: string;
      welcomeData: string;
      ratchetTree?: string | null;
    }) => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      void handleIncomingWelcome(currentUserRef.current.id, payload);
    };

    const handleMlsCommit = (payload: {
      id: string;
      conversationId: string;
      epoch: number;
      senderDeviceId: string;
      commitData: string;
      ratchetTree?: string | null;
    }) => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      void handleIncomingCommit(currentUserRef.current.id, payload);
    };

    const handleMlsKeyPackageLow = () => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      void replenishKeyPackages(currentUserRef.current.id, 15);
    };

    const handleMemberRemovedFromGroup = async (payload: {
      groupId: string;
      removedUserId: string;
      removedById?: string;
    }) => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      const myUserId = currentUserRef.current.id;
      if (payload.removedUserId === myUserId) return;

      // Bir üye kendi ayrıldığında (veya çıkarıldığında) grupta kalan aktif üyelerden
      // koordinatör olan (grup yöneticisi veya alfabetik ilk aktif üye) yeni MLS epoch oluşturur.
      try {
        const res = await api.get<User[]>(`/conversations/group/${payload.groupId}/participants`);
        const activeIds = (res.data || [])
          .filter((u) => u.isActive !== false && u.id !== payload.removedUserId)
          .map((u) => u.id)
          .sort();
        if (!activeIds.includes(myUserId)) return;

        const targetGroup =
          groupsListRef.current.find((g) => g.id === payload.groupId) ||
          conversationListRef.current.find((c) => c.id === payload.groupId);
        const shouldCoordinate =
          targetGroup?.adminId === myUserId || activeIds[0] === myUserId;

        if (shouldCoordinate) {
          await rotateConversationEpoch(myUserId, payload.groupId, activeIds);
        }
      } catch {
        // Sessizce geç
      }
    };

    const handleMlsDeviceChange = async (payload: {
      userId: string;
      deviceId: string;
      conversationIds?: string[];
    }) => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      const myUserId = currentUserRef.current.id;

      // H5b: Yalnızca açık olan sohbeti değil, iptal edilen cihazın dahil olduğu tüm aktif sohbetleri yenile
      const targetConvIds = new Set<string>(payload.conversationIds || []);
      if (activeConversationRef.current?.id) {
        targetConvIds.add(activeConversationRef.current.id);
      }
      if (payload.userId === myUserId) {
        for (const c of conversationListRef.current) {
          if (c.isActive !== false && !c.isDeleted) targetConvIds.add(c.id);
        }
      }

      for (const convId of targetConvIds) {
        const conv =
          (activeConversationRef.current?.id === convId ? activeConversationRef.current : null) ||
          conversationListRef.current.find((c) => c.id === convId) ||
          groupsListRef.current.find((g) => g.id === convId);
        if (!conv || conv.isActive === false || conv.isDeleted) continue;

        try {
          if (conv.isGroup) {
            const res = await api.get<User[]>(`/conversations/group/${conv.id}/participants`);
            const activeIds = (res.data || [])
              .filter((u) => u.isActive !== false)
              .map((u) => u.id)
              .sort();
            const shouldCoordinate =
              payload.userId === myUserId ||
              conv.adminId === myUserId ||
              activeIds[0] === myUserId;
            if (shouldCoordinate) {
              await rotateConversationEpoch(myUserId, conv.id, activeIds);
            }
          } else {
            const partnerId = conv.otherUser?.id || selectedUserRef.current?.id;
            const ids = [myUserId, partnerId].filter((id): id is string => Boolean(id));
            await rotateConversationEpoch(myUserId, conv.id, ids);
          }
        } catch {
          // Sessizce geç
        }
      }
    };

    socket.on('yeni_mesaj_geldi', handleYeniMesaj);
    socket.on('grup_olusturuldu', handleGroupCreated);
    socket.on('gruptan_atildi', handleMemberRemovedFromGroup);
    socket.on('mesajlar_okundu', handleMessagesRead);
    socket.on('mesaj_guncellendi', handleMessageUpdated);
    socket.on('mesaj_silindi', handleMessageDeleted);
    socket.on('typing_changed', handleTypingChanged);
    socket.on('voice_recording_changed', handleVoiceRecordingChanged);
    socket.on('mls:welcome', handleMlsWelcome);
    socket.on('mls:commit', handleMlsCommit);
    socket.on('mls:key_package_low', handleMlsKeyPackageLow);
    socket.on('mls:device_revoked', handleMlsDeviceChange);
    socket.on('mls:device_approved', handleMlsDeviceChange);

    return () => {
      socket.off('yeni_mesaj_geldi', handleYeniMesaj);
      socket.off('grup_olusturuldu', handleGroupCreated);
      socket.off('gruptan_atildi', handleMemberRemovedFromGroup);
      socket.off('mesajlar_okundu', handleMessagesRead);
      socket.off('mesaj_guncellendi', handleMessageUpdated);
      socket.off('mesaj_silindi', handleMessageDeleted);
      socket.off('typing_changed', handleTypingChanged);
      socket.off('voice_recording_changed', handleVoiceRecordingChanged);
      socket.off('mls:welcome', handleMlsWelcome);
      socket.off('mls:commit', handleMlsCommit);
      socket.off('mls:key_package_low', handleMlsKeyPackageLow);
      socket.off('mls:device_revoked', handleMlsDeviceChange);
      socket.off('mls:device_approved', handleMlsDeviceChange);
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
    resetChatSession,
    startChat,
    startGroupChat
  };
}
