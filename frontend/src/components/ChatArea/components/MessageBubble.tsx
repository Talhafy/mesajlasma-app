/**
 * ============================================================================
 * MESAJ BALONU VE ZAMAN ÇİZELGESİ ÖĞESİ BİLEŞENİ (MessageBubble Component)
 * ============================================================================
 * 
 * Bu bileşen, sohbet akışında (Timeline) yer alan tarih ayraçlarını, sistem
 * bildirimlerini ve gönderilen/alınan tekil mesaj balonlarını (Message Bubbles) render eder.
 * 
 * BİLEŞENLER VE İŞLEVLER:
 * 1. Timeline Item Render: 'date' (Tarih ayracı), 'system' (Katıldı/Ayrıldı uyarısı), 'message' (Mesaj balonu).
 * 2. CustomAudioPlayer: Özel tasarlanmış HTML5 ses kaydı oynatıcısı (Oynat/Duraklat, Oynatma çubuğu).
 * 3. Mesaj Detay Menüsü (Portal Dropdown): Yanıtla, İlet, Yıldızla, Sabitle, Düzenle, Sil.
 * 4. Mesaj Durum İkonları: Tek tık (Sunucuya ulaştı), Çift tık (İletildi), Mavi çift tık (Okundu).
 */

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { User, Conversation, Message } from '../../../types/chat';
import { getMessagePreview } from '../chatTimeline';

interface TimelineRenderItem {
  type: 'message' | 'system' | 'date';
  id: string;
  createdAt: string;
  label?: string;
  message?: Message;
  entry?: {
    id: string;
    conversationId: string;
    text: string;
    createdAt: string;
  };
}

interface MessageBubbleProps {
  item: TimelineRenderItem;
  currentUser: User;
  activeConversation: Conversation | null;
  groupMembers: User[];
  usersList: User[];
  isSelectMode: boolean;
  selectedMessageIds: Set<string>;
  toggleSelectMessage: (msgId: string) => void;
  handleSelectMessage: (msgId: string) => void;
  highlightedMessageId: string | null;
  setAvatarProfileUser: (user: User) => void;
  setLightboxImageUrl: (url: string | null) => void;
  isDarkMode: boolean;
  textColor: string;
  iconColor: string;
  borderColor: string;
  inputBg: string;
  panelBg: string;
  handleReply: (msg: Message) => void;
  handleForward: (msg: Message) => void;
  handleStar: (msgId: string) => void;
  handlePin: (msgId: string) => void;
  handleDeleteForMe: (msgId: string) => void;
  handleDeleteForEveryone: (msgId: string) => void;
  handleEditMessage: (msg: Message) => void;
  setMessageInfo: (msg: Message) => void;
  selectedUser: User | null;
}

/**
 * ÖZEL SES DOSYASI OYNATICI BİLEŞENİ (CustomAudioPlayer)
 * Gelen sesli mesajları (Voice Messages) oynatma, duraklatma ve ilerleme çubuğu ile sunar.
 */
