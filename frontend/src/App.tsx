import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

import Auth from './components/Auth/Auth';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import CreateGroupModal from './components/Modals/CreateGroupModal';
import GroupSettingsModal from './components/Modals/GroupSettingsModal';
import SettingsModal from './components/Modals/SettingsModal';
import { api } from './api/httpClient';
import { API_ORIGIN } from './config/runtime';
import type { Conversation, Message, User } from './types/chat';
import {
  closeRefreshSession,
  getAccessToken,
  refreshAccessSession,
  setAccessToken,
  subscribeAccessToken
} from './auth/tokenStore';

export default function App() {
  const [currentView, setCurrentView] = useState<'login' | 'register' | 'chat'>('login');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [groupsList, setGroupsList] = useState<Conversation[]>([]);
  const [conversationList, setConversationList] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newUsernameSettings, setNewUsernameSettings] = useState('');
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
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});

  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const groupsListRef = useRef<Conversation[]>([]);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const autoScrollRef = useRef(true);

  const resetClientSession = () => {
    setAccessToken(null);
    setCurrentUser(null); setSelectedUser(null); setActiveConversation(null);
    setMessages([]); setGroupsList([]); setConversationList([]); setUnreadCounts({});
    setIsSettingsOpen(false); setIsGroupModalOpen(false); setIsGroupSettingsOpen(false); setCurrentView('login');
  };

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
  useEffect(() => { if (autoScrollRef.current) { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); } }, [messages]);
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
    if (!window.confirm("Hesabınızı ve tüm verilerinizi kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try { await api.delete('/user/account'); alert("Hesabınız silindi."); cikisYap(); }
    catch { alert("Hesap silinirken hata oluştu."); }
  };

  const handleToggleReadReceipts = async (isEnabled: boolean) => {
    setCurrentUser(prev => prev ? {...prev, readReceiptsOn: isEnabled} : null);
    try { await api.put('/user/settings/read-receipts', { isEnabled }); }
    catch { console.error("Ayar kaydedilemedi."); }
  };

  const fetchUsers = async () => {
    try { const res = await api.get('/users'); setUsersList(res.data); }
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

  const fetchConversations = async () => {
    try { const res = await api.get('/conversations'); setConversationList(res.data); }
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
    setSelectedUser(targetUser);
    setHasMore(true);
    try {
      const res = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      setActiveConversation({ ...res.data, otherUser: targetUser });
      const msgs = await api.get(`/conversations/${res.data.id}/messages`);
      autoScrollRef.current = true;
      setMessages(msgs.data);

      if (currentUser) {
        await api.post(`/conversations/${res.data.id}/read`, { emitReceipt: currentUser.readReceiptsOn !== false });
        setUnreadCounts(prev => ({ ...prev, [targetUser.id]: 0, [res.data.id]: 0 }));
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
    if (!newGroupName.trim() || selectedMembers.length === 0) return alert("Grup adı ve en az 1 kişi seçin!");
    try {
      const res = await api.post('/conversations/group', { name: newGroupName, participantIds: selectedMembers });
      setIsGroupModalOpen(false); setNewGroupName(''); setSelectedMembers([]);
      const groupId = res.data?.id;

      if (currentUser && groupId) {
        setGroupsList(prev => [...prev, { id: groupId, isGroup: true, name: newGroupName, adminId: currentUser.id }]);
        if (socket) socket.emit('odaya_katil', groupId);
        selectedMembers.forEach(memberId => socket?.emit('yeni_grup_bildirimi', { groupId, memberId }));
        setTimeout(() => fetchGroups(), 500);
      } else { if (currentUser) setTimeout(() => fetchGroups(), 500); }
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
    if (!activeConversation || !window.confirm("Yöneticiliği devretmek istediğinize emin misiniz?")) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/admin`, { newAdminId });
      setActiveConversation({ ...activeConversation, adminId: newAdminId });
      setGroupsList(prev => prev.map(g => g.id === activeConversation.id ? { ...g, adminId: newAdminId } : g));
    } catch { alert("Yetki devredilemedi."); }
  };

  const toggleMemberSelection = (userId: string) => { setSelectedMembers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]); };

  const openGroupSettings = async () => {
    if (!activeConversation) return;
    setIsGroupSettingsOpen(true); setEditGroupName(activeConversation.name || '');
    try { const res = await api.get(`/conversations/group/${activeConversation.id}/participants`); setGroupMembers(res.data); }
    catch { console.error("Üyeler alınamadı"); }
  };

  const handleUpdateGroupName = async () => {
    if (!activeConversation || !editGroupName.trim()) return;
    try {
      await api.put(`/conversations/group/${activeConversation.id}/name`, { newName: editGroupName });
      setActiveConversation({ ...activeConversation, name: editGroupName });
      setGroupsList(prev => prev.map(g => g.id === activeConversation.id ? { ...g, name: editGroupName } : g));
    } catch { alert("Ad güncellenemedi."); }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeConversation || !window.confirm("Bu işlemi yapmak istediğinize emin misiniz?")) return;
    try {
      await api.delete(`/conversations/group/${activeConversation.id}/participants/${userId}`);
      setGroupMembers(prev => prev.filter(member => member.id !== userId));
      if (userId === currentUser?.id) { setIsGroupSettingsOpen(false); setActiveConversation(null); setGroupsList(prev => prev.filter(g => g.id !== activeConversation.id)); }
    } catch { alert("Kişi çıkarılamadı."); }
  };

  const handleDeleteGroup = async () => {
    if (!activeConversation || !window.confirm("Grubu kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try {
      await api.delete(`/conversations/group/${activeConversation.id}`);
      setIsGroupSettingsOpen(false); setActiveConversation(null); setGroupsList(prev => prev.filter(g => g.id !== activeConversation.id));
    } catch { alert("Grup silinirken hata oluştu."); }
  };

  useEffect(() => {
    if (currentView !== 'chat' || !currentUser?.id) return;
    const token = getAccessToken();
    const newSocket = io(API_ORIGIN, { auth: { token } });
    setSocket(newSocket);

    // Yeni access token geldiğinde socket yeniden doğrulanır ve odalar connect olayında geri yüklenir.
    const unsubscribeToken = subscribeAccessToken((nextToken) => {
      const wasConnected = newSocket.connected;
      newSocket.auth = { token: nextToken };
      if (nextToken && wasConnected) {
        newSocket.disconnect();
        newSocket.connect();
      }
    });

    newSocket.on('connect', () => {
      if (currentUserRef.current) newSocket.emit('odaya_katil', currentUserRef.current.id);
      groupsListRef.current.forEach((group) => newSocket.emit('odaya_katil', group.id));
      if (activeConversationRef.current) newSocket.emit('odaya_katil', activeConversationRef.current.id);
    });

    newSocket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect') return;
      void refreshAccessSession().then(({ accessToken }) => {
        newSocket.auth = { token: accessToken };
        newSocket.connect();
      }).catch(() => undefined);
    });

    newSocket.off('yeni_mesaj_geldi'); newSocket.off('mesajlar_okundu');

    newSocket.on('yeni_mesaj_geldi', (gelenMesaj: Message) => {
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      processedMessagesRef.current.add(gelenMesaj.id);
      void fetchConversations();

      if (gelenMesaj.senderId !== currentUserRef.current?.id && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
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

    newSocket.on('presence_snapshot', ({ onlineUserIds }: { onlineUserIds: string[] }) => {
      const online = new Set(onlineUserIds);
      setUsersList((previous) => previous.map((user) => ({ ...user, isOnline: online.has(user.id) })));
      setSelectedUser((previous) => previous ? { ...previous, isOnline: online.has(previous.id) } : previous);
      setConversationList((previous) => previous.map((conversation) => conversation.otherUser
        ? { ...conversation, otherUser: { ...conversation.otherUser, isOnline: online.has(conversation.otherUser.id) } }
        : conversation));
    });

    newSocket.on('presence_changed', ({ userId, isOnline, lastSeenAt }: { userId: string; isOnline: boolean; lastSeenAt?: string }) => {
      setUsersList((previous) => previous.map((user) => user.id === userId ? { ...user, isOnline, lastSeenAt: lastSeenAt || user.lastSeenAt } : user));
      setSelectedUser((previous) => previous?.id === userId ? { ...previous, isOnline, lastSeenAt: lastSeenAt || previous.lastSeenAt } : previous);
      setConversationList((previous) => previous.map((conversation) => conversation.otherUser?.id === userId
        ? { ...conversation, otherUser: { ...conversation.otherUser, isOnline, lastSeenAt: lastSeenAt || conversation.otherUser.lastSeenAt } }
        : conversation));
    });

    newSocket.on('typing_changed', ({ conversationId, username, isTyping }: { conversationId: string; username: string; isTyping: boolean }) => {
      setTypingByConversation((previous) => {
        if (!isTyping) {
          const next = { ...previous };
          delete next[conversationId];
          return next;
        }
        return { ...previous, [conversationId]: username };
      });
    });

    newSocket.on('grup_olusturuldu', (yeniGrup: Conversation) => {
      setGroupsList(prev => { if (prev.some(g => g.id === yeniGrup.id)) return prev; return [...prev, yeniGrup]; });
      newSocket.emit('odaya_katil', yeniGrup.id);
    });

    newSocket.on('yeni_grup_bildirimi', () => { if (currentUserRef.current) fetchGroups(); });

    newSocket.on('gruptan_atildi', (data: { groupId: string, removedUserId: string }) => {
      if (data.removedUserId === currentUserRef.current?.id) {
        if (activeConversationRef.current?.adminId !== currentUserRef.current?.id) { alert("Grup yöneticisi sizi gruptan çıkardı."); }
        setGroupsList(prev => prev.filter(g => g.id !== data.groupId)); setActiveConversation(prev => prev?.id === data.groupId ? null : prev);
      }
    });

    newSocket.on('grup_silindi', (data: { groupId: string }) => {
      alert("Bu grup yönetici tarafından kalıcı olarak silindi.");
      setGroupsList(prev => prev.filter(g => g.id !== data.groupId)); setActiveConversation(prev => prev?.id === data.groupId ? null : prev);
    });

    return () => { unsubscribeToken(); newSocket.disconnect(); };
  }, [currentView, currentUser?.id]);

  useEffect(() => { if (socket && currentUser) socket.emit('odaya_katil', currentUser.id); }, [socket, currentUser]);
  useEffect(() => { if (socket && groupsList.length > 0) groupsList.forEach(group => socket.emit('odaya_katil', group.id)); }, [socket, groupsList]);

  const closeChat = () => { setActiveConversation(null); setSelectedUser(null); };

  const cikisYap = () => {
    void closeRefreshSession().catch(() => undefined);
    resetClientSession();
  };

  if (currentView === 'login' || currentView === 'register') return <Auth onLoginSuccess={onLoginSuccess} />;

  return (
    <div className={`app-container ${(activeConversation || selectedUser) ? 'chat-active' : ''}`}>
      {currentUser && (
       <Sidebar
          currentUser={currentUser} conversationList={conversationList} usersList={usersList} activeConversation={activeConversation} selectedUser={selectedUser} unreadCounts={unreadCounts}
          startGroupChat={startGroupChat} startChat={startChat} setIsGroupModalOpen={setIsGroupModalOpen} setIsSettingsOpen={setIsSettingsOpen} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode}
        />
      )}

      {currentUser && (
        <ChatArea
          currentUser={currentUser} activeConversation={activeConversation} selectedUser={selectedUser} messages={messages} newMessage={newMessage} setNewMessage={setNewMessage}
          mesajGonder={mesajGonder} messagesEndRef={messagesEndRef} openGroupSettings={openGroupSettings} closeChat={closeChat} isDarkMode={isDarkMode} usersList={usersList} groupMembers={groupMembers}
          loadMoreMessages={loadMoreMessages}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          typingUsername={activeConversation ? typingByConversation[activeConversation.id] : undefined}
          onTyping={(isTyping) => activeConversation && socket?.emit('typing_changed', { conversationId: activeConversation.id, isTyping })}

          />
      )}

      {isGroupModalOpen && (
        <CreateGroupModal setIsGroupModalOpen={setIsGroupModalOpen} newGroupName={newGroupName} setNewGroupName={setNewGroupName} usersList={usersList} selectedMembers={selectedMembers} toggleMemberSelection={toggleMemberSelection} handleCreateGroup={handleCreateGroup} />
      )}

      {isGroupSettingsOpen && activeConversation && (
        <GroupSettingsModal setIsGroupSettingsOpen={setIsGroupSettingsOpen} activeConversation={activeConversation} currentUser={currentUser} editGroupName={editGroupName} setEditGroupName={setEditGroupName} handleUpdateGroupName={handleUpdateGroupName} groupMembers={groupMembers} handleRemoveMember={handleRemoveMember} handleDeleteGroup={handleDeleteGroup} usersList={usersList} handleAddMembersToGroup={handleAddMembersToGroup} handleTransferAdmin={handleTransferAdmin} />
      )}

      {isSettingsOpen && (
        <SettingsModal setIsSettingsOpen={setIsSettingsOpen} settingsMessage={settingsMessage} setSettingsMessage={setSettingsMessage} newUsernameSettings={newUsernameSettings} setNewUsernameSettings={setNewUsernameSettings} handleUpdateUsername={handleUpdateUsername} currentUser={currentUser} handleToggleReadReceipts={handleToggleReadReceipts} oldPasswordSettings={oldPasswordSettings} setOldPasswordSettings={setOldPasswordSettings} newPasswordSettings={newPasswordSettings} setNewPasswordSettings={setNewPasswordSettings} handleUpdatePassword={handleUpdatePassword} handleUpdateAvatar={handleUpdateAvatar} handleDeleteAccount={handleDeleteAccount} cikisYap={cikisYap} />
      )}
    </div>
  );
}
