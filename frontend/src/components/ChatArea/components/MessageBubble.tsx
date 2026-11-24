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
import { getMessagePreview, hasReadReceipt, isDeletedForEveryoneMessage, isVideoMessage } from '../chatTimeline';
import { decryptAttachmentToBlobUrl, openGroupAttachment } from '../../../crypto/fileCrypto';

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
  highlightSequence?: number;
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
const VOICE_WAVEFORM_BARS = [8, 13, 18, 11, 22, 28, 17, 12, 25, 31, 20, 14, 19, 27, 34, 23, 16, 11, 21, 29, 24, 15, 18, 32, 26, 13, 9, 17, 23, 30, 19, 12, 25, 20, 14, 28, 22, 10, 16, 24, 18, 12];

function CustomAudioPlayer({
  src,
  isMe,
  showAvatar,
  avatarUrl,
  avatarLabel
}: {
  src: string;
  isMe: boolean;
  showAvatar: boolean;
  avatarUrl?: string;
  avatarLabel: string;
}) {
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
    <div className={`voice-note-player ${isMe ? 'voice-note-outgoing' : 'voice-note-incoming'} ${showAvatar ? 'voice-note-with-avatar' : 'voice-note-without-avatar'}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {showAvatar && (
        <div className="voice-note-avatar" aria-hidden="true">
          {avatarUrl
            ? <img src={avatarUrl} alt="" />
            : <span>{avatarLabel.slice(0, 1).toUpperCase()}</span>}
          <span className="voice-note-mic">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5.3-3a5.3 5.3 0 0 1-10.6 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-1.7Z" /></svg>
          </span>
        </div>
      )}

      <button
        type="button"
        className="voice-note-play"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Sesli mesajı duraklat' : 'Sesli mesajı oynat'}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" style={{ marginLeft: '2px' }}>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="voice-note-body">
        <div className="voice-note-waveform">
          {VOICE_WAVEFORM_BARS.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className={(index + 1) / VOICE_WAVEFORM_BARS.length * 100 <= progressPercent ? 'is-played' : ''}
              style={{ height: `${height}px` }}
            />
          ))}
          <input
            className="voice-note-range"
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleSliderChange}
            aria-label="Sesli mesaj oynatma konumu"
          />
        </div>
        <span className="voice-note-duration">{formatTime(currentTime > 0 ? currentTime : duration)}</span>
      </div>
    </div>
  );
}

function DocumentMessageCard({
  href,
  fileName,
  isMe
}: {
  href: string;
  fileName?: string;
  isMe: boolean;
}) {
  const displayName = fileName || 'Belge';
  const extension = displayName.includes('.')
    ? displayName.split('.').pop()?.toUpperCase() || 'DOSYA'
    : 'DOSYA';
  const isPdf = extension === 'PDF';

  return (
    <a
      className={`document-message-card ${isMe ? 'document-message-outgoing' : 'document-message-incoming'}`}
      href={href}
      download={displayName}
      aria-label={`${displayName} belgesini indir`}
    >
      <span className={`document-file-icon ${isPdf ? 'is-pdf' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2.75h8l4 4v14.5H6z" />
          <path d="M14 2.75v4h4" />
        </svg>
        <small>{isPdf ? 'PDF' : extension.slice(0, 4)}</small>
      </span>

      <span className="document-file-copy">
        <strong>{displayName}</strong>
        <small>{isPdf ? 'PDF belgesi' : `${extension} belgesi`}</small>
      </span>

      <span className="document-download-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 20h14" />
        </svg>
      </span>
    </a>
  );
}

/**
 * ANA MESAJ BALONU VE ÇİZELGE İŞLEYİCİ BİLEŞENİ (MessageBubble Entry)
 */
export default function MessageBubble({
  item, currentUser, activeConversation, groupMembers, usersList,
  isSelectMode, selectedMessageIds, toggleSelectMessage, handleSelectMessage, highlightSequence,
  setAvatarProfileUser, setLightboxImageUrl, isDarkMode: _isDarkMode, textColor, iconColor,
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
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const targetMsg = item.message;
    setDecryptedMediaUrl(null);
    if (!targetMsg) return;
    const local = !targetMsg.fileUrl && targetMsg.archivedFileAvailable;
    if (!local && (!targetMsg.fileUrl || !targetMsg.encryptedFileMetadata)) return;
    let cancelled = false;
    let localUrl: string | null = null;
    const source = local ? openGroupAttachment(currentUser.id, targetMsg) :
      decryptAttachmentToBlobUrl(targetMsg.fileUrl!, targetMsg.encryptedFileMetadata!);
    void source
      .then((blobUrl) => {
        if (local) {
          if (cancelled && blobUrl) URL.revokeObjectURL(blobUrl);
          else localUrl = blobUrl;
        }
        if (!cancelled) setDecryptedMediaUrl(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setDecryptedMediaUrl(null);
      });
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [currentUser.id, item.message]);

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
      <div className="system-message">
        <span className="system-message-label">{item.entry.text}</span>
      </div>
    );
  }

  // 3. MESAJ BALONU RENDER AKIŞI
  const msg = item.message;
  if (!msg) return null;

  const isMe = msg.senderId === currentUser.id;
  const isSelected = selectedMessageIds.has(msg.id);
  const voiceSender = isMe
    ? currentUser
    : groupMembers.find(member => member.id === msg.senderId)
      || usersList.find(user => user.id === msg.senderId)
      || activeConversation?.otherUser
      || undefined;
  const isVideoAttachment = isVideoMessage(msg);
  const isImageAttachment = msg.fileType === 'image' || msg.fileType?.startsWith('image');
  const isAudioAttachment = (msg.fileType === 'audio' || msg.fileType?.startsWith('audio/')) && !isVideoAttachment;
  const isDeletedForEveryone = isDeletedForEveryoneMessage(msg);
  const hasBeenRead = hasReadReceipt(msg, Boolean(activeConversation?.isGroup));
  const displayFileUrl = decryptedMediaUrl || (msg.encryptedFileMetadata ? undefined : msg.fileUrl);
  const isGeneratedVoiceLabel = isAudioAttachment
    && /^Sesli mesaj(?:\s*\(\d+:\d{2}\))?$/i.test(msg.content.trim());
  const visibleContent = isGeneratedVoiceLabel || isDeletedForEveryone ? '' : msg.content;
  const isReadOnlyHistory = Boolean(
    msg.isPriorMembershipMessage || msg.isLocalGroupHistory || (activeConversation?.isGroup &&
      (activeConversation.isActive === false || activeConversation.isDeleted))
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
      className={`message-row ${isMe ? 'mine' : 'other'}`}
      onClick={() => isSelectMode && !isReadOnlyHistory && toggleSelectMessage(msg.id)}
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
      {isSelectMode && !isReadOnlyHistory && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleSelectMessage(msg.id)}
          style={{ cursor: 'pointer', margin: '0 8px 10px 0' }}
        />
      )}

      {/* KARŞI TARAF AVATARI (GRUP İÇİNDE) */}
      {!isMe && activeConversation?.isGroup && !isAudioAttachment && (
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
        className={`message-bubble-container ${isMe ? 'message-bubble-outgoing' : 'message-bubble-incoming'} ${isDeletedForEveryone ? 'message-bubble-deleted' : ''}`}
        style={{
          background: isDeletedForEveryone ? undefined : isMe ? '#f97316' : inputBg,
          color: isDeletedForEveryone ? undefined : isMe ? '#ffffff' : textColor
        }}
      >
        {highlightSequence !== undefined && (
          <span key={highlightSequence} className="message-bubble-highlight" aria-hidden="true" />
        )}
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
        {msg.fileKey && !displayFileUrl && !isDeletedForEveryone && (
          <div className="message-attachment">{msg.fileName || 'Ek dosya'}</div>
        )}
        {displayFileUrl && (
          <div className="message-attachment" style={{ marginBottom: isAudioAttachment ? '2px' : '6px' }}>
            {(() => {
              return isImageAttachment ? (
                <img
                  className="message-image-attachment"
                  src={displayFileUrl}
                  alt={msg.fileName || 'Paylaşılan görsel'}
                  onClick={() => setLightboxImageUrl(displayFileUrl || null)}
                />
              ) : isVideoAttachment ? (
                <video
                  className="message-video-attachment"
                  src={displayFileUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={msg.fileName || 'Paylaşılan video'}
                >
                  Tarayıcınız video oynatmayı desteklemiyor.
                </video>
              ) : isAudioAttachment ? (
                <CustomAudioPlayer
                  src={displayFileUrl}
                  isMe={isMe}
                  showAvatar={Boolean(activeConversation?.isGroup)}
                  avatarUrl={voiceSender?.avatarUrl}
                  avatarLabel={voiceSender?.username || msg.sender?.username || 'Kullanıcı'}
                />
              ) : (
                <DocumentMessageCard href={displayFileUrl} fileName={msg.fileName} isMe={isMe} />
              );
            })()}
          </div>
        )}

        {/* METİN, SAAT VE OKUNDU BİLGİSİ */}
        <div className="message-content-flow">
          {isDeletedForEveryone && (
            <span className="deleted-message-copy">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></svg>
              <span>{isMe ? 'Bu mesajı sildiniz' : 'Bu mesaj silindi'}</span>
            </span>
          )}
          {visibleContent && <span className="message-text-content">{visibleContent}</span>}
          <span className={`message-inline-meta ${displayFileUrl || (!visibleContent && !isDeletedForEveryone) ? 'message-inline-meta-stacked' : ''}`}>
            {!isDeletedForEveryone && msg.starredByIds?.includes(currentUser.id) && <span aria-label="Yıldızlı mesaj">★</span>}
            <span>{msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            {isMe && msg.isOffline && <span title="Gönderim bekliyor" aria-label="Gönderim bekliyor">◷</span>}
            {isMe && !msg.isOffline && (
              <span className={`message-read-ticks ${hasBeenRead ? 'is-read' : ''}`} aria-label={hasBeenRead ? (activeConversation?.isGroup ? 'Herkes okudu' : 'Okundu') : 'Gönderildi'}>
                ✓✓
              </span>
            )}
          </span>
        </div>

        {/* MESAJ SEÇENEKLERİ DROPDOWN AÇMA BUTONU */}
        {!isSelectMode && !msg.isOffline && (
          <button
            className={`message-menu-trigger ${activeDropdownMsgId === msg.id ? 'is-open' : ''}`}
            onClick={(e) => openMenu(e, msg.id)}
            aria-label="Mesaj seçeneklerini aç"
            aria-expanded={activeDropdownMsgId === msg.id}
            style={{
              background: isDeletedForEveryone ? 'transparent' : isMe ? '#f97316' : inputBg,
              color: isDeletedForEveryone ? undefined : isMe ? '#ffffff' : iconColor,
            }}
          >
            <span aria-hidden="true">⌄</span>
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
          {!isReadOnlyHistory && !isDeletedForEveryone && <button className="msg-dropdown-btn" onClick={() => { handleReply(msg); setActiveDropdownMsgId(null); }}>↩️ Yanıtla</button>}
          {visibleContent && <button className="msg-dropdown-btn" onClick={() => { void copyMessageText(visibleContent); setActiveDropdownMsgId(null); }}>📋 Kopyala</button>}
          {!isReadOnlyHistory && !isDeletedForEveryone && <button className="msg-dropdown-btn" onClick={() => { handleSelectMessage(msg.id); setActiveDropdownMsgId(null); }}>☑️ Seç</button>}
          {!isReadOnlyHistory && !isDeletedForEveryone && isMe && <button className="msg-dropdown-btn" onClick={() => { handleEditMessage(msg); setActiveDropdownMsgId(null); }}>✏️ Düzenle</button>}
          {!isDeletedForEveryone && (!isReadOnlyHistory || !msg.fileKey) && <button className="msg-dropdown-btn" onClick={() => { handleForward(msg); setActiveDropdownMsgId(null); }}>➡️ İlet</button>}
          {!isReadOnlyHistory && !isDeletedForEveryone && <button className="msg-dropdown-btn" onClick={() => { handleStar(msg.id); setActiveDropdownMsgId(null); }}>{msg.starredByIds?.includes(currentUser.id) ? '⭐ Yıldızı Kaldır' : '⭐ Yıldızla'}</button>}
          {!isReadOnlyHistory && !isDeletedForEveryone && <button className="msg-dropdown-btn" onClick={() => { handlePin(msg.id); setActiveDropdownMsgId(null); }}>{msg.isPinned ? '📌 Sabitlemeyi Kaldır' : '📌 Sabitle'}</button>}
          <button className="msg-dropdown-btn" onClick={() => { handleDeleteForMe(msg.id); setActiveDropdownMsgId(null); }}>🗑️ Benden Sil</button>
          {!isReadOnlyHistory && !isDeletedForEveryone && isMe && <button className="msg-dropdown-btn danger-text" onClick={() => { handleDeleteForEveryone(msg.id); setActiveDropdownMsgId(null); }}>⛔ Herkesten Sil</button>}
        </div>,
        document.body
      )}
    </div>
  );
}
