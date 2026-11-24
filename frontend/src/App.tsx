/**
 * ============================================================================
 * ANA UYGULAMA BİLEŞENİ (App.tsx - Modüler Orkestratör)
 * ============================================================================
 * 
 * Bu bileşen; uygulamanın görünüm durumlarını (Auth / Chat), modalları
 * ve alt bileşenleri (Sidebar, ChatArea, CallModal) birleştiren
 * modüler bir orkestratördür.
 * 
 * İş mantığı 3 ana Custom Hook'a devredilmiştir:
 * 1. `useSocketSession`: WebSocket bağlantısı, aktivite heartbeat ve canlı varlık durumu.
 * 2. `useCallManager`: WebRTC (LiveKit) sesli ve görüntülü aramalar, gelen çağrılar ve arama geçmişi.
 * 3. `useChatManager`: Sohbet listeleri, aktif sohbet, mesajlaşma akışı ve göstergeler.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import './App.css';

// Ekranlar ve Alt Bileşenler
import Auth from './components/Auth/Auth';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import IncomingCallPrompt from './components/Call/IncomingCallPrompt';
import CreateGroupModal from './components/Modals/CreateGroupModal';
import GroupSettingsModal from './components/Modals/GroupSettingsModal';
import SettingsModal from './components/Modals/SettingsModal';
import SecurityVaultModal from './components/Modals/SecurityVaultModal';
import AccountVaultGate from './components/Auth/AccountVaultGate';
import AvatarViewerModal from './components/Modals/AvatarViewerModal';
import { api } from './api/httpClient';
import { unwrapItems } from './api/pagination';
import type { Message, User } from './types/chat';
import { isReadOnlyGroup } from './types/chat';
import {
  closeRefreshSession,
  getAccessSessionId,
  refreshAccessSession,
  setAccessToken
} from './auth/tokenStore';
import { useConfirm } from './context/useConfirm';

// Custom Hook'lar
import { useSocketSession } from './hooks/useSocketSession';
import { useCallManager, type CallHistoryItem } from './hooks/useCallManager';
import { useChatManager } from './hooks/useChatManager';
import { base64ToBytes, forgetRememberedVaultSession, getStoredDeviceIdentity, isVaultUnlocked, lockVault, openDeviceVault } from './crypto/vault';
import { accountVaultMode, approveDeviceWithAccountVault, prepareAccountHistoryPasswordChange, recoverAccountVault, setupAccountVault,
  rememberAccountVault, resumeAccountVault, syncAccountHistoryBeforeLogout, unlockAccountVault } from './crypto/accountHistory';
import { mergeMessage } from './components/ChatArea/chatTimeline';
import {
  decryptIncomingMessage,
  decryptMessageList,
  encryptOutgoingMessage,
  deliverMlsMessage,
  ensureDeviceRegistered,
  registerDeviceForAccountVault,
  getTsMlsCiphersuite,
  messageDeliveryError,
  startAutomaticHistoryRepair,
  retryQueuedMlsMessages,
  rotateConversationEpoch
} from './crypto/mlsClient';

// İhtiyaç anında yüklenen bileşenler (Lazy Loading)
const CallModal = lazy(() => import('./components/Call/CallModal'));

export type { CallHistoryItem };

export default function App() {
  const confirm = useConfirm();

  // EKRAN VE MOD DURUMLARI
  const [currentView, setCurrentView] = useState<'loading' | 'login' | 'vault' | 'account-vault' | 'chat'>('loading');
  // KULLANICI DURUMU
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginNotice, setLoginNotice] = useState('');

  // MODAL VE AYAR DURUMLARI
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultSetup, setVaultSetup] = useState<'migration' | 'unavailable' | null>(null);
  const [accountVaultStatus, setAccountVaultStatus] = useState<'setup' | 'migrate' | 'unlock' | 'unavailable'>('unavailable');
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const [newUsernameSettings, setNewUsernameSettings] = useState<string | null>(null);
  const [newEmailSettings, setNewEmailSettings] = useState<string | null>(null);
  const [oldPasswordSettings, setOldPasswordSettings] = useState('');
  const [newPasswordSettings, setNewPasswordSettings] = useState('');
  const [settingsMessage, setSettingsMessage] = useState({ type: '', text: '' });

  // GRUP MODAL DURUMLARI
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<User[]>([]);

  // TEMA (Karanlık / Aydınlık Mod)
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastSentTypingRef = useRef<{ conversationId: string; isTyping: boolean } | null>(null);
  const lastSentRecordingRef = useRef<{ conversationId: string; isRecording: boolean } | null>(null);
  const prevMessagesLengthRef = useRef(0);
  const resetChatSessionRef = useRef<() => void>(() => undefined);
  const resetCallSessionRef = useRef<() => void>(() => undefined);
  const sessionAttemptRef = useRef(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const accountHistoryAbortRef = useRef<AbortController | null>(null);
  const profileChannelRef = useRef<BroadcastChannel | null>(null);

  /** Oturum sonlandırıldığında hafızayı temizleyen fonksiyon */
  const resetClientSession = () => {
    sessionAttemptRef.current++;
    accountHistoryAbortRef.current?.abort();
    if (sessionUserIdRef.current) {
      const sessionId = getAccessSessionId();
      if (sessionId) void forgetRememberedVaultSession(sessionUserIdRef.current, sessionId).catch(() => undefined);
      lockVault(sessionUserIdRef.current);
    }
    sessionUserIdRef.current = null;
    resetChatSessionRef.current();
    resetCallSessionRef.current();
    setAccessToken(null);
    setCurrentUser(null);
    setIsSettingsOpen(false);
    setVaultSetup(null);
    setIsAvatarViewerOpen(false);
    setIsGroupModalOpen(false);
    setIsGroupSettingsOpen(false);
    setNewUsernameSettings(null);
    setNewEmailSettings(null);
    setOldPasswordSettings('');
    setNewPasswordSettings('');
    setSettingsMessage({ type: '', text: '' });
    setNewGroupName('');
    setSelectedMembers([]);
    setEditGroupName('');
    setGroupMembers([]);
    lastSentTypingRef.current = null;
    lastSentRecordingRef.current = null;
    prevMessagesLengthRef.current = 0;
    setCurrentView('login');
  };

  // 1. SOKET OTURUMU HOOK'U
  const {
    socket,
    socketConnectionStatus,
    onlineUserIds,
    onlineUserIdsRef
  } = useSocketSession({
    currentView: currentView === 'chat' ? 'chat' : 'login',
    onAuthExpired: resetClientSession
  });

  useEffect(() => {
    if (!currentUser?.id || socketConnectionStatus !== 'connected') return;
    const retry = () => void retryQueuedMlsMessages(currentUser.id).catch(() => undefined);
    retry();
    window.addEventListener('message-vault-unlocked', retry);
    return () => window.removeEventListener('message-vault-unlocked', retry);
  }, [currentUser?.id, socketConnectionStatus]);


  // 2. SOHBET VE MESAJLAŞMA HOOK'U
  const {
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
    setGroupsList,
    setConversationList,
    setSelectedUser,
    setActiveConversation,
    setMessages,
    setNewMessage,
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
  } = useChatManager({
    socket,
    currentUser: currentView === 'chat' ? currentUser : null,
    onlineUserIds,
    onlineUserIdsRef
  });

  const paginationConversationRef = useRef(activeConversation);
  paginationConversationRef.current = activeConversation;

  // 3. ARAMA YÖNETİMİ HOOK'U
  const {
    activeCall,
    incomingCall,
    callHistory,
    resetCallSession,
    startConversationCall,
    startCallWithUser,
    acceptIncomingCall,
    declineIncomingCall,
    closeActiveCall
  } = useCallManager({
    socket,
    currentUserId: currentUser?.id || null,
    activeConversation,
    conversationList,
    groupsList,
    selectedUser
  });

  resetChatSessionRef.current = resetChatSession;
  resetCallSessionRef.current = resetCallSession;

  useEffect(() => {
    if (autoScrollRef.current && messages.length !== prevMessagesLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const showChats = (user: User) => {
    setVaultSetup(null);
    setCurrentUser(user);
    setCurrentView('chat');
    void fetchUsers();
    void fetchGroups();
    void fetchConversations(user.id);
    void fetchUnreadCounts();
  };

  const showAccountVault = async (user: User, attempt: number) => {
    accountHistoryAbortRef.current?.abort();
    const controller = new AbortController();
    accountHistoryAbortRef.current = controller;
    const mode = await accountVaultMode(user.id, controller.signal).catch(() => 'unavailable' as const);
    if (controller.signal.aborted || sessionAttemptRef.current !== attempt) return;
    if (mode === 'unlock') {
      try {
        const sessionId = getAccessSessionId();
        const identity = await getStoredDeviceIdentity(user.id);
        if (sessionId && identity && await resumeAccountVault(user.id, sessionId, identity.deviceId, controller.signal)) {
          await approveDeviceWithAccountVault(user.id, identity.deviceId, identity.signaturePublicKeyBase64, controller.signal);
          if (controller.signal.aborted || sessionAttemptRef.current !== attempt) return;
          showChats(user);
          return;
        }
      } catch {
        if (controller.signal.aborted || sessionAttemptRef.current !== attempt) return;
      }
    }
    setCurrentUser(user);
    setAccountVaultStatus(mode);
    setCurrentView('account-vault');
  };

  const enterChat = async (user: User, attempt: number, loginPassword?: string) => {
    if (sessionAttemptRef.current !== attempt) return;
    sessionUserIdRef.current = user.id;
    setCurrentView('loading');
    const setup = await openDeviceVault(user.id, loginPassword)
      .then((ready) => ready ? null : 'migration' as const)
      .catch(() => 'unavailable' as const);
    if (sessionAttemptRef.current !== attempt) return;
    if (!setup) {
      await showAccountVault(user, attempt);
      return;
    }
    setVaultSetup(setup);
    setCurrentUser(user);
    setCurrentView('vault');
  };

  // İlk Yüklemede Oturum Kontrolü
  useEffect(() => {
    const attempt = ++sessionAttemptRef.current;
    const checkAuth = async () => {
      localStorage.removeItem('jwt_token');
      sessionStorage.removeItem('jwt_token');
      try {
        await refreshAccessSession();
        const res = await api.get('/user/me');
        await enterChat(res.data, attempt);
      } catch {
        if (sessionAttemptRef.current === attempt) resetClientSession();
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const handleExpiredSession = (event: Event) => {
      if ((event as CustomEvent<string>).detail === 'device_revoked') {
        setLoginNotice('Bu tarayıcının erişimi kaldırıldı. Yeniden giriş yapıp kasa parolanla bu tarayıcıyı tekrar onaylayabilirsin.');
      }
      resetClientSession();
    };
    window.addEventListener('auth:expired', handleExpiredSession);
    return () => window.removeEventListener('auth:expired', handleExpiredSession);
  }, []);

  useEffect(() => {
    if (currentView !== 'vault' || !currentUser) return;
    const handleVaultReady = () => {
      if (sessionUserIdRef.current !== currentUser.id || !isVaultUnlocked(currentUser.id)) return;
      void showAccountVault(currentUser, sessionAttemptRef.current);
    };
    window.addEventListener('message-vault-unlocked', handleVaultReady);
    return () => window.removeEventListener('message-vault-unlocked', handleVaultReady);
  }, [currentView, currentUser]);

  const onLoginSuccess = async (token: string, user: User, password: string) => {
    const attempt = ++sessionAttemptRef.current;
    setLoginNotice('');
    resetChatSessionRef.current();
    resetCallSessionRef.current();
    setAccessToken(token);
    await enterChat(user, attempt, password);
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };

  useEffect(() => {
    if (currentView !== 'chat' || !currentUser?.id) return;
    const controller = new AbortController();
    startAutomaticHistoryRepair(currentUser.id, controller.signal);
    return () => controller.abort();
  }, [currentView, currentUser?.id]);

  const currentUserId = currentUser?.id;
  useEffect(() => {
    if (currentView !== 'chat' || !currentUserId) return;
    let request: AbortController | undefined;
    const refreshProfile = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void api.get<User>('/user/me', { signal: controller.signal }).then(({ data }) => {
        if (!controller.signal.aborted && data.id === currentUserId) {
          setCurrentUser((previous) => previous?.id === currentUserId ? { ...previous, ...data } : previous);
        }
      }).catch(() => undefined);
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') refreshProfile(); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('profile-changed:' + currentUserId);
    profileChannelRef.current = channel;
    channel?.addEventListener('message', refreshProfile);
    socket?.on('profile_changed', refreshProfile);
    socket?.on('connect', refreshProfile);
    document.addEventListener('visibilitychange', handleVisibility);
    if (socket?.connected) refreshProfile();
    return () => {
      request?.abort();
      channel?.close();
      profileChannelRef.current = null;
      socket?.off('profile_changed', refreshProfile);
      socket?.off('connect', refreshProfile);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [socket, currentView, currentUserId]);

  const handleUpdateUsername = async () => {
    if (!newUsernameSettings?.trim()) return;
    try {
      const res = await api.put('/user/username', { newUsername: newUsernameSettings.trim() });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser((prev) => (prev ? { ...prev, username: res.data.username } : null));
      setNewUsernameSettings(null);
      profileChannelRef.current?.postMessage(null);
    } catch (error) {
      const response = (error as { response?: { data?: { error?: string } } }).response;
      setSettingsMessage({ type: 'error', text: response?.data?.error || 'Kullanıcı adı güncellenemedi.' });
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmailSettings?.trim()) return;
    try {
      const res = await api.put('/user/email', { newEmail: newEmailSettings.trim() });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser((prev) => (prev ? { ...prev, email: res.data.email } : null));
      setNewEmailSettings(null);
      profileChannelRef.current?.postMessage(null);
    } catch (error) {
      const response = (error as { response?: { data?: { error?: string } } }).response;
      setSettingsMessage({ type: 'error', text: response?.data?.error || 'E-posta güncellenemedi.' });
    }
  };

  const cikisYap = async () => {
    const sessionId = getAccessSessionId();
    if (currentUser && sessionId) await forgetRememberedVaultSession(currentUser.id, sessionId).catch(() => undefined);
    if (currentUser) await syncAccountHistoryBeforeLogout(currentUser.id);
    await closeRefreshSession().catch(() => undefined);
    resetClientSession();
  };

  const handleUpdatePassword = async () => {
    if (!currentUser || !oldPasswordSettings || !newPasswordSettings) return;
    try {
      const accountHistoryKey = await prepareAccountHistoryPasswordChange(currentUser.id, oldPasswordSettings, newPasswordSettings);
      const res = await api.put('/user/password', { oldPassword: oldPasswordSettings, newPassword: newPasswordSettings, accountHistoryKey });
      alert(res.data.message);
      setOldPasswordSettings('');
      setNewPasswordSettings('');
      cikisYap();
    } catch {
      setSettingsMessage({ type: 'error', text: 'Şifre güncellenemedi.' });
    }
  };

  const handleDeleteAccount = async () => {
    const isConfirmed = await confirm({
      title: 'Hesabı Sil',
      message: 'Hesabınızı ve tüm verilerinizi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.',
      confirmText: 'Hesabımı Sil',
      cancelText: 'Vazgeç',
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete('/user/account');
      setLoginNotice('Hesabın silindi.');
      await cikisYap();
    } catch {
      setSettingsMessage({ type: 'error', text: 'Hesap silinemedi. Tekrar dene.' });
    }
  };

  const handleToggleReadReceipts = async (isEnabled: boolean) => {
    try {
      const { data } = await api.put('/user/settings/read-receipts', { isEnabled });
      setCurrentUser((prev) => (prev ? { ...prev, readReceiptsOn: data.readReceiptsOn } : null));
      profileChannelRef.current?.postMessage(null);
    } catch {
      setSettingsMessage({ type: 'error', text: 'Okundu bilgisi ayarı kaydedilemedi.' });
    }
  };

  const handleUpdateAvatar = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const upload = await api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    const response = await api.put('/user/avatar', { fileKey: upload.data.fileKey });
    setCurrentUser((previous) => (previous ? { ...previous, ...response.data } : previous));
    setSettingsMessage({ type: 'success', text: 'Profil fotoğrafı güncellendi.' });
    profileChannelRef.current?.postMessage(null);
  };

  const mesajGonder = async (replyToId?: string, payloadOverride?: { fileKey?: string; fileType?: 'image' | 'video' | 'audio' | 'document'; fileName?: string }) => {
    const contentToSend = newMessage.trim();
    if (!contentToSend && !payloadOverride?.fileKey) return;
    if (!activeConversation) return;

    const currentConvId = activeConversation.id;
    const clientId = crypto.randomUUID();

    try {
      const participantIds = activeConversation.isGroup
        ? groupMembers.filter((m) => m.isActive !== false).map((m) => m.id)
        : [currentUser?.id, selectedUser?.id || activeConversation.otherUser?.id].filter(
            (id): id is string => Boolean(id)
          );

      const mlsEnvelope =
        currentUser?.id
          ? await encryptOutgoingMessage(
              currentUser.id,
              currentConvId,
              participantIds,
              contentToSend, undefined, { clientId, delivery: { fileKey: payloadOverride?.fileKey, fileType: payloadOverride?.fileType, replyToId } }
            )
          : null;

      if (!mlsEnvelope) {
        alert('Uçtan uca şifreleme (MLS) anahtarı doğrulanamadı; güvenliğiniz için mesaj düz metin olarak gönderilmedi.');
        return;
      }

      const res = await deliverMlsMessage(currentUser!.id, currentConvId, clientId);
      const hydrated = currentUser?.id
        ? await decryptIncomingMessage(currentUser.id, res.data)
        : res.data;
      if (paginationConversationRef.current?.id === currentConvId && !hasNewer) {
        autoScrollRef.current = true;
        setMessages((prev) => mergeMessage(prev, hydrated));
      }
      if (paginationConversationRef.current?.id === currentConvId) {
        setNewMessage((draft) => draft === newMessage ? '' : draft);
      }
      if (!socket?.connected) void fetchConversations();
    } catch (error) {
      alert(messageDeliveryError(error, 'Mesaj gönderilemedi.'));
    }
  };

  const loadMoreMessages = async () => {
    if (!activeConversation || isReadOnlyGroup(activeConversation) || isLoadingMore || !hasMore || messages.length === 0) return;
    const isCurrent = () => paginationConversationRef.current?.id === activeConversation.id &&
      paginationConversationRef.current?.historyClearedAt === activeConversation.historyClearedAt &&
      !isReadOnlyGroup(paginationConversationRef.current);
    setIsLoadingMore(true);
    const oldestMessageId = messages.find((message) => !message.isLocalGroupHistory)?.id;
    if (!oldestMessageId) {
      setHasMore(false);
      setIsLoadingMore(false);
      return;
    }
    try {
      const res = await api.get(`/conversations/${activeConversation.id}/messages?cursor=${oldestMessageId}`);
      if (!isCurrent()) return;
      const olderMessages = await decryptMessageList(
        currentUser?.id || '',
        unwrapItems<Message>(res.data)
      );
      if (!isCurrent()) return;
      if (olderMessages.length === 0) {
        setHasMore(false);
      } else {
        autoScrollRef.current = false;
        setMessages((prev) => [...olderMessages, ...prev]);
      }
    } catch {
      console.error('Eski mesajlar yüklenemedi');
    } finally {
      if (isCurrent()) setIsLoadingMore(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || selectedMembers.length === 0) return;
    try {
      const res = await api.post('/conversations/group', {
        name: newGroupName.trim(),
        participantIds: selectedMembers
      });
      setGroupsList((prev) => (
        prev.some((group) => group.id === res.data.id) ? prev : [res.data, ...prev]
      ));
      setConversationList((prev) => (
        prev.some((conversation) => conversation.id === res.data.id) ? prev : [res.data, ...prev]
      ));
      setIsGroupModalOpen(false);
      setNewGroupName('');
      setSelectedMembers([]);
      startGroupChat(res.data);
      void fetchConversations();
    } catch {
      alert('Grup oluşturulamadı.');
    }
  };

  const handleAddMembersToGroup = async (userIdsToAdd: string[]) => {
    if (!activeConversation || userIdsToAdd.length === 0) return;
    try {
      await api.post(`/conversations/group/${activeConversation.id}/participants`, { userIdsToAdd });
      const res = await api.get(`/conversations/group/${activeConversation.id}/participants`);
      const updatedMembers: User[] = res.data;
      setGroupMembers(updatedMembers);
      if (currentUser?.id) {
        const activeIds = updatedMembers.filter((m) => m.isActive !== false).map((m) => m.id);
        void rotateConversationEpoch(currentUser.id, activeConversation.id, activeIds);
      }
    } catch {
      alert('Üye eklenemedi.');
    }
  };

  const handleTransferAdmin = async (newAdminId: string) => {
    if (!activeConversation) return;
    const isConfirmed = await confirm({
      title: 'Yönetici Yetkisini Devret',
      message: 'Grup yöneticiliği yetkisini bu üyeye devretmek istediğinize emin misiniz?',
      confirmText: 'Yetkiyi Devret',
      cancelText: 'Vazgeç',
      isDanger: false
    });
    if (!isConfirmed) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/admin`, { newAdminId });
      setActiveConversation({ ...activeConversation, adminId: newAdminId });
      setGroupsList((prev) => prev.map((g) => (g.id === activeConversation.id ? { ...g, adminId: newAdminId } : g)));
    } catch {
      alert('Yetki devredilemedi.');
    }
  };

  const toggleMemberSelection = (userId: string) => {
    setSelectedMembers((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const openGroupSettings = async () => {
    if (!activeConversation || activeConversation.isActive === false || activeConversation.isDeleted) return;
    setIsGroupSettingsOpen(true);
    setEditGroupName(activeConversation.name || '');
    try {
      const res = await api.get(`/conversations/group/${activeConversation.id}/participants`);
      setGroupMembers(res.data);
    } catch {
      console.error('Üyeler alınamadı');
    }
  };

  const handleUpdateGroupName = async (newName?: string) => {
    if (!activeConversation) return;
    const nameToUse = (newName || editGroupName).trim();
    if (!nameToUse) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/name`, { newName: nameToUse });
      setActiveConversation({ ...activeConversation, name: nameToUse });
      setGroupsList((prev) => prev.map((g) => (g.id === activeConversation.id ? { ...g, name: nameToUse } : g)));
      setConversationList((prev) => prev.map((c) => (c.id === activeConversation.id ? { ...c, name: nameToUse } : c)));
    } catch {
      alert('Ad güncellenemedi.');
    }
  };

  const handleUpdateGroupAvatar = async (file: File) => {
    if (!activeConversation?.id) return;
    const formData = new FormData();
    formData.append('file', file);
    const upload = await api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    const response = await api.put(`/conversations/group/${activeConversation.id}/avatar`, { fileKey: upload.data.fileKey });
    setActiveConversation((prev) => (prev?.id === activeConversation.id ? { ...prev, ...response.data } : prev));
    setGroupsList((prev) => prev.map((group) => (group.id === activeConversation.id ? { ...group, ...response.data } : group)));
    setConversationList((prev) => prev.map((conversation) => (conversation.id === activeConversation.id ? { ...conversation, ...response.data } : conversation)));
  };

  const handleRemoveMember = async (userId: string, skipConfirm = false) => {
    if (!activeConversation) return;
    const isSelf = userId === currentUser?.id;
    if (!skipConfirm) {
      const isConfirmed = await confirm({
        title: isSelf ? 'Gruptan Çık' : 'Üyeyi Çıkar',
        message: isSelf
          ? 'Bu gruptan çıkmak istediğinize emin misiniz?'
          : 'Bu üyeyi gruptan çıkarmak istediğinize emin misiniz?',
        confirmText: isSelf ? 'Gruptan Çık' : 'Çıkar',
        cancelText: 'Vazgeç',
        isDanger: true
      });
      if (!isConfirmed) return;
    }
    try {
      const { data } = await api.delete<{ leftAt: string }>(`/conversations/group/${activeConversation.id}/participants/${userId}`);
      setGroupMembers((prev) =>
        prev.map((m) =>
          m.id === userId
            ? {
                ...m,
                isActive: false,
                leftAt: data.leftAt,
                leftReason: isSelf ? 'LEAVE' : 'KICK'
              }
            : m
        )
      );
      if (isSelf) {
        setIsGroupSettingsOpen(false);
        markGroupLeft(activeConversation.id, data.leftAt);
        await fetchConversations();
        await fetchGroups();
      } else if (currentUser?.id) {
        const remainingActiveIds = groupMembers
          .filter((m) => m.id !== userId && m.isActive !== false)
          .map((m) => m.id);
        void rotateConversationEpoch(currentUser.id, activeConversation.id, remainingActiveIds);
      }
    } catch {
      alert('Kişi çıkarılamadı.');
    }
  };

  const handleDeleteConversationHistory = async (conversationId: string) => {
    const isConfirmed = await confirm({
      title: 'Sohbeti Kalıcı Olarak Sil',
      message: 'Bu grubu ve mesaj geçmişinizi kendi listenizden tamamen silmek istediğinize emin misiniz? Bu işlem geri alınamaz.',
      confirmText: 'Sohbeti Sil',
      cancelText: 'Vazgeç',
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/conversations/${conversationId}`);
    } catch {
      alert('Sohbet silinirken hata oluştu.');
      return;
    }
    setIsGroupSettingsOpen(false);
    if (currentUser) {
      await clearGroupHistory(currentUser.id, conversationId)?.catch(() => {
        alert('Sohbet listeden kaldırıldı. Tarayıcıdaki yerel kopya temizlenemedi.');
      });
    }
  };

  const handleClearPersonalHistory = async (conversationId: string) => {
    if (!currentUser || !await confirm({
      title: 'Sohbet geçmişini temizle',
      message: 'Bu sohbetteki mevcut mesajlar yalnızca senin geçmişinden silinecek. Bu işlem geri alınamaz.',
      confirmText: 'Geçmişi temizle',
      cancelText: 'Vazgeç',
      isDanger: true
    })) return;
    try {
      const { data } = await api.delete<{ clearedAt: string }>(`/conversations/${conversationId}/history`);
      await applyPersonalHistoryClear(currentUser.id, conversationId, data.clearedAt);
      void fetchConversations();
    } catch {
      alert('Sohbet geçmişi temizlenemedi.');
    }
  };

  const closeChat = () => {
    setActiveConversation(null);
    setSelectedUser(null);
  };

  const reconnectRealtime = async () => {
    if (!socket) return;
    try {
      const { accessToken } = await refreshAccessSession();
      socket.auth = { token: accessToken };
      socket.connect();
    } catch {
      console.error('Yeniden bağlantı başarısız.');
    }
  };

  const handleToggleConversationPin = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/pin`);
      setConversationList((prev) =>
        prev
          .map((conversation) => (conversation.id === conversationId ? { ...conversation, isPinned: response.data.isPinned } : conversation))
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
      );
      setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, isPinned: response.data.isPinned } : prev));
    } catch {
      alert('Sohbet sabitleme durumu güncellenemedi.');
    }
  };

  const handleToggleConversationArchive = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/archive`);
      setConversationList((prev) => prev.map((conversation) => (conversation.id === conversationId ? { ...conversation, isArchived: response.data.isArchived } : conversation)));
      setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, isArchived: response.data.isArchived } : prev));
    } catch {
      alert('Sohbet arşiv durumu güncellenemedi.');
    }
  };

  const handleToggleConversationMute = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/mute`);
      setConversationList((prev) => prev.map((conversation) => (conversation.id === conversationId ? { ...conversation, isMuted: response.data.isMuted } : conversation)));
      setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, isMuted: response.data.isMuted } : prev));
    } catch {
      alert('Sohbet sessize alma durumu güncellenemedi.');
    }
  };

  const handleSetDisappearingMode = async (conversationId: string, durationSeconds: number | null) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/disappearing`, { durationSeconds });
      setConversationList((prev) => prev.map((conversation) => (conversation.id === conversationId ? { ...conversation, disappearingDurationSeconds: response.data.disappearingDurationSeconds } : conversation)));
      setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, disappearingDurationSeconds: response.data.disappearingDurationSeconds } : prev));
    } catch {
      alert('Kaybolan mesaj modu güncellenemedi.');
    }
  };

  const getCallTitle = (conversationId: string, fallback?: string | null) => {
    const conversation = activeConversation?.id === conversationId
      ? activeConversation
      : conversationList.find((item) => item.id === conversationId) || groupsList.find((item) => item.id === conversationId);

    if (conversation?.isGroup) return conversation.name || fallback || 'Grup görüşmesi';
    return conversation?.otherUser?.username || selectedUser?.username || fallback || 'Görüşme';
  };

  const getCallAvatar = (conversationId: string, callerId?: string) => {
    const conversation = activeConversation?.id === conversationId ? activeConversation
      : conversationList.find((item) => item.id === conversationId) || groupsList.find((item) => item.id === conversationId);
    if (conversation?.isGroup) return conversation.avatarUrl;
    return conversation?.otherUser?.avatarUrl || usersList.find((user) => user.id === callerId)?.avatarUrl;
  };

  if (currentView === 'login') return <Auth onLoginSuccess={onLoginSuccess} notice={loginNotice} />;
  if (currentView === 'account-vault' && currentUser) {
    const user = currentUser;
    return <AccountVaultGate mode={accountVaultStatus} logout={() => void cikisYap()}
      retry={() => void showAccountVault(user, sessionAttemptRef.current)}
      recover={async (code, passphrase, newCode) => {
        const controller = accountHistoryAbortRef.current;
        if (!controller || controller.signal.aborted) throw new Error('Oturum sona erdi.');
        await recoverAccountVault(user.id, code, passphrase, newCode, controller.signal);
      }}
      open={async (passphrase, legacyPassword, recoveryCode) => {
        const controller = accountHistoryAbortRef.current;
        if (!controller || controller.signal.aborted) return;
        const { signal } = controller;
        if (accountVaultStatus === 'setup' || accountVaultStatus === 'migrate') {
          const issuer = await ensureDeviceRegistered(user.id);
          if (!issuer) throw new Error('İlk kasa kurulumunu onaylı cihazında yap.');
          const cs = await getTsMlsCiphersuite();
          try {
            await setupAccountVault(user.id, passphrase, legacyPassword, issuer.deviceId,
              (data) => cs.signature.sign(base64ToBytes(issuer.signaturePrivateKeyPkcs8Base64), data), signal, recoveryCode);
          } catch {
            throw new Error('Kasa oluşturulamadı. Geçiş yapıyorsan mevcut hesap parolanı kontrol et.');
          }
        }
        let revision: number;
        try {
          revision = await unlockAccountVault(user.id, passphrase, signal);
          if (!signal.aborted) setAccountVaultStatus('unlock');
        } catch (error) {
          if (error instanceof DOMException && error.name === 'OperationError') {
            throw new Error('Kasa açılamadı. Kasa parolanı kontrol et ve tekrar dene.');
          }
          throw error;
        }
        const identity = await registerDeviceForAccountVault(user.id, signal);
        signal.throwIfAborted();
        try {
          await approveDeviceWithAccountVault(user.id, identity.deviceId, identity.signaturePublicKeyBase64, signal);
        } catch {
          throw new Error('Bu tarayıcı onaylanamadı. Yeniden giriş yapıp tekrar dene.');
        }
        const sessionId = getAccessSessionId();
        if (sessionId) await rememberAccountVault(user.id, sessionId, identity.deviceId, revision).catch(() => undefined);
        if (!signal.aborted && sessionUserIdRef.current === user.id) showChats(user);
      }} />;
  }
  if (currentView === 'loading' || currentView === 'vault') {
    return (
      <main className="settings-overlay">
        <div className="settings-modal" style={{ display: 'grid', gap: 16, padding: 24, width: 'min(460px, 90vw)', height: 'auto' }}>
          {currentView === 'vault' && currentUser ? (
            <>
              <SecurityVaultModal userId={currentUser.id} vaultSetup={vaultSetup} />
              <button type="button" onClick={() => void cikisYap()}>Çıkış yap</button>
            </>
          ) : <p role="status">Sohbetler hazırlanıyor…</p>}
        </div>
      </main>
    );
  }

  return (
    <div className={`app-container ${activeConversation || selectedUser ? 'chat-active' : ''}`}>
      {currentUser && (
        <Sidebar
          currentUser={currentUser}
          conversationList={conversationList}
          usersList={usersList}
          activeConversation={activeConversation}
          selectedUser={selectedUser}
          unreadCounts={unreadCounts}
          startGroupChat={startGroupChat}
          startChat={startChat}
          setIsGroupModalOpen={setIsGroupModalOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          isDarkMode={isDarkMode}
          setIsDarkMode={setIsDarkMode}
          socketConnectionStatus={socketConnectionStatus}
          onReconnectRealtime={reconnectRealtime}
          typingByConversation={typingByConversation}
          callHistory={callHistory}
          onViewOwnAvatar={() => setIsAvatarViewerOpen(true)}
        />
      )}

      {currentUser && (
        <ChatArea
          currentUser={currentUser}
          activeConversation={activeConversation}
          selectedUser={selectedUser}
          messages={messages}
          setMessages={setMessages}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          mesajGonder={mesajGonder}
          messagesEndRef={messagesEndRef}
          openGroupSettings={openGroupSettings}
          onDeleteConversationHistory={handleDeleteConversationHistory}
          onClearPersonalHistory={handleClearPersonalHistory}
          messageFocus={messageFocus}
          onFocusMessage={focusConversationMessage}
          hasNewer={hasNewer}
          onDeleteMessageForMe={async (message) => {
            if (!message.isLocalGroupHistory) await api.delete(`/messages/${message.id}?forEveryone=false`);
            await forgetHistoryMessage(currentUser.id, message.conversationId, message.id);
            void fetchConversations();
          }}
          closeChat={closeChat}
          isDarkMode={isDarkMode}
          usersList={usersList}
          groupMembers={groupMembers}
          loadMoreMessages={loadMoreMessages}
          socketConnectionStatus={socketConnectionStatus}
          onStartDirectChat={startChat}
          onStartCallWithUser={startCallWithUser}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          typingUsername={activeConversation ? typingByConversation[activeConversation.id] ?? null : null}
          recordingUsername={activeConversation ? recordingByConversation[activeConversation.id] ?? null : null}
          onVoiceRecording={(isRecording) => {
            if (!activeConversation || isReadOnlyGroup(activeConversation) || !socket) return;
            const current = lastSentRecordingRef.current;
            if (current && current.conversationId === activeConversation.id && current.isRecording === isRecording) return;
            lastSentRecordingRef.current = { conversationId: activeConversation.id, isRecording };
            socket.emit('voice_recording_changed', { conversationId: activeConversation.id, isRecording });
          }}
          onTyping={(isTyping) => {
            if (!activeConversation || isReadOnlyGroup(activeConversation) || !socket) return;
            const current = lastSentTypingRef.current;
            if (current && current.conversationId === activeConversation.id && current.isTyping === isTyping) return;
            lastSentTypingRef.current = { conversationId: activeConversation.id, isTyping };
            socket.emit('typing_changed', { conversationId: activeConversation.id, isTyping });
          }}
          onToggleConversationPin={handleToggleConversationPin}
          onToggleConversationArchive={handleToggleConversationArchive}
          onToggleConversationMute={handleToggleConversationMute}
          onSetDisappearingMode={handleSetDisappearingMode}
          onStartCall={startConversationCall}
        />
      )}

      {isGroupModalOpen && (
        <CreateGroupModal setIsGroupModalOpen={setIsGroupModalOpen} newGroupName={newGroupName} setNewGroupName={setNewGroupName} usersList={usersList} selectedMembers={selectedMembers} toggleMemberSelection={toggleMemberSelection} handleCreateGroup={handleCreateGroup} />
      )}

      {isGroupSettingsOpen && activeConversation && (
        <GroupSettingsModal
          setIsGroupSettingsOpen={setIsGroupSettingsOpen}
          activeConversation={activeConversation}
          currentUser={currentUser}
          handleUpdateGroupName={handleUpdateGroupName}
          handleUpdateGroupAvatar={handleUpdateGroupAvatar}
          groupMembers={groupMembers}
          handleRemoveMember={handleRemoveMember}
          handleDeleteConversationHistory={handleDeleteConversationHistory}
          usersList={usersList}
          handleAddMembersToGroup={handleAddMembersToGroup}
          handleTransferAdmin={handleTransferAdmin}
          startChat={startChat}
          isDarkMode={isDarkMode}
          onStartCallWithUser={startCallWithUser}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal vaultSetup={vaultSetup} setIsSettingsOpen={setIsSettingsOpen} settingsMessage={settingsMessage} setSettingsMessage={setSettingsMessage} newUsernameSettings={newUsernameSettings} setNewUsernameSettings={setNewUsernameSettings} handleUpdateUsername={handleUpdateUsername} newEmailSettings={newEmailSettings} setNewEmailSettings={setNewEmailSettings} handleUpdateEmail={handleUpdateEmail} currentUser={currentUser} handleToggleReadReceipts={handleToggleReadReceipts} oldPasswordSettings={oldPasswordSettings} setOldPasswordSettings={setOldPasswordSettings} newPasswordSettings={newPasswordSettings} setNewPasswordSettings={setNewPasswordSettings} handleUpdatePassword={handleUpdatePassword} handleUpdateAvatar={handleUpdateAvatar} handleDeleteAccount={handleDeleteAccount} cikisYap={cikisYap} />
      )}

      {isAvatarViewerOpen && currentUser && (
        <AvatarViewerModal
          avatarUrl={currentUser.avatarUrl ?? null}
          username={currentUser.username}
          onClose={() => setIsAvatarViewerOpen(false)}
        />
      )}

      {incomingCall && (
        <IncomingCallPrompt
          call={incomingCall}
          avatarUrl={getCallAvatar(incomingCall.conversationId, incomingCall.caller.id)}
          onAccept={acceptIncomingCall}
          onDecline={declineIncomingCall}
        />
      )}

      {activeCall && (
        <Suspense fallback={<div className="app-loading">Arama hazırlanıyor…</div>}>
          <CallModal
            key={activeCall.callId}
            call={activeCall}
            title={getCallTitle(activeCall.conversationId, activeCall.conversation?.name)}
            avatarUrl={getCallAvatar(activeCall.conversationId)}
            localAvatarUrl={currentUser?.avatarUrl}
            onClose={closeActiveCall}
          />
        </Suspense>
      )}
    </div>
  );
}
