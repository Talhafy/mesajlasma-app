import { useRef, useEffect, type RefObject } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { tr } from 'date-fns/locale';
import EmojiPicker, { Theme, EmojiStyle, type EmojiClickData, SuggestionMode } from 'emoji-picker-react';
import type { User, Message } from '../../../types/chat';
import Button from '../../UI/Button';

interface ChatInputProps {
  isBlockedLocally: boolean;
  chatPartner: User | undefined;
  isDarkMode: boolean;
  isUploading: boolean;
  uploadProgress: number;
  replyingTo: Message | null;
  setReplyingTo: (val: Message | null) => void;
  isScheduling: boolean;
  setIsScheduling: (val: boolean) => void;
  scheduleTime: Date | null;
  setScheduleTime: (val: Date | null) => void;
  selectedFile: File | null;
  filePreview: string | null;
  cancelFile: () => void;
  isRecordingAudio: boolean;
  isRecordingPaused: boolean;
  recordingDuration: number;
  handleCancelVoiceRecording: () => void;
  togglePauseResumeRecording: () => void;
  handleSendVoiceRecording: () => void;
  showEmojiPicker: boolean;
  setShowEmojiPicker: (val: boolean) => void;
  showAttachmentMenu: boolean;
  setShowAttachmentMenu: (val: boolean) => void;
  openFilePicker: (acceptType: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileAccept: string;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  scheduledFileInputRef: RefObject<HTMLInputElement | null>;
  handleScheduledFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  newMessage: string;
  setNewMessage: (val: string) => void;
  handleSend: () => void;
  handleBlockToggle: () => void;
  panelBg: string;
  inputBg: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
  toggleVoiceRecording: () => void;
  editingMessage: Message | null;
  setEditingMessage: (val: Message | null) => void;
  handleSaveMessageEdit: () => void;
  isGroup?: boolean;
  isActiveGroupMember?: boolean;
  isDeleted?: boolean;
}

export default function ChatInput({
  isBlockedLocally, chatPartner, isDarkMode, isUploading, uploadProgress, replyingTo, setReplyingTo,
  isScheduling, setIsScheduling, scheduleTime, setScheduleTime, selectedFile, filePreview, cancelFile,
  isRecordingAudio, isRecordingPaused, recordingDuration, handleCancelVoiceRecording,
  togglePauseResumeRecording, handleSendVoiceRecording, showEmojiPicker, setShowEmojiPicker,
  showAttachmentMenu, setShowAttachmentMenu, openFilePicker, fileInputRef, fileAccept, handleFileUpload,
  scheduledFileInputRef, handleScheduledFileChange, newMessage, setNewMessage, handleSend,
  handleBlockToggle, panelBg, inputBg, borderColor, textColor, iconColor, toggleVoiceRecording,
  editingMessage, setEditingMessage, handleSaveMessageEdit, isGroup = false, isActiveGroupMember = true, isDeleted = false
}: ChatInputProps) {

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 140);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [newMessage]);

  const filterPassedTime = (time: Date) => new Date().getTime() < new Date(time).getTime();

  const formatSeconds = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (isBlockedLocally) {
    return (
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 15px', background: isDarkMode ? '#2c1a1a' : '#ffebee', borderRadius: '12px', border: `1px solid ${isDarkMode ? '#5c2222' : '#ffcdd2'}`, color: isDarkMode ? '#ff8a80' : '#c62828', fontSize: '14px', fontWeight: 600 }}>
          <span>🚫 Bu kullanıcıyı engellediniz.</span>
          <button 
            onClick={handleBlockToggle} 
            style={{ background: '#e53935', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', flexShrink: 0 }}
          >
            Engeli Kaldır
          </button>
        </div>
      </div>
    );
  }

  if (chatPartner?.blockedByOther) {
    return (
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px 15px', background: isDarkMode ? '#222' : '#f5f5f5', borderRadius: '12px', border: `1px solid ${borderColor}`, color: iconColor, fontSize: '14px', fontWeight: 600 }}>
          <span>🚫 Bu kullanıcıya mesaj gönderemezsiniz.</span>
        </div>
      </div>
    );
  }

  if (isGroup && isDeleted) {
    return (
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px 15px', background: isDarkMode ? '#222' : '#f5f5f5', borderRadius: '12px', border: `1px solid ${borderColor}`, color: iconColor, fontSize: '14px', fontWeight: 600 }}>
          <span>🚫 Bu grup yönetici tarafından silinmiştir. Geçmiş mesajları okuyabilirsiniz.</span>
        </div>
      </div>
    );
  }

  if (isGroup && !isActiveGroupMember) {
    return (
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px 15px', background: isDarkMode ? '#222' : '#f5f5f5', borderRadius: '12px', border: `1px solid ${borderColor}`, color: iconColor, fontSize: '14px', fontWeight: 600 }}>
          <span>🚫 Artık bu grubun üyesi değilsiniz, bu gruba mesaj gönderemezsiniz.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative' }}>
      {isUploading && (
        <div className="upload-progress-line">
          <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}

      {/* YANITLANAN MESAJ GÖSTERGESİ */}
      {replyingTo && (
        <div style={{ position: 'absolute', top: '-52px', left: '20px', right: '20px', background: inputBg, padding: '10px 15px', borderRadius: '8px 8px 0 0', border: `1px solid ${borderColor}`, borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.05)' }}>
          <div style={{ borderLeft: '4px solid #f97316', paddingLeft: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f97316' }}>{replyingTo.sender?.username || 'Kullanıcı'} kişisine yanıt veriliyor</div>
            <div style={{ fontSize: '13px', color: textColor, opacity: 0.8 }}>{replyingTo.content.substring(0, 60)}...</div>
          </div>
          <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
        </div>
      )}

      {/* EDİTLENEN MESAJ GÖSTERGESİ */}
      {editingMessage && (
        <div style={{ position: 'absolute', top: '-52px', left: '20px', right: '20px', background: inputBg, padding: '10px 15px', borderRadius: '8px 8px 0 0', border: `1px solid ${borderColor}`, borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.05)' }}>
          <div style={{ borderLeft: '4px solid #f97316', paddingLeft: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f97316' }}>Mesajı Düzenle</div>
            <div style={{ fontSize: '13px', color: textColor, opacity: 0.8 }}>{editingMessage.content.substring(0, 60)}...</div>
          </div>
          <button onClick={() => { setEditingMessage(null); setNewMessage(''); }} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
        </div>
      )}

      {/* ZAMANLAMA KUTUSU */}
      {isScheduling && (
        <div style={{ position: 'absolute', bottom: '75px', right: '20px', background: inputBg, padding: '18px', borderRadius: '16px', boxShadow: '0 12px 36px rgba(0,0,0,0.25)', zIndex: 100, border: `1px solid ${borderColor}`, color: textColor, width: '310px', backdropFilter: 'blur(10px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#f97316', display: 'block' }}>🕒 Gönderimi Planla</span>
              <span style={{ fontSize: '11px', color: iconColor }}>Mesajın ne zaman iletileceğini seçin</span>
            </div>
            <button onClick={() => { setIsScheduling(false); setScheduleTime(null); }} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', fontSize: '14px', cursor: 'pointer', color: iconColor, width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
          <div className="modern-datepicker-container" style={{ border: `1px solid ${borderColor}`, borderRadius: '12px', overflow: 'hidden', background: panelBg, padding: '5px' }}>
            <DatePicker selected={scheduleTime} onChange={(date: Date | null) => setScheduleTime(date)} showTimeSelect timeFormat="HH:mm" timeIntervals={5} timeCaption="Saat" dateFormat="d MMMM yyyy, HH:mm" minDate={new Date()} filterTime={filterPassedTime} locale={tr} placeholderText="Tarih ve saat seçin" inline />
          </div>
          <div style={{ marginTop: '14px', opacity: scheduleTime ? 1 : 0.5, pointerEvents: scheduleTime ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
            <Button text="Zamanla ve Gönder" onClick={handleSend} fullWidth />
          </div>
        </div>
      )}

      {/* DOSYA ÖNİZLEME KUTUSU */}
      {selectedFile && (
        <div className="file-preview-banner" style={{ top: (replyingTo || editingMessage) ? '-130px' : '-80px' }}>
          {selectedFile.type.startsWith('image/') && filePreview ? (
            <img src={filePreview} alt="Önizleme" style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '5px' }} />
          ) : (
            <div style={{ width: '50px', height: '50px', background: '#5157ae', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '5px', fontSize: '20px' }}>📄</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '200px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile.name}</span>
            <span style={{ fontSize: '11px', color: iconColor }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <button onClick={cancelFile} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontSize: '18px', marginLeft: '10px' }}>✖</button>
        </div>
      )}

      {isRecordingAudio ? (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', gap: '16px' }}>
          <button
            onClick={handleCancelVoiceRecording}
            style={{
              background: 'none',
              border: 'none',
              color: '#e53935',
              cursor: 'pointer',
              fontSize: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px',
              borderRadius: '50%',
              transition: 'background 0.2s',
              outline: 'none'
            }}
            title="Ses kaydını iptal et/sil"
            className="voice-cancel-btn"
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(229,57,53,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            🗑️
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexGrow: 1, fontSize: '15px', color: textColor, fontWeight: 600 }}>
            <span className="recording-dot" style={{ animationPlayState: isRecordingPaused ? 'paused' : 'running', opacity: isRecordingPaused ? 0.5 : 1 }} />
            <span>Ses kaydediliyor... {formatSeconds(recordingDuration)}</span>
            
            <button
              onClick={togglePauseResumeRecording}
              style={{
                background: isDarkMode ? 'rgba(249,115,22,0.15)' : 'rgba(249,115,22,0.1)',
                border: 'none',
                color: '#f97316',
                cursor: 'pointer',
                borderRadius: '20px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                marginLeft: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}
              title={isRecordingPaused ? 'Kaydı devam ettir' : 'Kaydı duraklat'}
            >
              {isRecordingPaused ? (
                <>
                  <span>▶️</span> Devam Et
                </>
              ) : (
                <>
                  <span>⏸️</span> Duraklat
                </>
              )}
            </button>
          </div>

          <button
            onClick={handleSendVoiceRecording}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: 'none',
              background: '#f97316',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(249,115,22,0.3)',
              transition: 'transform 0.2s ease',
              flexShrink: 0
            }}
            title="Gönder"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{ transform: 'rotate(-45deg) translate(2px, -2px)' }}>
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          </button>
        </div>
      ) : (
        <>
          {/* BUTONLAR (EMOJİ VE ATAŞ) */}
          <div style={{ display: 'flex', gap: '8px', color: iconColor }}>
            <div style={{ position: 'relative' }}>
              <Button variant="icon" onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachmentMenu(false); }} title="Emoji Ekle" aria-label="Emoji ekle" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.153 11.603c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962zm-3.204 1.362c-.026-.307-.131 5.218 6.063 5.551 6.066-.25 6.066-5.551 6.066-5.551-6.078 1.416-12.129 0-12.129 0zm11.363 1.108s-.669 1.959-5.051 1.959c-3.505 0-5.388-1.164-5.607-1.959 0 0 5.912 1.055 10.658 0zM11.804 1.011C5.609 1.011.978 6.033.978 12.228s4.826 10.761 11.021 10.761S23.02 18.423 23.02 12.228c.001-6.195-5.021-11.217-11.216-11.217zM12 21.354c-5.273 0-9.381-3.886-9.381-9.159s3.942-9.548 9.215-9.548 9.548 4.275 9.548 9.548c-.001 5.272-4.109 9.159-9.382 9.159zm3.108-9.751c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962z"></path></svg>} />
              {showEmojiPicker && (
                <div style={{ position: 'absolute', bottom: '55px', left: '0', zIndex: 1000, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                  <EmojiPicker onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)} theme={isDarkMode ? Theme.DARK : Theme.LIGHT} emojiStyle={EmojiStyle.APPLE} lazyLoadEmojis={true} suggestedEmojisMode={SuggestionMode.RECENT} previewConfig={{ showPreview: false }} />
                </div>
              )}
            </div>

            {!editingMessage && (
              <div style={{ position: 'relative' }}>
                <Button variant="icon" onClick={() => { setShowAttachmentMenu(!showAttachmentMenu); setShowEmojiPicker(false); }} title="Dosya Ekle" aria-label="Dosya ekle" style={{ color: iconColor, transform: showAttachmentMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.57.57 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"></path></svg>} />

                {showAttachmentMenu && (
                  <div className="dropdown-menu" style={{ bottom: '55px', left: '0', padding: '10px', gap: '8px', minWidth: '160px' }}>
                    <button onClick={() => { setShowAttachmentMenu(false); openFilePicker('image/*'); }} className="msg-dropdown-btn" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px' }}><span style={{ fontSize: '18px' }}>📷</span> Görsel</button>
                    <button onClick={() => { setShowAttachmentMenu(false); openFilePicker('*/*'); }} className="msg-dropdown-btn" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px' }}><span style={{ fontSize: '18px' }}>📄</span> Belge</button>
                  </div>
                )}
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept={fileAccept} onChange={handleFileUpload} />
                <input type="file" ref={scheduledFileInputRef} style={{ display: 'none' }} onChange={handleScheduledFileChange} />
              </div>
            )}
          </div>

          {/* INPUT ALANI */}
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={editingMessage ? "Mesajı düzenleyin..." : isUploading ? "Dosya gönderiliyor..." : "Bir mesaj yazın..."}
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Enter sends message, Shift+Enter breaks line
                if (editingMessage) {
                  handleSaveMessageEdit();
                } else {
                  handleSend();
                }
              }
            }}
            disabled={isUploading}
            aria-label="Mesaj yazma alanı"
            style={{
              flex: 1,
              padding: '11px 15px',
              borderRadius: '8px',
              border: `1px solid ${borderColor}`,
              outline: 'none',
              backgroundColor: inputBg,
              color: textColor,
              fontSize: '15px',
              resize: 'none',
              boxSizing: 'border-box',
              minHeight: '42px',
              maxHeight: '140px',
              lineHeight: '1.4',
              fontFamily: 'inherit',
              overflowY: 'auto'
            }}
          />

          {!editingMessage && (
            <button
              onClick={toggleVoiceRecording}
              disabled={isUploading}
              title="Sesli mesaj kaydet"
              aria-label="Sesli mesaj kaydet"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                background: '#f97316',
                color: 'white',
                cursor: isUploading ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                flexShrink: 0
              }}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"></path></svg>
            </button>
          )}

          {/* GÖNDER / KAYDET BUTONU */}
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', opacity: (newMessage.trim() || selectedFile) ? 1 : 0.5, pointerEvents: ((newMessage.trim() || selectedFile) && !isUploading) ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
            <button 
              onClick={editingMessage ? handleSaveMessageEdit : handleSend} 
              style={{ background: '#f97316', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}
              title={editingMessage ? "Kaydet" : "Gönder"}
            >
              {editingMessage ? (
                <span style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817z"></path></svg>
              )}
            </button>
            {!editingMessage && (
              <button onClick={() => setIsScheduling(!isScheduling)} style={{ background: '#ea580c', color: 'white', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
