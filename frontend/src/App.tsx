import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

import Auth from './components/Auth/Auth';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import CallModal, { type ActiveCall, type CallType } from './components/Call/CallModal';
import IncomingCallPrompt, { type IncomingCall } from './components/Call/IncomingCallPrompt';
import CreateGroupModal from './components/Modals/CreateGroupModal';
import GroupSettingsModal from './components/Modals/GroupSettingsModal';
import SettingsModal from './components/Modals/SettingsModal';
import AvatarViewerModal from './components/Modals/AvatarViewerModal';
import GameHub from './components/GameHub/GameHub';
import { api } from './api/httpClient';
import { API_ORIGIN } from './config/runtime';
import type { Conversation, Message, User } from './types/chat';
import type { TypedSocket } from './types/socket';
import {
  closeRefreshSession,
  getAccessToken,
  refreshAccessSession,
  setAccessToken,
  subscribeAccessToken
} from './auth/tokenStore';
import { useConfirm } from './context/ConfirmContext';
const SOCKET_INACTIVITY_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const SOCKET_ACTIVITY_PING_INTERVAL_MS = 60 * 1000;

export interface CallHistoryItem {
  callId: string;
  conversationId: string;
  title: string;
  callType: CallType;
  direction: 'incoming' | 'outgoing';
  status: 'started' | 'accepted' | 'declined' | 'missed' | 'ended';
  createdAt: string;
}

