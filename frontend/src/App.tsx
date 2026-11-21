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
import AvatarViewerModal from './components/Modals/AvatarViewerModal';
import { api } from './api/httpClient';
import { unwrapItems } from './api/pagination';
import type { Message, User } from './types/chat';
import {
  closeRefreshSession,
  refreshAccessSession,
  setAccessToken
} from './auth/tokenStore';
import { useConfirm } from './context/useConfirm';

// Custom Hook'lar
import { useSocketSession } from './hooks/useSocketSession';
import { useCallManager, type CallHistoryItem } from './hooks/useCallManager';
import { useChatManager } from './hooks/useChatManager';
import { lockVault, openDeviceVault } from './crypto/vault';
import { mergeMessage } from './components/ChatArea/chatTimeline';
import {
  decryptIncomingMessage,
  decryptMessageList,
  encryptOutgoingMessage,
  deliverMlsMessage,
  retryQueuedMlsMessages,
  rotateConversationEpoch
} from './crypto/mlsClient';

// İhtiyaç anında yüklenen bileşenler (Lazy Loading)
const CallModal = lazy(() => import('./components/Call/CallModal'));

export type { CallHistoryItem };

export default function App() {
  const confirm = useConfirm();

  // EKRAN VE MOD DURUMLARI
  const [currentView, setCurrentView] = useState<'login' | 'register' | 'chat'>('login');
  // KULLANICI DURUMU
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // MODAL VE AYAR DURUMLARI
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultSetup, setVaultSetup] = useState<'migration' | 'unavailable' | null>(null);
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const [newUsernameSettings, setNewUsernameSettings] = useState('');
  const [newEmailSettings, setNewEmailSettings] = useState('');
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

  /** Oturum sonlandırıldığında hafızayı temizleyen fonksiyon */
  const resetClientSession = () => {
    sessionAttemptRef.current++;
    if (sessionUserIdRef.current) lockVault(sessionUserIdRef.current);
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
    setNewUsernameSettings('');
    setNewEmailSettings('');
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
    currentView,
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
    startChat,
    startGroupChat
  } = useChatManager({
    socket,
    currentUser,
    onlineUserIds,
    onlineUserIdsRef
  });

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

  const enterChat = async (user: User, attempt: number, loginPassword?: string) => {
    if (sessionAttemptRef.current !== attempt) return;
    sessionUserIdRef.current = user.id;
    const setup = await openDeviceVault(user.id, loginPassword)
      .then((ready) => ready ? null : 'migration' as const)
      .catch(() => 'unavailable' as const);
    if (sessionAttemptRef.current !== attempt) return;
    setVaultSetup(setup);
    setIsSettingsOpen(setup === 'unavailable');
    setCurrentUser(user);
    setCurrentView('chat');
    fetchUsers();
    fetchGroups();
    fetchConversations(user.id);
    fetchUnreadCounts();
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
    const handleExpiredSession = () => resetClientSession();
    const handleVaultReady = () => setVaultSetup(null);
    window.addEventListener('auth:expired', handleExpiredSession);
    window.addEventListener('message-vault-unlocked', handleVaultReady);
    return () => {
      window.removeEventListener('auth:expired', handleExpiredSession);
      window.removeEventListener('message-vault-unlocked', handleVaultReady);
    };
  }, []);

  const onLoginSuccess = async (token: string, user: User, password: string) => {
    const attempt = ++sessionAttemptRef.current;
    resetChatSessionRef.current();
    resetCallSessionRef.current();
    setAccessToken(token);
    await enterChat(user, attempt, password);
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };

  const handleUpdateUsername = async () => {
    if (!newUsernameSettings.trim()) return;
    try {
      const res = await api.put('/user/username', { newUsername: newUsernameSettings });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser((prev) => (prev ? { ...prev, username: res.data.username } : null));
      setNewUsernameSettings('');
    } catch {
      setSettingsMessage({ type: 'error', text: 'İsim güncellenemedi.' });
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmailSettings.trim()) return;
    try {
      const res = await api.put('/user/email', { newEmail: newEmailSettings });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser((prev) => (prev ? { ...prev, email: res.data.email } : null));
      setNewEmailSettings('');
    } catch {
      setSettingsMessage({ type: 'error', text: 'E-posta güncellenemedi.' });
    }
  };

  const cikisYap = async () => {
    await closeRefreshSession().catch(() => undefined);
    resetClientSession();
  };

  const handleUpdatePassword = async () => {
    if (!oldPasswordSettings || !newPasswordSettings) return;
    try {
      const res = await api.put('/user/password', { oldPassword: oldPasswordSettings, newPassword: newPasswordSettings });
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
      alert('Hesabınız silindi.');
      cikisYap();
    } catch {
      alert('Hesap silinirken hata oluştu.');
    }
  };

  const handleToggleReadReceipts = async (isEnabled: boolean) => {
    setCurrentUser((prev) => (prev ? { ...prev, readReceiptsOn: isEnabled } : null));
    try {
      await api.put('/user/settings/read-receipts', { isEnabled });
    } catch {
      console.error('Ayar kaydedilemedi.');
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
      autoScrollRef.current = true;
      setMessages((prev) => mergeMessage(prev, hydrated));
      setNewMessage('');
      fetchConversations();
    } catch {
      alert('Mesaj gönderilemedi.');
    }
  };

  const loadMoreMessages = async () => {
    if (!activeConversation || isLoadingMore || !hasMore || messages.length === 0) return;
    setIsLoadingMore(true);
    const oldestMessageId = messages[0].id;
    try {
      const res = await api.get(`/conversations/${activeConversation.id}/messages?cursor=${oldestMessageId}`);
      const olderMessages = await decryptMessageList(
        currentUser?.id || '',
        unwrapItems<Message>(res.data)
      );
      if (olderMessages.length === 0) {
        setHasMore(false);
      } else {
        autoScrollRef.current = false;
        setMessages((prev) => [...olderMessages, ...prev]);
      }
    } catch {
      console.error('Eski mesajlar yüklenemedi');
    } finally {
      setIsLoadingMore(false);
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
      await api.delete(`/conversations/group/${activeConversation.id}/participants/${userId}`);
      setGroupMembers((prev) =>
        prev.map((m) =>
          m.id === userId
            ? {
                ...m,
                isActive: false,
                leftAt: new Date().toISOString(),
                leftReason: isSelf ? 'LEAVE' : 'KICK'
              }
            : m
        )
      );
      if (isSelf) {
        setIsGroupSettingsOpen(false);
        await fetchConversations();
        await fetchGroups();
        setActiveConversation((prev) => (prev?.id === activeConversation.id ? { ...prev, isActive: false } : prev));
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
      setActiveConversation(null);
      setGroupsList((prev) => prev.filter((g) => g.id !== conversationId));
      setConversationList((prev) => prev.filter((c) => c.id !== conversationId));
    } catch {
      alert('Sohbet silinirken hata oluştu.');
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

  if (currentView === 'login' || currentView === 'register') return <Auth onLoginSuccess={onLoginSuccess} />;

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
            if (!activeConversation || !socket) return;
            const current = lastSentRecordingRef.current;
            if (current && current.conversationId === activeConversation.id && current.isRecording === isRecording) return;
            lastSentRecordingRef.current = { conversationId: activeConversation.id, isRecording };
            socket.emit('voice_recording_changed', { conversationId: activeConversation.id, isRecording });
          }}
          onTyping={(isTyping) => {
            if (!activeConversation || !socket) return;
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
