/**
 * ============================================================================
 * MESAJ GİRİŞ VE GÖNDERME BİLEŞENİ (ChatInput Component)
 * ============================================================================
 * 
 * Bu bileşen, sohbet penceresinin altında yer alan mesaj yazma, dosya ekleme,
 * ses kaydı alma, emoji seçme ve mesaj gönderme alanıdır.
 * 
 * MODLAR VE İŞLEVLER:
 * 1. Dosya Yükleme (Direct-to-R2): İstemciden R2 depolamasına doğrudan yükleme ilerlemesi.
 * 2. Ses Kaydı Alma (MediaRecorder API): Canlı ses kaydı, duraklatma/devam etme ve silme.
 * 3. Yanıtlama & Düzenleme (Reply & Edit): Seçilen mesajı yanıtlama veya var olan mesajı düzenleme.
 * 5. Engellenmiş Kullanıcı Uyarısı: Engellenen sohbetlerde girdi alanını kapatma.
 */

import { useRef, useEffect, type RefObject } from 'react';
import EmojiPicker, { Theme, EmojiStyle, type EmojiClickData, SuggestionMode } from 'emoji-picker-react';
import type { User, Message } from '../../../types/chat';
import Button from '../../UI/Button';
import { getMessagePreview } from '../chatTimeline';

