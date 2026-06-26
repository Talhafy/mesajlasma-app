import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import './App.css';

// DIŞA AKTARILAN BİLEŞENLER
import Auth from './components/Auth/Auth';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/ChatArea/ChatArea';
import CreateGroupModal from './components/Modals/CreateGroupModal';
import GroupSettingsModal from './components/Modals/GroupSettingsModal';
import SettingsModal from './components/Modals/SettingsModal';

export interface Message { id: string; content: string; senderId: string; sender?: { username: string }; readByIds?: string[]; conversationId: string; conversation?: any; createdAt?: string; }
export interface User { id: string; username: string; email: string; readReceiptsOn?: boolean; }
export interface Conversation { id: string; isGroup: boolean; name?: string; adminId?: string; }

export default function App() {
  // --- STATE'LER (TÜM DEĞİŞKENLER EN ÜSTTE) ---
  const [currentView, setCurrentView] = useState<'login' | 'register' | 'chat'>('login');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [groupsList, setGroupsList] = useState<Conversation[]>([]);
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

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<User[]>([]);

  // TEMA STATE'İ (EN TEPEYE ALINDI)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);

  const currentUserRef = useRef<User | null>(null);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // TEMA DEĞİŞTİRİCİ MOTOR (EN TEPEYE ALINDI)
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('jwt_token');
      if (token) {
        try {
          const res = await axios.get('http://localhost:3000/api/user/me', { headers: { Authorization: `Bearer ${token}` } });
          setCurrentUser(res.data); setCurrentView('chat'); 
          fetchUsers(res.data.id); 
          fetchGroups(res.data.id);
          fetchUnreadCounts(res.data.id);
          console.log(fetchUnreadCounts)
        } catch (error) {
          localStorage.removeItem('jwt_token'); setCurrentView('login');
        }
      }
    };
    checkAuth();
  }, []);

  const getAuthHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('jwt_token')}` } });

  const onLoginSuccess = (token: string, user: User) => {
    localStorage.setItem('jwt_token', token); setCurrentUser(user); setCurrentView('chat'); 
    fetchUsers(user.id); 
    fetchGroups(user.id);
    fetchUnreadCounts(user.id);
  };

  const handleUpdateUsername = async () => { 
    setSettingsMessage({ type: '', text: '' });
    if(!newUsernameSettings.trim()) return;
    try {
      const res = await axios.put('http://localhost:3000/api/user/username', { newUsername: newUsernameSettings }, getAuthHeaders());
      setSettingsMessage({ type: 'success', text: res.data.message });
      setCurrentUser(prev => prev ? { ...prev, username: res.data.username } : null);
      setNewUsernameSettings('');
    } catch (error: any) { setSettingsMessage({ type: 'error', text: "İsim güncellenemedi." }); }
  };

  const handleUpdatePassword = async () => { 
    setSettingsMessage({ type: '', text: '' });
    if(!oldPasswordSettings || !newPasswordSettings) return;
    try {
      const res = await axios.put('http://localhost:3000/api/user/password', { oldPassword: oldPasswordSettings, newPassword: newPasswordSettings }, getAuthHeaders());
      setSettingsMessage({ type: 'success', text: res.data.message });
      setOldPasswordSettings(''); setNewPasswordSettings('');
    } catch (error: any) { setSettingsMessage({ type: 'error', text: "Şifre güncellenemedi." }); }
  };

  const handleDeleteAccount = async () => { 
    if (!window.confirm("Hesabınızı ve tüm verilerinizi kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try { await axios.delete('http://localhost:3000/api/user/account', getAuthHeaders()); alert("Hesabınız silindi."); cikisYap(); } 
    catch (error: any) { alert("Hesap silinirken hata oluştu."); }
  };

  const handleToggleReadReceipts = async (isEnabled: boolean) => {
    setCurrentUser(prev => prev ? {...prev, readReceiptsOn: isEnabled} : null);
    try { await axios.put('http://localhost:3000/api/user/settings/read-receipts', { isEnabled }, getAuthHeaders()); } 
    catch (error) { console.error("Ayar kaydedilemedi."); }
  };

  const fetchUsers = async (userId: string) => {
    try { const res = await axios.get(`http://localhost:3000/api/users?currentUserId=${userId}`); setUsersList(res.data); } 
    catch (error) { console.error("Kullanıcılar çekilemedi"); }
  };

  const fetchGroups = async (userId: string) => {
    try { const res = await axios.get(`http://localhost:3000/api/conversations/groups?currentUserId=${userId}`); setGroupsList(res.data); } 
    catch (error) { console.error("Gruplar çekilemedi"); }
  };

  const fetchUnreadCounts = async (userId: string) => {
    try {
      const res = await axios.get(`http://localhost:3000/api/unread-counts?userId=${userId}`);
      console.log("API Yanıtı:", res.data);
      setUnreadCounts(res.data);
    } catch (error) { console.error("Okunmamış sayılar çekilemedi"); }
  };
