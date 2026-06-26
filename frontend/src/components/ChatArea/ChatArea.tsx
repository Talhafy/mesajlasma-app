import { useState } from 'react';
import type { User, Conversation, Message } from '../../App';
import Button from '../UI/Button';
import './ChatArea.css'; // (Kendi CSS dosyanın adına göre burayı ayarlayabilirsin)

interface ChatAreaProps {
  currentUser: User;
  activeConversation: Conversation | null;
  selectedUser: User | null;
  messages: Message[];
  newMessage: string;
  setNewMessage: (val: string) => void;
  mesajGonder: () => void;
  messagesEndRef: any;
  openGroupSettings: () => void;
  closeChat: () => void;
}

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage,
  setNewMessage, mesajGonder, messagesEndRef, openGroupSettings, closeChat
}: ChatAreaProps) {

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [messageSearchTerm, setMessageSearchTerm] = useState('');

  // 1. HAYATİ EKLENTİ: Eğer kimse seçili değilse boş ekranı (Mesajlaşmaya Başla) göster ve KODU DURDUR!
  if (!activeConversation && !selectedUser) {
    return (
      <div className="chat-area empty-chat-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: '#f0f2f5' }}>
        <h2 className="empty-chat-box" style={{ color: '#41525d', fontWeight: 300 }}>Mesajlaşmaya Başla</h2>
        <p style={{ color: '#8696a0', marginTop: '10px' }}>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
      </div>
    );
  }

  // 2. Arama filtresi
  const displayedMessages = messageSearchTerm.trim() !== ''
    ? messages.filter(m => m.content.toLowerCase().includes(messageSearchTerm.toLowerCase()))
    : messages;

  return (
    <div className="chat-area">
      <div className="chat-header">
        <div className="chat-title-info">
          <button className="mobile-back-btn" onClick={closeChat}>←</button>
          {/* Kim seçiliyse onun adını yaz */}
          <h2>{activeConversation?.isGroup ? activeConversation.name : selectedUser?.username}</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* Arama İkonu */}
          <Button text="🔍" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} variant="ghost" title="Mesajlarda Ara" />
          
          {activeConversation?.isGroup && (
            <Button text="ℹ️" onClick={openGroupSettings} variant="ghost" title="Grup Bilgisi" />
          )}
        </div>
      </div>

      {isSearchOpen && (
        <div className="chat-search-bar" style={{ padding: '10px 20px', background: '#f0f2f5', borderBottom: '1px solid #ddd' }}>
          <input 
            type="text" 
            className="global-search-input"
            placeholder="Bu sohbette ara..." 
            value={messageSearchTerm}
            onChange={(e) => setMessageSearchTerm(e.target.value)}
            autoFocus
          />
        </div>
      )}

    <div className="messages-list">
        {displayedMessages.map((msg, index) => {
          const isMe = msg.senderId === currentUser.id;
          
          // YENİ: Görüldü kontrolü (Eğer readByIds dizisi varsa ve içi doluysa mesaj okunmuştur)
          const isRead = msg.readByIds && msg.readByIds.length > 0;
          
          // YENİ: Mesaj saati formatlama (Örn: 14:30)
          const timeString = msg.createdAt 
            ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={index} className={`message-row ${isMe ? 'me' : 'them'}`}>
              <div className="message-bubble">
                
                {/* Grup mesajlarında gönderenin adını yazma kısmı */}
                {!isMe && activeConversation?.isGroup && (
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00a884', marginBottom: '4px' }}>
                    {msg.sender?.username}
                  </div>
                )}
                
                {/* Mesajın asıl içeriği */}
                <div style={{ wordBreak: 'break-word' }}>{msg.content}</div>
                
                {/* YENİ: Saat ve Görüldü Tiki Alanı */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'flex-end', 
                  alignItems: 'center', 
                  gap: '4px', 
                  fontSize: '11px', 
                  color: isMe ? 'rgba(255,255,255,0.7)' : '#8696a0', 
                  marginTop: '4px' 
                }}>
                <div className="message-meta">
                  <span>{timeString}</span>
                  {isMe && (
                    <span className={`message-ticks ${isRead ? 'read' : ''}`}>
                      {isRead ? '✓✓' : '✓'} 
                    </span>
                  )}
                </div>
                </div>

              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <input 
          type="text" 
          placeholder="Bir mesaj yazın..." 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') mesajGonder(); }}
        />
        <Button text="Gönder" onClick={mesajGonder} />
      </div>
    </div>
  );
}