interface ChatInputProps {
  isBlockedLocally: boolean;
  chatPartner: User | undefined;
  isDarkMode: boolean;
  isUploading: boolean;
  uploadProgress: number;
  replyingTo: Message | null;
  setReplyingTo: (val: Message | null) => void;
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
  selectedFile, filePreview, cancelFile,
  isRecordingAudio, isRecordingPaused, recordingDuration, handleCancelVoiceRecording,
  togglePauseResumeRecording, handleSendVoiceRecording, showEmojiPicker, setShowEmojiPicker,
  showAttachmentMenu, setShowAttachmentMenu, openFilePicker, fileInputRef, fileAccept,
  handleFileUpload, newMessage, setNewMessage,
  handleSend, handleBlockToggle, panelBg, inputBg, borderColor, textColor, iconColor,
  toggleVoiceRecording, editingMessage, setEditingMessage, handleSaveMessageEdit,
  isGroup, isActiveGroupMember, isDeleted
}: ChatInputProps) {
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 21;
    const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const maxHeight = (lineHeight * 8) + verticalPadding;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [newMessage]);

  // Emoji picker ve attachment menüsü dışına tıklandığında menüleri kapatan useEffect
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowEmojiPicker, setShowAttachmentMenu]);

  // Sesi kaydedilirken geçen süreyi (00:05 biçiminde) formatlar
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedFileKind = selectedFile?.type.startsWith('image/')
    ? 'image'
    : selectedFile?.type.startsWith('video/')
      ? 'video'
      : 'document';
  const selectedFileSize = selectedFile
    ? selectedFile.size >= 1024 * 1024
      ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
      : `${Math.max(1, Math.round(selectedFile.size / 1024))} KB`
    : '';

  // Engellenmiş sohbet veya üyesi olunmayan grup uyarısı gösterimi
  if (isBlockedLocally || chatPartner?.isBlocked || chatPartner?.blockedByOther || (isGroup && (!isActiveGroupMember || isDeleted))) {
    return (
      <div className="chat-input-area blocked-area" style={{ background: panelBg, borderTop: `1px solid ${borderColor}`, padding: '15px 20px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '13px', color: iconColor }}>
          {isGroup
            ? (isDeleted ? 'Bu grup silindi.' : 'Bu gruptan ayrıldınız. Artık mesaj gönderemezsiniz.')
            : isBlockedLocally
              ? 'Bu kullanıcıyı engellediniz. Mesaj gönderemezsiniz.'
              : 'Bu kullanıcıya mesaj gönderemezsiniz.'}
        </p>
        {isBlockedLocally && !isGroup && (
          <button className="unblock-btn-inline" onClick={handleBlockToggle} style={{ marginTop: '8px', background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
            Engeli Kaldır
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="chat-input-area" style={{ position: 'relative' }}>
      {/* 1. DOSYA YÜKLEME İLERLEME ÇUBUĞU (Progress Bar) */}
      {isUploading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'rgba(255,255,255,0.1)' }}>
          <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#f97316', transition: 'width 0.2s ease' }} />
        </div>
      )}

      {/* 2. MESAJ YANITLAMA VE DÜZENLEME ON-SCREEN ÖNİZLEMESİ */}
      {replyingTo && (
        <div className="reply-preview-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: inputBg, borderRadius: '8px', marginBottom: '8px', borderLeft: '3px solid #f97316' }}>
          <div style={{ fontSize: '12px', color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 'bold', color: '#f97316' }}>{replyingTo.sender?.username || 'Kullanıcı'}: </span>
            {getMessagePreview(replyingTo) || 'Mesaj'}
          </div>
          <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
        </div>
      )}

      {editingMessage && (
        <div className="reply-preview-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: inputBg, borderRadius: '8px', marginBottom: '8px', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontSize: '12px', color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 'bold', color: '#3b82f6' }}>Mesaj Düzenleniyor: </span>
            {editingMessage.content}
          </div>
          <button onClick={() => setEditingMessage(null)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
        </div>
      )}

      {/* 3. SEÇİLEN DOSYA ÖNİZLEME ALANI */}
      {selectedFile && (
        <div className="file-preview-bar" style={{ background: inputBg, borderColor }}>
          {filePreview && selectedFileKind === 'image' ? (
            <img className="file-preview-media" src={filePreview} alt={`${selectedFile.name} önizlemesi`} />
          ) : filePreview && selectedFileKind === 'video' ? (
            <div className="file-preview-video-wrap">
              <video
                className="file-preview-media"
                src={filePreview}
                muted
                playsInline
                preload="metadata"
                aria-label={`${selectedFile.name} video önizlemesi`}
                onLoadedMetadata={(event) => {
                  if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0.1) {
                    event.currentTarget.currentTime = 0.1;
                  }
                }}
              />
              <span className="file-preview-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </div>
          ) : (
            <span className="file-preview-document-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h6" /></svg>
            </span>
          )}
          <div className="file-preview-copy">
            <div className="file-preview-name" style={{ color: textColor }}>{selectedFile.name}</div>
            <div className="file-preview-meta" style={{ color: iconColor }}>
              <span>{selectedFileKind === 'image' ? 'Görsel' : selectedFileKind === 'video' ? 'Video' : 'Belge'}</span>
              <span aria-hidden="true">•</span>
              <span>{selectedFileSize}</span>
            </div>
          </div>
          <button className="file-preview-remove" type="button" onClick={cancelFile} style={{ color: iconColor }} aria-label="Seçilen dosyayı kaldır" title="Dosyayı kaldır">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}

      {/* 4. CANLI SES KAYDI ALMA ARAYÜZÜ (Voice Recorder UI) */}
      {isRecordingAudio ? (
        <div className="voice-recording-bar" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: inputBg, borderRadius: '24px', padding: '6px 16px', height: '48px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
            <span className="recording-dot" style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ fontSize: '14px', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatDuration(recordingDuration)}</span>
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="icon" onClick={handleCancelVoiceRecording} title="İptal et" aria-label="Ses kaydını iptal et" style={{ color: '#ef4444' }} icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>} />
          <Button variant="icon" onClick={togglePauseResumeRecording} title={isRecordingPaused ? 'Devam et' : 'Duraklat'} aria-label={isRecordingPaused ? 'Devam et' : 'Duraklat'} style={{ color: iconColor }} icon={isRecordingPaused ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg> : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>} />
          <Button variant="icon" onClick={handleSendVoiceRecording} title="Gönder" aria-label="Ses kaydını gönder" style={{ color: '#f97316' }} icon={<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>} />
        </div>
      ) : (
        /* 5. STANDART MESAJ YAZMA VE GÖNDERME FORMU */
        <div className="chat-composer">
          {/* EMOJİ PİCKER BUTONU VE AÇILIR PANELİ */}
          <div ref={emojiPickerRef} style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Emoji seç" aria-label="Emoji seç" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"></path></svg>} />
            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '50px', left: '0', zIndex: 1000 }}>
                <EmojiPicker
                  onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)}
                  theme={isDarkMode ? Theme.DARK : Theme.LIGHT}
                  emojiStyle={EmojiStyle.NATIVE}
                  suggestedEmojisMode={SuggestionMode.RECENT}
                />
              </div>
            )}
          </div>

          {/* DOSYA VE MEDYA EKLEME MENÜSÜ */}
          <div ref={attachmentMenuRef} style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => setShowAttachmentMenu(!showAttachmentMenu)} title="Dosya ekle" aria-label="Dosya ekle" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4s-4 1.79-4 4v12.5c0 3.31 2.69 6 6 6s6-2.69 6-6V6h-2.5z"></path></svg>} />
            {showAttachmentMenu && (
              <div className="attachment-dropdown-menu" style={{ position: 'absolute', bottom: '52px', left: '0', background: panelBg, border: `1px solid ${borderColor}`, borderRadius: '12px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '3px', zIndex: 1000, boxShadow: isDarkMode ? '0 16px 40px rgba(0,0,0,0.45)' : '0 16px 40px rgba(15,23,42,0.18)', width: '268px' }}>
                <div className="attachment-menu-heading" style={{ color: iconColor }}>Dosya paylaş</div>
                <button type="button" className="attachment-btn" style={{ color: textColor }} onClick={() => { openFilePicker('image/*,video/*'); setShowAttachmentMenu(false); }}>
                  <span className="attachment-icon attachment-icon-media" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4.5 17 4-4 3 2.7 2.5-2.4 5.5 4.7" /><path d="m15.5 7.5 3 1.8-3 1.8z" /></svg>
                  </span>
                  <span className="attachment-copy"><strong>Fotoğraf veya video</strong><small style={{ color: iconColor }}>Galeriden medya seç</small></span>
                </button>
                <button type="button" className="attachment-btn" style={{ color: textColor }} onClick={() => { openFilePicker('application/pdf,application/zip,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'); setShowAttachmentMenu(false); }}>
                  <span className="attachment-icon attachment-icon-document" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2.75h8l4 4v14.5H6z" /><path d="M14 2.75v4h4M9 11h6M9 15h6M9 18h4" /></svg>
                  </span>
                  <span className="attachment-copy"><strong>Belge veya PDF</strong><small style={{ color: iconColor }}>PDF, Word, ZIP ve metin</small></span>
                </button>
                <button type="button" className="attachment-btn" style={{ color: textColor }} onClick={() => { openFilePicker('audio/*'); setShowAttachmentMenu(false); }}>
                  <span className="attachment-icon attachment-icon-audio" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" /></svg>
                  </span>
                  <span className="attachment-copy"><strong>Ses dosyası</strong><small style={{ color: iconColor }}>Müzik veya kayıt paylaş</small></span>
                </button>
              </div>
            )}
          </div>

          {/* GİZLİ FILE INPUTLARI */}
          <input type="file" ref={fileInputRef} accept={fileAccept} onChange={handleFileUpload} style={{ display: 'none' }} />

          {/* 6. METİN YAZMA INPUT ALANI */}
          <div className="chat-composer-text-wrap">
            <textarea
              ref={textareaRef}
              rows={1}
              className="chat-composer-textarea"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (editingMessage) {
                    handleSaveMessageEdit();
                  } else {
                    handleSend();
                  }
                }
              }}
              placeholder={editingMessage ? 'Mesajı düzenleyin...' : 'Bir mesaj yazın...'}
              aria-label="Mesaj"
            />
          </div>

          {/* 8. GÖNDER / KANIT KAYDI AL / GÜNCELLE BUTONLARI */}
          {editingMessage ? (
            <Button variant="primary" text="Kaydet" onClick={handleSaveMessageEdit} disabled={!newMessage.trim()} />
          ) : newMessage.trim() || selectedFile ? (
            <Button variant="icon" onClick={handleSend} title="Gönder" aria-label="Mesajı gönder" style={{ color: '#ffffff', background: '#f97316' }} icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>} />
          ) : (
            <Button variant="icon" onClick={toggleVoiceRecording} title="Ses Kaydı Al" aria-label="Ses kaydı al" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"></path></svg>} />
          )}
        </div>
      )}
    </div>
  );
}