const startChat = async (targetUser: User) => {
    setSelectedUser(targetUser);
    // DİKKAT: Sayacı burada hemen sıfırlamıyoruz!
    
    try {
      const res = await axios.post('http://localhost:3000/api/conversations/direct', { currentUserId: currentUser?.id, targetUserId: targetUser.id });
      setActiveConversation(res.data);
      
      const msgs = await axios.get(`http://localhost:3000/api/conversations/${res.data.id}/messages`);
      setMessages(msgs.data);

      // KESİN GÖRÜLDÜ İŞLEMİ VE SIFIRLAMA
      if (currentUser) {
        // 1. Backend'in okundu işlemini bitirmesini BEKLE (await)
        await axios.post(`http://localhost:3000/api/conversations/${res.data.id}/read`, { 
          userId: currentUser.id, emitReceipt: currentUser.readReceiptsOn !== false
        });
        
        // 2. İşlem BAŞARILI olursa arayüzdeki sayacı sıfırla!
        setUnreadCounts(prev => ({ ...prev, [targetUser.id]: 0, [res.data.id]: 0 }));
      }

      if (socket) socket.emit('odaya_katil', res.data.id);
    } catch (error: any) { alert("Kullanıcı silinmiş veya sohbet yüklenemedi."); setSelectedUser(null); }
  };

  const startGroupChat = async (group: Conversation) => {
    setSelectedUser(null); 
    setActiveConversation(group); 
    // DİKKAT: Sayacı burada hemen sıfırlamıyoruz!
    
    try {
      const msgs = await axios.get(`http://localhost:3000/api/conversations/${group.id}/messages`);
      setMessages(msgs.data);
      
      if (currentUser) {
        // 1. Backend'in okundu işlemini bitirmesini BEKLE (await)
        await axios.post(`http://localhost:3000/api/conversations/${group.id}/read`, { 
          userId: currentUser.id, emitReceipt: currentUser.readReceiptsOn !== false
        });
        
        // 2. İşlem BAŞARILI olursa arayüzdeki sayacı sıfırla!
        setUnreadCounts(prev => ({ ...prev, [group.id]: 0 }));
      }
      
      if (socket) socket.emit('odaya_katil', group.id);
    } catch (error) { console.error("Grup mesajları çekilemedi", error); }
  };
  
  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || selectedMembers.length === 0) return alert("Grup adı girin ve en az 1 kişi seçin.");
    try {
      await axios.post('http://localhost:3000/api/conversations/group', { currentUserId: currentUser?.id, name: newGroupName, participantIds: selectedMembers });
      setIsGroupModalOpen(false); setNewGroupName(''); setSelectedMembers([]);
      if (currentUser) fetchGroups(currentUser.id);
    } catch (error) { alert("Grup oluşturulamadı."); }
  };

  const toggleMemberSelection = (userId: string) => { setSelectedMembers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]); };

  const openGroupSettings = async () => {
    if (!activeConversation) return;
    setIsGroupSettingsOpen(true); setEditGroupName(activeConversation.name || '');
    try {
      const res = await axios.get(`http://localhost:3000/api/conversations/group/${activeConversation.id}/participants`);
      setGroupMembers(res.data);
    } catch (error) { console.error("Üyeler alınamadı"); }
  };

  const handleUpdateGroupName = async () => {
    if (!activeConversation || !editGroupName.trim()) return;
    try {
      await axios.put(`http://localhost:3000/api/conversations/group/${activeConversation.id}/name`, { newName: editGroupName });
      setActiveConversation({ ...activeConversation, name: editGroupName });
      if (currentUser) fetchGroups(currentUser.id);
      alert("Grup adı başarıyla güncellendi.");
    } catch (error) { alert("Ad güncellenemedi."); }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeConversation || !window.confirm("Bu işlemi yapmak istediğinize emin misiniz?")) return;
    try {
      await axios.delete(`http://localhost:3000/api/conversations/group/${activeConversation.id}/participants/${userId}?adminId=${currentUser?.id}`);
      setGroupMembers(prev => prev.filter(member => member.id !== userId));
      if (userId === currentUser?.id) { setIsGroupSettingsOpen(false); setActiveConversation(null); if (currentUser) fetchGroups(currentUser.id); }
    } catch (error: any) { alert(error.response?.data?.error || "Kişi çıkarılamadı."); }
  };

  const handleDeleteGroup = async () => {
    if (!activeConversation || !window.confirm("Grubu ve tüm mesajları kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try {
      await axios.delete(`http://localhost:3000/api/conversations/group/${activeConversation.id}?adminId=${currentUser?.id}`);
      setIsGroupSettingsOpen(false); setActiveConversation(null); if (currentUser) fetchGroups(currentUser.id); alert("Grup silindi.");
    } catch (error: any) { alert(error.response?.data?.error || "Grup silinemedi."); }
  };

  // --- SOKET DİNLEYİCİLERİ ---
  useEffect(() => {
    if (currentView !== 'chat' || !currentUser?.id) return;
    const token = localStorage.getItem('jwt_token');
    const newSocket = io("http://localhost:3000", { auth: { token } });
    setSocket(newSocket);

    newSocket.off('yeni_mesaj_geldi');
    newSocket.off('mesajlar_okundu');

   newSocket.on('yeni_mesaj_geldi', (gelenMesaj: Message) => {
      
      // 1. KUSURSUZ KORUMA: Bu mesajın ID'sini az önce gördüysek, işlemi anında durdur! (2'şer artmayı engeller)
      if (processedMessagesRef.current.has(gelenMesaj.id)) return;
      processedMessagesRef.current.add(gelenMesaj.id);

      if (activeConversationRef.current?.id === gelenMesaj.conversationId) {
        setMessages((prev) => {
          if (prev.some(m => m.id === gelenMesaj.id)) return prev;
          if (activeConversationRef.current?.id !== gelenMesaj.conversationId) return prev;
          return [...prev, gelenMesaj];
        });
        if (currentUserRef.current) {
          axios.post(`http://localhost:3000/api/conversations/${gelenMesaj.conversationId}/read`, { 
            userId: currentUserRef.current.id,
            emitReceipt: currentUserRef.current.readReceiptsOn !== false
          }).catch(console.error);
        }
      } else {
        setUnreadCounts((prev) => ({ 
          ...prev, 
          [gelenMesaj.conversationId]: (prev[gelenMesaj.conversationId] || 0) + 1, 
          [gelenMesaj.senderId]: (prev[gelenMesaj.senderId] || 0) + 1 
        }));
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

    newSocket.on('gruptan_atildi', (data: { groupId: string, removedUserId: string }) => {
      if (data.removedUserId === currentUserRef.current?.id) { alert("Grup yöneticisi sizi gruptan çıkardı."); setGroupsList(prev => prev.filter(g => g.id !== data.groupId)); setActiveConversation(prev => prev?.id === data.groupId ? null : prev); }
    });

    newSocket.on('grup_silindi', (data: { groupId: string }) => {
      alert("Bu grup yönetici tarafından kalıcı olarak silindi."); setGroupsList(prev => prev.filter(g => g.id !== data.groupId)); setActiveConversation(prev => prev?.id === data.groupId ? null : prev);
    });

    return () => { newSocket.disconnect(); };
  }, [currentView, currentUser?.id]);

  useEffect(() => {
    if (socket && currentUser) { socket.emit('odaya_katil', currentUser.id); }
  }, [socket, currentUser]);

  useEffect(() => {
    if (socket && groupsList.length > 0) {
      groupsList.forEach(group => { socket.emit('odaya_katil', group.id); });
    }
  }, [socket, groupsList]);

  const mesajGonder = async () => {
    if (!newMessage.trim() || !currentUser || !activeConversation) return;
    const mesajIcerigi = newMessage; setNewMessage(""); 
    try { await axios.post('http://localhost:3000/api/messages', { conversationId: activeConversation.id, senderId: currentUser.id, content: mesajIcerigi }); } catch (error) { console.error("Mesaj gönderilemedi"); }
  };

  const closeChat = () => { setActiveConversation(null); setSelectedUser(null); };

  const cikisYap = () => {
    localStorage.removeItem('jwt_token'); setCurrentUser(null); setSelectedUser(null); setActiveConversation(null);
    setMessages([]); setGroupsList([]); setUnreadCounts({});
    setIsSettingsOpen(false); setIsGroupModalOpen(false); setIsGroupSettingsOpen(false); setCurrentView('login');
  };

  if (currentView === 'login' || currentView === 'register') {
    return <Auth onLoginSuccess={onLoginSuccess} />;
  }

  return (
    <div className={`app-container ${(activeConversation || selectedUser) ? 'chat-active' : ''}`}>
      {currentUser && (
       <Sidebar 
          currentUser={currentUser} groupsList={groupsList} usersList={usersList} activeConversation={activeConversation} selectedUser={selectedUser} unreadCounts={unreadCounts}
          startGroupChat={startGroupChat} startChat={startChat} setIsGroupModalOpen={setIsGroupModalOpen} setIsSettingsOpen={setIsSettingsOpen} cikisYap={cikisYap}
          isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode}
        />
      )}

      {currentUser && (
        <ChatArea 
          currentUser={currentUser} activeConversation={activeConversation} selectedUser={selectedUser} messages={messages} newMessage={newMessage} setNewMessage={setNewMessage}
          mesajGonder={mesajGonder} messagesEndRef={messagesEndRef} openGroupSettings={openGroupSettings} closeChat={closeChat}
        />
      )}

      {isGroupModalOpen && (
        <CreateGroupModal 
          setIsGroupModalOpen={setIsGroupModalOpen} newGroupName={newGroupName} setNewGroupName={setNewGroupName} 
          usersList={usersList} selectedMembers={selectedMembers} toggleMemberSelection={toggleMemberSelection} handleCreateGroup={handleCreateGroup} 
        />
      )}

      {isGroupSettingsOpen && activeConversation && (
        <GroupSettingsModal 
          setIsGroupSettingsOpen={setIsGroupSettingsOpen} activeConversation={activeConversation} currentUser={currentUser} 
          editGroupName={editGroupName} setEditGroupName={setEditGroupName} handleUpdateGroupName={handleUpdateGroupName} 
          groupMembers={groupMembers} handleRemoveMember={handleRemoveMember} handleDeleteGroup={handleDeleteGroup} 
        />
      )}

      {isSettingsOpen && (
        <SettingsModal 
          setIsSettingsOpen={setIsSettingsOpen} settingsMessage={settingsMessage} setSettingsMessage={setSettingsMessage} 
          newUsernameSettings={newUsernameSettings} setNewUsernameSettings={setNewUsernameSettings} handleUpdateUsername={handleUpdateUsername} 
          currentUser={currentUser} handleToggleReadReceipts={handleToggleReadReceipts} oldPasswordSettings={oldPasswordSettings} 
          setOldPasswordSettings={setOldPasswordSettings} newPasswordSettings={newPasswordSettings} setNewPasswordSettings={setNewPasswordSettings} 
          handleUpdatePassword={handleUpdatePassword} handleDeleteAccount={handleDeleteAccount} 
        />
      )}
    </div>
  );
}