function CustomAudioPlayer({ src, isDarkMode }: { src: string; isDarkMode: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    if (audio.duration && !isNaN(audio.duration)) {
      setDuration(audio.duration);
    }

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.log('Playback error:', err));
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 12px',
      borderRadius: '20px',
      background: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      minWidth: '220px',
      maxWidth: '300px',
      userSelect: 'none'
    }}>
      <audio ref={audioRef} src={src} preload="metadata" />
      
      {/* OYNAT / DURAKLAT BUTONU */}
      <button
        onClick={togglePlay}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: 'none',
          background: '#f97316',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          boxShadow: '0 2px 6px rgba(249, 115, 22, 0.4)'
        }}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ marginLeft: '2px' }}>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* İLERLEME ÇUBUĞU VE GEÇEN SÜRE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleSliderChange}
            style={{
              width: '100%',
              height: '4px',
              appearance: 'none',
              background: `linear-gradient(to right, #f97316 ${progressPercent}%, ${isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'} ${progressPercent}%)`,
              borderRadius: '2px',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: isDarkMode ? '#a1a1aa' : '#71717a', fontFamily: 'monospace' }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * ANA MESAJ BALONU VE ÇİZELGE İŞLEYİCİ BİLEŞENİ (MessageBubble Entry)
 */
export default function MessageBubble({
  item, currentUser, activeConversation, groupMembers, usersList,
  isSelectMode, selectedMessageIds, toggleSelectMessage, handleSelectMessage, highlightedMessageId,
  setAvatarProfileUser, setLightboxImageUrl, isDarkMode, textColor, iconColor,
  borderColor, inputBg, panelBg, handleReply, handleForward, handleStar, handlePin,
  handleDeleteForMe, handleDeleteForEveryone, handleEditMessage, setMessageInfo, selectedUser: _selectedUser
}: MessageBubbleProps) {
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<{
    top: number;
    right: number;
    bottom: number;
    left: number;
    align: 'left' | 'right';
  } | null>(null);
  const [isDropdownPositioned, setIsDropdownPositioned] = useState(false);
  const [activeDropdownMsgId, setActiveDropdownMsgId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = () => {
    setActiveDropdownMsgId(null);
    setDropdownPos(null);
    setDropdownAnchor(null);
    setIsDropdownPositioned(false);
  };

  // Menü dışına tıklanınca, sohbet/pencere kaydırılınca veya ekran boyutu değişince kapatır.
  useEffect(() => {
    if (!activeDropdownMsgId) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    const handleViewportChange = (event: Event) => {
      if (event.type === 'scroll' && dropdownRef.current?.contains(event.target as Node)) return;
      closeDropdown();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDropdown();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activeDropdownMsgId]);

  // Portal render edildikten sonra gerçek menü boyutuna göre viewport içinde konumlandırır.
  useLayoutEffect(() => {
    if (!activeDropdownMsgId || !dropdownAnchor || !dropdownRef.current) return;

    const viewportPadding = 8;
    const menuGap = 6;
    const menuRect = dropdownRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - dropdownAnchor.bottom - viewportPadding;
    const spaceAbove = dropdownAnchor.top - viewportPadding;

    let top: number;
    if (menuRect.height <= spaceBelow) {
      top = dropdownAnchor.bottom + menuGap;
    } else if (menuRect.height <= spaceAbove) {
      top = dropdownAnchor.top - menuRect.height - menuGap;
    } else if (spaceBelow >= spaceAbove) {
      top = Math.max(viewportPadding, window.innerHeight - menuRect.height - viewportPadding);
    } else {
      top = viewportPadding;
    }

    const preferredLeft = dropdownAnchor.align === 'right'
      ? dropdownAnchor.right - menuRect.width
      : dropdownAnchor.left;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, preferredLeft), maxLeft);

    setDropdownPos({ top, left });
    setIsDropdownPositioned(true);
  }, [activeDropdownMsgId, dropdownAnchor]);

  // 1. TARİH AYRACI (Date Separator Item)
  if (item.type === 'date') {
    return (
      <div className="date-separator" style={{ textAlign: 'center', margin: '16px 0' }}>
        <span style={{ background: inputBg, color: iconColor, padding: '4px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
          {item.label}
        </span>
      </div>
    );
  }

  // 2. SİSTEM BİLDİRİMİ (System Log Item)
  if (item.type === 'system' && item.entry) {
    return (
      <div className="system-message" style={{ textAlign: 'center', margin: '10px 0', fontSize: '12px', color: iconColor }}>
        {item.entry.text}
      </div>
    );
  }

  // 3. MESAJ BALONU RENDER AKIŞI
  const msg = item.message;
  if (!msg) return null;

  const isMe = msg.senderId === currentUser.id;
  const isSelected = selectedMessageIds.has(msg.id);
  const isHighlighted = highlightedMessageId === msg.id;
  const isReadOnlyHistory = Boolean(
    activeConversation?.isGroup
    && (activeConversation.isActive === false || activeConversation.isDeleted)
  );

  // Açılır Menü Konumunu Hesaplama
  const openMenu = (e: React.MouseEvent, msgId: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownAnchor({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      align: isMe ? 'right' : 'left'
    });
    setDropdownPos({ top: rect.bottom + 6, left: rect.left });
    setIsDropdownPositioned(false);
    setActiveDropdownMsgId(msgId);
  };

  const copyMessageText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  };

  return (
    <div
      id={`msg-${msg.id}`}
      data-message-id={msg.id}
      className={`message-row ${isMe ? 'mine' : 'other'} ${isHighlighted ? 'highlighted' : ''}`}
      onClick={() => isSelectMode && toggleSelectMessage(msg.id)}
      style={{
        display: 'flex',
        margin: '6px 0',
        justifyContent: isMe ? 'flex-end' : 'flex-start',
        alignItems: 'flex-end',
        gap: '8px',
        padding: '2px 16px',
        background: isSelected ? 'rgba(249, 115, 22, 0.15)' : 'transparent',
        transition: 'background 0.2s ease'
      }}
    >
      {/* SEÇİM MODUNDA CHECKBOX */}
      {isSelectMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelectMessage(msg.id)}
          style={{ cursor: 'pointer', margin: '0 8px 10px 0' }}
        />
      )}

      {/* KARŞI TARAF AVATARI (GRUP İÇİNDE) */}
      {!isMe && activeConversation?.isGroup && (
        <div
          className="avatar-circle small"
          style={{ width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }}
          onClick={() => {
            const member = groupMembers.find(m => m.id === msg.senderId) || usersList.find(u => u.id === msg.senderId);
            if (member) setAvatarProfileUser(member);
          }}
        >
          {(msg.sender?.username)?.[0]?.toUpperCase() || '?'}
        </div>
      )}

      {/* MESAJ BALON GÖVDESİ */}
      <div
        className="message-bubble-container"
        style={{
          position: 'relative',
          maxWidth: '65%',
          background: isMe ? '#f97316' : inputBg,
          color: isMe ? '#ffffff' : textColor,
          borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '10px 14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}
      >
        {/* GRUP İÇİNDE GÖNDEREN ADI */}
        {!isMe && activeConversation?.isGroup && (
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#f97316', marginBottom: '4px' }}>
            {msg.sender?.username || 'Kullanıcı'}
          </div>
        )}

        {/* YANITLANAN MESAJ ÖNİZLEMESİ */}
        {msg.replyTo && (
          <div style={{ background: isMe ? 'rgba(0,0,0,0.15)' : panelBg, borderLeft: '3px solid #f97316', borderRadius: '4px', padding: '4px 8px', marginBottom: '6px', fontSize: '12px' }}>
            <span style={{ fontWeight: 'bold', display: 'block', fontSize: '11px' }}>{msg.replyTo.sender?.username || 'Kullanıcı'}</span>
            <span style={{ opacity: 0.9 }}>{getMessagePreview(msg.replyTo) || 'Mesaj'}</span>
          </div>
        )}

        {/* MEDYA / DOSYA İÇERİĞİ */}
        {msg.fileUrl && (
          <div style={{ marginBottom: '6px' }}>
            {msg.fileType === 'image' ? (
              <img src={msg.fileUrl} alt="Medya" style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', display: 'block' }} onClick={() => setLightboxImageUrl(msg.fileUrl || null)} />
            ) : msg.fileType === 'audio' ? (
              <CustomAudioPlayer src={msg.fileUrl} isDarkMode={isDarkMode} />
            ) : (
              <a href={msg.fileUrl} download={msg.fileName || 'dosya'} style={{ color: isMe ? '#ffffff' : '#3b82f6', textDecoration: 'underline', fontSize: '13px' }}>
                📁 {msg.fileName || 'Dosyayı İndir'}
              </a>
            )}
          </div>
        )}

        {/* METİN İÇERİĞİ */}
        <div style={{ fontSize: '14px', wordBreak: 'break-word', lineHeight: '1.4' }}>
          {msg.content}
        </div>

        {/* MESAJ ALT BİLGİSİ (SAAT, YILDIZ, OKUNDU BİLGİSİ) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px', fontSize: '10px', opacity: 0.8 }}>
          {msg.starredByIds?.includes(currentUser.id) && <span>⭐</span>}
          <span>{msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          
          {/* BENİM GÖNDERDİĞİM MESAJLAR İÇİN OKUNDU TİK İKONLARI */}
          {isMe && (
            <span>
              {msg.readByIds && msg.readByIds.length > 0 ? (
                <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>✓✓</span>
              ) : (
                <span>✓✓</span>
              )}
            </span>
          )}
        </div>

        {/* MESAJ SEÇENEKLERİ DROPDOWN AÇMA BUTONU */}
        {!isSelectMode && (
          <button
            onClick={(e) => openMenu(e, msg.id)}
            aria-label="Mesaj seçeneklerini aç"
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: 'none',
              border: 'none',
              color: isMe ? '#ffffff' : iconColor,
              cursor: 'pointer',
              opacity: 0.6,
              fontSize: '12px'
            }}
          >
            ▼
          </button>
        )}
      </div>

      {/* PORTAL İLE BODY ÜZERİNDE RENDER EDİLEN DROPDOWN MENÜ */}
      {activeDropdownMsgId === msg.id && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="msg-dropdown-menu"
          role="menu"
          aria-label="Mesaj işlemleri"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            background: panelBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
            zIndex: 9999,
            padding: '6px',
            width: '190px',
            maxWidth: 'calc(100vw - 16px)',
            maxHeight: 'calc(100vh - 16px)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            visibility: isDropdownPositioned ? 'visible' : 'hidden'
          }}
        >
          <button className="msg-dropdown-btn" onClick={() => { setMessageInfo(msg); setActiveDropdownMsgId(null); }}>ℹ️ Bilgi</button>
          {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleReply(msg); setActiveDropdownMsgId(null); }}>↩️ Yanıtla</button>}
          {msg.content && <button className="msg-dropdown-btn" onClick={() => { void copyMessageText(msg.content); setActiveDropdownMsgId(null); }}>📋 Kopyala</button>}
          {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleSelectMessage(msg.id); setActiveDropdownMsgId(null); }}>☑️ Seç</button>}
          {!isReadOnlyHistory && isMe && <button className="msg-dropdown-btn" onClick={() => { handleEditMessage(msg); setActiveDropdownMsgId(null); }}>✏️ Düzenle</button>}
          <button className="msg-dropdown-btn" onClick={() => { handleForward(msg); setActiveDropdownMsgId(null); }}>➡️ İlet</button>
          {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleStar(msg.id); setActiveDropdownMsgId(null); }}>{msg.starredByIds?.includes(currentUser.id) ? '⭐ Yıldızı Kaldır' : '⭐ Yıldızla'}</button>}
          {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handlePin(msg.id); setActiveDropdownMsgId(null); }}>{msg.isPinned ? '📌 Sabitlemeyi Kaldır' : '📌 Sabitle'}</button>}
          {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleDeleteForMe(msg.id); setActiveDropdownMsgId(null); }}>🗑️ Benden Sil</button>}
          {!isReadOnlyHistory && isMe && <button className="msg-dropdown-btn danger-text" onClick={() => { handleDeleteForEveryone(msg.id); setActiveDropdownMsgId(null); }}>⛔ Herkesten Sil</button>}
        </div>,
        document.body
      )}
    </div>
  );
}
