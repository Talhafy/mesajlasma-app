import { useState } from 'react';
import { api } from '../../api/httpClient';
import './Sidebar.css';
import type { User, Conversation, Message } from '../../types/chat';
import Button from '../UI/Button';

interface CallHistoryItem {
  callId: string;
  conversationId: string;
  title: string;
  callType: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  status: 'started' | 'accepted' | 'declined' | 'missed' | 'ended';
  createdAt: string;
}

interface SidebarProps {
  currentUser: User;
  conversationList: Conversation[];
  usersList: User[];
  activeConversation: Conversation | null;
  selectedUser: User | null;
  unreadCounts: Record<string, number>;
  startGroupChat: (group: Conversation) => void;
  startChat: (user: User) => void;
  setIsGroupModalOpen: (isOpen: boolean) => void;
  setIsSettingsOpen: (isOpen: boolean) => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
  socketConnectionStatus: 'connected' | 'inactive' | 'reconnecting' | 'disconnected';
  onReconnectRealtime: () => void;
  typingByConversation: Record<string, string>;
  callHistory: CallHistoryItem[];
  onOpenGameMode: () => void;
}

export default function Sidebar({
  currentUser, conversationList, usersList, activeConversation, selectedUser,
  unreadCounts, isDarkMode, setIsDarkMode, startGroupChat, startChat, setIsGroupModalOpen, setIsSettingsOpen,
  socketConnectionStatus, onReconnectRealtime, typingByConversation, callHistory, onOpenGameMode
}: SidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [messageResults, setMessageResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isArchiveView, setIsArchiveView] = useState(false);
  const [isContactsListView, setIsContactsListView] = useState(false);
  const [isCallsView, setIsCallsView] = useState(false);
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState(false);
  const [isContactsPanelOpen, setIsContactsPanelOpen] = useState(false);
  const [contactsSearchTerm, setContactsSearchTerm] = useState('');
  const [isStarredPanelOpen, setIsStarredPanelOpen] = useState(false);
  const [starredMessages, setStarredMessages] = useState<Message[]>([]);
  const [isLoadingStarred, setIsLoadingStarred] = useState(false);
  
  const [isBlockedUsersView, setIsBlockedUsersView] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [isBlockedUsersLoading, setIsBlockedUsersLoading] = useState(false);

  const fetchBlockedUsers = async () => {
    setIsBlockedUsersLoading(true);
    try {
      const res = await api.get('/users/blocked/list');
      setBlockedUsers(res.data);
    } catch {
      console.error("Engellenen kullanıcılar getirilemedi.");
    } finally {
      setIsBlockedUsersLoading(false);
    }
  };

  const handleUnblock = async (id: string) => {
    try {
      await api.delete(`/users/${id}/block`);
      setBlockedUsers(prev => prev.filter(u => u.id !== id));
    } catch {
      alert("Engel kaldırılamadı.");
    }
  };

  const panelBg = isDarkMode ? '#202c33' : '#f0f2f5';
  const textColor = isDarkMode ? '#e9edef' : '#111b21';
  const iconColor = isDarkMode ? '#aebac1' : '#54656f';
  const borderColor = isDarkMode ? '#313d45' : '#d1d7db';
  const isReconnecting = socketConnectionStatus === 'reconnecting';
  // Arama 2 karakterden sonra "global arama modu"na geçer.
  // Bu modda son sohbetler filtrelenip karışmaz; ayrı arama kartı öne çıkar, sohbet listesi arkada kalır.
  const isGlobalSearchActive = searchTerm.trim().length >= 2;

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);

    if (val.trim().length < 2) {
      setMessageResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    rememberSearchTerm(val);
    try {
      const res = await api.get(`/messages/search?q=${encodeURIComponent(val)}`);
      setMessageResults(res.data);
    } catch (error) {
      console.error('Global arama hatası:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMessageClick = (msg: Message) => {
    if (!msg.conversation) return;
    if (msg.conversation.isGroup) {
      startGroupChat(msg.conversation);
    } else {
      const otherParticipant = msg.conversation.participants.find((p: any) => p.user.id !== currentUser.id);
      if (otherParticipant) startChat(otherParticipant.user);
    }
  };

  const getConversationTitle = (conversation: Conversation) =>
    conversation.isGroup ? conversation.name : conversation.otherUser?.username;

  const getConversationPreview = (conversation: Conversation) => {
    if (!conversation.lastMessage) return 'Henüz mesaj yok';
    return conversation.lastMessage.content
      || (conversation.lastMessage.fileType === 'image' ? '📷 Görsel' : '📎 Dosya');
  };

  const archivedConversations = conversationList.filter((conversation) => {
    if (!conversation.isGroup && !conversation.lastMessage && activeConversation?.id !== conversation.id) {
      return false;
    }
    return conversation.isArchived;
  });
  const getUnreadKey = (conversation: Conversation) =>
    conversation.isGroup ? conversation.id : conversation.otherUser?.id || conversation.id;
  const archivedUnreadCount = archivedConversations.filter((conversation) => (unreadCounts[getUnreadKey(conversation)] || 0) > 0).length;
  const filteredConversations = conversationList.filter((conversation) => {
    if (conversation.isArchived !== isArchiveView) return false;
    
    // Birebir konuşmalarda mesaj yoksa ve şu an aktif seçili konuşma değilse listede gösterme
    if (!conversation.isGroup && !conversation.lastMessage && activeConversation?.id !== conversation.id) {
      return false;
    }

    const title = getConversationTitle(conversation);
    // Arama kartı açıkken alttaki sohbet listesi normal sırasını korur; sonuçlar ayrı çerçevede gösterilir.
    if (isGlobalSearchActive) return true;
    return title?.toLowerCase().includes(searchTerm.toLowerCase());
  });
  const filteredContactUsers = usersList.filter(user => user.username.toLowerCase().includes(contactsSearchTerm.toLowerCase()));
  const searchUserResults = isGlobalSearchActive
    ? usersList.filter(user => user.username.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];
  // Kişiler listesi artık ana listede gösterilmiyor; üç nokta menüsündeki rehber panelinden yönetiliyor.
  const showLegacyContactsInMainList = false;

  const rememberSearchTerm = (term: string) => {
    const cleanTerm = term.trim();
    if (cleanTerm.length < 2) return;
    try {
      const previous = JSON.parse(localStorage.getItem('chatSearchHistory') || '[]') as string[];
      const next = [cleanTerm, ...previous.filter((item) => item.toLowerCase() !== cleanTerm.toLowerCase())].slice(0, 12);
      localStorage.setItem('chatSearchHistory', JSON.stringify(next));
    } catch {
      localStorage.setItem('chatSearchHistory', JSON.stringify([cleanTerm]));
    }
  };

  const openStarredMessages = async () => {
    setIsSidebarMenuOpen(false);
    setIsContactsPanelOpen(false);
    setIsStarredPanelOpen(true);
    setIsLoadingStarred(true);
    try {
      const res = await api.get('/messages/starred');
      setStarredMessages(res.data);
    } catch {
      alert('Yıldızlı mesajlar getirilemedi.');
    } finally {
      setIsLoadingStarred(false);
    }
  };

  const openContactsPanel = () => {
    setIsContactsListView(true);
    setIsArchiveView(false);
    setIsCallsView(false);
    setIsContactsPanelOpen(false);
    setIsSidebarMenuOpen(false);
    setIsStarredPanelOpen(false);
  };

  const openGroupCreator = () => {
    setIsGroupModalOpen(true);
    setIsSidebarMenuOpen(false);
    setIsContactsPanelOpen(false);
    setIsContactsListView(false);
    setIsCallsView(false);
    setIsArchiveView(false);
    setIsStarredPanelOpen(false);
    setIsBlockedUsersView(false);
  };

  const startContactChat = (user: User) => {
    startChat(user);
    setIsContactsPanelOpen(false);
    setIsStarredPanelOpen(false);
    setContactsSearchTerm('');
  };

  const renderConversationRow = (conversation: Conversation) => {
    const otherUser = conversation.otherUser;
    const unreadKey = conversation.isGroup ? conversation.id : otherUser?.id || conversation.id;
    const preview = getConversationPreview(conversation);
    // WhatsApp benzeri davranış: biri yazarken son mesaj önizlemesi geçici olarak yeşil "yazıyor..." metnine döner.
    const typingUsername = typingByConversation[conversation.id];

    return (
      <div
        key={conversation.id}
        className={`user-item ${activeConversation?.id === conversation.id ? 'active' : ''}`}
        onClick={() => conversation.isGroup ? startGroupChat(conversation) : otherUser && startChat(otherUser)}
        style={{ color: textColor, opacity: conversation.isArchived ? 0.85 : 1 }}
      >
        <div className="avatar-small" style={{ background: conversation.isArchived ? '#607d8b' : '#f97316', color: 'white', position: 'relative', overflow: 'visible' }}>
          {conversation.isGroup && conversation.avatarUrl
            ? <img src={conversation.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : otherUser?.avatarUrl
            ? <img src={otherUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : conversation.isGroup ? '👥' : otherUser?.username?.[0]?.toUpperCase()}
          {!conversation.isGroup && otherUser?.isOnline && (
            <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />
          )}
        </div>
        <div className="user-info">
          <span className="user-name">
            {conversation.isPinned ? '📌 ' : ''}{conversation.isMuted ? '🔕 ' : ''}{getConversationTitle(conversation)}
          </span>
          <div style={{ fontSize: '12px', color: typingUsername ? '#f97316' : iconColor, fontWeight: typingUsername ? 700 : 400, marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
            {typingUsername ? `${typingUsername} yazıyor...` : preview}
          </div>
        </div>
        {unreadCounts[unreadKey] > 0 && (
          <span style={{ background: '#f97316', color: 'white', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', marginLeft: 'auto', flexShrink: 0 }}>
            {unreadCounts[unreadKey]}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar" style={{ position: 'relative', display: 'flex', flexDirection: 'row', height: '100%', background: isDarkMode ? '#111b21' : '#ffffff' }}>
      <div style={{ width: '58px', flexShrink: 0, background: panelBg, borderRight: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 8px', boxSizing: 'border-box', gap: '10px' }}>
        <div
          title={`${currentUser.username} • Profil`}
          style={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: '#f97316', color: 'white', fontWeight: 800, fontSize: '17px', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}
        >
          {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt={currentUser.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : currentUser.username?.[0]?.toUpperCase()}
        </div>

        <div style={{ flex: 1 }} />

        <button
          title="Oyun modu"
          aria-label="Oyun modu"
          onClick={onOpenGameMode}
          style={{ width: '38px', height: '38px', borderRadius: '12px', border: 'none', background: 'transparent', color: iconColor, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 8h7a5 5 0 0 1 4.7 3.3l1.3 3.7a3 3 0 0 1-5.1 3l-1.5-1.8H9.1L7.6 18a3 3 0 0 1-5.1-3l1.3-3.7A5 5 0 0 1 8.5 8ZM7 11v4m-2-2h4m8-1h.01M19 14h.01" /></svg>
        </button>

        <button
          title="Aramalar"
          onClick={() => { setIsCallsView(true); setIsArchiveView(false); setIsContactsListView(false); setIsStarredPanelOpen(false); setIsSidebarMenuOpen(false); setIsBlockedUsersView(false); }}
          style={{ width: '38px', height: '38px', borderRadius: '12px', border: 'none', background: isCallsView ? '#f97316' : 'transparent', color: isCallsView ? 'white' : iconColor, cursor: 'pointer', fontSize: '18px' }}
        >
          ☎
        </button>

        <button
          title="Engellenen Kullanıcılar"
          onClick={() => { setIsBlockedUsersView(true); setIsCallsView(false); setIsArchiveView(false); setIsContactsListView(false); setIsStarredPanelOpen(false); setIsSidebarMenuOpen(false); fetchBlockedUsers(); }}
          style={{ width: '38px', height: '38px', borderRadius: '12px', border: 'none', background: isBlockedUsersView ? '#f97316' : 'transparent', color: isBlockedUsersView ? 'white' : iconColor, cursor: 'pointer', fontSize: '20px' }}
        >
          🚫
        </button>

        <button
          className="icon-btn"
          title="Ayarlar"
          aria-label="Ayarlar"
          onClick={() => setIsSettingsOpen(true)}
          style={{ fontSize: '20px' }}
        >
          ⚙
        </button>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}` }}>
        <h2 style={{ margin: 0, fontSize: '22px', color: textColor, fontWeight: 'bold' }}>
          {isBlockedUsersView ? 'Engellenenler' : isContactsListView ? 'Kayıtlı Kullanıcılar' : isCallsView ? 'Aramalar' : isArchiveView ? 'Arşiv' : 'Sohbetler'}
        </h2>

        <div style={{ display: 'flex', gap: '4px' }}>
          {(isArchiveView || isContactsListView || isCallsView || isBlockedUsersView) && (
            <Button variant="icon" onClick={() => { setIsArchiveView(false); setIsContactsListView(false); setIsCallsView(false); setIsBlockedUsersView(false); }} title="Sohbetlere dön" aria-label="Sohbetlere dön" style={{ color: iconColor }} icon={<span style={{ fontSize: '20px' }}>←</span>} />
          )}
          <Button
            variant="icon"
            onClick={() => setIsDarkMode(!isDarkMode)}
            title={isDarkMode ? 'Aydınlık Mod' : 'Karanlık Mod'}
            aria-label={isDarkMode ? 'Aydınlık Mod' : 'Karanlık Mod'}
            style={{ color: iconColor }}
            icon={isDarkMode ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-1-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-1-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4C12.92 3.04 12.46 3 12 3z" /></svg>
            )}
          />
          <div style={{ position: 'relative' }}>
            <Button
              variant="icon"
              onClick={() => setIsSidebarMenuOpen((previous) => !previous)}
              title="Sidebar seçenekleri"
              aria-label="Sidebar seçenekleri"
              style={{ color: iconColor }}
              icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"></path></svg>}
            />
            {isSidebarMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsSidebarMenuOpen(false)} />
                <div className="dropdown-menu" style={{ right: 0, top: '42px', width: '220px', color: textColor }}>
                  <button className="msg-dropdown-btn" onClick={openContactsPanel}>👤 Kayıtlı kullanıcılar</button>
                  <button className="msg-dropdown-btn" onClick={openGroupCreator}>👥 Yeni grup kur</button>
                  <button className="msg-dropdown-btn" onClick={openStarredMessages}>⭐ Yıldızlı mesajlar</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {socketConnectionStatus !== 'connected' && (
        <div style={{ margin: '10px', padding: '10px 12px', borderRadius: '10px', background: isDarkMode ? '#3b2f12' : '#fff4d6', border: `1px solid ${isDarkMode ? '#7a5b14' : '#ffd36a'}`, color: textColor, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span>{isReconnecting ? 'Yenileniyor... Anlık bağlantı yeniden kuruluyor.' : socketConnectionStatus === 'inactive' ? 'Uzun süre işlem yapılmadı. Anlık bağlantı kapandı.' : 'Bağlantı koptu. Anlık bildirimler durdu.'}</span>
          <button onClick={onReconnectRealtime} disabled={isReconnecting} style={{ border: 'none', borderRadius: '999px', padding: '6px 10px', background: '#f97316', color: 'white', cursor: isReconnecting ? 'default' : 'pointer', fontWeight: 700, whiteSpace: 'nowrap', opacity: isReconnecting ? 0.65 : 1 }}>
            Bağlan
          </button>
        </div>
      )}

      <div className="sidebar-search" style={{ padding: '12px 16px', borderBottom: `1px solid ${borderColor}`, background: isDarkMode ? '#111b21' : '#ffffff' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', color: iconColor, opacity: 0.6, pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="global-search-input"
            placeholder="Sohbet veya mesaj ara..."
            value={searchTerm}
            onChange={handleSearchChange}
          />
          {searchTerm && (
            <button
              onClick={() => { setSearchTerm(''); handleSearchChange({ target: { value: '' } } as any); }}
              style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: iconColor, opacity: 0.7, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
              title="Aramayı temizle"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isContactsPanelOpen && (
        <div style={{ position: 'absolute', top: '76px', left: '12px', right: '12px', maxHeight: '70vh', zIndex: 120, background: isDarkMode ? '#202c33' : '#ffffff', border: `1px solid ${borderColor}`, borderRadius: '16px', boxShadow: '0 18px 55px rgba(0,0,0,0.32)', overflow: 'hidden', color: textColor }}>
          <div style={{ padding: '14px', borderBottom: `1px solid ${borderColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <div>
              <div style={{ color: '#f97316', fontSize: '12px', fontWeight: 800 }}>Kişi rehberi</div>
              <h3 style={{ margin: '2px 0 0', fontSize: '17px' }}>Kayıtlı kullanıcılar</h3>
            </div>
            <button onClick={() => setIsContactsPanelOpen(false)} style={{ border: 'none', background: panelBg, color: iconColor, width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}>×</button>
          </div>

          <div style={{ padding: '12px', display: 'flex', gap: '8px', borderBottom: `1px solid ${borderColor}` }}>
            <button onClick={openGroupCreator} style={{ border: 'none', background: '#f97316', color: 'white', borderRadius: '10px', padding: '9px 11px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Yeni grup
            </button>
            <input
              value={contactsSearchTerm}
              onChange={(event) => setContactsSearchTerm(event.target.value)}
              placeholder="Kullanıcı ara..."
              autoFocus
              style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: '10px', border: `1px solid ${borderColor}`, background: panelBg, color: textColor, outline: 'none' }}
            />
          </div>

          <div style={{ maxHeight: 'calc(70vh - 125px)', overflowY: 'auto' }}>
            {filteredContactUsers.length > 0 ? filteredContactUsers.map((user) => (
              <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startContactChat(user)} style={{ color: textColor, cursor: 'pointer' }}>
                <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                  {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                </div>
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                  <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px' }}>{user.isOnline ? 'Çevrimiçi' : 'Sohbet başlat'}</div>
                </div>
                <button onClick={(event) => { event.stopPropagation(); startContactChat(user); }} style={{ border: 'none', background: '#f97316', color: 'white', borderRadius: '999px', padding: '6px 10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', marginLeft: 'auto' }}>
                  Sohbet başlat
                </button>
              </div>
            )) : (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Kullanıcı bulunamadı.</div>
            )}
          </div>
        </div>
      )}

      {isStarredPanelOpen && (
        <div style={{ position: 'absolute', top: '76px', left: '12px', right: '12px', maxHeight: '72vh', zIndex: 120, background: isDarkMode ? '#202c33' : '#ffffff', border: `1px solid ${borderColor}`, borderRadius: '16px', boxShadow: '0 18px 55px rgba(0,0,0,0.32)', overflow: 'hidden', color: textColor }}>
          <div style={{ padding: '14px', borderBottom: `1px solid ${borderColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <div>
              <div style={{ color: '#f97316', fontSize: '12px', fontWeight: 800 }}>Yıldızlı mesajlar</div>
              <h3 style={{ margin: '2px 0 0', fontSize: '17px' }}>Kaydedilenler</h3>
            </div>
            <button onClick={() => setIsStarredPanelOpen(false)} style={{ border: 'none', background: panelBg, color: iconColor, width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}>x</button>
          </div>

          <div style={{ maxHeight: 'calc(72vh - 58px)', overflowY: 'auto' }}>
            {isLoadingStarred ? (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Yıldızlı mesajlar yükleniyor...</div>
            ) : starredMessages.length > 0 ? (
              starredMessages.map((msg) => (
                <div key={msg.id} onClick={() => { handleMessageClick(msg); setIsStarredPanelOpen(false); }} className="user-item" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '12px 15px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer', color: textColor }}>
                  <div style={{ fontSize: '12px', color: iconColor, marginBottom: '5px', width: '100%', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                    <strong style={{ color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.sender?.username || 'Kullanıcı'}</strong>
                    <span>{msg.createdAt ? new Date(msg.createdAt).toLocaleDateString('tr-TR') : ''}</span>
                  </div>
                  <div style={{ fontSize: '14px', color: textColor, opacity: 0.92, wordBreak: 'break-word' }}>
                    {msg.content || (msg.fileType === 'image' ? 'Görsel' : msg.fileName || 'Dosya')}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Henüz yıldızlanan mesaj yok.</div>
            )}
          </div>
        </div>
      )}

      <div className="users-list" style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {isContactsListView && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 45, background: isDarkMode ? '#111b21' : '#ffffff', color: textColor, overflowY: 'auto' }}>
            <div style={{ padding: '12px', display: 'flex', gap: '8px', borderBottom: `1px solid ${borderColor}` }}>
              <button onClick={openGroupCreator} style={{ border: 'none', background: '#f97316', color: 'white', borderRadius: '10px', padding: '9px 11px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                Yeni grup
              </button>
              <input
                value={contactsSearchTerm}
                onChange={(event) => setContactsSearchTerm(event.target.value)}
                placeholder="Kullanıcı ara..."
                autoFocus
                style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: '10px', border: `1px solid ${borderColor}`, background: panelBg, color: textColor, outline: 'none' }}
              />
            </div>
            {filteredContactUsers.length > 0 ? filteredContactUsers.map((user) => (
              <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startContactChat(user)} style={{ color: textColor, cursor: 'pointer' }}>
                <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                  {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                </div>
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                  <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px' }}>{user.isOnline ? 'Çevrimiçi' : 'Sohbet başlat'}</div>
                </div>
              </div>
            )) : (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Kullanıcı bulunamadı.</div>
            )}
          </div>
        )}

        {isCallsView && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 45, background: isDarkMode ? '#111b21' : '#ffffff', color: textColor, overflowY: 'auto' }}>
            {callHistory.length > 0 ? callHistory.map((call) => {
              const statusText = call.status === 'missed' ? 'Cevapsız' : call.status === 'declined' ? 'Reddedildi' : call.status === 'ended' ? 'Bitti' : call.status === 'accepted' ? 'Kabul edildi' : 'Başlatıldı';
              const directionIcon = call.direction === 'incoming' ? '↙' : '↗';
              return (
                <div key={call.callId} className="user-item" style={{ color: textColor, cursor: 'default' }}>
                  <div className="avatar-small" style={{ background: call.status === 'missed' ? '#e53935' : '#f97316', color: 'white' }}>
                    {call.callType === 'video' ? '▣' : '☎'}
                  </div>
                  <div className="user-info">
                    <span className="user-name">{call.title}</span>
                    <div style={{ fontSize: '12px', color: call.status === 'missed' ? '#e53935' : iconColor, marginTop: '3px' }}>
                      {directionIcon} {statusText} · {new Date(call.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Henüz arama kaydı yok.</div>
            )}
          </div>
        )}

        {isBlockedUsersView && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 45, background: isDarkMode ? '#111b21' : '#ffffff', color: textColor, overflowY: 'auto' }}>
            <div style={{ padding: '15px 20px', borderBottom: `1px solid ${borderColor}` }}>
               <h3 style={{ margin: 0, fontSize: '15px', color: '#f97316', fontWeight: 'bold' }}>Engellenen Kullanıcılar</h3>
               <p style={{ margin: '5px 0 0', fontSize: '12px', color: iconColor }}>Engellediğiniz kullanıcıların engelini buradan kaldırabilirsiniz.</p>
            </div>
            {isBlockedUsersLoading ? (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Yükleniyor...</div>
            ) : blockedUsers.length > 0 ? (
              blockedUsers.map(user => (
                <div key={user.id} className="user-item" style={{ color: textColor, cursor: 'default', justifyContent: 'space-between', alignItems: 'center', paddingRight: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="avatar-small" style={{ background: '#f97316', color: 'white', position: 'relative', overflow: 'hidden' }}>
                      {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="user-info">
                      <span className="user-name">{user.username}</span>
                    </div>
                  </div>
                  <button onClick={() => handleUnblock(user.id)} style={{ border: `1px solid ${borderColor}`, background: panelBg, color: textColor, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    Engeli Kaldır
                  </button>
                </div>
              ))
            ) : (
              <div style={{ padding: '18px', textAlign: 'center', color: iconColor, fontSize: '13px' }}>Engellenen kullanıcı yok.</div>
            )}
          </div>
        )}

        {isGlobalSearchActive && (
          <>
          {/* Arama sonuçları normal sohbet listesinin içinde değil, üstte ayrı bir panel olarak gösterilir.
              Böylece kullanıcı son sohbetlerle arama sonuçlarını aynı liste gibi algılamaz. */}
          <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', bottom: '10px', zIndex: 25, background: isDarkMode ? 'rgba(32,44,51,0.97)' : 'rgba(255,255,255,0.97)', border: `1px solid ${borderColor}`, borderRadius: '16px', boxShadow: '0 18px 48px rgba(0,0,0,0.28)', overflow: 'hidden', color: textColor, display: 'flex', flexDirection: 'column', backdropFilter: 'blur(5px)' }}>
            <div style={{ padding: '14px 15px', borderBottom: `1px solid ${borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ color: '#f97316', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase' }}>Arama Sonuçları</div>
                <div style={{ fontSize: '13px', color: iconColor, marginTop: '3px' }}>"{searchTerm}" için kişiler ve mesajlar</div>
              </div>
              <button onClick={() => { setSearchTerm(''); setMessageResults([]); }} style={{ border: 'none', background: panelBg, color: iconColor, width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '10px' }}>
              {searchUserResults.length > 0 && (
                <>
                  <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: '#f97316', textTransform: 'uppercase' }}>Kullanıcılar</h3>
                  {searchUserResults.map((user) => (
                    <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startContactChat(user)} style={{ color: textColor, cursor: 'pointer' }}>
                      <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                        {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                        {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                      </div>
                      <div className="user-info">
                        <span className="user-name">{user.username}</span>
                        <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px' }}>Sohbet başlat</div>
                      </div>
                      <button onClick={(event) => { event.stopPropagation(); startContactChat(user); }} style={{ border: 'none', background: '#f97316', color: 'white', borderRadius: '999px', padding: '6px 10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', marginLeft: 'auto' }}>
                        Başlat
                      </button>
                    </div>
                  ))}
                </>
              )}

              <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: '#f97316', textTransform: 'uppercase' }}>Mesajlarda Bulunanlar</h3>
              {isSearching ? (
                <div style={{ padding: '14px 15px', fontSize: '13px', color: iconColor }}>Aranıyor...</div>
              ) : messageResults.length > 0 ? (
                messageResults.map((msg) => (
                  <div key={msg.id} className="user-item" onClick={() => handleMessageClick(msg)} style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '12px 15px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}>
                    <div style={{ fontSize: '12px', color: iconColor, marginBottom: '4px' }}>
                      <strong style={{ color: textColor }}>{msg.sender?.username}</strong> yazdı:
                    </div>
                    <div style={{ fontSize: '14px', color: textColor, opacity: 0.9 }}>
                      {msg.content.length > 40 ? msg.content.substring(0, 40) + '...' : msg.content}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '14px 15px', fontSize: '13px', color: iconColor }}>Mesaj bulunamadı.</div>
              )}
            </div>
          </div>
          </>
        )}


        {!isArchiveView && !isContactsListView && !isCallsView && !isBlockedUsersView && archivedConversations.length > 0 && searchTerm.trim() === '' && (
          <div onClick={() => { setIsArchiveView(true); setIsCallsView(false); setIsContactsListView(false); }} className="user-item" style={{ color: textColor, borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}>
            <div className="avatar-small" style={{ background: '#607d8b', color: 'white' }}>🗄️</div>
            <div className="user-info">
              <span className="user-name">Arşivlenen sohbetler</span>
              <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px' }}>Ayrı arşiv görünümüne git</div>
            </div>
            {archivedUnreadCount > 0 && (
              <span style={{ background: '#f97316', color: 'white', padding: '2px 8px', borderRadius: '999px', fontSize: '12px', marginLeft: 'auto' }}>
                {archivedUnreadCount}
              </span>
            )}
          </div>
        )}

        <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: iconColor, textTransform: 'uppercase' }}>
          {isArchiveView ? 'Arşivlenenler' : 'Son Sohbetler'}
        </h3>
        {filteredConversations.length > 0
          ? filteredConversations.map(renderConversationRow)
          : <div style={{ padding: '10px 15px', fontSize: '13px', color: iconColor }}>{isArchiveView ? 'Arşivde sohbet yok.' : 'Henüz sohbet yok.'}</div>}

        {showLegacyContactsInMainList && (
          <>
            <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: iconColor, textTransform: 'uppercase' }}>Kişiler</h3>
            {filteredContactUsers.map((user) => (
              <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startChat(user)} style={{ color: textColor }}>
                <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                  {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                </div>
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                </div>
                {unreadCounts[user.id] > 0 && (
                  <span style={{ background: '#f97316', color: 'white', padding: '2px 8px', borderRadius: '50%', fontSize: '12px', marginLeft: 'auto' }}>
                    {unreadCounts[user.id]}
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {!isGlobalSearchActive && searchTerm.length >= 2 && (
          <>
            {searchUserResults.length > 0 && (
              <>
                <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: '#f97316', textTransform: 'uppercase' }}>Kullanıcılar</h3>
                {searchUserResults.map((user) => (
                  <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startContactChat(user)} style={{ color: textColor, cursor: 'pointer' }}>
                    <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                      {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                      {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                    </div>
                    <div className="user-info">
                      <span className="user-name">{user.username}</span>
                      <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px' }}>Sohbet başlat</div>
                    </div>
                    <button onClick={(event) => { event.stopPropagation(); startContactChat(user); }} style={{ border: 'none', background: '#f97316', color: 'white', borderRadius: '999px', padding: '6px 10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', marginLeft: 'auto' }}>
                      Başlat
                    </button>
                  </div>
                ))}
              </>
            )}
            <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: '#f97316', textTransform: 'uppercase' }}>Mesajlarda Bulunanlar</h3>
            {isSearching ? (
              <div style={{ padding: '10px 15px', fontSize: '13px', color: iconColor }}>Aranıyor...</div>
            ) : messageResults.length > 0 ? (
              messageResults.map((msg) => (
                <div key={msg.id} className="user-item" onClick={() => handleMessageClick(msg)} style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '12px 15px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: '12px', color: iconColor, marginBottom: '4px' }}>
                    <strong style={{ color: textColor }}>{msg.sender?.username}</strong> yazdı:
                  </div>
                  <div style={{ fontSize: '14px', color: textColor, opacity: 0.9 }}>
                    {msg.content.length > 40 ? msg.content.substring(0, 40) + '...' : msg.content}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '10px 15px', fontSize: '13px', color: iconColor }}>Mesaj bulunamadı.</div>
            )}
          </>
        )}
      </div>

      </div>
      <style>{`
        .msg-dropdown-btn {
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          border: none;
          background: transparent;
          color: ${textColor};
          font-size: 14px;
          cursor: pointer;
        }
        .msg-dropdown-btn:hover {
          background: ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'};
        }
      `}</style>
    </div>
  );
}