export default function App() {
  const confirm = useConfirm();
  const [currentView, setCurrentView] = useState<'login' | 'register' | 'chat'>('login');
  const [appMode, setAppMode] = useState<'chat' | 'game'>(() => {
    return (localStorage.getItem('appMode') as 'chat' | 'game') || 'chat';
  });
  const changeAppMode = (mode: 'chat' | 'game') => {
    setAppMode(mode);
    localStorage.setItem('appMode', mode);
  };
  const [isGameModePromptOpen, setIsGameModePromptOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [groupsList, setGroupsList] = useState<Conversation[]>([]);
  const [conversationList, setConversationList] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  const [newUsernameSettings, setNewUsernameSettings] = useState('');
  const [newEmailSettings, setNewEmailSettings] = useState('');
  const [oldPasswordSettings, setOldPasswordSettings] = useState('');
  const [newPasswordSettings, setNewPasswordSettings] = useState('');
  const [settingsMessage, setSettingsMessage] = useState({ type: '', text: '' });

  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<User[]>([]);
  // typingByConversation: conversationId -> yazan kullanıcının adı.
  // Bu tek state hem ChatArea üst barındaki "yazıyor" bilgisini hem Sidebar son mesaj önizlemesini besler.
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  const [recordingByConversation, setRecordingByConversation] = useState<Record<string, string>>({});
  // Socket bağlantısının kullanıcıya görünen durumudur; inactive/disconnected olunca Sidebar'da bağlan uyarısı çıkar.
  const [socketConnectionStatus, setSocketConnectionStatus] = useState<'connected' | 'inactive' | 'reconnecting' | 'disconnected'>('connected');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('callHistory') || '[]');
    } catch {
      return [];
    }
  });

  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const selectedUserRef = useRef<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const groupsListRef = useRef<Conversation[]>([]);
  const usersListRef = useRef<User[]>([]);
  const conversationListRef = useRef<Conversation[]>([]);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const autoScrollRef = useRef(true);
  const isSocketActiveRef = useRef(true);
  const socketInactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSocketActivityPingRef = useRef(0);
  const lastUserActivityAtRef = useRef(Date.now());
  const activeCallRef = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const lastSentTypingRef = useRef<{ conversationId: string; isTyping: boolean } | null>(null);
  const onlineUserIdsRef = useRef<Set<string>>(new Set());
  const lastSentRecordingRef = useRef<{ conversationId: string; isRecording: boolean } | null>(null);
  const prevMessagesLengthRef = useRef(0);

  const resetClientSession = () => {
    setAccessToken(null);
    setCurrentUser(null); setSelectedUser(null); setActiveConversation(null);
    setMessages([]); setGroupsList([]); setConversationList([]); setUnreadCounts({});
    setIsSettingsOpen(false); setIsGroupModalOpen(false); setIsGroupSettingsOpen(false); setAppMode('chat'); setCurrentView('login');
  };

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
  useEffect(() => { usersListRef.current = usersList; }, [usersList]);
  useEffect(() => { conversationListRef.current = conversationList; }, [conversationList]);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);
  useEffect(() => {
    if (autoScrollRef.current && messages.length !== prevMessagesLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);
  useEffect(() => {
    if (isDarkMode) { document.body.classList.add('dark-theme'); localStorage.setItem('theme', 'dark'); }
    else { document.body.classList.remove('dark-theme'); localStorage.setItem('theme', 'light'); }
  }, [isDarkMode]);

  useEffect(() => {
    const checkAuth = async () => {
      // Access token bellekte olduğu için sayfa yenilenince HttpOnly cookie ile sessizce yenilenir.
      localStorage.removeItem('jwt_token');
      sessionStorage.removeItem('jwt_token');
      try {
        await refreshAccessSession();
        const res = await api.get('/user/me');
        setCurrentUser(res.data); setCurrentView('chat');
        fetchUsers(); fetchGroups(); fetchConversations(); fetchUnreadCounts();
      } catch { resetClientSession(); }
    }; checkAuth();
  }, []);

  useEffect(() => {
    // Refresh oturumu sona erdiğinde bütün kullanıcıya özel UI durumu tek noktadan temizlenir.
    const handleExpiredSession = () => resetClientSession();
    window.addEventListener('auth:expired', handleExpiredSession);
    return () => window.removeEventListener('auth:expired', handleExpiredSession);
  }, []);

  const onLoginSuccess = (token: string, user: User) => {
    setAccessToken(token); setCurrentUser(user); setCurrentView('chat');
    fetchUsers(); fetchGroups(); fetchConversations(); fetchUnreadCounts();
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };

  const handleUpdateUsername = async () => {
    if(!newUsernameSettings.trim()) return;
    try {
      const res = await api.put('/user/username', { newUsername: newUsernameSettings });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser(prev => prev ? { ...prev, username: res.data.username } : null); setNewUsernameSettings('');
    } catch { setSettingsMessage({ type: 'error', text: "İsim güncellenemedi." }); }
  };

  const handleUpdateEmail = async () => {
    if (!newEmailSettings.trim()) return;
    try {
      const res = await api.put('/user/email', { newEmail: newEmailSettings });
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser(prev => prev ? { ...prev, email: res.data.email } : null);
      setNewEmailSettings('');
    } catch {
      setSettingsMessage({ type: 'error', text: "E-posta güncellenemedi." });
    }
  };

  const handleUpdatePassword = async () => {
    if(!oldPasswordSettings || !newPasswordSettings) return;
    try {
      const res = await api.put('/user/password', { oldPassword: oldPasswordSettings, newPassword: newPasswordSettings });
      alert(res.data.message);
      setOldPasswordSettings(''); setNewPasswordSettings('');
      cikisYap();
    } catch { setSettingsMessage({ type: 'error', text: "Şifre güncellenemedi." }); }
  };

  const handleDeleteAccount = async () => {
    const isConfirmed = await confirm({
      title: "Hesabı Sil",
      message: "Hesabınızı ve tüm verilerinizi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
      confirmText: "Hesabımı Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try { await api.delete('/user/account'); alert("Hesabınız silindi."); cikisYap(); }
    catch { alert("Hesap silinirken hata oluştu."); }
  };

  const handleToggleReadReceipts = async (isEnabled: boolean) => {
    setCurrentUser(prev => prev ? {...prev, readReceiptsOn: isEnabled} : null);
    try { await api.put('/user/settings/read-receipts', { isEnabled }); }
    catch { console.error("Ayar kaydedilemedi."); }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      const enriched = res.data.map((user: User) => {
        const shouldHide = user.isBlocked || user.blockedByOther;
        return {
          ...user,
          isOnline: shouldHide ? false : onlineUserIdsRef.current.has(user.id)
        };
      });
      setUsersList(enriched);
    }
    catch { console.error("Kullanıcılar çekilemedi"); }
  };

  const fetchGroups = async () => {
    try { const res = await api.get('/conversations/groups'); setGroupsList(res.data); }
    catch { console.error("Gruplar çekilemedi"); }
  };

  const fetchUnreadCounts = async () => {
    try { const res = await api.get('/unread-counts'); setUnreadCounts(res.data); }
    catch { console.error("Okunmamış sayılar çekilemedi"); }
  };

  const mergeLiveUsersIntoConversations = (conversations: Conversation[]) => conversations.map((conversation) => {
    if (!conversation.otherUser) return conversation;
    const liveUser = usersListRef.current.find((user) => user.id === conversation.otherUser?.id);
    return liveUser ? { ...conversation, otherUser: { ...conversation.otherUser, ...liveUser } } : conversation;
  });

  const fetchConversations = async () => {
    try {
      const res = await api.get('/conversations');
      const merged = mergeLiveUsersIntoConversations(res.data).map((conversation) => {
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
    }
    catch { console.error("Sohbet listesi alınamadı"); }
  };

  const handleUpdateAvatar = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const upload = await api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    const response = await api.put('/user/avatar', { fileKey: upload.data.fileKey });
    setCurrentUser((previous) => previous ? { ...previous, ...response.data } : previous);
    setSettingsMessage({ type: 'success', text: 'Profil fotoğrafı güncellendi.' });
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
      setMessages(msgs.data);

      if (currentUser) {
        await api.post(`/conversations/${res.data.id}/read`, { emitReceipt: currentUser.readReceiptsOn !== false });
        setUnreadCounts(prev => ({ ...prev, [chatUser.id]: 0, [res.data.id]: 0 }));
      }
      if (socket) socket.emit('odaya_katil', res.data.id);
    } catch { alert("Kullanıcı silinmiş veya sohbet yüklenemedi."); setSelectedUser(null); }
  };

  const startGroupChat = async (group: Conversation) => {
    setSelectedUser(null); setActiveConversation(group);
    setHasMore(true);
    try {
      const msgs = await api.get(`/conversations/${group.id}/messages`);
      autoScrollRef.current = true;
      setMessages(msgs.data);

      const partRes = await api.get(`/conversations/group/${group.id}/participants`);
      setGroupMembers(partRes.data);

      if (currentUser) {
        // Grup sohbetlerinde okundu listesi üye bazlı hesaplandığı için receipt her zaman gönderilir.
        await api.post(`/conversations/${group.id}/read`, {
          emitReceipt: true
        });
        setUnreadCounts(prev => ({ ...prev, [group.id]: 0 }));
      }
      if (socket) socket.emit('odaya_katil', group.id);
    } catch (error) { console.error("Grup mesajları çekilemedi", error); }
  };

  // YUKARI KAYDIRINCA ESKİ MESAJLARI GETİREN FONKSİYON
  const loadMoreMessages = async () => {
    if (!activeConversation || !hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      // Ekranda gözüken en eski mesajın ID'sini bul (Cursor)
      const cursorId = messages.length > 0 ? messages[0].id : null;
      const url = `/conversations/${activeConversation.id}/messages${cursorId ? `?cursor=${cursorId}` : ''}`;

      const res = await api.get(url);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Gelen mesaj 50'den azsa, demek ki sohbetin en başına ulaştık
      if (res.data.length < 50) setHasMore(false);

      // Gelen eski mesajları, elimizdeki mesajların ÜSTÜNE (önüne) ekle
      autoScrollRef.current = false;
      setMessages(prev => [...res.data, ...prev]);
    } catch (error) {
      console.error("Eski mesajlar çekilemedi", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Metin mesajı gönderimi; dosyalı gönderimler ChatArea tarafından yönetilir.
  const mesajGonder = async (replyToId?: string) => {
    if (!newMessage.trim() || !currentUser || !activeConversation) return;
    const mesajIcerigi = newMessage; setNewMessage("");
    try {
      await api.post('/messages', {
        conversationId: activeConversation.id,
        clientId: crypto.randomUUID(),
        content: mesajIcerigi,
        replyToId: replyToId // Hangi mesaja yanıt verildiğini iletiyoruz
      });
    } catch { console.error("Mesaj gönderilemedi"); }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("Grup ismi yazmadınız.");
    if (selectedMembers.length === 0) return alert("Gruba eklenecek en az 1 kişi seçin.");
    try {
      const groupName = newGroupName.trim();
      const res = await api.post('/conversations/group', { name: groupName, participantIds: selectedMembers });
      setIsGroupModalOpen(false); setNewGroupName(''); setSelectedMembers([]);
      const createdGroup: Conversation = { ...res.data, isGroup: true, name: res.data?.name || groupName };
      const groupId = createdGroup.id;

      if (currentUser && groupId) {
        setGroupsList(prev => prev.some(group => group.id === groupId) ? prev : [...prev, createdGroup]);
        setConversationList(prev => prev.some(conversation => conversation.id === groupId) ? prev : [createdGroup, ...prev]);
        if (socket) socket.emit('odaya_katil', groupId);
        void fetchGroups();
        void fetchConversations();
      } else { if (currentUser) { void fetchGroups(); void fetchConversations(); } }
    } catch { alert("Grup oluşturulamadı."); }
  };

  const handleAddMembersToGroup = async (userIds: string[]) => {
    if (!activeConversation || userIds.length === 0) return;
    try {
      await api.post(`/conversations/group/${activeConversation.id}/participants`, { userIdsToAdd: userIds });
      alert("Kişiler eklendi."); openGroupSettings();
    } catch { alert("Kişiler eklenemedi."); }
  };

  const handleTransferAdmin = async (newAdminId: string) => {
    if (!activeConversation) return;
    const isConfirmed = await confirm({
      title: "Yöneticiliği Devret",
      message: "Grubun yöneticiliğini bu üyeye devretmek istediğinize emin misiniz?",
      confirmText: "Yöneticiliği Devret",
      cancelText: "Vazgeç",
      isDanger: false
    });
    if (!isConfirmed) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/admin`, { newAdminId });
      setActiveConversation({ ...activeConversation, adminId: newAdminId });
      setGroupsList(prev => prev.map(g => g.id === activeConversation.id ? { ...g, adminId: newAdminId } : g));
    } catch { alert("Yetki devredilemedi."); }
  };

  const toggleMemberSelection = (userId: string) => { setSelectedMembers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]); };

  const getCallTitle = (conversationId: string, fallback?: string | null) => {
    const conversation = activeConversationRef.current?.id === conversationId
      ? activeConversationRef.current
      : conversationListRef.current.find((item) => item.id === conversationId) || groupsListRef.current.find((item) => item.id === conversationId);

    if (conversation?.isGroup) return conversation.name || fallback || 'Grup görüşmesi';
    return conversation?.otherUser?.username || selectedUserRef.current?.username || fallback || 'Görüşme';
  };

  const rememberCall = (entry: CallHistoryItem) => {
    setCallHistory((previous) => {
      const next = [entry, ...previous.filter((item) => item.callId !== entry.callId)].slice(0, 50);
      localStorage.setItem('callHistory', JSON.stringify(next));
      return next;
    });
  };

  const updateCallStatus = (callId: string, status: CallHistoryItem['status']) => {
    setCallHistory((previous) => {
      const next = previous.map((item) => item.callId === callId ? { ...item, status } : item);
      localStorage.setItem('callHistory', JSON.stringify(next));
      return next;
    });
  };

  const createCallConnection = async (conversationId: string, callId: string, callType: CallType): Promise<ActiveCall> => {
    const response = await api.post('/calls/token', { conversationId, callId, callType });
    return response.data;
  };

  const emitCallSignal = (eventName: 'call:invite' | 'call:accepted' | 'call:declined' | 'call:ended', call: {
    conversationId: string;
    callId: string;
    callType: CallType;
  }) => {
    socket?.emit(eventName, {
      conversationId: call.conversationId,
      callId: call.callId,
      callType: call.callType
    });
  };

  const startConversationCall = async (callType: CallType) => {
    if (!activeConversation?.id) return;
    const callId = crypto.randomUUID();

    try {
      const nextCall = await createCallConnection(activeConversation.id, callId, callType);
      rememberCall({
        callId,
        conversationId: activeConversation.id,
        title: getCallTitle(activeConversation.id, activeConversation.name),
        callType,
        direction: 'outgoing',
        status: 'started',
        createdAt: new Date().toISOString()
      });
      setActiveCall(nextCall);
      emitCallSignal('call:invite', nextCall);
    } catch {
      alert('Görüşme başlatılamadı. LiveKit ayarlarını kontrol edin.');
    }
  };

  const startCallWithUser = async (targetUser: User, callType: CallType) => {
    try {
      const res = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      const conversation = res.data;
      const callId = crypto.randomUUID();
      const nextCall = await createCallConnection(conversation.id, callId, callType);
      rememberCall({
        callId,
        conversationId: conversation.id,
        title: targetUser.username,
        callType,
        direction: 'outgoing',
        status: 'started',
        createdAt: new Date().toISOString()
      });
      setActiveCall(nextCall);
      emitCallSignal('call:invite', nextCall);
    } catch {
      alert('Arama başlatılamadı. LiveKit ayarlarını kontrol edin.');
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    try {
      const nextCall = await createCallConnection(incomingCall.conversationId, incomingCall.callId, incomingCall.callType);
      emitCallSignal('call:accepted', incomingCall);
      updateCallStatus(incomingCall.callId, 'accepted');
      setIncomingCall(null);
      setActiveCall(nextCall);
    } catch {
      alert('Görüşmeye bağlanılamadı.');
    }
  };

  const declineIncomingCall = () => {
    if (incomingCall) emitCallSignal('call:declined', incomingCall);
    if (incomingCall) updateCallStatus(incomingCall.callId, 'declined');
    setIncomingCall(null);
  };

  const closeActiveCall = () => {
    if (activeCallRef.current) emitCallSignal('call:ended', activeCallRef.current);
    if (activeCallRef.current) updateCallStatus(activeCallRef.current.callId, 'ended');
    setActiveCall(null);
  };

  const openGroupSettings = async () => {
    if (!activeConversation) return;
    setIsGroupSettingsOpen(true); setEditGroupName(activeConversation.name || '');
    try { const res = await api.get(`/conversations/group/${activeConversation.id}/participants`); setGroupMembers(res.data); }
    catch { console.error("Üyeler alınamadı"); }
  };

  const handleUpdateGroupName = async (newName?: string) => {
    if (!activeConversation) return;
    const nameToUse = (newName || editGroupName).trim();
    if (!nameToUse) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/name`, { newName: nameToUse });
      setActiveConversation({ ...activeConversation, name: nameToUse });
      setGroupsList(prev => prev.map(g => g.id === activeConversation.id ? { ...g, name: nameToUse } : g));
      setConversationList(prev => prev.map(c => c.id === activeConversation.id ? { ...c, name: nameToUse } : c));
    } catch { alert("Ad güncellenemedi."); }
  };

  const handleUpdateGroupAvatar = async (file: File) => {
    if (!activeConversation?.id) return;
    const formData = new FormData();
    formData.append('file', file);
    const upload = await api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    const response = await api.put(`/conversations/group/${activeConversation.id}/avatar`, { fileKey: upload.data.fileKey });
    setActiveConversation(prev => prev?.id === activeConversation.id ? { ...prev, ...response.data } : prev);
    setGroupsList(prev => prev.map(group => group.id === activeConversation.id ? { ...group, ...response.data } : group));
    setConversationList(prev => prev.map(conversation => conversation.id === activeConversation.id ? { ...conversation, ...response.data } : conversation));
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeConversation) return;
    const isSelf = userId === currentUser?.id;
    const isConfirmed = await confirm({
      title: isSelf ? "Gruptan Çık" : "Üyeyi Çıkar",
      message: isSelf 
        ? "Bu gruptan çıkmak istediğinize emin misiniz? Bu gruptaki mesaj geçmişine artık erişemeyeceksiniz." 
        : "Bu üyeyi gruptan çıkarmak istediğinize emin misiniz?",
      confirmText: isSelf ? "Gruptan Çık" : "Çıkar",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/conversations/group/${activeConversation.id}/participants/${userId}`);
      setGroupMembers(prev => prev.filter(member => member.id !== userId));
      if (isSelf) { setIsGroupSettingsOpen(false); setActiveConversation(null); setGroupsList(prev => prev.filter(g => g.id !== activeConversation.id)); }
    } catch { alert("Kişi çıkarılamadı."); }
  };

  const handleDeleteGroup = async () => {
    if (!activeConversation) return;
    const isConfirmed = await confirm({
      title: "Grubu Kalıcı Olarak Sil",
      message: "Grubu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz ve gruptaki tüm üyelerin mesaj geçmişi silinir.",
      confirmText: "Grubu Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/conversations/group/${activeConversation.id}`);
      setIsGroupSettingsOpen(false); setActiveConversation(null); setGroupsList(prev => prev.filter(g => g.id !== activeConversation.id));
    } catch { alert("Grup silinirken hata oluştu."); }
  };

  useEffect(() => {
    if (currentView !== 'chat' || !currentUser?.id) return;
    const token = getAccessToken();
    // Chat ekranına girildiğinde tek Socket.IO bağlantısı kurulur.
    // Socket auth token'ı access token'dır; refresh token socket'e gönderilmez.
    const newSocket = io(API_ORIGIN, { auth: { token } }) as unknown as TypedSocket;
    setSocket(newSocket);

    const reconnectSocketIfActive = async () => {
      // Kullanıcı uzun süre pasif kaldıysa socket'i otomatik geri açmayız.
      // Ama kullanıcı aktifse ve bağlantı kopmuşsa önce yeni access token alıp socket'i yeniden bağlarız.
      const isStillActive = Date.now() - lastUserActivityAtRef.current < SOCKET_INACTIVITY_TIMEOUT_MS;
      if (!isSocketActiveRef.current || !isStillActive || newSocket.connected) return;
      setSocketConnectionStatus('reconnecting');
      try {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        const currentToken = getAccessToken() || (await refreshAccessSession()).accessToken;
        newSocket.auth = { token: currentToken };
        newSocket.connect();
      } catch {
        setSocketConnectionStatus('disconnected');
      }
    };

    const markSocketActive = (e?: Event) => {
      // Mouse/klavye/scroll gibi gerçek kullanıcı hareketleri buraya düşer.
      // Bu hareketler hem frontend timer'ını yeniler hem backend'e client_activity ping'i gönderir.
      const wasInactive = !isSocketActiveRef.current;
      
      // Eğer kullanıcı inaktif durumdaysa ve sadece fareyi oynattıysa/scroll ettiyse otomatik bağlamıyoruz.
      // Yeniden bağlanmak için tıklamalı, tuşa basmalı, ekrana dokunmalı veya doğrudan "Bağlan" butonunu kullanmalıdır.
      if (wasInactive && e && (e.type === 'mousemove' || e.type === 'wheel')) {
        return;
      }

      isSocketActiveRef.current = true;
      lastUserActivityAtRef.current = Date.now();

      if (socketInactivityTimerRef.current) clearTimeout(socketInactivityTimerRef.current);
      socketInactivityTimerRef.current = setTimeout(() => {
        isSocketActiveRef.current = false;
        setSocketConnectionStatus('inactive');
        if (newSocket.connected) newSocket.disconnect();
      }, SOCKET_INACTIVITY_TIMEOUT_MS);

      if (newSocket.connected && Date.now() - lastSocketActivityPingRef.current > SOCKET_ACTIVITY_PING_INTERVAL_MS) {
        lastSocketActivityPingRef.current = Date.now();
        newSocket.emit('client_activity');
      }

      if (wasInactive) void reconnectSocketIfActive();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) markSocketActive();
    };

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart', 'pointerdown'];
    // Aktivite eventleri sayesinde kullanıcı gerçekten bilgisayar başındaysa online kalır.
    // Sadece arka planda refresh token yenileniyor diye kullanıcı online gösterilmez.
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markSocketActive, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    markSocketActive();

    // Yeni access token geldiğinde bağlı socket'i yeniden başlatmayız; token sonraki bağlantıda kullanılır.
    const unsubscribeToken = subscribeAccessToken((nextToken) => {
      newSocket.auth = { token: nextToken };
      if (nextToken && !newSocket.connected && isSocketActiveRef.current) void reconnectSocketIfActive();
    });

    newSocket.on('connect', () => {
      // Socket tekrar bağlandığında kişisel odaya, grup odalarına ve aktif konuşma odasına yeniden katılır.
      // Socket.IO reconnect sonrasında oda üyelikleri server tarafında yeniden kurulmalıdır.
      setSocketConnectionStatus('connected');
      lastSocketActivityPingRef.current = Date.now();
      newSocket.emit('client_activity');
      if (currentUserRef.current) newSocket.emit('odaya_katil', currentUserRef.current.id);
      groupsListRef.current.forEach((group) => newSocket.emit('odaya_katil', group.id));
      if (activeConversationRef.current) newSocket.emit('odaya_katil', activeConversationRef.current.id);

      // Çevrim dışıyken (bağlantı kopukken) gelen kaçırılmış mesajları ve bildirimleri senkronize et
      void fetchConversations();
      void fetchUnreadCounts();
      if (activeConversationRef.current) {
        api.get(`/conversations/${activeConversationRef.current.id}/messages`)
          .then((msgs) => {
            setMessages(msgs.data);
            // Aktif konuşmayı okundu olarak işaretle
            void api.post(`/conversations/${activeConversationRef.current!.id}/read`, {
              emitReceipt: activeConversationRef.current!.isGroup ? true : (currentUserRef.current?.readReceiptsOn !== false)
            });
            // Okunmamış sayaçlarını sıfırla
            setUnreadCounts(prev => ({
              ...prev,
              [activeConversationRef.current!.id]: 0,
              ...(activeConversationRef.current!.otherUser ? { [activeConversationRef.current!.otherUser.id]: 0 } : {})
            }));
          })
          .catch((err) => console.error("Aktif sohbet mesajları eşitlenemedi:", err));
      }
    });

    newSocket.on('disconnect', (reason) => {
      const isStillActive = Date.now() - lastUserActivityAtRef.current < SOCKET_INACTIVITY_TIMEOUT_MS;
      if (!isSocketActiveRef.current || !isStillActive) {
        isSocketActiveRef.current = false;
        setSocketConnectionStatus('inactive');
        return;
      }
      setSocketConnectionStatus('disconnected');
      if (reason !== 'io server disconnect') return;
      void refreshAccessSession().then(({ accessToken }) => {
        newSocket.auth = { token: accessToken };
        newSocket.connect();
      }).catch(() => undefined);
    });

    newSocket.off('yeni_mesaj_geldi'); newSocket.off('mesajlar_okundu');

    newSocket.on('yeni_mesaj_geldi', (gelenMesaj: Message) => {
      // Aynı mesaj hem conversation odasından hem userId odasından gelebilir.
      // processedMessagesRef çift eklemeyi engeller.
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      processedMessagesRef.current.add(gelenMesaj.id);
      void fetchConversations();

      const notificationConversation = conversationListRef.current.find((conversation) => conversation.id === gelenMesaj.conversationId);
      if (!notificationConversation?.isMuted && gelenMesaj.senderId !== currentUserRef.current?.id && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        // Browser bildirimi yalnızca sayfa arka plandayken, sohbet sessizde değilken ve mesaj başkasından geldiyse gösterilir.
        new Notification(gelenMesaj.sender?.username || 'Yeni mesaj', {
          body: gelenMesaj.content || (gelenMesaj.fileType === 'image' ? '📷 Görsel' : '📎 Dosya')
        });
      }

      const isKnownGroup = groupsListRef.current.some(g => g.id === gelenMesaj.conversationId);
      const isBackendToldUsGroup = gelenMesaj.conversation?.isGroup === true;

     if (activeConversationRef.current?.id === gelenMesaj.conversationId) {
      autoScrollRef.current = true; // Karşıdan canlı mesaj geldi, en alta in!
        setMessages((prev) => { if (prev.some(m => m.id === gelenMesaj.id)) return prev; return [...prev, gelenMesaj]; });

        if (currentUserRef.current) {
          // Grup receipt'i üye sayımı için zorunlu, birebir sohbette kullanıcı tercihine bağlıdır.
          const isGrupMesaji = gelenMesaj.conversation?.isGroup === true || groupsListRef.current.some(g => g.id === gelenMesaj.conversationId);
          const okunduGonder = isGrupMesaji ? true : currentUserRef.current.readReceiptsOn !== false;

          api.post(`/conversations/${gelenMesaj.conversationId}/read`, {
            emitReceipt: okunduGonder
          }).catch(console.error);
        }
      }
      else {
        if (isKnownGroup || isBackendToldUsGroup) {
          setUnreadCounts((prev) => ({ ...prev, [gelenMesaj.conversationId]: (prev[gelenMesaj.conversationId] || 0) + 1 }));
          if (!isKnownGroup && currentUserRef.current) { fetchGroups(); newSocket.emit('odaya_katil', gelenMesaj.conversationId); }
        } else {
          if (currentUserRef.current) { fetchGroups(); fetchUnreadCounts(); newSocket.emit('odaya_katil', gelenMesaj.conversationId); }
        }
      }
    });

    newSocket.on('mesajlar_okundu', ({ conversationId, readByUserId }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setMessages(prev => prev.map(msg => {
          const isAlreadyRead = msg.readByIds?.includes(readByUserId);
          if (msg.senderId !== readByUserId && !isAlreadyRead) return { ...msg, readByIds: [...(msg.readByIds || []), readByUserId] };
          return msg;
        }));
      }
    });

    // Mesaj mutasyonları aktif sohbeti ve son mesaj önizlemesini birlikte günceller.
    newSocket.on('mesaj_guncellendi', (updatedMsg: Message) => {
      if (activeConversationRef.current?.id === updatedMsg.conversationId) {
        setMessages(prev => prev.map(msg => msg.id === updatedMsg.id ? updatedMsg : msg));
      }
      void fetchConversations();
    });

    newSocket.on('mesaj_silindi', (data: { messageId: string, conversationId: string }) => {
      if (activeConversationRef.current?.id === data.conversationId) {
        setMessages(prev => prev.filter(msg => msg.id !== data.messageId));
      }
      void fetchConversations();
    });

    newSocket.on('sohbet_ayarlari_guncellendi', (data: { conversationId: string; disappearingDurationSeconds: number | null }) => {
      setConversationList(prev => prev.map(conversation => conversation.id === data.conversationId
        ? { ...conversation, disappearingDurationSeconds: data.disappearingDurationSeconds }
        : conversation));
      setActiveConversation(prev => prev?.id === data.conversationId
        ? { ...prev, disappearingDurationSeconds: data.disappearingDurationSeconds }
        : prev);
    });

    newSocket.on('presence_snapshot', ({ onlineUserIds }: { onlineUserIds: string[] }) => {
      onlineUserIdsRef.current = new Set(onlineUserIds);
      const online = onlineUserIdsRef.current;
      setUsersList((previous) => previous.map((user) => {
        const shouldHide = user.isBlocked || user.blockedByOther;
        return { ...user, isOnline: shouldHide ? false : online.has(user.id) };
      }));
      setSelectedUser((previous) => {
        if (!previous) return previous;
        const shouldHide = previous.isBlocked || previous.blockedByOther;
        return { ...previous, isOnline: shouldHide ? false : online.has(previous.id) };
      });
      setConversationList((previous) => previous.map((conversation) => {
        if (!conversation.otherUser) return conversation;
        const shouldHide = conversation.otherUser.isBlocked || conversation.otherUser.blockedByOther;
        return {
          ...conversation,
          otherUser: {
            ...conversation.otherUser,
            isOnline: shouldHide ? false : online.has(conversation.otherUser.id)
          }
        };
      }));
    });

    newSocket.on('presence_changed', ({ userId, isOnline, lastSeenAt }: { userId: string; isOnline: boolean; lastSeenAt?: string | null }) => {
      if (isOnline) {
        onlineUserIdsRef.current.add(userId);
      } else {
        onlineUserIdsRef.current.delete(userId);
      }
      setUsersList((previous) => previous.map((user) => {
        if (user.id !== userId) return user;
        const shouldHide = user.isBlocked || user.blockedByOther;
        return { ...user, isOnline: shouldHide ? false : isOnline, lastSeenAt: shouldHide ? undefined : (lastSeenAt || user.lastSeenAt) };
      }));
      setSelectedUser((previous) => {
        if (previous?.id !== userId) return previous;
        const shouldHide = previous.isBlocked || previous.blockedByOther;
        return { ...previous, isOnline: shouldHide ? false : isOnline, lastSeenAt: shouldHide ? undefined : (lastSeenAt || previous.lastSeenAt) };
      });
      setConversationList((previous) => previous.map((conversation) => {
        if (conversation.otherUser?.id !== userId) return conversation;
        const shouldHide = conversation.otherUser.isBlocked || conversation.otherUser.blockedByOther;
        return {
          ...conversation,
          otherUser: {
            ...conversation.otherUser,
            isOnline: shouldHide ? false : isOnline,
            lastSeenAt: shouldHide ? undefined : (lastSeenAt || conversation.otherUser.lastSeenAt)
          }
        };
      }));
    });

    newSocket.on('user_blocked_you', ({ blockerId }: { blockerId: string }) => {
      setUsersList(prev => prev.map(u => u.id === blockerId ? { ...u, blockedByOther: true, isOnline: false, lastSeenAt: undefined } : u));
      setSelectedUser(prev => prev?.id === blockerId ? { ...prev, blockedByOther: true, isOnline: false, lastSeenAt: undefined } : prev);
      setConversationList(prev => prev.map(c => c.otherUser?.id === blockerId ? { ...c, otherUser: { ...c.otherUser, blockedByOther: true, isOnline: false, lastSeenAt: undefined } } : c));
    });

    newSocket.on('user_unblocked_you', ({ blockerId }: { blockerId: string }) => {
      setUsersList(prev => prev.map(u => u.id === blockerId ? { ...u, blockedByOther: false } : u));
      setSelectedUser(prev => prev?.id === blockerId ? { ...prev, blockedByOther: false } : prev);
      setConversationList(prev => prev.map(c => c.otherUser?.id === blockerId ? { ...c, otherUser: { ...c.otherUser, blockedByOther: false } } : c));
    });

    newSocket.on('user_blocked_target', ({ targetId }: { targetId: string }) => {
      setUsersList(prev => prev.map(u => u.id === targetId ? { ...u, isBlocked: true, isOnline: false, lastSeenAt: undefined } : u));
      setSelectedUser(prev => prev?.id === targetId ? { ...prev, isBlocked: true, isOnline: false, lastSeenAt: undefined } : prev);
      setConversationList(prev => prev.map(c => c.otherUser?.id === targetId ? { ...c, otherUser: { ...c.otherUser, isBlocked: true, isOnline: false, lastSeenAt: undefined } } : c));
    });

    newSocket.on('user_unblocked_target', ({ targetId }: { targetId: string }) => {
      setUsersList(prev => prev.map(u => u.id === targetId ? { ...u, isBlocked: false } : u));
      setSelectedUser(prev => prev?.id === targetId ? { ...prev, isBlocked: false } : prev);
      setConversationList(prev => prev.map(c => c.otherUser?.id === targetId ? { ...c, otherUser: { ...c.otherUser, isBlocked: false } } : c));
    });

    newSocket.on('kullanici_eklendi', (user: User) => {
      if (user.id === currentUserRef.current?.id) return;
      setUsersList(previous => previous.some(existing => existing.id === user.id)
        ? previous
        : [...previous, { ...user, isOnline: false }]);
    });

    newSocket.on('voice_recording_changed', ({ conversationId, username, isRecording }: { conversationId: string; username: string; isRecording: boolean }) => {
      setRecordingByConversation((previous) => {
        if (!isRecording) {
          const updated = { ...previous };
          delete updated[conversationId];
          return updated;
        }
        return { ...previous, [conversationId]: username };
      });
    });

    newSocket.on('typing_changed', ({ conversationId, gameChannelId, username, isTyping }: { conversationId: string; gameChannelId?: string | null; username: string; isTyping: boolean }) => {
      if (gameChannelId) return;
      // Yazıyor bilgisi conversation bazlı tutulur.
      // Aynı state hem Sidebar son mesaj alanını hem ChatArea üst bilgisini günceller.
      const conversation = conversationListRef.current.find(c => c.id === conversationId);
      if (conversation && !conversation.isGroup && conversation.otherUser) {
        const shouldHide = conversation.otherUser.isBlocked || conversation.otherUser.blockedByOther;
        if (shouldHide) return;
      }

      setTypingByConversation((previous) => {
        if (!isTyping) {
          const next = { ...previous };
          delete next[conversationId];
          return next;
        }
        return { ...previous, [conversationId]: username };
      });
    });

    newSocket.on('call:incoming', (call: IncomingCall) => {
      if (call.caller.id === currentUserRef.current?.id) return;

      if (activeCallRef.current || incomingCallRef.current) {
        newSocket.emit('call:declined', {
          conversationId: call.conversationId,
          callId: call.callId,
          callType: call.callType
        });
        return;
      }

      rememberCall({
        callId: call.callId,
        conversationId: call.conversationId,
        title: call.isGroup && call.conversationName ? call.conversationName : call.caller.username,
        callType: call.callType,
        direction: 'incoming',
        status: 'missed',
        createdAt: new Date().toISOString()
      });
      setIncomingCall(call);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(call.callType === 'video' ? 'Görüntülü çağrı' : 'Sesli çağrı', {
          body: `${call.caller.username} arıyor`
        });
      }
    });

    newSocket.on('call:declined', ({ callId, user }: { callId: string; user?: { username?: string } }) => {
      if (activeCallRef.current?.callId !== callId) return;
      updateCallStatus(callId, 'declined');
      if (user?.username) console.info(`${user.username} çağrıyı reddetti.`);
    });

    newSocket.on('call:ended', ({ callId }: { callId: string }) => {
      updateCallStatus(callId, 'ended');
      if (activeCallRef.current?.callId === callId) setActiveCall(null);
      if (incomingCallRef.current?.callId === callId) setIncomingCall(null);
    });

    newSocket.on('grup_olusturuldu', (yeniGrup: Conversation) => {
      setGroupsList(prev => { if (prev.some(g => g.id === yeniGrup.id)) return prev.map(g => g.id === yeniGrup.id ? { ...g, ...yeniGrup, isActive: true } : g); return [...prev, yeniGrup]; });
      setConversationList(prev => { if (prev.some(conversation => conversation.id === yeniGrup.id)) return prev.map(c => c.id === yeniGrup.id ? { ...c, ...yeniGrup, isActive: true } : c); return [yeniGrup, ...prev]; });
      setActiveConversation(prev => prev?.id === yeniGrup.id ? { ...prev, ...yeniGrup, isActive: true } : prev);
      newSocket.emit('odaya_katil', yeniGrup.id);
      void fetchGroups();
      void fetchConversations();
    });

    newSocket.on('grup_guncellendi', (updatedGroup: Conversation) => {
      setGroupsList(prev => prev.map(group => group.id === updatedGroup.id ? { ...group, ...updatedGroup } : group));
      setConversationList(prev => prev.map(conversation => conversation.id === updatedGroup.id ? { ...conversation, ...updatedGroup } : conversation));
      setActiveConversation(prev => prev?.id === updatedGroup.id ? { ...prev, ...updatedGroup } : prev);
    });

    newSocket.on('yeni_grup_bildirimi', () => {
      if (currentUserRef.current) {
        void fetchGroups();
        void fetchConversations();
      }
    });

    newSocket.on('gruptan_atildi', (data: { groupId: string, removedUserId: string, removedById?: string }) => {
      if (data.removedUserId === currentUserRef.current?.id) {
        alert(data.removedById === currentUserRef.current?.id ? "Gruptan başarıyla çıkıldı." : "Grup yöneticisi sizi gruptan çıkardı.");
        setGroupsList(prev => prev.map(g => g.id === data.groupId ? { ...g, isActive: false } : g));
        setConversationList(prev => prev.map(c => c.id === data.groupId ? { ...c, isActive: false } : c));
        setActiveConversation(prev => prev?.id === data.groupId ? { ...prev, isActive: false } : prev);
        void fetchGroups();
        void fetchConversations();
      } else {
        if (activeConversationRef.current?.id === data.groupId) {
          setGroupMembers(prev => prev.map(m => m.id === data.removedUserId ? { ...m, isActive: false } : m));
        }
      }
    });

    newSocket.on('grup_yonetici_degisti', (data: { groupId: string, newAdminId: string }) => {
      setGroupsList(prev => prev.map(group => group.id === data.groupId ? { ...group, adminId: data.newAdminId } : group));
      setConversationList(prev => prev.map(c => c.id === data.groupId ? { ...c, adminId: data.newAdminId } : c));
      setActiveConversation(prev => prev?.id === data.groupId ? { ...prev, adminId: data.newAdminId } : prev);
    });

    newSocket.on('grup_uyeleri_eklendi', ({ groupId, newMembers }: { groupId: string, newMembers: User[] }) => {
      if (activeConversationRef.current?.id === groupId) {
        setGroupMembers(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filtered = newMembers.filter(m => !existingIds.has(m.id));
          const updatedPrev = prev.map(m => {
            const addedBack = newMembers.find(nm => nm.id === m.id);
            return addedBack ? { ...m, ...addedBack, isActive: true } : m;
          });
          return [...updatedPrev, ...filtered];
        });
      }
    });

    newSocket.on('grup_silindi', (data: { groupId: string }) => {
      alert("Bu grup yönetici tarafından kalıcı olarak silindi.");
      setGroupsList(prev => prev.filter(g => g.id !== data.groupId));
      setConversationList(prev => prev.filter(conversation => conversation.id !== data.groupId));
      setActiveConversation(prev => prev?.id === data.groupId ? null : prev);
    });

    newSocket.on('kullanici_silindi', (data: {
      userId: string;
      conversationIds: string[];
      deletedGroupIds: string[];
      updatedGroups: Array<{ groupId: string; removedUserId: string; newAdminId: string | null }>;
    }) => {
      setUsersList(prev => prev.filter(user => user.id !== data.userId));
      setConversationList(prev => prev.filter(conversation =>
        !data.conversationIds.includes(conversation.id) &&
        !data.deletedGroupIds.includes(conversation.id) &&
        conversation.otherUser?.id !== data.userId
      ));
      setGroupsList(prev => prev
        .filter(group => !data.deletedGroupIds.includes(group.id))
        .map(group => {
          const update = data.updatedGroups.find(item => item.groupId === group.id);
          return update?.newAdminId ? { ...group, adminId: update.newAdminId } : group;
        }));
      setGroupMembers(prev => prev.filter(member => member.id !== data.userId));
      setActiveConversation(prev => {
        if (!prev) return prev;
        if (data.deletedGroupIds.includes(prev.id) || data.conversationIds.includes(prev.id)) return null;
        const update = data.updatedGroups.find(item => item.groupId === prev.id);
        return update?.newAdminId ? { ...prev, adminId: update.newAdminId } : prev;
      });
      setUnreadCounts(prev => {
        const next = { ...prev };
        delete next[data.userId];
        data.conversationIds.forEach(id => delete next[id]);
        data.deletedGroupIds.forEach(id => delete next[id]);
        return next;
      });
      if (selectedUserRef.current?.id === data.userId || (activeConversationRef.current && data.conversationIds.includes(activeConversationRef.current.id))) {
        setSelectedUser(null);
        setMessages([]);
      }
    });

    return () => {
      unsubscribeToken();
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markSocketActive));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (socketInactivityTimerRef.current) clearTimeout(socketInactivityTimerRef.current);
      socketInactivityTimerRef.current = null;
      newSocket.disconnect();
    };
  }, [currentView, currentUser?.id]);

  useEffect(() => { if (socket && currentUser) socket.emit('odaya_katil', currentUser.id); }, [socket, currentUser]);
  useEffect(() => { if (socket && groupsList.length > 0) groupsList.forEach(group => socket.emit('odaya_katil', group.id)); }, [socket, groupsList]);

  const closeChat = () => { setActiveConversation(null); setSelectedUser(null); };

  const reconnectRealtime = async () => {
    if (!socket) return;
    try {
      isSocketActiveRef.current = true;
      lastUserActivityAtRef.current = Date.now();
      setSocketConnectionStatus('reconnecting');
      await new Promise(resolve => window.setTimeout(resolve, 1000));
      const { accessToken } = await refreshAccessSession();
      socket.auth = { token: accessToken };
      socket.connect();
    } catch {
      setSocketConnectionStatus('disconnected');
    }
  };

  const handleToggleConversationPin = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/pin`);
      setConversationList(prev => prev
        .map(conversation => conversation.id === conversationId ? { ...conversation, isPinned: response.data.isPinned } : conversation)
        .sort((a, b) => Number(b.isPinned) - Number(a.isPinned)));
      setActiveConversation(prev => prev?.id === conversationId ? { ...prev, isPinned: response.data.isPinned } : prev);
    } catch { alert('Sohbet sabitleme durumu güncellenemedi.'); }
  };

  const handleToggleConversationArchive = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/archive`);
      setConversationList(prev => prev.map(conversation => conversation.id === conversationId ? { ...conversation, isArchived: response.data.isArchived } : conversation));
      setActiveConversation(prev => prev?.id === conversationId ? { ...prev, isArchived: response.data.isArchived } : prev);
    } catch { alert('Sohbet arşiv durumu güncellenemedi.'); }
  };

  const handleToggleConversationMute = async (conversationId: string) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/mute`);
      setConversationList(prev => prev.map(conversation => conversation.id === conversationId ? { ...conversation, isMuted: response.data.isMuted } : conversation));
      setActiveConversation(prev => prev?.id === conversationId ? { ...prev, isMuted: response.data.isMuted } : prev);
    } catch { alert('Sohbet sessize alma durumu gÃ¼ncellenemedi.'); }
  };

  const handleSetDisappearingMode = async (conversationId: string, durationSeconds: number | null) => {
    try {
      const response = await api.put(`/conversations/${conversationId}/disappearing`, { durationSeconds });
      setConversationList(prev => prev.map(conversation => conversation.id === conversationId ? { ...conversation, disappearingDurationSeconds: response.data.disappearingDurationSeconds } : conversation));
      setActiveConversation(prev => prev?.id === conversationId ? { ...prev, disappearingDurationSeconds: response.data.disappearingDurationSeconds } : prev);
    } catch { alert('Kaybolan mesaj modu güncellenemedi.'); }
  };

  const cikisYap = () => {
    void closeRefreshSession().catch(() => undefined);
    resetClientSession();
  };

  if (currentView === 'login' || currentView === 'register') return <Auth onLoginSuccess={onLoginSuccess} />;

  return (
    <div className={`app-container ${(activeConversation || selectedUser) ? 'chat-active' : ''}`}>
      {appMode === 'chat' && currentUser && (
       <Sidebar
          currentUser={currentUser} conversationList={conversationList} usersList={usersList} activeConversation={activeConversation} selectedUser={selectedUser} unreadCounts={unreadCounts}
          startGroupChat={startGroupChat} startChat={startChat} setIsGroupModalOpen={setIsGroupModalOpen} setIsSettingsOpen={setIsSettingsOpen} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode}
          // Sidebar gerçek zamanlı durumları kendi içinde gösterebilmek için socket status ve typing map alır.
          socketConnectionStatus={socketConnectionStatus}
          onReconnectRealtime={reconnectRealtime}
          typingByConversation={typingByConversation}
          callHistory={callHistory}
          onOpenGameMode={() => setIsGameModePromptOpen(true)}
          onViewOwnAvatar={() => setIsAvatarViewerOpen(true)}
        />
      )}

      {appMode === 'chat' && currentUser && (
        <ChatArea
          currentUser={currentUser} activeConversation={activeConversation} selectedUser={selectedUser} messages={messages} newMessage={newMessage} setNewMessage={setNewMessage}
          mesajGonder={mesajGonder} messagesEndRef={messagesEndRef} openGroupSettings={openGroupSettings} closeChat={closeChat} isDarkMode={isDarkMode} usersList={usersList} groupMembers={groupMembers}
          loadMoreMessages={loadMoreMessages}
          socketConnectionStatus={socketConnectionStatus}
          onStartDirectChat={startChat}
          onStartCallWithUser={startCallWithUser}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          // Aktif konuşmada biri yazıyorsa ChatArea header'ında gösterilir.
          typingUsername={activeConversation ? typingByConversation[activeConversation.id] : undefined}
          recordingUsername={activeConversation ? recordingByConversation[activeConversation.id] : undefined}
          onVoiceRecording={(isRecording) => {
            if (!activeConversation || !socket) return;
            const current = lastSentRecordingRef.current;
            if (current && current.conversationId === activeConversation.id && current.isRecording === isRecording) {
              return;
            }
            lastSentRecordingRef.current = { conversationId: activeConversation.id, isRecording };
            socket.emit('voice_recording_changed', { conversationId: activeConversation.id, isRecording });
          }}
          onTyping={(isTyping) => {
            if (!activeConversation || !socket) return;
            const current = lastSentTypingRef.current;
            if (current && current.conversationId === activeConversation.id && current.isTyping === isTyping) {
              return;
            }
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

      {appMode === 'game' && currentUser && (
        <GameHub 
          currentUser={currentUser} 
          groups={groupsList} 
          users={usersList} 
          socket={socket} 
          onExit={() => changeAppMode('chat')} 
          onStartDirectChat={(targetUser: User) => {
            changeAppMode('chat');
            void startChat(targetUser);
          }}
        />
      )}

      {isGameModePromptOpen && (
        <div className="game-mode-prompt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsGameModePromptOpen(false); }}>
          <section className="game-mode-prompt" role="dialog" aria-modal="true" aria-labelledby="game-mode-title">
            <div className="game-mode-prompt-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8h7a5 5 0 0 1 4.7 3.3l1.3 3.7a3 3 0 0 1-5.1 3l-1.5-1.8H9.1L7.6 18a3 3 0 0 1-5.1-3l1.3-3.7A5 5 0 0 1 8.5 8ZM7 11v4m-2-2h4m8-1h.01M19 14h.01" /></svg></div>
            <h2 id="game-mode-title">Oyun moduna geçilsin mi?</h2>
            <p>Grubuna bağlı yazı ve kalıcı ses kanallarını açabilir, arkadaşlarınla anında konuşabilirsin.</p>
            <div className="game-mode-prompt-actions"><button onClick={() => setIsGameModePromptOpen(false)}>Vazgeç</button><button className="primary" onClick={() => { setIsGameModePromptOpen(false); changeAppMode('game'); }}>Oyun moduna geç</button></div>
          </section>
        </div>
      )}

      {isGroupModalOpen && (
        <CreateGroupModal setIsGroupModalOpen={setIsGroupModalOpen} newGroupName={newGroupName} setNewGroupName={setNewGroupName} usersList={usersList} selectedMembers={selectedMembers} toggleMemberSelection={toggleMemberSelection} handleCreateGroup={handleCreateGroup} />
      )}

      {isGroupSettingsOpen && activeConversation && (
        <GroupSettingsModal setIsGroupSettingsOpen={setIsGroupSettingsOpen} activeConversation={activeConversation} currentUser={currentUser} handleUpdateGroupName={handleUpdateGroupName} handleUpdateGroupAvatar={handleUpdateGroupAvatar} groupMembers={groupMembers} handleRemoveMember={handleRemoveMember} handleDeleteGroup={handleDeleteGroup} usersList={usersList} handleAddMembersToGroup={handleAddMembersToGroup} handleTransferAdmin={handleTransferAdmin} startChat={startChat} />
      )}

      {isSettingsOpen && (
        <SettingsModal setIsSettingsOpen={setIsSettingsOpen} settingsMessage={settingsMessage} setSettingsMessage={setSettingsMessage} newUsernameSettings={newUsernameSettings} setNewUsernameSettings={setNewUsernameSettings} handleUpdateUsername={handleUpdateUsername} newEmailSettings={newEmailSettings} setNewEmailSettings={setNewEmailSettings} handleUpdateEmail={handleUpdateEmail} currentUser={currentUser} handleToggleReadReceipts={handleToggleReadReceipts} oldPasswordSettings={oldPasswordSettings} setOldPasswordSettings={setOldPasswordSettings} newPasswordSettings={newPasswordSettings} setNewPasswordSettings={setNewPasswordSettings} handleUpdatePassword={handleUpdatePassword} handleUpdateAvatar={handleUpdateAvatar} handleDeleteAccount={handleDeleteAccount} cikisYap={cikisYap} />
      )}
      {isAvatarViewerOpen && currentUser && (
        <AvatarViewerModal
          avatarUrl={currentUser.avatarUrl}
          username={currentUser.username}
          onClose={() => setIsAvatarViewerOpen(false)}
        />
      )}
      {incomingCall && (
        <IncomingCallPrompt
          call={incomingCall}
          onAccept={acceptIncomingCall}
          onDecline={declineIncomingCall}
        />
      )}

      {activeCall && (
        <CallModal
          call={activeCall}
          title={getCallTitle(activeCall.conversationId, activeCall.conversation?.name)}
          onClose={closeActiveCall}
        />
      )}
    </div>
  );
}
