import { useState, useEffect } from 'react';
import axios from 'axios';
import type { User, Conversation, Message } from '../../App';
import Button from '../UI/Button';
import './ChatArea.css'; 
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { tr } from 'date-fns/locale';
import EmojiPicker, { Theme, EmojiStyle, type EmojiClickData, SuggestionMode } from 'emoji-picker-react';

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
  isDarkMode: boolean;
}

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage,
  setNewMessage, mesajGonder, messagesEndRef, openGroupSettings, closeChat, isDarkMode
}: ChatAreaProps) {

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [messageSearchTerm, setMessageSearchTerm] = useState('');
  
  // ZAMANLAMA VE DOSYA EKLEME STATE'LERİ (GERİ GELDİ)
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  // YENİ: MESAJ SEÇENEKLERİ MENÜSÜ İÇİN STATE'LER
  const [openOptionsId, setOpenOptionsId] = useState<string | null>(null);
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);

  const panelBg = isDarkMode ? '#202c33' : '#f0f2f5';      
  const chatBg = isDarkMode ? '#0b141a' : '#efeae2';       
  const textColor = isDarkMode ? '#e9edef' : '#111b21';    
  const iconColor = isDarkMode ? '#aebac1' : '#54656f';    
  const borderColor = isDarkMode ? '#313d45' : '#d1d7db';  
  const inputBg = isDarkMode ? '#2a3942' : '#ffffff';      

  useEffect(() => {
    if (activeConversation?.id) { fetchPendingMessages(); }
  }, [activeConversation?.id, isPendingModalOpen]);

  const fetchPendingMessages = async () => {
    try {
      const res = await axios.get(`http://localhost:3000/api/messages/scheduled/${activeConversation?.id}`);
      setPendingMessages(res.data);
    } catch (error) { console.error("Bekleyen mesajlar alınamadı", error); }
  };

  const cancelScheduledMessage = async (id: string) => {
    try {
      await axios.delete(`http://localhost:3000/api/messages/schedule/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
    } catch (error) { alert("İptal işlemi başarısız oldu."); }
  };

  const sendNowScheduledMessage = async (id: string) => {
    try {
      await axios.post(`http://localhost:3000/api/messages/schedule/send-now/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
    } catch (error) { alert("Mesaj anında gönderilemedi."); }
  };

  const editScheduledMessage = async (id: string, currentContent: string) => {
    const newContent = prompt("Zamanlanmış mesajı düzenle:", currentContent);
    if (newContent === null || !newContent.trim() || newContent === currentContent) return;
    try {
      await axios.put(`http://localhost:3000/api/messages/schedule/${id}`, { content: newContent });
      setPendingMessages(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
    } catch (error) { alert("Mesaj güncellenemedi."); }
  };

  const filterPassedTime = (time: Date) => {
    const currentDate = new Date();
    const selectedDate = new Date(time);
    return currentDate.getTime() < selectedDate.getTime();
  };

  const handleSend = async () => {
    if (!newMessage.trim()) return;

    if (isScheduling) {
      if (!scheduleTime) { return alert("HATA: Lütfen takvimden mesajın gönderileceği bir tarih ve saat seçin!"); }
      if (scheduleTime.getTime() <= Date.now()) { return alert("HATA: Geçmiş bir saate mesaj zamanlayamazsınız!"); }
      try {
        await axios.post('http://localhost:3000/api/messages/schedule', {
          conversationId: activeConversation?.id, senderId: currentUser.id, content: newMessage, sendAt: scheduleTime.toISOString()
        });
        alert("Mesajınız başarıyla zamanlandı! 🎉");
        setIsScheduling(false); setScheduleTime(null); setNewMessage(''); fetchPendingMessages(); 
      } catch (error: any) { alert(error.response?.data?.error || "Mesaj zamanlanırken bir hata oluştu."); }
    } else {
      mesajGonder(); 
    }
  };

  const formatDetailedDate = (dateString?: string) => {
    if (!dateString) return "Tarih bilinmiyor";
    const d = new Date(dateString);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' });
  };

  const getUnixEpoch = (dateString?: string) => {
    if (!dateString) return "-";
    return Math.floor(new Date(dateString).getTime() / 1000);
  };

  // TS UYARISINI DÜZELTMEK İÇİN KULLANILMAYAN PARAMETRELERİN BAŞINA "_" EKLENDİ
  const handleReply = (_msgId: string) => { alert("Yanıtla seçildi (Backend/UI bağlantısı eklenecek)."); setOpenOptionsId(null); };
  const handleForward = (_msgId: string) => { alert("İlet seçildi (Kişi seçme ekranı eklenecek)."); setOpenOptionsId(null); };
  const handleStar = (_msgId: string) => { alert("Mesaj Yıldızlandı ⭐"); setOpenOptionsId(null); };
  const handlePin = (_msgId: string) => { alert("Mesaj Sabitlendi 📌"); setOpenOptionsId(null); };
  const handleDeleteForMe = (_msgId: string) => { alert("Mesaj sadece sizden silindi 🗑️"); setOpenOptionsId(null); };
  const handleDeleteForEveryone = (_msgId: string) => { alert("Mesaj herkesten silindi ⛔"); setOpenOptionsId(null); };

  if (!activeConversation && !selectedUser) {
    return (
      <div className="chat-area empty-chat-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: panelBg }}>
        <h2 className="empty-chat-box" style={{ color: textColor, fontWeight: 300 }}>Mesajlaşmaya Başla</h2>
        <p style={{ color: iconColor, marginTop: '10px' }}>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
      </div>
    );
  }

  const displayedMessages = messageSearchTerm.trim() !== ''
    ? messages.filter(m => m.content.toLowerCase().includes(messageSearchTerm.toLowerCase()))
    : messages;

  return (
    <div className="chat-area" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: chatBg }}>
      
      {/* ÜST BAR (HEADER) */}
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', boxSizing: 'border-box' }}>
        <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button className="mobile-back-btn" onClick={closeChat} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: iconColor }}>←</button>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            {(activeConversation?.isGroup ? activeConversation.name : selectedUser?.username)?.[0]?.toUpperCase()}
          </div>
          <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600' }}>
            {activeConversation?.isGroup ? activeConversation.name : selectedUser?.username}
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Button variant="icon" onClick={() => setIsPendingModalOpen(!isPendingModalOpen)} title="Bekleyen Mesajlar" style={{ color: iconColor, position: 'relative' }}
            icon={<><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"></path></svg>{pendingMessages.length > 0 && (<span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#e53935', color: 'white', fontSize: '10px', fontWeight: 'bold', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${panelBg}` }}>{pendingMessages.length}</span>)}</>} 
          />
          <Button variant="icon" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} title="Mesajlarda Ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.8 0a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"></path></svg>} />
          {activeConversation?.isGroup && (<Button variant="icon" onClick={openGroupSettings} title="Grup Bilgisi" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z"></path></svg>} />)}
        </div>
      </div>

      {/* GERİ GETİRİLEN: BEKLEYEN MESAJLAR PANELİ */}
      {isPendingModalOpen && (
        <div style={{ position: 'absolute', top: '75px', right: '20px', width: '320px', background: inputBg, borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 10, padding: '15px', border: `1px solid ${borderColor}` }}>
          <h3 style={{ fontSize: '15px', color: '#00a884', margin: '0 0 10px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '8px' }}>Zamanlanmış Mesajlar</h3>
          {pendingMessages.length === 0 ? (
             <p style={{ fontSize: '13px', color: iconColor, textAlign: 'center' }}>Bekleyen mesaj yok.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              {pendingMessages.map((pm) => (
                <div key={pm.id} style={{ background: panelBg, padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ color: iconColor, marginBottom: '6px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Zaman: {new Date(pm.sendAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => sendNowScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#00a884', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Şimdi</button>
                      <button onClick={() => editScheduledMessage(pm.id, pm.content)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Düzenle</button>
                      <button onClick={() => cancelScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>İptal</button>
                    </div>
                  </div>
                  <div style={{ color: textColor, wordBreak: 'break-word' }}>{pm.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ARAMA ÇUBUĞU */}
      {isSearchOpen && (
        <div className="chat-search-bar" style={{ padding: '10px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}` }}>
          <input type="text" className="global-search-input" placeholder="Bu sohbette ara..." value={messageSearchTerm} onChange={(e) => setMessageSearchTerm(e.target.value)} autoFocus style={{ width: '100%', padding: '10px 15px', borderRadius: '8px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, outline: 'none' }} />
        </div>
      )}

      {/* MESAJ LİSTESİ */}
      <div className="messages-list" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        
        {activeConversation?.isGroup && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 25px 0' }}>
            <div style={{ background: isDarkMode ? '#182229' : '#fff5c4', color: isDarkMode ? '#8696a0' : '#54656f', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', maxWidth: '85%' }}>
              <span style={{ fontSize: '14px', marginRight: '5px' }}>🔒</span> 
              <strong>Uçtan uca şifrelenmiş mesajlaşma.</strong><br/>
              <span style={{ marginTop: '5px', display: 'inline-block' }}>{activeConversation.adminId === currentUser.id ? `Siz "${activeConversation.name}" grubunu oluşturdunuz.` : `Grup yöneticisi sizi "${activeConversation.name}" grubuna ekledi.`}</span>
            </div>
          </div>
        )}

        {displayedMessages.map((msg, index) => {
          const isMe = msg.senderId === currentUser.id;
          const myReceiptsEnabled = currentUser.readReceiptsOn !== false;
          const theirReceiptsEnabled = activeConversation?.isGroup ? true : selectedUser?.readReceiptsOn !== false;
          const isRead = msg.readByIds && msg.readByIds.length > 0 && myReceiptsEnabled && theirReceiptsEnabled;
          const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={index} className={`message-row ${isMe ? 'me' : 'them'}`}>
              
              <div 
                className="message-bubble" 
                style={{ position: 'relative', minWidth: '100px', paddingRight: '25px' }} 
                onMouseLeave={() => setOpenOptionsId(null)} 
              >
                {!isMe && activeConversation?.isGroup && (
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00a884', marginBottom: '4px' }}>{msg.sender?.username}</div>
                )}
                <div style={{ wordBreak: 'break-word' }}>{msg.content}</div>
                <div className="message-meta">
                  <span>{timeString}</span>
                  {isMe && <span className={`message-ticks ${isRead ? 'read' : ''}`}>{isRead ? '✓✓' : '✓'}</span>}
                </div>

                <button 
                  onClick={() => setOpenOptionsId(openOptionsId === msg.id ? null : msg.id)}
                  style={{ position: 'absolute', top: '5px', right: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: '2px 5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor"><path d="M3.3 5.4h11.4L9 12.6z"></path></svg>
                </button>

                {openOptionsId === msg.id && (
                  <div style={{ 
                    position: 'absolute', top: '25px', right: isMe ? '10px' : '-160px', 
                    background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', 
                    zIndex: 50, boxShadow: '0 4px 15px rgba(0,0,0,0.2)', width: '170px', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column'
                  }}>
                    <button className="msg-dropdown-btn" onClick={() => { setMessageInfo(msg); setOpenOptionsId(null); }}>ℹ️ Bilgi</button>
                    <button className="msg-dropdown-btn" onClick={() => handleReply(msg.id)}>↩️ Yanıtla</button>
                    <button className="msg-dropdown-btn" onClick={() => handleForward(msg.id)}>➡️ İlet</button>
                    <button className="msg-dropdown-btn" onClick={() => handleStar(msg.id)}>⭐ Yıldızla</button>
                    <button className="msg-dropdown-btn" onClick={() => handlePin(msg.id)}>📌 Sabitle</button>
                    <button className="msg-dropdown-btn" onClick={() => handleDeleteForMe(msg.id)}>🗑️ Benden Sil</button>
                    {isMe && <button className="msg-dropdown-btn danger-text" onClick={() => handleDeleteForEveryone(msg.id)}>⛔ Herkesten Sil</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* MESAJ BİLGİSİ (INFO) MODALI */}
      {messageInfo && (
        <div className="settings-overlay" onClick={() => setMessageInfo(null)} style={{ zIndex: 10000 }}>
          <div style={{ width: '400px', background: panelBg, borderRadius: '12px', padding: '25px', boxShadow: '0 15px 50px rgba(0,0,0,0.3)', color: textColor }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 20px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '10px', fontSize: '18px', display: 'flex', justifyContent: 'space-between' }}>
              Mesaj Bilgisi
              <span style={{ cursor: 'pointer', color: iconColor }} onClick={() => setMessageInfo(null)}>✖</span>
            </h3>
            
            <div style={{ background: inputBg, padding: '15px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${borderColor}`, fontSize: '14px', wordBreak: 'break-word', opacity: 0.9 }}>
              "{messageInfo.content}"
            </div>

            <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontWeight: '600', color: '#00a884', fontSize: '15px' }}>✓ İletilme Tarihi</div>
              <div style={{ fontSize: '14px' }}>{formatDetailedDate(messageInfo.createdAt)}</div>
              <div style={{ fontSize: '12px', color: iconColor, fontFamily: 'monospace' }}>Unix Epoch: {getUnixEpoch(messageInfo.createdAt)}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ fontWeight: '600', color: '#00a884', fontSize: '15px' }}>✓✓ Okunma Tarihi</div>
              {messageInfo.readByIds && messageInfo.readByIds.length > 0 ? (
                <>
                  <div style={{ fontSize: '14px' }}>Okundu (Gerçek zaman için DB'ye 'readAt' eklenecek)</div>
                  <div style={{ fontSize: '12px', color: iconColor }}>{messageInfo.readByIds.length} kişi tarafından görüldü.</div>
                </>
              ) : (
                <div style={{ fontSize: '14px', color: iconColor }}>Henüz okunmadı</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MESAJ YAZMA VE ARAÇLAR ALANI */}
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative' }}>
        
        {/* GERİ GETİRİLEN: ZAMANLAMA TAKVİMİ */}
        {isScheduling && (
          <div style={{ position: 'absolute', bottom: '75px', right: '20px', background: inputBg, padding: '15px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 100, border: `1px solid ${borderColor}`, color: textColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#00a884' }}>Gönderimi Planla</span>
              <button onClick={() => { setIsScheduling(false); setScheduleTime(null); }} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: iconColor }}>✖</button>
            </div>
            <DatePicker
              selected={scheduleTime} onChange={(date: Date | null) => setScheduleTime(date)} showTimeSelect timeFormat="HH:mm" timeIntervals={5} timeCaption="Saat" dateFormat="d MMMM yyyy, HH:mm" minDate={new Date()} filterTime={filterPassedTime} locale={tr} placeholderText="Tarih ve saat seçin" onKeyDown={(e) => e.preventDefault()} inline
            />
            <div style={{ marginTop: '10px', opacity: scheduleTime ? 1 : 0.5, pointerEvents: scheduleTime ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
              <Button text="Zamanla ve Gönder" onClick={handleSend} fullWidth />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', color: iconColor }}>
          <div style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachmentMenu(false); }} title="Emoji Ekle" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.153 11.603c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962zm-3.204 1.362c-.026-.307-.131 5.218 6.063 5.551 6.066-.25 6.066-5.551 6.066-5.551-6.078 1.416-12.129 0-12.129 0zm11.363 1.108s-.669 1.959-5.051 1.959c-3.505 0-5.388-1.164-5.607-1.959 0 0 5.912 1.055 10.658 0zM11.804 1.011C5.609 1.011.978 6.033.978 12.228s4.826 10.761 11.021 10.761S23.02 18.423 23.02 12.228c.001-6.195-5.021-11.217-11.216-11.217zM12 21.354c-5.273 0-9.381-3.886-9.381-9.159s3.942-9.548 9.215-9.548 9.548 4.275 9.548 9.548c-.001 5.272-4.109 9.159-9.382 9.159zm3.108-9.751c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962z"></path></svg>} />
            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '55px', left: '0', zIndex: 1000, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                <EmojiPicker onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)} theme={isDarkMode ? Theme.DARK : Theme.LIGHT} emojiStyle={EmojiStyle.APPLE} lazyLoadEmojis={true} suggestedEmojisMode={SuggestionMode.RECENT} previewConfig={{ showPreview: false }} />
              </div>
            )}
          </div>

          {/* GERİ GETİRİLEN: DOSYA EKLEME (ATAŞ) BUTONU VE MENÜSÜ */}
          <div style={{ position: 'relative' }}>
             <Button 
              variant="icon"
              onClick={() => { setShowAttachmentMenu(!showAttachmentMenu); setShowEmojiPicker(false); }}
              title="Dosya Ekle"
              style={{ color: iconColor, transform: showAttachmentMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}
              icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.57.57 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"></path></svg>}
            />
            {showAttachmentMenu && (
              <div style={{ position: 'absolute', bottom: '55px', left: '-10px', background: inputBg, padding: '15px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '18px', zIndex: 100, minWidth: '160px', border: `1px solid ${borderColor}` }}>
                <button onClick={() => alert("Görsel yükleme altyapısı kurulduğunda aktif olacak!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', color: textColor, fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#bf59cf', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🖼️</span> Görsel
                </button>
                <button onClick={() => alert("Belge yükleme altyapısı kurulduğunda aktif olacak!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', color: textColor, fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#5157ae', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📄</span> Belge
                </button>
                <button onClick={() => alert("Ses kayıt altyapısı kurulduğunda aktif olacak!")} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '15px', color: textColor, fontWeight: '500' }}>
                  <span style={{ fontSize: '20px', background: '#e53935', color: 'white', borderRadius: '50%', padding: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎤</span> Ses Dosyası
                </button>
              </div>
            )}
          </div>

        </div>
        
        <input type="text" placeholder="Bir mesaj yazın..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }} style={{ flex: 1, padding: '12px 15px', borderRadius: '8px', border: `1px solid ${borderColor}`, outline: 'none', backgroundColor: inputBg, color: textColor, fontSize: '15px' }} />

        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', opacity: newMessage.trim() ? 1 : 0.5, pointerEvents: newMessage.trim() ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
          <button onClick={handleSend} style={{ background: '#00a884', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817z"></path></svg>
          </button>

          {/* GERİ GETİRİLEN: ZAMANLAMA SEÇENEĞİ İÇİN KÜÇÜK OK BUTONU */}
          <button onClick={() => setIsScheduling(!isScheduling)} style={{ background: '#009071', color: 'white', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ▼
          </button>
        </div>
      </div>
      
      <style>{`
        .msg-dropdown-btn {
          width: 100%; text-align: left; padding: 12px 15px; border: none; background: transparent;
          color: ${textColor}; font-size: 14px; cursor: pointer; transition: background 0.2s;
        }
        .msg-dropdown-btn:hover { background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}; }
        .msg-dropdown-btn.danger-text { color: #e53935; font-weight: bold; }
        .msg-dropdown-btn.danger-text:hover { background: ${isDarkMode ? 'rgba(229, 57, 53, 0.15)' : '#ffebee'}; }
      `}</style>

    </div>
  );
}