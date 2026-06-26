import { useState } from 'react';
import axios from 'axios';
import './Sidebar.css';
import type { User, Conversation, Message } from '../../App'; 
import Button from '../UI/Button';

interface SidebarProps {
  currentUser: User;
  groupsList: Conversation[];
  usersList: User[];
  activeConversation: Conversation | null;
  selectedUser: User | null;
  unreadCounts: Record<string, number>;
  startGroupChat: (group: Conversation) => void;
  startChat: (user: User) => void;
  setIsGroupModalOpen: (isOpen: boolean) => void;
  setIsSettingsOpen: (isOpen: boolean) => void;
  cikisYap: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

export default function Sidebar({
  currentUser, groupsList, usersList, activeConversation, selectedUser,
  unreadCounts, isDarkMode, setIsDarkMode, startGroupChat, startChat, setIsGroupModalOpen, setIsSettingsOpen, cikisYap
}: SidebarProps) {
  
  const [searchTerm, setSearchTerm] = useState('');
  const [messageResults, setMessageResults] = useState<Message[]>([]); // Backend'den gelecek mesajlar
  const [isSearching, setIsSearching] = useState(false);

  // Hem yerel listeleri filtrele hem de API'ye istek at
  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);

    // Eğer kelime 2 harften kısaysa veritabanını yorma, sonuçları temizle
    if (val.trim().length < 2) {
      setMessageResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      // SENİN YAZDIĞIN MUHTEŞEM API'Yİ ÇAĞIRIYORUZ!
      const res = await axios.get(`http://localhost:3000/api/messages/search?q=${val}&userId=${currentUser.id}`);
      setMessageResults(res.data);
    } catch (error) {
      console.error("Global arama hatası:", error);
    } finally {
      setIsSearching(false);
    }
  };

  // YENİ: Aranan mesaja tıklayınca ilgili sohbete götüren fonksiyon
  const handleMessageClick = (msg: Message) => {
    if (!msg.conversation) return;

    if (msg.conversation.isGroup) {
      // Eğer grup mesajıysa, grubu aç
      startGroupChat(msg.conversation);
    } else {
      // Eğer özel mesajsa, karşıdaki kişiyi bul ve onunla olan sohbeti aç
      const otherParticipant = msg.conversation.participants.find((p: any) => p.user.id !== currentUser.id);
      if (otherParticipant) {
        startChat(otherParticipant.user);
      }
    }
  };

  // Yerel Listeleri Filtrele (Kişiler ve Gruplar)
  const filteredGroups = groupsList.filter(group => 
    group.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const filteredUsers = usersList.filter(user => 
    user.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="user-profile">
          <div className="avatar">{currentUser.username.charAt(0).toUpperCase()}</div>
          <span>{currentUser.username}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button text={isDarkMode ? "☀️" : "🌙"} onClick={() => setIsDarkMode(!isDarkMode)} variant="ghost" title={isDarkMode ? "Aydınlık Mod" : "Karanlık Mod"} />
          <Button text="➕" onClick={() => setIsGroupModalOpen(true)} variant="ghost" title="Yeni Grup Kur" />
          <Button text="⚙️" onClick={() => setIsSettingsOpen(true)} variant="ghost" title="Ayarlar" />
          <Button text="🚪" onClick={cikisYap} variant="ghost" title="Çıkış Yap" />
        </div>
      </div>

      <div className="sidebar-search" style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>
        <input 
          type="text" 
          className="global-search-input"
          placeholder="Kişi, grup veya mesaj ara..." 
          value={searchTerm}
          onChange={handleSearchChange}
        />
      </div>
      
      <div className="users-list">
        
        {/* 1. GRUP SONUÇLARI */}
        {filteredGroups.length > 0 && (
          <>
            <h3 className="list-title">Gruplarım</h3>
            {filteredGroups.map((group) => (
              <div key={group.id} className={`user-item ${activeConversation?.id === group.id ? 'active' : ''}`} onClick={() => startGroupChat(group)}>
                <div className="avatar-small" style={{ background: '#00a884', color: 'white' }}>👥</div>
                <div className="user-info">
                  <span className="user-name">{group.name}</span>
                </div>
                {unreadCounts[group.id] > 0 && (
                  <span style={{ background: '#00a884', color: 'white', padding: '2px 8px', borderRadius: '50%', fontSize: '12px', marginLeft: 'auto' }}>
                    {unreadCounts[group.id]}
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {/* 2. KİŞİ SONUÇLARI */}
        {(filteredUsers.length > 0 || searchTerm === '') && (
          <>
            <h3 className="list-title" style={filteredGroups.length > 0 ? { marginTop: '15px' } : {}}>Kişiler</h3>
            {filteredUsers.map((user) => (
              <div key={user.id} className={`user-item ${selectedUser?.id === user.id ? 'active' : ''}`} onClick={() => startChat(user)}>
                <div className="avatar-small">{user.username.charAt(0).toUpperCase()}</div>
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

        {/* 3. SENİN API'NDEN GELEN GLOBAL MESAJ SONUÇLARI */}
        {searchTerm.length >= 2 && (
          <>
            <h3 className="list-title" style={{ marginTop: '15px', color: '#00a884' }}>Mesajlarda Bulunanlar</h3>
            
            {isSearching ? (
              <div style={{ padding: '10px', fontSize: '13px', color: '#8696a0' }}>Aranıyor...</div>
            ) : messageResults.length > 0 ? (
              messageResults.map((msg) => (
                <div 
                  key={msg.id} 
                  className="user-item" 
                  // Eğer mesaj bir gruptansa grup sohbetini, kişidense o kişiyle olan sohbeti açar
                 onClick={() => handleMessageClick(msg)}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '10px' }}
                >
                  <div style={{ fontSize: '12px', color: '#8696a0', marginBottom: '4px' }}>
                    <strong>{msg.sender?.username}</strong> yazdı:
                  </div>
                  <div style={{ fontSize: '14px', color: isDarkMode ? '#e9edef' : '#333' }}>
                    {/* Arama kelimesini basitçe gösteriyoruz */}
                    {msg.content.length > 40 ? msg.content.substring(0, 40) + '...' : msg.content}
                  </div>
                </div>
              ))
            ) : (
               <div style={{ padding: '10px', fontSize: '13px', color: '#8696a0' }}>Mesaj bulunamadı.</div>
            )}
          </>
        )}

      </div>
    </div>
  );
}