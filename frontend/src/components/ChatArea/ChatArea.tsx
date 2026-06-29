import { useState, useEffect } from 'react';
import axios from 'axios';
import type { User, Conversation, Message } from '../../App';
import Button from '../UI/Button';
import './ChatArea.css'; 
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { tr } from 'date-fns/locale';

import EmojiPicker, { Theme, EmojiStyle, SuggestionMode, type EmojiClickData } from 'emoji-picker-react';

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
  
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  useEffect(() => {
    if (activeConversation?.id) {
      fetchPendingMessages();
    }
  }, [activeConversation?.id, isPendingModalOpen]);

  const fetchPendingMessages = async () => {
    try {
      const res = await axios.get(`http://localhost:3000/api/messages/scheduled/${activeConversation?.id}`);
      setPendingMessages(res.data);
    } catch (error) {
      console.error("Bekleyen mesajlar alınamadı", error);
    }
  };

  const cancelScheduledMessage = async (id: string) => {
    try {
      await axios.delete(`http://localhost:3000/api/messages/schedule/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      alert("İptal işlemi başarısız oldu.");
    }
  };

  const sendNowScheduledMessage = async (id: string) => {
    try {
      await axios.post(`http://localhost:3000/api/messages/schedule/send-now/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      alert("Mesaj anında gönderilemedi.");
    }
  };

  const editScheduledMessage = async (id: string, currentContent: string) => {
    const newContent = prompt("Zamanlanmış mesajı düzenle:", currentContent);
    if (newContent === null || !newContent.trim() || newContent === currentContent) return;

    try {
      await axios.put(`http://localhost:3000/api/messages/schedule/${id}`, { content: newContent });
      setPendingMessages(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
    } catch (error) {
      alert("Mesaj güncellenemedi.");
    }
  };

  if (!activeConversation && !selectedUser) {
    return (
      <div className="chat-area empty-chat-state">
        <h2 className="empty-chat-box">Mesajlaşmaya Başla</h2>
        <p>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
      </div>
    );
  }

  const filterPassedTime = (time: Date) => {
    const currentDate = new Date();
    const selectedDate = new Date(time);
    return currentDate.getTime() < selectedDate.getTime();
  };

 const handleSend = async () => {
    if (!newMessage.trim()) return;

    if (isScheduling) {
      if (!scheduleTime) {
        alert("HATA: Lütfen takvimden mesajın gönderileceği bir tarih ve saat seçin!");
        return; 
      }

      if (scheduleTime.getTime() <= Date.now()) {
        alert("HATA: Geçmiş bir saate mesaj zamanlayamazsınız!");
        return;
      }

      try {
        await axios.post('http://localhost:3000/api/messages/schedule', {
          conversationId: activeConversation?.id,
          senderId: currentUser.id,
          content: newMessage,
          sendAt: scheduleTime.toISOString()
        });
        
        alert("Mesajınız başarıyla zamanlandı! 🎉");
        setIsScheduling(false);
        setScheduleTime(null); 
        setNewMessage('');
        fetchPendingMessages(); 
      } catch (error: any) {
        alert(error.response?.data?.error || "Mesaj zamanlanırken bir hata oluştu.");
      }
      
    } else {
      mesajGonder(); 
    }
  };

  const displayedMessages = messageSearchTerm.trim() !== ''
    ? messages.filter(m => m.content.toLowerCase().includes(messageSearchTerm.toLowerCase()))
    : messages;

  return (
    <div className="chat-area" style={{ position: 'relative' }}>
      
      <div className="chat-header">
        <div className="chat-title-info">
          <button className="mobile-back-btn" onClick={closeChat}>←</button>
          <h2>{activeConversation?.isGroup ? activeConversation.name : selectedUser?.username}</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button text={pendingMessages.length > 0 ? `⏳ (${pendingMessages.length})` : "⏳"} onClick={() => setIsPendingModalOpen(!isPendingModalOpen)} variant="ghost" title="Bekleyen Mesajlar" />
          <Button text="🔍" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} variant="ghost" title="Mesajlarda Ara" />
          {activeConversation?.isGroup && (
            <Button text="ℹ️" onClick={openGroupSettings} variant="ghost" title="Grup Bilgisi" />
          )}
        </div>
      </div>

      {isPendingModalOpen && (
        <div className="theme-modal" style={{ position: 'absolute', top: '65px', right: '20px', width: '300px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 10, padding: '15px' }}>
          <h3 style={{ fontSize: '15px', color: '#00a884', margin: '0 0 10px 0', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>Zamanlanmış Mesajlar</h3>
          
          {pendingMessages.length === 0 ? (
             <p style={{ fontSize: '13px', color: '#8696a0', textAlign: 'center' }}>Bekleyen mesaj yok.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              {pendingMessages.map((pm) => (
                <div key={pm.id} className="theme-modal-item" style={{ padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ color: '#8696a0', marginBottom: '6px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Zaman: {new Date(pm.sendAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => sendNowScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#00a884', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }} title="Hemen Şimdi Gönder">Şimdi Gönder</button>
                      <button onClick={() => editScheduledMessage(pm.id, pm.content)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }} title="İçeriği Değiştir">Düzenle</button>
                      <button onClick={() => cancelScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }} title="Zamanlamayı İptal Et ve Sil">İptal</button>
                    </div>
                  </div>
                  <div className="theme-text-main" style={{ wordBreak: 'break-word' }}>{pm.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isSearchOpen && (
        <div className="chat-search-bar" style={{ padding: '10px 20px', background: '#f0f2f5', borderBottom: '1px solid #ddd' }}>
          <input type="text" className="global-search-input" placeholder="Bu sohbette ara..." value={messageSearchTerm} onChange={(e) => setMessageSearchTerm(e.target.value)} autoFocus />
        </div>
      )}

      <div className="messages-list">
        {displayedMessages.map((msg, index) => {
          const isMe = msg.senderId === currentUser.id;
          const isRead = msg.readByIds && msg.readByIds.length > 0;
          const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={index} className={`message-row ${isMe ? 'me' : 'them'}`}>
              <div className="message-bubble">
                {!isMe && activeConversation?.isGroup && (
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00a884', marginBottom: '4px' }}>{msg.sender?.username}</div>
                )}
                <div style={{ wordBreak: 'break-word' }}>{msg.content}</div>
                <div className="message-meta">
                  <span>{timeString}</span>
                  {isMe && <span className={`message-ticks ${isRead ? 'read' : ''}`}>{isRead ? '✓✓' : '✓'}</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* İNPUT ALANI BACKGROUND KALDIRILDI, CLASS EKLENDİ */}
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '15px 20px', position: 'relative' }}>
        
        {isScheduling && (
          <div className="theme-modal" style={{ position: 'absolute', bottom: '75px', right: '20px', padding: '15px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#00a884' }}>Gönderimi Planla</span>
              <button onClick={() => { setIsScheduling(false); setScheduleTime(null); }} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#999' }}>✖</button>
            </div>
            <DatePicker selected={scheduleTime} onChange={(date: Date | null) => setScheduleTime(date)} showTimeSelect timeFormat="HH:mm" timeIntervals={5} timeCaption="Saat" dateFormat="d MMMM yyyy, HH:mm" minDate={new Date()} filterTime={filterPassedTime} locale={tr} placeholderText="Tarih ve saat seçin" onKeyDown={(e) => e.preventDefault()} inline />
            <div style={{ opacity: scheduleTime ? 1 : 0.5, pointerEvents: scheduleTime ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
              <Button text="Zamanla ve Gönder" onClick={handleSend} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '15px', color: '#54656f', fontSize: '22px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ cursor: 'pointer', filter: showEmojiPicker ? 'brightness(0.8)' : 'none' }} title="Emoji Ekle" onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachmentMenu(false); }}>😊</span>
            {showEmojiPicker && (
              <div className="emoji-picker-wrapper theme-modal" style={{ position: 'absolute', bottom: '45px', left: '0', zIndex: 1000, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                {/* Emojilerin karanlık modda görünmesi için Theme.AUTO kullanıldı */}
                <EmojiPicker onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)} theme={Theme.AUTO} emojiStyle={EmojiStyle.APPLE} lazyLoadEmojis={true} searchPlaceholder="Emoji ara..." suggestedEmojisMode={SuggestionMode.RECENT} previewConfig={{ showPreview: false }} />
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <span style={{ cursor: 'pointer', display: 'inline-block', transform: showAttachmentMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} title="Dosya Ekle" onClick={() => { setShowAttachmentMenu(!showAttachmentMenu); setShowEmojiPicker(false); }}>📎</span>
            {showAttachmentMenu && (
              <div className="theme-modal" style={{ position: 'absolute', bottom: '45px', left: '-50px', padding: '15px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '18px', zIndex: 100, minWidth: '160px' }}>
                <button className="theme-text-main" onClick={() => alert("Görsel yükleme yakında eklenecek!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#bf59cf', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🖼️</span> Görsel
                </button>
                <button className="theme-text-main" onClick={() => alert("Belge yükleme yakında eklenecek!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#5157ae', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📄</span> Belge
                </button>
                <button className="theme-text-main" onClick={() => alert("Ses kayıt yakında eklenecek!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#e53935', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎤</span> Ses Dosyası
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* INPUT ALANI ARKA PLAN RENGİ KALDIRILDI */}
        <input 
          type="text" 
          className="chat-input"
          placeholder="Bir mesaj yazın..." 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          style={{ flex: 1, padding: '12px 15px', borderRadius: '8px', border: 'none', outline: 'none', fontSize: '15px' }}
        />

        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', opacity: newMessage.trim() ? 1 : 0.5, pointerEvents: newMessage.trim() ? 'auto' : 'none', transition: 'all 0.2s ease-in-out' }}>
          <button onClick={handleSend} style={{ background: '#00a884', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }} title="Şimdi Gönder">➤</button>
          <button onClick={() => setIsScheduling(!isScheduling)} style={{ background: '#009071', color: 'white', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }} title="Gönderimi planla">▼</button>
        </div>
      </div>
    </div>
  );
}