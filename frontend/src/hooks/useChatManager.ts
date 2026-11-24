/**
 * ============================================================================
 * SOHBET VE MESAJLAŞMA YÖNETİMİ HOOK'U (useChatManager)
 * ============================================================================
 * 
 * Bu hook; birebir ve grup sohbetlerini (`conversationList`, `groupsList`),
 * aktif sohbet durumunu (`activeConversation`), mesaj geçmişini (`messages`),
 * okunmamış mesaj rozetlerini (`unreadCounts`) ve canlı soket mesaj/yazıyor olaylarını yönetir.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, Message, User } from '../types/chat';
import { isReadOnlyGroup } from '../types/chat';
import type { TypedSocket } from '../types/socket';
import { api } from '../api/httpClient';
import { unwrapItems, type PaginatedResponse } from '../api/pagination';
import { clearLocalConversationHistory, deleteGroupHistory, deleteLocalHistoryMessage, isVaultUnlocked, readGroupHistory, saveGroupHistory } from '../crypto/vault';
import { cacheGroupAttachment } from '../crypto/fileCrypto';
import { receiveAccountHistoryCopies, type SyncedHistoryCopy } from '../crypto/accountHistory';
import { isPendingMessageDecryption, mergeMessage } from '../components/ChatArea/chatTimeline';
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

const visibleHistory = (messages: Message[]) => {
  const now = Date.now();
  return messages.filter((message) => !message.expiresAt || Date.parse(message.expiresAt) > now);
};

const isAfterHistoryCutoff = (message: Message | null | undefined, clearedAt: string) =>
  Boolean(message?.createdAt && Date.parse(message.createdAt) > Date.parse(clearedAt));

const withClearedHistory = (conversation: Conversation, clearedAt: string): Conversation => ({
  ...conversation,
  historyClearedAt: clearedAt,
  lastMessage: isAfterHistoryCutoff(conversation.lastMessage, clearedAt) ? conversation.lastMessage : null
});

const legacyGroupHistory = (
  archive: Awaited<ReturnType<typeof readGroupHistory>>,
  historySince: string | undefined,
  historyId: string | undefined
) => {
  if (!archive || !historySince || (archive.historyId && archive.historyId !== historyId)) return [];
  return visibleHistory(archive.messages).filter((message) => message.createdAt && Date.parse(message.createdAt) < Date.parse(historySince))
    .map((message) => ({ ...message, isLocalGroupHistory: true, fileUrl: undefined }));
};

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
  const [hasNewer, setHasNewer] = useState(false);
  const [messageFocus, setMessageFocus] = useState<{ conversationId: string; messageId: string } | null>(null);
  const hasNewerRef = useRef(false);
  const historyCutoffs = useRef(new Map<string, string>());
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  const [recordingByConversation, setRecordingByConversation] = useState<Record<string, string>>({});

  const activeConversationRef = useRef<Conversation | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const selectedUserRef = useRef<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const groupsListRef = useRef<Conversation[]>([]);
  const usersListRef = useRef<User[]>([]);
  const conversationListRef = useRef<Conversation[]>([]);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const autoScrollRef = useRef(true);
  const sessionGenerationRef = useRef(0);
  const chatSelectionRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const conversationListRequestRef = useRef(0);
  const appliedConversationListRequestRef = useRef(0);
  const groupHistorySyncRef = useRef(new Map<string, Promise<Message[] | undefined>>());
  const archiveAttemptsRef = useRef(new Set<string>());
  const archiveAbortRef = useRef(new AbortController());
  const forgottenConversationsRef = useRef(new Set<string>());
  const historyDeletionVersionRef = useRef(0);
  const deletedMessagesRef = useRef(new Set<string>());
  const historyCleanupRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
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
    chatSelectionRef.current += 1;
    groupHistorySyncRef.current.clear();
    archiveAttemptsRef.current.clear();
    forgottenConversationsRef.current.clear();
    historyCutoffs.current.clear();
    hasNewerRef.current = false;
    setHasNewer(false);
    setMessageFocus(null);
    deletedMessagesRef.current.clear();
    historyCleanupRef.current.clear();
    archiveAbortRef.current.abort();
    archiveAbortRef.current = new AbortController();
    activeConversationRef.current = null;
    messagesRef.current = [];
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

  const fetchUsers = useCallback(async () => {
    const sessionGeneration = sessionGenerationRef.current;
    const requestId = ++directoryRequestRef.current;
    try {
      const users: User[] = [];
      let cursor: string | null | undefined;
      do {
        const { data } = await api.get<PaginatedResponse<User> | User[]>('/users', {
          params: { cursor, limit: 100 }
        });
        if (sessionGeneration !== sessionGenerationRef.current || requestId !== directoryRequestRef.current) return;
        users.push(...unwrapItems(data));
        cursor = Array.isArray(data) ? null : data.nextCursor;
      } while (cursor);

      const enriched = users.map((user) => {
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
  }, [onlineUserIdsRef]);

  const fetchGroups = async () => {
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const res = await api.get('/conversations/groups');
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setGroupsList((res.data as Conversation[]).filter((group) => !forgottenConversationsRef.current.has(group.id)));
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

  const loadGroupHistory = async (userId: string, group: Conversation) => {
    await groupHistorySyncRef.current.get(group.id);
    const archive = await readGroupHistory(userId, group.id);
    if (!archive || archive.leftAt !== (group.leftAt ?? null)) return [];
    const clearedAt = historyCutoffs.current.get(group.id) ?? group.historyClearedAt;
    return visibleHistory(archive.messages).filter((message) =>
      !deletedMessagesRef.current.has(message.id) && (!clearedAt || isAfterHistoryCutoff(message, clearedAt))
    );
  };

  const syncGroupHistory = (userId: string, group: Conversation) => {
    const pending = groupHistorySyncRef.current.get(group.id);
    if (pending) return pending;
    const generation = sessionGenerationRef.current;
    const leftAt = group.leftAt ?? null;
    const attemptKey = `${group.id}:${leftAt}`;
    const signal = archiveAbortRef.current.signal;
    const sync = (async () => {
      if (!isVaultUnlocked(userId) || forgottenConversationsRef.current.has(group.id)) return;
      const existing = await readGroupHistory(userId, group.id);
      if (existing?.leftAt === leftAt && ((existing.attachmentsReady && !existing.messages.some(isPendingMessageDecryption)) ||
          archiveAttemptsRef.current.has(attemptKey))) return;

      const pages: Message[][] = [];
      let historySince: string | undefined;
      let historyId: string | undefined;
      let cursor: string | null = null;
      do {
        if (generation !== sessionGenerationRef.current || forgottenConversationsRef.current.has(group.id)) return;
        const { data }: { data: PaginatedResponse<Message> | Message[] } = await api.get(`/conversations/${group.id}/messages`, {
          params: { cursor: cursor ?? undefined }, signal
        });
        pages.push(unwrapItems(data));
        if (!Array.isArray(data)) {
          historySince ??= data.historySince;
          historyId ??= data.historyId;
        }
        cursor = Array.isArray(data) ? null : data.nextCursor ?? null;
      } while (cursor);

      if (generation !== sessionGenerationRef.current) return;
      const messages = pages.reverse().flat();
      const cutoff = leftAt ? Date.parse(leftAt) : Infinity;
      const eligible = messages.filter((message) => !deletedMessagesRef.current.has(message.id) && (
        !message.createdAt || Date.parse(message.createdAt) <= cutoff
      ));
      const decrypted = await decryptMessageList(userId, eligible, false);
      const history: Message[] = legacyGroupHistory(existing, historySince, historyId);
      const savedById = new Map(existing?.messages.map((message) => [message.id, message]));
      let attachmentsReady = true;
      for (const entry of decrypted) {
        if (signal.aborted || forgottenConversationsRef.current.has(group.id)) return;
        const saved = savedById.get(entry.id);
        const message = saved && entry.decryptionPending ? mergeMessage([saved], entry)[0] : entry;
        let archivedFileAvailable = Boolean(saved?.archivedFileAvailable && saved.fileKey === message.fileKey);
        if (isPendingMessageDecryption(message)) {
          attachmentsReady = false;
        } else if (message.fileKey && message.fileUrl) {
          try {
            await cacheGroupAttachment(userId, message, signal);
            archivedFileAvailable = true;
          } catch {
            attachmentsReady = false;
          }
        }
        history.push({ ...message, fileUrl: undefined, archivedFileAvailable });
      }
      if (generation === sessionGenerationRef.current && !forgottenConversationsRef.current.has(group.id)) {
        const retained = history.filter((message) => !deletedMessagesRef.current.has(message.id));
        await saveGroupHistory(userId, group.id, { leftAt, messages: retained, historyId, attachmentsReady });
        archiveAttemptsRef.current.add(attemptKey);
        return retained;
      }
    })().catch(() => {
      // Sohbet listesi tekrar yenilendiğinde eşitleme yeniden denenir.
      return undefined;
    }).finally(() => {
      if (groupHistorySyncRef.current.get(group.id) === sync) groupHistorySyncRef.current.delete(group.id);
    });
    groupHistorySyncRef.current.set(group.id, sync);
    return sync;
  };

  const queueHistoryCleanup = (conversationId: string, cleanup: () => Promise<void>) => {
    const queued = historyCleanupRef.current.get(conversationId) ?? Promise.resolve();
    const next = queued.catch(() => undefined).then(async () => {
      await groupHistorySyncRef.current.get(conversationId);
      await cleanup();
    }).finally(() => {
      if (historyCleanupRef.current.get(conversationId) === next) historyCleanupRef.current.delete(conversationId);
    });
    historyCleanupRef.current.set(conversationId, next);
    return next;
  };

  const clearGroupHistory = (userId: string, conversationId: string) => {
    if (forgottenConversationsRef.current.has(conversationId)) return historyCleanupRef.current.get(conversationId);
    forgottenConversationsRef.current.add(conversationId);
    historyDeletionVersionRef.current += 1;
    conversationListRef.current = conversationListRef.current.filter((conversation) => conversation.id !== conversationId);
    setConversationList((previous) => previous.filter((conversation) => conversation.id !== conversationId));
    setGroupsList((previous) => previous.filter((group) => group.id !== conversationId));
    if (activeConversationRef.current?.id === conversationId) {
      chatSelectionRef.current += 1;
      activeConversationRef.current = null;
      setActiveConversation(null);
      setMessages([]);
    }
    return queueHistoryCleanup(conversationId, () => deleteGroupHistory(userId, conversationId));
  };

  const applyPersonalHistoryClear = (userId: string, conversationId: string, clearedAt: string) => {
    const previous = historyCutoffs.current.get(conversationId);
    if (previous && previous >= clearedAt) return historyCleanupRef.current.get(conversationId) ?? Promise.resolve();
    historyCutoffs.current.set(conversationId, clearedAt);
    const update = (conversation: Conversation) => conversation.id === conversationId ? withClearedHistory(conversation, clearedAt) : conversation;
    conversationListRef.current = conversationListRef.current.map(update);
    setConversationList((list) => list.map(update));
    setUnreadCounts((counts) => ({ ...counts, [conversationId]: 0 }));
    if (activeConversationRef.current?.id === conversationId) {
      chatSelectionRef.current += 1;
      activeConversationRef.current = update(activeConversationRef.current);
      setActiveConversation(activeConversationRef.current);
      setMessages((list) => list.filter((message) => isAfterHistoryCutoff(message, clearedAt))
        .map((message) => message.replyTo?.createdAt && message.replyTo.createdAt <= clearedAt ? { ...message, replyTo: undefined } : message));
      hasNewerRef.current = false;
      setHasNewer(false);
      setMessageFocus(null);
      setHasMore(false);
      setIsLoadingMore(false);
    }
    return queueHistoryCleanup(conversationId, () => clearLocalConversationHistory(userId, conversationId, clearedAt));
  };

  const forgetHistoryMessage = (userId: string, conversationId: string, messageId: string) => {
    if (activeConversationRef.current?.id === conversationId) {
      setMessages((previous) => previous.filter((message) => message.id !== messageId)
        .map((message) => message.replyTo?.id === messageId ? { ...message, replyTo: undefined } : message));
    }
    deletedMessagesRef.current.add(messageId);
    return queueHistoryCleanup(conversationId, () => deleteLocalHistoryMessage(userId, conversationId, messageId));
  };

  const markGroupLeft = (groupId: string, leftAt: string) => {
    const markLeft = (group: Conversation): Conversation => ({ ...group, isActive: false, leftAt });
    setGroupsList((previous) => previous.filter((group) => group.id !== groupId));
    conversationListRef.current = conversationListRef.current.map((group) => group.id === groupId ? markLeft(group) : group);
    setConversationList((previous) => previous.map((group) => group.id === groupId ? markLeft(group) : group));
    const active = activeConversationRef.current;
    if (active?.id !== groupId) return;
    const formerGroup = markLeft(active);
    activeConversationRef.current = formerGroup;
    setActiveConversation(formerGroup);
    setMessages((previous) => previous.filter((message) => message.conversationId === groupId &&
      (!message.createdAt || Date.parse(message.createdAt) <= Date.parse(leftAt))
    ).map((message) => ({ ...message, fileUrl: undefined })));
    setHasMore(false);
    setIsLoadingMore(false);
  };

  const fetchConversations = async (userId = currentUserRef.current?.id || '') => {
    const sessionGeneration = sessionGenerationRef.current;
    const historyDeletionVersion = historyDeletionVersionRef.current;
    const requestId = ++conversationListRequestRef.current;
    const isCurrent = () => sessionGeneration === sessionGenerationRef.current &&
      historyDeletionVersion === historyDeletionVersionRef.current &&
      requestId >= appliedConversationListRequestRef.current;
    const applyKnownCutoff = (conversation: Conversation) => {
      const clearedAt = historyCutoffs.current.get(conversation.id);
      return clearedAt ? withClearedHistory(conversation, clearedAt) : conversation;
    };
    try {
      const res = await api.get('/conversations');
      if (!isCurrent()) return;
      const rawItems = mergeLiveUsersIntoConversations(unwrapItems<Conversation>(res.data));
      for (const conversation of rawItems) {
        if (userId && conversation.historyClearedAt) {
          void applyPersonalHistoryClear(userId, conversation.id, conversation.historyClearedAt).catch(() => undefined);
        }
      }
      const merged = await Promise.all(
        rawItems.map(async (item) => {
          const conversation = applyKnownCutoff(item);
          const { lastMessage } = conversation;
          const decryptedLastMessage =
            lastMessage && userId
              ? await decryptIncomingMessage(userId, lastMessage, !isReadOnlyGroup(conversation)).catch(() => lastMessage)
              : lastMessage;
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
      if (!isCurrent()) return;
      appliedConversationListRequestRef.current = requestId;
      for (const conversation of merged) {
        if (!isReadOnlyGroup(conversation)) forgottenConversationsRef.current.delete(conversation.id);
      }
      const conversations = merged.filter((conversation) => !forgottenConversationsRef.current.has(conversation.id)).map(applyKnownCutoff);
      conversationListRef.current = conversations;
      setConversationList(conversations);
      const historySyncs = userId ? conversations.filter(isReadOnlyGroup).map(async (group) => {
        await historyCleanupRef.current.get(group.id)?.catch(() => undefined);
        if (!isCurrent()) return;
        const history = await syncGroupHistory(userId, group);
        if (history && sessionGeneration === sessionGenerationRef.current) {
          const active = activeConversationRef.current;
          if (active?.id === group.id && isReadOnlyGroup(active) && (active.leftAt ?? null) === (group.leftAt ?? null)) {
            const clearedAt = historyCutoffs.current.get(group.id);
            setMessages(visibleHistory(history).filter((message) => !clearedAt || isAfterHistoryCutoff(message, clearedAt)));
          }
        }
      }) : [];
      void Promise.allSettled(historySyncs);
    } catch {
      console.error('Sohbet listesi alınamadı');
    }
  };

  const updateMessageWindow = (conversationId: string, targetId: string | undefined, data?: PaginatedResponse<Message> | Message[]) => {
    hasNewerRef.current = !Array.isArray(data) && Boolean(data?.hasNewer);
    setHasNewer(hasNewerRef.current);
    autoScrollRef.current = !targetId && !hasNewerRef.current;
    setMessageFocus(targetId ? { conversationId, messageId: targetId } : null);
  };

  const startChat = async (targetUser: User, targetId?: string) => {
    const sessionGeneration = sessionGenerationRef.current;
    const selection = ++chatSelectionRef.current;
    const isCurrent = () => sessionGeneration === sessionGenerationRef.current && selection === chatSelectionRef.current;
    const liveUser = usersListRef.current.find((user) => user.id === targetUser.id);
    const chatUser = liveUser ? { ...targetUser, ...liveUser } : targetUser;
    setSelectedUser(chatUser);
    setMessageFocus(null);
    setHasMore(true);
    setIsLoadingMore(false);
    try {
      const res = await api.post('/conversations/direct', { targetUserId: chatUser.id });
      if (!isCurrent()) return;
      activeConversationRef.current = { ...res.data, otherUser: chatUser };
      setActiveConversation({ ...res.data, otherUser: chatUser });
      const msgs = await api.get<PaginatedResponse<Message> | Message[]>(`/conversations/${res.data.id}/messages`,
        targetId ? { params: { anchor: targetId } } : undefined);
      if (!isCurrent()) return;
      const userId = currentUserRef.current?.id || '';
      if (!Array.isArray(msgs.data) && msgs.data.historyClearedAt && userId) {
        await clearLocalConversationHistory(userId, res.data.id, msgs.data.historyClearedAt).catch(() => undefined);
      }
      const decryptedMsgs = await decryptMessageList(
        userId,
        unwrapItems<Message>(msgs.data)
      );
      if (!isCurrent()) return;
      updateMessageWindow(res.data.id, targetId, msgs.data);
      setMessages(decryptedMsgs);
      setHasMore(Array.isArray(msgs.data) ? decryptedMsgs.length > 0 : Boolean(msgs.data.nextCursor));

      if (currentUser) {
        await api.post(`/conversations/${res.data.id}/read`, { emitReceipt: currentUser.readReceiptsOn !== false });
        if (!isCurrent()) return;
        setUnreadCounts((prev) => ({ ...prev, [chatUser.id]: 0, [res.data.id]: 0 }));
      }
      if (socket) socket.emit('odaya_katil', res.data.id);
    } catch {
      if (!isCurrent()) return;
      alert(targetId ? 'Mesaj bu sohbet geçmişinde bulunamadı.' : 'Kullanıcı silinmiş veya sohbet yüklenemedi.');
      setSelectedUser(null);
    }
  };

  const startGroupChat = async (group: Conversation, targetId?: string) => {
    if (forgottenConversationsRef.current.has(group.id)) return;
    group = conversationListRef.current.find((conversation) => conversation.id === group.id) ?? group;
    const sessionGeneration = sessionGenerationRef.current;
    const selection = ++chatSelectionRef.current;
    const isCurrent = () => sessionGeneration === sessionGenerationRef.current && selection === chatSelectionRef.current &&
      activeConversationRef.current?.id === group.id;
    const readOnly = isReadOnlyGroup(group);
    setSelectedUser(null);
    setMessageFocus(null);
    setHasMore(!readOnly);
    setIsLoadingMore(false);
    setMessages([]);
    activeConversationRef.current = group;
    setActiveConversation(group);
    try {
      if (readOnly) {
        const userId = currentUserRef.current?.id;
        const history = userId ? await loadGroupHistory(userId, group) : [];
        if (isCurrent() && isReadOnlyGroup(activeConversationRef.current)) {
          updateMessageWindow(group.id, targetId);
          setMessages(history);
        }
        return;
      }
      const { data } = await api.get<PaginatedResponse<Message> | Message[]>(`/conversations/${group.id}/messages`,
        targetId ? { params: { anchor: targetId } } : undefined);
      if (!isCurrent() || isReadOnlyGroup(activeConversationRef.current)) return;
      const userId = currentUserRef.current?.id || '';
      if (!Array.isArray(data) && data.historyClearedAt && userId) {
        await clearLocalConversationHistory(userId, group.id, data.historyClearedAt).catch(() => undefined);
      }
      const archive = userId ? await readGroupHistory(userId, group.id).catch(() => null) : null;
      const legacy = Array.isArray(data) ? [] : legacyGroupHistory(archive, data.historySince, data.historyId);
      const decryptedMsgs = await decryptMessageList(userId, unwrapItems(data));
      if (!isCurrent() || isReadOnlyGroup(activeConversationRef.current)) return;
      updateMessageWindow(group.id, targetId, data);
      setMessages([...legacy, ...decryptedMsgs].filter((message) => !deletedMessagesRef.current.has(message.id)));
      setHasMore(Array.isArray(data) ? decryptedMsgs.length > 0 : Boolean(data.nextCursor));

      const lastVisibleMessage = decryptedMsgs.findLast((message) => !message.isPriorMembershipMessage &&
        !isPendingMessageDecryption(message) && !deletedMessagesRef.current.has(message.id));
      if (lastVisibleMessage) {
        void api.post(`/conversations/${group.id}/read`, { lastReadMessageId: lastVisibleMessage.id }).then(() => {
          if (sessionGeneration === sessionGenerationRef.current) setUnreadCounts((prev) => ({ ...prev, [group.id]: 0 }));
        }).catch(() => undefined);
      }
      if (socket) socket.emit('odaya_katil', group.id);
    } catch {
      if (!isCurrent()) return;
      alert(targetId ? 'Mesaj bu grup geçmişinde bulunamadı.' : 'Grup sohbeti yüklenemedi.');
    }
  };

  const focusConversationMessage = (messageId?: string) => {
    const conversation = activeConversationRef.current;
    if (!conversation) return;
    if (messageId && messagesRef.current.some((message) => message.id === messageId && !isPendingMessageDecryption(message))) {
      autoScrollRef.current = false;
      setMessageFocus({ conversationId: conversation.id, messageId });
      return;
    }
    if (conversation.isGroup) void startGroupChat(conversation, messageId);
    else if (conversation.otherUser) void startChat(conversation.otherUser, messageId);
  };

  const retryPendingHistory = async (conversationId: string) => {
    const userId = currentUserRef.current?.id;
    const generation = sessionGenerationRef.current;
    const conversation = activeConversationRef.current;
    if (!userId || conversation?.id !== conversationId || isReadOnlyGroup(conversation)) return;
    const pending = messagesRef.current.filter((message) => message.conversationId === conversationId && isPendingMessageDecryption(message));
    if (!pending.length) return;
    const hydrated = await decryptMessageList(userId, pending);
    if (generation === sessionGenerationRef.current && activeConversationRef.current?.id === conversationId &&
        !isReadOnlyGroup(activeConversationRef.current)) {
      setMessages((previous) => hydrated.reduce((next, message) => next.some((item) => item.id === message.id && item.ciphertext === message.ciphertext)
        ? mergeMessage(next, message) : next, previous));
    }
  };

  useEffect(() => {
    const refreshUnlockedMessages = async () => {
      const user = currentUserRef.current;
      if (!user) return;
      const generation = sessionGenerationRef.current;
      const conversation = activeConversationRef.current;
      archiveAttemptsRef.current.clear();
      void fetchConversations();
      if (!conversation || isReadOnlyGroup(conversation)) return;
      const conversationId = conversation.id;
      try {
        await retryPendingHistory(conversationId);
        const { data } = await api.get('/conversations/' + conversationId + '/messages');
        const hydrated = await decryptMessageList(user.id, unwrapItems<Message>(data));
        if (generation === sessionGenerationRef.current && activeConversationRef.current?.id === conversationId &&
            !isReadOnlyGroup(activeConversationRef.current)) {
          setMessages((previous) => hydrated.filter((message) => !deletedMessagesRef.current.has(message.id)).reduce(mergeMessage, previous));
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
    let conversationRefresh: ReturnType<typeof setTimeout> | undefined;

    const handleYeniMesaj = async (gelenMesaj: Message) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      const cutoff = historyCutoffs.current.get(gelenMesaj.conversationId);
      if (cutoff && (!gelenMesaj.createdAt || gelenMesaj.createdAt <= cutoff)) return;
      if (forgottenConversationsRef.current.has(gelenMesaj.conversationId) || deletedMessagesRef.current.has(gelenMesaj.id)) return;
      if (conversationListRef.current.some((conversation) => conversation.id === gelenMesaj.conversationId && isReadOnlyGroup(conversation))) return;
      processedMessagesRef.current.add(gelenMesaj.id);
      const hydrated = currentUserRef.current
        ? await decryptIncomingMessage(currentUserRef.current.id, gelenMesaj)
        : gelenMesaj;
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const latestCutoff = historyCutoffs.current.get(gelenMesaj.conversationId);
      if (latestCutoff && (!gelenMesaj.createdAt || gelenMesaj.createdAt <= latestCutoff)) return;
      if (forgottenConversationsRef.current.has(gelenMesaj.conversationId) || deletedMessagesRef.current.has(gelenMesaj.id)) return;
      if (!conversationRefresh) {
        conversationRefresh = setTimeout(() => {
          conversationRefresh = undefined;
          if (sessionGeneration === sessionGenerationRef.current) void fetchConversations();
        }, 400);
      }

      const currentConv = activeConversationRef.current;
      if (currentConv && hydrated.conversationId === currentConv.id) {
        if (isReadOnlyGroup(currentConv)) return;
        if (!hasNewerRef.current) setMessages((prev) => mergeMessage(prev, hydrated));
        if (currentConv.isGroup) {
          if (hydrated.senderId !== currentUserRef.current?.id && !isPendingMessageDecryption(hydrated)) {
            void api.post(`/conversations/${currentConv.id}/read`, { lastReadMessageId: hydrated.id }).catch(() => undefined);
          }
        } else if (currentUserRef.current && hydrated.senderId !== currentUserRef.current.id && !isPendingMessageDecryption(hydrated)) {
          void api.post(`/conversations/${currentConv.id}/read`, {
            emitReceipt: currentUserRef.current.readReceiptsOn !== false
          }).catch(() => undefined);
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

    const handleMessagesRead = (payload: { conversationId: string; readByUserId: string; readThroughAt: string }) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (activeConversationRef.current?.id !== payload.conversationId) return;
      const readThroughAt = Date.parse(payload.readThroughAt);
      setMessages((previous) => previous.map((message) => {
        if (message.conversationId !== payload.conversationId || !message.createdAt || !(Date.parse(message.createdAt) <= readThroughAt)) return message;
        if (message.senderId === payload.readByUserId || message.readByIds?.includes(payload.readByUserId)) return message;
        return { ...message, readByIds: [...(message.readByIds || []), payload.readByUserId] };
      }));
    };

    const handleMessageUpdated = async (updatedMessage: Message) => {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (forgottenConversationsRef.current.has(updatedMessage.conversationId) || deletedMessagesRef.current.has(updatedMessage.id)) return;
      const hydrated = currentUserRef.current
        ? await decryptIncomingMessage(currentUserRef.current.id, updatedMessage)
        : updatedMessage;
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (forgottenConversationsRef.current.has(updatedMessage.conversationId) || deletedMessagesRef.current.has(updatedMessage.id)) return;
      if (activeConversationRef.current?.id === hydrated.conversationId && !isReadOnlyGroup(activeConversationRef.current)) {
        setMessages((previous) => previous.some((message) => message.id === hydrated.id) ? mergeMessage(previous, hydrated) : previous);
      }
      void fetchConversations();
    };

    const handleMessageDeleted = (payload: { messageId: string; conversationId: string }) => {
      const userId = currentUserRef.current?.id;
      if (sessionGeneration !== sessionGenerationRef.current || !userId) return;
      void forgetHistoryMessage(userId, payload.conversationId, payload.messageId).catch(() => undefined);
      void fetchConversations();
    };

    const handleHistoryDeleted = ({ conversationId }: { conversationId: string }) => {
      const userId = currentUserRef.current?.id;
      if (sessionGeneration === sessionGenerationRef.current && userId) {
        void clearGroupHistory(userId, conversationId)?.catch(() => undefined);
      }
    };

    const handleAccountHistorySynced = (copies: SyncedHistoryCopy[]) => {
      const userId = currentUserRef.current?.id;
      if (sessionGeneration !== sessionGenerationRef.current || !userId) return;
      receiveAccountHistoryCopies(userId, copies);
      const conversation = activeConversationRef.current;
      const ids = new Set(copies.map((copy) => copy.messageId));
      if (!conversation || !messagesRef.current.some((message) => ids.has(message.id) && isPendingMessageDecryption(message))) return;
      if (isReadOnlyGroup(conversation)) {
        archiveAttemptsRef.current.delete(`${conversation.id}:${conversation.leftAt ?? null}`);
        void fetchConversations();
      } else {
        void retryPendingHistory(conversation.id).catch(() => undefined);
      }
    };

    const handlePersonalHistoryClear = ({ conversationId, clearedAt }: { conversationId: string; clearedAt: string }) => {
      const userId = currentUserRef.current?.id;
      if (userId && sessionGeneration === sessionGenerationRef.current) {
        void applyPersonalHistoryClear(userId, conversationId, clearedAt).catch(() => undefined);
      }
    };

    const handleAccountHistoryRepaired = async ({ messageId, conversationId, historyDelivery }: {
      messageId: string; conversationId: string; historyDelivery: NonNullable<Message['historyDelivery']>;
    }) => {
      const userId = currentUserRef.current?.id;
      const conversation = activeConversationRef.current;
      if (!userId || sessionGeneration !== sessionGenerationRef.current || conversation?.id !== conversationId) return;
      const pending = messagesRef.current.find((message) => message.id === messageId && isPendingMessageDecryption(message));
      if (!pending) return;
      if (isReadOnlyGroup(conversation)) {
        archiveAttemptsRef.current.delete(`${conversation.id}:${conversation.leftAt ?? null}`);
        void fetchConversations();
        return;
      }
      const opened = await decryptIncomingMessage(userId, { ...pending, historyDelivery });
      if (opened.decryptionPending || sessionGeneration !== sessionGenerationRef.current || activeConversationRef.current?.id !== conversationId) return;
      setMessages((previous) => previous.some((message) => message.id === messageId && message.ciphertext === pending.ciphertext)
        ? mergeMessage(previous, opened) : previous);
    };

    const handleGroupCreated = (group: Conversation) => {
      if (sessionGeneration !== sessionGenerationRef.current || !group?.id) return;
      forgottenConversationsRef.current.delete(group.id);
      setGroupsList((previous) => (
        previous.some((item) => item.id === group.id) ? previous : [group, ...previous]
      ));
      const activateGroup = (previous: Conversation[]) => previous.some((item) => item.id === group.id)
        ? previous.map((item) => item.id === group.id ? { ...item, ...group } : item)
        : [group, ...previous];
      conversationListRef.current = activateGroup(conversationListRef.current);
      setConversationList(activateGroup);
      if (activeConversationRef.current?.id === group.id && isReadOnlyGroup(activeConversationRef.current)) {
        void startGroupChat(group);
      }
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
      void handleIncomingWelcome(currentUserRef.current.id, payload).then((state) => {
        if (state && sessionGeneration === sessionGenerationRef.current) return retryPendingHistory(payload.conversationId);
      }).catch(() => undefined);
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
      void handleIncomingCommit(currentUserRef.current.id, payload).then((state) => {
        if (state && sessionGeneration === sessionGenerationRef.current) return retryPendingHistory(payload.conversationId);
      }).catch(() => undefined);
    };

    const handleMlsKeyPackageLow = () => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      void replenishKeyPackages(currentUserRef.current.id, 15);
    };

    const handleMemberRemovedFromGroup = async (payload: {
      groupId: string;
      removedUserId: string;
      removedById?: string;
      leftAt: string;
    }) => {
      if (sessionGeneration !== sessionGenerationRef.current || !currentUserRef.current) return;
      const myUserId = currentUserRef.current.id;
      if (payload.removedUserId === myUserId) {
        markGroupLeft(payload.groupId, payload.leftAt);
        void fetchConversations();
        return;
      }
      if (activeConversationRef.current?.id === payload.groupId) {
        setMessages((previous) => previous.map((message) => message.groupRecipientIds?.includes(payload.removedUserId) ? {
          ...message, groupRecipientIds: message.groupRecipientIds.filter((id) => id !== payload.removedUserId)
        } : message));
      }

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

    const refreshDirectory = () => {
      if (sessionGeneration === sessionGenerationRef.current) void fetchUsers();
    };
    const syncPersonalHistoryCutoffs = () => {
      const userId = currentUserRef.current?.id;
      if (!userId) return;
      void api.get<Array<{ conversationId: string; clearedAt: string }>>('/conversations/history-cutoffs').then(({ data }) => {
        if (sessionGeneration !== sessionGenerationRef.current) return;
        return Promise.allSettled(data.map(({ conversationId, clearedAt }) => applyPersonalHistoryClear(userId, conversationId, clearedAt)));
      }).catch(() => undefined);
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

    socket.on('connect', refreshDirectory);
    socket.on('connect', syncPersonalHistoryCutoffs);
    socket.on('user_directory_changed', refreshDirectory);
    if (socket.connected) {
      refreshDirectory();
      syncPersonalHistoryCutoffs();
    }
    socket.on('yeni_mesaj_geldi', handleYeniMesaj);
    socket.on('grup_olusturuldu', handleGroupCreated);
    socket.on('gruptan_atildi', handleMemberRemovedFromGroup);
    socket.on('mesajlar_okundu', handleMessagesRead);
    socket.on('mesaj_guncellendi', handleMessageUpdated);
    socket.on('mesaj_silindi', handleMessageDeleted);
    socket.on('sohbet_gecmisi_silindi', handleHistoryDeleted);
    socket.on('sohbet_gecmisi_temizlendi', handlePersonalHistoryClear);
    socket.on('account_history_synced', handleAccountHistorySynced);
    socket.on('account_history_repaired', handleAccountHistoryRepaired);
    socket.on('typing_changed', handleTypingChanged);
    socket.on('voice_recording_changed', handleVoiceRecordingChanged);
    socket.on('mls:welcome', handleMlsWelcome);
    socket.on('mls:commit', handleMlsCommit);
    socket.on('mls:key_package_low', handleMlsKeyPackageLow);
    socket.on('mls:device_revoked', handleMlsDeviceChange);
    socket.on('mls:device_approved', handleMlsDeviceChange);

    return () => {
      if (conversationRefresh) clearTimeout(conversationRefresh);
      socket.off('connect', refreshDirectory);
      socket.off('connect', syncPersonalHistoryCutoffs);
      socket.off('user_directory_changed', refreshDirectory);
      socket.off('yeni_mesaj_geldi', handleYeniMesaj);
      socket.off('grup_olusturuldu', handleGroupCreated);
      socket.off('gruptan_atildi', handleMemberRemovedFromGroup);
      socket.off('mesajlar_okundu', handleMessagesRead);
      socket.off('mesaj_guncellendi', handleMessageUpdated);
      socket.off('mesaj_silindi', handleMessageDeleted);
      socket.off('sohbet_gecmisi_silindi', handleHistoryDeleted);
      socket.off('sohbet_gecmisi_temizlendi', handlePersonalHistoryClear);
      socket.off('account_history_synced', handleAccountHistorySynced);
      socket.off('account_history_repaired', handleAccountHistoryRepaired);
      socket.off('typing_changed', handleTypingChanged);
      socket.off('voice_recording_changed', handleVoiceRecordingChanged);
      socket.off('mls:welcome', handleMlsWelcome);
      socket.off('mls:commit', handleMlsCommit);
      socket.off('mls:key_package_low', handleMlsKeyPackageLow);
      socket.off('mls:device_revoked', handleMlsDeviceChange);
      socket.off('mls:device_approved', handleMlsDeviceChange);
    };
  }, [socket, fetchUsers]);

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
    clearGroupHistory,
    applyPersonalHistoryClear,
    messageFocus,
    focusConversationMessage,
    hasNewer,
    forgetHistoryMessage,
    markGroupLeft,
    startChat,
    startGroupChat
  };
}
