import { useState } from 'react';
import { api } from '../../api/httpClient';
import './Sidebar.css';
import type { User, Conversation, Message } from '../../types/chat';
import Button from '../UI/Button';

/**
 * Arama geçmişi kaydının veri yapısını tanımlayan arayüz.
 */
interface CallHistoryItem {
  callId: string;
  conversationId: string;
  title: string;
  callType: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  status: 'started' | 'accepted' | 'declined' | 'missed' | 'ended';
  createdAt: string;
}

/**
 * Sidebar bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface SidebarProps {
  /** Oturum açmış olan mevcut kullanıcı bilgisi */
  currentUser: User;
  /** Kullanıcının dahil olduğu sohbet/grup listesi */
  conversationList: Conversation[];
  /** Uygulamadaki tüm kayıtlı kullanıcıların listesi */
  usersList: User[];
  /** O anda açık olan sohbet nesnesi */
  activeConversation: Conversation | null;
  /** O anda seçili olan birebir sohbet kullanıcısı */
  selectedUser: User | null;
  /** Sohbet ID'sine veya kullanıcı ID'sine göre okunmamış mesaj sayıları haritası */
  unreadCounts: Record<string, number>;
  /** Grup sohbetini aktif sohbet olarak başlatan fonksiyon */
  startGroupChat: (group: Conversation) => void;
  /** Birebir sohbeti başlatan fonksiyon */
  startChat: (user: User) => void;
  /** Yeni grup oluşturma modalını açan setter fonksiyonu */
  setIsGroupModalOpen: (isOpen: boolean) => void;
  /** Ayarlar modalını açan setter fonksiyonu */
  setIsSettingsOpen: (isOpen: boolean) => void;
  /** Karanlık modun aktif olup olmadığı bilgisi */
  isDarkMode: boolean;
  /** Karanlık mod tercihini değiştiren setter fonksiyonu */
  setIsDarkMode: (val: boolean) => void;
  /** WebSocket anlık bağlantı durumu */
  socketConnectionStatus: 'connected' | 'inactive' | 'reconnecting' | 'disconnected';
  /** Kesilen WebSocket bağlantısını yeniden başlatan callback */
  onReconnectRealtime: () => void;
  /** Hangi sohbette kimin "yazıyor..." durumunda olduğunu tutan harita */
  typingByConversation: Record<string, string>;
  /** Kullanıcının arama geçmişi listesi */
  callHistory: CallHistoryItem[];
  /** Kullanıcının kendi avatarını büyük boyutta görüntülemesini sağlayan fonksiyon */
  onViewOwnAvatar: () => void;
}

/**
 * Sol kenar çubuğu (Sidebar) bileşeni.
 * Sohbet listesi, arama motoru, kayıtlı kişiler rehberi, arama geçmişi,
 * yıldızlı mesajlar paneli ve sol navigasyon şeridini barındırır.
 */
