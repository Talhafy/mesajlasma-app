import { useState } from 'react';
import { api } from '../../api/httpClient';
import './Sidebar.css';
import type { User, Conversation, Message } from '../../types/chat';
import Button from '../UI/Button'; // Senin bileşenini geri çağırdık!

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
}

export default function Sidebar({
  currentUser, conversationList, usersList, activeConversation, selectedUser,
  unreadCounts, isDarkMode, setIsDarkMode, startGroupChat, startChat, setIsGroupModalOpen, setIsSettingsOpen
}: SidebarProps) {

  const [searchTerm, setSearchTerm] = useState('');
  const [messageResults, setMessageResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const panelBg = isDarkMode ? '#202c33' : '#f0f2f5';
  const textColor = isDarkMode ? '#e9edef' : '#111b21';
  const iconColor = isDarkMode ? '#aebac1' : '#54656f';
  const borderColor = isDarkMode ? '#313d45' : '#d1d7db';

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);

    if (val.trim().length < 2) {
      setMessageResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const res = await api.get(`/messages/search?q=${encodeURIComponent(val)}`);
      setMessageResults(res.data);
    } catch (error) {
      console.error("Global arama hatası:", error);
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

  const filteredUsers = usersList.filter(user => user.username.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredConversations = conversationList.filter((conversation) => {
    const title = conversation.isGroup ? conversation.name : conversation.otherUser?.username;
    return title?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: isDarkMode ? '#111b21' : '#ffffff' }}>

      {/* ÜST BAR */}
      <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}` }}>
        <h2 style={{ margin: 0, fontSize: '22px', color: textColor, fontWeight: 'bold' }}>Sohbetler</h2>

        <div style={{ display: 'flex', gap: '4px' }}>

          {/* Tema değiştirme kısayolu */}
          <Button
            variant="icon"
            onClick={() => setIsDarkMode(!isDarkMode)}
            title={isDarkMode ? "Aydınlık Mod" : "Karanlık Mod"}
            style={{ color: iconColor }}
            icon={
              isDarkMode ? (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06z"></path>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4C12.92 3.04 12.46 3 12 3z"></path>
                </svg>
              )
            }
          />

          {/* Yeni grup oluşturma kısayolu */}
          <Button
            variant="icon"
            onClick={() => setIsGroupModalOpen(true)}
            title="Yeni Grup Kur"
            style={{ color: iconColor }}
            icon={
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M19.005 3.175H4.674C3.642 3.175 3 3.789 3 4.821V21.02l3.544-3.514h12.461c1.033 0 2.064-1.06 2.064-2.093V4.821c-.001-1.032-1.032-1.646-2.064-1.646zm-4.989 9.869H10.04V10.04h3.976v3.004z"></path>
              </svg>
            }
          />
        </div>
      </div>

      {/* ARAMA ÇUBUĞU */}
      <div className="sidebar-search" style={{ padding: '10px', borderBottom: `1px solid ${borderColor}`, background: isDarkMode ? '#111b21' : '#ffffff' }}>
        <input
          type="text"
          className="global-search-input"
          placeholder="Kişi, grup veya mesaj ara..."
          value={searchTerm}
          onChange={handleSearchChange}
          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${borderColor}`, background: panelBg, color: textColor, outline: 'none' }}
        />
      </div>

      {/* KİŞİLER VE GRUPLAR LİSTESİ */}
      <div className="users-list" style={{ flex: 1, overflowY: 'auto' }}>

        {filteredConversations.length > 0 && (
          <>
            <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: iconColor, textTransform: 'uppercase' }}>Son Sohbetler</h3>
            {filteredConversations.map((conversation) => {
              const otherUser = conversation.otherUser;
              const unreadKey = conversation.isGroup ? conversation.id : otherUser?.id || conversation.id;
              const preview = conversation.lastMessage
                ? conversation.lastMessage.content || (conversation.lastMessage.fileType === 'image' ? '📷 Görsel' : '📎 Dosya')
                : 'Henüz mesaj yok';
              return (
              <div key={conversation.id} className={`user-item ${activeConversation?.id === conversation.id ? 'active' : ''}`} onClick={() => conversation.isGroup ? startGroupChat(conversation) : otherUser && startChat(otherUser)} style={{ color: textColor }}>
                <div className="avatar-small" style={{ background: '#00a884', color: 'white', position: 'relative', overflow: 'visible' }}>
                  {otherUser?.avatarUrl ? <img src={otherUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : conversation.isGroup ? '👥' : otherUser?.username?.[0]?.toUpperCase()}
                  {!conversation.isGroup && otherUser?.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                </div>
                <div className="user-info">
                  <span className="user-name">{conversation.isGroup ? conversation.name : otherUser?.username}</span>
                  <div style={{ fontSize: '12px', color: iconColor, marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '175px' }}>{preview}</div>
                </div>
                {unreadCounts[unreadKey] > 0 && (
                  <span style={{ background: '#00a884', color: 'white', padding: '2px 8px', borderRadius: '50%', fontSize: '12px', marginLeft: 'auto' }}>
                    {unreadCounts[unreadKey]}
                  </span>
                )}
              </div>
            )})}
          </>
        )}

        {(filteredUsers.length > 0 || searchTerm === '') && (
          <>
            <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: iconColor, textTransform: 'uppercase' }}>Kişiler</h3>
            {filteredUsers.map((user) => (
              <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startChat(user)} style={{ color: textColor }}>
                <div className="avatar-small" style={{ position: 'relative', overflow: 'visible' }}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                  {user.isOnline && <span style={{ position: 'absolute', right: '-1px', bottom: '1px', width: '11px', height: '11px', borderRadius: '50%', background: '#25d366', border: `2px solid ${panelBg}` }} />}
                </div>
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                </div>
                {unreadCounts[user.id] > 0 && (
                  <span style={{ background: '#00a884', color: 'white', padding: '2px 8px', borderRadius: '50%', fontSize: '12px', marginLeft: 'auto' }}>
                    {unreadCounts[user.id]}
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {searchTerm.length >= 2 && (
          <>
            <h3 className="list-title" style={{ padding: '15px 15px 5px 15px', margin: 0, fontSize: '13px', color: '#00a884', textTransform: 'uppercase' }}>Mesajlarda Bulunanlar</h3>

            {isSearching ? (
              <div style={{ padding: '10px 15px', fontSize: '13px', color: iconColor }}>Aranıyor...</div>
            ) : messageResults.length > 0 ? (
              messageResults.map((msg) => (
                <div
                  key={msg.id}
                  className="user-item"
                  onClick={() => handleMessageClick(msg)}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '12px 15px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer' }}
                >
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

      {/* PROFİL VE AYARLAR ALANI */}
      <div style={{
        marginTop: 'auto',
        padding: '15px 20px',
        background: panelBg,
        borderTop: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            {currentUser.avatarUrl ? <img src={currentUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : currentUser?.username?.[0]?.toUpperCase()}
          </div>
          <span style={{ fontWeight: '600', color: textColor, fontSize: '16px' }}>{currentUser?.username}</span>
        </div>

        {/* Profil ve hesap ayarları */}
        <Button
          variant="icon"
          onClick={() => setIsSettingsOpen(true)}
          title="Ayarlar"
          style={{ color: iconColor }}
          icon={
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"></path>
            </svg>
          }
        />
      </div>

    </div>
  );
}