export default function Sidebar({
  currentUser, conversationList, usersList, activeConversation, selectedUser,
  unreadCounts, isDarkMode, setIsDarkMode, startGroupChat, startChat, setIsGroupModalOpen, setIsSettingsOpen,
  socketConnectionStatus, onReconnectRealtime, typingByConversation, callHistory, onViewOwnAvatar
}: SidebarProps) {
  // --- DURUM DEĞİŞKENLERİ (STATE) ---
  /** Genel arama kutusuna yazılan arama terimi */
  const [searchTerm, setSearchTerm] = useState('');
  /** Mesaj araması sonucunda API'den dönen mesajlar */
  const [messageResults, setMessageResults] = useState<Message[]>([]);
  /** Mesaj arama isteğinin devam edip etmediği durumu */
  const [isSearching, setIsSearching] = useState(false);
  /** Görünümün 'Arşivlenen Sohbetler' modunda olup olmadığı */
  const [isArchiveView, setIsArchiveView] = useState(false);
  /** Görünümün 'Kayıtlı Kullanıcılar / Rehber' modunda olup olmadığı */
  const [isContactsListView, setIsContactsListView] = useState(false);
  /** Görünümün 'Arama Geçmişi' modunda olup olmadığı */
  const [isCallsView, setIsCallsView] = useState(false);
  /** Üç nokta (sağ üst) açılır menüsünün açık/kapalı durumu */
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState(false);
  /** Rehber hızlı açılır paneli durumu */
  const [isContactsPanelOpen, setIsContactsPanelOpen] = useState(false);
  /** Rehber içi kullanıcı arama terimi */
  const [contactsSearchTerm, setContactsSearchTerm] = useState('');
  /** Yıldızlı mesajlar panelinin görünürlük durumu */
  const [isStarredPanelOpen, setIsStarredPanelOpen] = useState(false);
  /** Sunucudan çekilen yıldızlı mesajlar listesi */
  const [starredMessages, setStarredMessages] = useState<Message[]>([]);
  /** Yıldızlı mesajlar yüklenirken gösterilen yükleniyor durumu */
  const [isLoadingStarred, setIsLoadingStarred] = useState(false);

  // Tema renk token'ları
  const panelBg = isDarkMode ? '#202c33' : '#f0f2f5';
  const textColor = isDarkMode ? '#e9edef' : '#111b21';
  const iconColor = isDarkMode ? '#aebac1' : '#54656f';
  const borderColor = isDarkMode ? '#313d45' : '#d1d7db';
  const isReconnecting = socketConnectionStatus === 'reconnecting';
  
  // Arama metni 2 karakter veya üzerindeyse "Global Arama Modu" aktifleşir
  const isGlobalSearchActive = searchTerm.trim().length >= 2;

  /**
   * Genel arama çubuğundaki girdi değiştiğinde mesaj ve kullanıcı araması yapar.
   */
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

  /**
   * Bulunan bir mesaja tıklandığında ilgili grup veya birebir sohbeti açar.
   */
  const handleMessageClick = (msg: Message) => {
    if (!msg.conversation) return;
    if (msg.conversation.isGroup) {
      startGroupChat(msg.conversation);
    } else {
      const otherParticipant = msg.conversation.participants?.find((p: { user: User }) => p.user.id !== currentUser.id);
      if (otherParticipant) {
        startChat(otherParticipant.user);
      } else if (msg.conversation.otherUser) {
        startChat(msg.conversation.otherUser);
      }
    }
  };

  /**
   * Sohbet nesnesinden başlığı getirir (Grup adı veya diğer kullanıcının adı)
   */
  const getConversationTitle = (conversation: Conversation) =>
    conversation.isGroup ? conversation.name : conversation.otherUser?.username;

  /**
   * Sohbet listesinde son mesaj metnini biçimlendirerek önizleme oluşturur.
   * Sistem olaylarını (gruba katılma, ayrılma, çıkarılma, yönetici atama) Türkçeleştirir.
   */
  const getConversationPreview = (conversation: Conversation) => {
    if (!conversation.lastMessage) return 'Henüz mesaj yok';
    const content = conversation.lastMessage.content;
    if (content) {
      if (content.startsWith('[SYSTEM_LEAVE]:')) {
        const username = content.replace('[SYSTEM_LEAVE]:', '');
        return username === currentUser?.username ? 'Gruptan ayrıldınız' : `${username} gruptan ayrıldı`;
      }
      if (content.startsWith('[SYSTEM_KICK]:')) {
        const parts = content.replace('[SYSTEM_KICK]:', '').split(':');
        const adminUsername = parts[0];
        const kickedUsername = parts[1];
        return kickedUsername === currentUser?.username 
          ? `${adminUsername} sizi gruptan çıkardı`
          : `${adminUsername}, ${kickedUsername} kullanıcısını gruptan çıkardı`;
      }
      if (content.startsWith('[SYSTEM_ADD]:')) {
        const parts = content.replace('[SYSTEM_ADD]:', '').split(':');
        const adminUsername = parts[0];
        const addedUsername = parts[1];
        if (addedUsername === currentUser?.username) {
          return `${adminUsername} sizi ekledi`;
        } else if (adminUsername === currentUser?.username) {
          return `Siz "${addedUsername}" kullanıcısını eklediniz`;
        } else {
          return `${adminUsername}, "${addedUsername}" kullanıcısını ekledi`;
        }
      }
      if (content.startsWith('[SYSTEM_ADMIN_ASSIGN]:')) {
        const newAdminUsername = content.replace('[SYSTEM_ADMIN_ASSIGN]:', '');
        return newAdminUsername === currentUser?.username 
          ? 'Yeni grup yöneticisi siz oldunuz' 
          : `Yeni grup yöneticisi: ${newAdminUsername}`;
      }
      if (content.startsWith('[SYSTEM_ADMIN_TRANSFER]:')) {
        const parts = content.replace('[SYSTEM_ADMIN_TRANSFER]:', '').split(':');
        const adminUsername = parts[0];
        const newAdminUsername = parts[1];
        if (newAdminUsername === currentUser?.username) {
          return `${adminUsername} sizi grup yöneticisi yaptı`;
        } else if (adminUsername === currentUser?.username) {
          return `"${newAdminUsername}" kullanıcısını grup yöneticisi yaptınız`;
        } else {
          return `${adminUsername}, "${newAdminUsername}" kullanıcısını grup yöneticisi yaptı`;
        }
      }
      return content;
    }
    return conversation.lastMessage.fileType === 'image' ? '📷 Görsel' : '📎 Dosya';
  };

  // Arşivlenmiş sohbetlerin filtrelenmesi
  const archivedConversations = conversationList.filter((conversation) => {
    if (!conversation.isGroup && !conversation.lastMessage && activeConversation?.id !== conversation.id) {
      return false;
    }
    return conversation.isArchived;
  });
  
  const getUnreadKey = (conversation: Conversation) =>
    conversation.isGroup ? conversation.id : conversation.otherUser?.id || conversation.id;
    
  const archivedUnreadCount = archivedConversations.filter((conversation) => (unreadCounts[getUnreadKey(conversation)] || 0) > 0).length;

  // Ana listede gösterilecek sohbetlerin filtrelenmesi
  const filteredConversations = conversationList.filter((conversation) => {
    if (conversation.isArchived !== isArchiveView) return false;
    
    // Birebir konuşmalarda mesaj yoksa ve şu an aktif seçili konuşma değilse listede gösterme
    if (!conversation.isGroup && !conversation.lastMessage && activeConversation?.id !== conversation.id) {
      return false;
    }

    const title = getConversationTitle(conversation);
    if (isGlobalSearchActive) return true;
    return title?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const filteredContactUsers = usersList.filter(user => user.username.toLowerCase().includes(contactsSearchTerm.toLowerCase()));
  
  const searchUserResults = isGlobalSearchActive
    ? usersList.filter(user => user.username.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  /** Arama terimini tarayıcının yerel hafızasında (localStorage) saklar */
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

  /** Yıldızlı mesajlar panelini açar ve kayıtlı mesajları yükler */
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

  /** Kayıtlı kullanıcılar (Rehber) görünümünü açar */
  const openContactsPanel = () => {
    setIsContactsListView(true);
    setIsArchiveView(false);
    setIsCallsView(false);
    setIsContactsPanelOpen(false);
    setIsSidebarMenuOpen(false);
    setIsStarredPanelOpen(false);
  };

  /** Yeni grup oluşturma modalını tetikler */
  const openGroupCreator = () => {
    setIsGroupModalOpen(true);
    setIsSidebarMenuOpen(false);
    setIsContactsPanelOpen(false);
    setIsContactsListView(false);
    setIsCallsView(false);
    setIsArchiveView(false);
    setIsStarredPanelOpen(false);
  };

  /** Rehberdeki bir kullanıcıyla sohbet başlatır */
  const startContactChat = (user: User) => {
    startChat(user);
    setIsContactsPanelOpen(false);
    setIsStarredPanelOpen(false);
    setContactsSearchTerm('');
  };

  /**
   * Tekil sohbet satırını ekrana çizen yardımcı JSX render fonksiyonu
   */
  const renderConversationRow = (conversation: Conversation) => {
    const otherUser = conversation.otherUser;
    const unreadKey = conversation.isGroup ? conversation.id : otherUser?.id || conversation.id;
    const preview = getConversationPreview(conversation);
    // Biri yazarken son mesaj önizlemesi geçici olarak turuncu "yazıyor..." metnine dönüşür
    const typingUsername = typingByConversation[conversation.id];

    return (
      <div
        key={conversation.id}
        className={`user-item ${activeConversation?.id === conversation.id ? 'active' : ''}`}
        onClick={() => conversation.isGroup ? startGroupChat(conversation) : otherUser && startChat(otherUser)}
        style={{ color: textColor, opacity: conversation.isArchived ? 0.85 : 1 }}
      >
        {/* Avatar ve Çevrimiçi Durum İndikatörü */}
        <div className="avatar-small" style={{ background: '#f97316', color: 'white', position: 'relative', overflow: 'visible' }}>
          {conversation.isGroup && conversation.avatarUrl
            ? <img src={conversation.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : otherUser?.avatarUrl
            ? <img src={otherUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : conversation.isGroup ? '👥' : otherUser?.username?.[0]?.toUpperCase()}
          {!conversation.isGroup && otherUser?.isOnline && (
            <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />
          )}
        </div>

        {/* İsim ve Son Mesaj Önizlemesi */}
        <div className="user-info">
          <span className="user-name">
            {conversation.isPinned ? '📌 ' : ''}{conversation.isMuted ? '🔕 ' : ''}{getConversationTitle(conversation)}
          </span>
          <div style={{ fontSize: '12px', color: typingUsername ? '#f97316' : iconColor, fontWeight: typingUsername ? 700 : 400, marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
            {typingUsername ? `${typingUsername} yazıyor...` : preview}
          </div>
        </div>

        {/* Okunmamış Mesaj Rozeti */}
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
      {/* --- EN SOL NAVİGASYON ŞERİDİ (DAR ŞERİT) --- */}
      <div style={{ width: '58px', flexShrink: 0, background: panelBg, borderRight: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 8px', boxSizing: 'border-box', gap: '10px' }}>
        {/* Kullanıcının Kendi Profil Resmi / Baş Harfi */}
        <div
          title={`${currentUser.username} • Profil resmini gör`}
          onClick={onViewOwnAvatar}
          style={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: '#f97316', color: 'white', fontWeight: 800, fontSize: '17px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}
        >
          {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt={currentUser.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : currentUser.username?.[0]?.toUpperCase()}
        </div>

        <div style={{ flex: 1 }} />

        {/* Aramalar Görünümü Butonu */}
        <button
          title="Aramalar"
          onClick={() => { setIsCallsView(true); setIsArchiveView(false); setIsContactsListView(false); setIsStarredPanelOpen(false); setIsSidebarMenuOpen(false); }}
          style={{ width: '38px', height: '38px', borderRadius: '12px', border: 'none', background: isCallsView ? '#f97316' : 'transparent', color: isCallsView ? 'white' : iconColor, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.57a1 1 0 0 0-1.01.24l-2.2 2.2a15.045 15.045 0 0 1-6.59-6.59l2.2-2.2a1 1 0 0 0 .24-1.01c-.38-1.11-.57-2.3-.57-3.53 0-.55-.45-1-1-1H3.99c-.55 0-1 .45-1 1 0 9.39 7.62 17 17 17 .55 0 1-.45 1-1v-3.51c0-.55-.45-1-1-1z"/>
          </svg>
        </button>

        {/* Ayarlar Modalı Açma Butonu */}
        <button
          className="icon-btn"
          title="Ayarlar"
          aria-label="Ayarlar"
          onClick={() => setIsSettingsOpen(true)}
          style={{ display: 'grid', placeItems: 'center' }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      {/* --- ANA SIDEBAR PANELİ --- */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Üst Header Alanı (Başlık, Tema Değiştirici ve Menü) */}
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 12px', background: panelBg, borderBottom: `1px solid ${borderColor}`, minWidth: 0 }}>
        <h2 
          title={isContactsListView ? 'Kayıtlı Kullanıcılar' : isCallsView ? 'Aramalar' : isArchiveView ? 'Arşiv' : 'Sohbetler'}
          style={{ margin: 0, fontSize: '18px', color: textColor, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1, marginRight: '8px' }}
        >
          {isContactsListView ? 'Kayıtlı Kullanıcılar' : isCallsView ? 'Aramalar' : isArchiveView ? 'Arşiv' : 'Sohbetler'}
        </h2>

        <div style={{ display: 'flex', gap: '4px' }}>
          {/* Ana Görünüme Geri Dönüş Butonu */}
          {(isArchiveView || isContactsListView || isCallsView) && (
            <Button variant="icon" onClick={() => { setIsArchiveView(false); setIsContactsListView(false); setIsCallsView(false); }} title="Sohbetlere dön" aria-label="Sohbetlere dön" style={{ color: iconColor }} icon={<span style={{ fontSize: '20px' }}>←</span>} />
          )}

          {/* Aydınlık / Karanlık Mod Değiştirme Butonu */}
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

          {/* Üç Nokta Seçenekler Menüsü */}
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

      {/* WebSocket Bağlantı Kopukluk Uyarı Banner'ı */}
      {socketConnectionStatus !== 'connected' && (
        <div style={{ margin: '10px', padding: '10px 12px', borderRadius: '10px', background: isDarkMode ? '#3b2f12' : '#fff4d6', border: `1px solid ${isDarkMode ? '#7a5b14' : '#ffd36a'}`, color: textColor, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span>{isReconnecting ? 'Yenileniyor... Anlık bağlantı yeniden kuruluyor.' : socketConnectionStatus === 'inactive' ? 'Uzun süre işlem yapılmadı. Anlık bağlantı kapandı.' : 'Bağlantı koptu. Anlık bildirimler durdu.'}</span>
          <button onClick={onReconnectRealtime} disabled={isReconnecting} style={{ border: 'none', borderRadius: '999px', padding: '6px 10px', background: '#f97316', color: 'white', cursor: isReconnecting ? 'default' : 'pointer', fontWeight: 700, whiteSpace: 'nowrap', opacity: isReconnecting ? 0.65 : 1 }}>
            Bağlan
          </button>
        </div>
      )}

      {/* Arama Input Alanı */}
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

      {/* Hızlı Rehber Paneli Drawer */}
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

      {/* Yıldızlı Mesajlar Paneli Drawer */}
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

      {/* --- ANA LİSTE ALANI --- */}
      <div className="users-list" style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {/* Tam Ekran Rehber Görünümü */}
        {isContactsListView && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 45, background: isDarkMode ? '#111b21' : '#ffffff', color: textColor, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${borderColor}`, background: isDarkMode ? '#111b21' : '#ffffff', flexShrink: 0 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '12px', color: iconColor, fontSize: '15px', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>🔍</span>
                <input
                  value={contactsSearchTerm}
                  onChange={(event) => setContactsSearchTerm(event.target.value)}
                  placeholder="Kullanıcı ara..."
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 36px',
                    borderRadius: '20px',
                    border: 'none',
                    background: isDarkMode ? '#202c33' : '#f0f2f5',
                    color: textColor,
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {contactsSearchTerm.trim() === '' && (
                <div 
                  onClick={openGroupCreator}
                  className="user-item"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '10px 15px', 
                    cursor: 'pointer', 
                    borderBottom: `1px solid ${borderColor}`,
                    color: textColor
                  }}
                >
                  <div className="avatar-small" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(249, 115, 22, 0.15)', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', marginRight: '12px', flexShrink: 0 }}>
                    👥
                  </div>
                  <div className="user-info">
                    <span className="user-name" style={{ color: '#f97316', fontWeight: 600 }}>Yeni Grup Kur</span>
                    <div style={{ fontSize: '11px', color: iconColor, marginTop: '2px' }}>Arkadaşlarınla grup sohbeti başlat</div>
                  </div>
                </div>
              )}

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
          </div>
        )}

        {/* Aramalar Geçmişi Görünümü */}
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

        {/* Global Arama Sonuçları Overlay Paneli */}
        {isGlobalSearchActive && (
          <>
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

        {/* Arşiv Geçiş Butonu */}
        {!isArchiveView && !isContactsListView && !isCallsView && archivedConversations.length > 0 && searchTerm.trim() === '' && (
          <div onClick={() => { setIsArchiveView(true); setIsCallsView(false); setIsContactsListView(false); }} className="user-item" style={{ color: textColor, borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}>
            <div className="avatar-small" style={{ background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5" rx="1"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
            </div>
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

        {/* Standart Sohbet Listesi Başlığı ve Satırları */}
        <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: iconColor, textTransform: 'uppercase' }}>
          {isArchiveView ? 'Arşivlenenler' : 'Son Sohbetler'}
        </h3>
        {filteredConversations.length > 0
          ? filteredConversations.map(renderConversationRow)
          : <div style={{ padding: '10px 15px', fontSize: '13px', color: iconColor }}>{isArchiveView ? 'Arşivde sohbet yok.' : 'Henüz sohbet yok.'}</div>}
      </div>

      </div>
      {/* Özel Bileşen İçi Açılır Menü Stilleri */}
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
