import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { User, Conversation, Message } from '../../../types/chat';

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
      padding: '4px 0',
      background: 'transparent',
      width: '240px',
      marginTop: '0'
    }}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button 
        onClick={togglePlay}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: 'none',
          background: '#f97316',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: '12px',
          padding: '0',
          transition: 'transform 0.1s ease',
          outline: 'none',
          flexShrink: 0
        }}
        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '2px' }}>
        <input 
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSliderChange}
          style={{
            width: '100%',
            cursor: 'pointer',
            height: '4px',
            borderRadius: '2px',
            WebkitAppearance: 'none',
            background: `linear-gradient(to right, #f97316 0%, #f97316 ${progressPercent}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${progressPercent}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
            outline: 'none',
            margin: '0'
          }}
          className="voice-audio-slider"
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '10px',
          color: isDarkMode ? '#94a3b8' : '#64748b',
          fontWeight: 500,
          marginTop: '2px'
        }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div style={{ fontSize: '16px', display: 'flex', alignItems: 'center', opacity: 0.85, flexShrink: 0 }}>
        🎙️
      </div>
    </div>
  );
}

export default function MessageBubble({
  item, currentUser, activeConversation, groupMembers, usersList, isSelectMode,
  selectedMessageIds, toggleSelectMessage, highlightedMessageId, setAvatarProfileUser,
  setLightboxImageUrl, isDarkMode, textColor, iconColor, borderColor, inputBg, panelBg,
  handleReply, handleForward, handleStar, handlePin, handleDeleteForMe, handleDeleteForEveryone,
  handleEditMessage, setMessageInfo, selectedUser
}: MessageBubbleProps) {
  const isReadOnlyHistory = Boolean(
    activeConversation?.isGroup &&
    (activeConversation.isActive === false || activeConversation.isDeleted)
  );
  
  const [openOptionsId, setOpenOptionsId] = useState<string | null>(null);
  const [optionsPos, setOptionsPos] = useState({ top: 0, bottom: 0, left: undefined as number | undefined, right: undefined as number | undefined, isAbove: false });

  if (item.type === 'date') {
    return (
      <div className="date-separator-row">
        <span className="date-separator-pill">{item.label}</span>
      </div>
    );
  }

  if (item.type === 'system') {
    const isDisappearingMode = Boolean(activeConversation?.disappearingDurationSeconds);
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: isDisappearingMode ? (isDarkMode ? '#113d34' : '#d9f5eb') : panelBg, color: isDisappearingMode ? '#f97316' : iconColor, border: `1px solid ${isDisappearingMode ? 'rgba(249, 115, 22,0.35)' : borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ⏳ {item.entry?.text}
        </div>
      </div>
    );
  }

  const msg = item.message;
  if (!msg) return null;

  if (msg.content.startsWith('[SYSTEM_LEAVE]:')) {
    const username = msg.content.replace('[SYSTEM_LEAVE]:', '');
    const text = username === currentUser.username ? 'Gruptan ayrıldınız.' : `${username} gruptan ayrıldı.`;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: panelBg, color: iconColor, border: `1px solid ${borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ℹ️ {text}
        </div>
      </div>
    );
  }

  if (msg.content.startsWith('[SYSTEM_KICK]:')) {
    const parts = msg.content.replace('[SYSTEM_KICK]:', '').split(':');
    const adminUsername = parts[0];
    const kickedUsername = parts[1];
    const text = kickedUsername === currentUser.username 
      ? `${adminUsername} sizi gruptan çıkardı.`
      : `${adminUsername}, ${kickedUsername} kullanıcısını gruptan çıkardı.`;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: panelBg, color: iconColor, border: `1px solid ${borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ℹ️ {text}
        </div>
      </div>
    );
  }

  if (msg.content.startsWith('[SYSTEM_ADD]:')) {
    const parts = msg.content.replace('[SYSTEM_ADD]:', '').split(':');
    const adminUsername = parts[0];
    const addedUsername = parts[1];
    let text = '';
    if (addedUsername === currentUser.username) {
      text = `${adminUsername} sizi ekledi.`;
    } else if (adminUsername === currentUser.username) {
      text = `Siz "${addedUsername}" kullanıcısını eklediniz.`;
    } else {
      text = `${adminUsername}, "${addedUsername}" kullanıcısını ekledi.`;
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: panelBg, color: iconColor, border: `1px solid ${borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ℹ️ {text}
        </div>
      </div>
    );
  }

  if (msg.content.startsWith('[SYSTEM_ADMIN_ASSIGN]:')) {
    const newAdminUsername = msg.content.replace('[SYSTEM_ADMIN_ASSIGN]:', '');
    const text = newAdminUsername === currentUser.username 
      ? 'Yeni grup yöneticisi siz oldunuz.' 
      : `Yeni grup yöneticisi: ${newAdminUsername}.`;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: panelBg, color: iconColor, border: `1px solid ${borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ℹ️ {text}
        </div>
      </div>
    );
  }

  if (msg.content.startsWith('[SYSTEM_ADMIN_TRANSFER]:')) {
    const parts = msg.content.replace('[SYSTEM_ADMIN_TRANSFER]:', '').split(':');
    const adminUsername = parts[0];
    const newAdminUsername = parts[1];
    let text = '';
    if (newAdminUsername === currentUser.username) {
      text = `${adminUsername} sizi grup yöneticisi yaptı.`;
    } else if (adminUsername === currentUser.username) {
      text = `"${newAdminUsername}" kullanıcısını grup yöneticisi yaptınız.`;
    } else {
      text = `${adminUsername}, "${newAdminUsername}" kullanıcısını grup yöneticisi yaptı.`;
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
        <div style={{ background: panelBg, color: iconColor, border: `1px solid ${borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          ℹ️ {text}
        </div>
      </div>
    );
  }

  const isMe = msg.senderId === currentUser.id;
  const senderMember = groupMembers.find(m => m.id === msg.senderId);
  const isSenderInactive = senderMember ? senderMember.isActive === false : (groupMembers.length > 0);

  const replySenderId = msg.replyTo?.senderId;
  const replySenderMember = replySenderId ? groupMembers.find(m => m.id === replySenderId) : null;
  const isReplySenderInactive = replySenderMember ? replySenderMember.isActive === false : !!(replySenderId && groupMembers.length > 0);

  let showBlueTick = false;
  let isDoubleTick = false;

  if (activeConversation?.isGroup) {
    const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
    const activeGroupMembers = groupMembers.filter(m => {
      if (!m.joinedAt) return m.isActive !== false;
      const joinedTime = new Date(m.joinedAt).getTime();
      if (joinedTime > msgTime) return false;
      if (m.isActive === false && m.leftAt) {
        const leftTime = new Date(m.leftAt).getTime();
        if (leftTime < msgTime) return false;
      }
      return true;
    });
    const otherMembersCount = activeGroupMembers.length > 0 ? activeGroupMembers.length - 1 : 0;
    if (otherMembersCount === 0) {
      showBlueTick = true;
    } else {
      showBlueTick = (msg.readByIds?.length || 0) >= otherMembersCount;
    }
    isDoubleTick = true;
  } else {
    const otherUser = selectedUser || activeConversation?.otherUser;
    const otherUserInList = otherUser ? usersList.find(u => u.id === otherUser.id) : null;
    const actualOtherUser = otherUserInList || otherUser;

    const isOtherUserOnline = actualOtherUser?.isOnline === true;
    const msgTime = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
    const lastSeenTime = actualOtherUser?.lastSeenAt ? new Date(actualOtherUser.lastSeenAt).getTime() : 0;
    const hasBeenOnlineSinceMessage = lastSeenTime >= msgTime;

    isDoubleTick = !!(msg.readByIds && msg.readByIds.length > 0) || isOtherUserOnline || hasBeenOnlineSinceMessage;

    const myReceiptsEnabled = currentUser.readReceiptsOn !== false;
    const theirReceiptsEnabled = actualOtherUser?.readReceiptsOn !== false;

    showBlueTick = !!(msg.readByIds && msg.readByIds.length > 0) && myReceiptsEnabled && theirReceiptsEnabled;
  }

  const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const isDeletedForEveryone = msg.content === "🚫 Bu mesaj silindi";

  const msgSender = usersList.find((u) => u.id === msg.senderId);
  const senderAvatarUrl = msgSender?.avatarUrl;
  const senderInitials = msg.sender?.username?.[0]?.toUpperCase() || '?';

  const handleCopyText = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {})
      .catch(() => { alert("Kopyalanamadı."); });
    setOpenOptionsId(null);
  };

  const renderLinkedText = (content: string) => {
    const parts = content.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, index) => /^https?:\/\/[^\s]+$/.test(part)
      ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#027eb5', textDecoration: 'underline' }}>{part}</a>
      : <span key={`${part}-${index}`}>{part}</span>);
  };

  const avatarElement = !isMe && activeConversation?.isGroup && (
    <div
      title={`${msg.sender?.username || 'Kullanıcı'} profilini görüntülemek için tıklayın`}
      onClick={() => {
        if (msgSender) {
          setAvatarProfileUser(msgSender);
        }
      }}
      style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: '#f97316',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 'bold',
        marginRight: '8px',
        flexShrink: 0,
        cursor: 'pointer',
        overflow: 'hidden',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
        alignSelf: 'flex-start',
        marginTop: '2px'
      }}
    >
      {senderAvatarUrl ? (
        <img src={senderAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        senderInitials
      )}
    </div>
  );

  return (
    <div data-message-id={msg.id} className={`message-row ${isMe ? 'me' : 'them'} ${highlightedMessageId === msg.id ? 'highlight-message' : ''}`} style={{ marginBottom: '6px' }}>
      {isSelectMode && (
        <input
          type="checkbox"
          checked={selectedMessageIds.has(msg.id)}
          onChange={() => toggleSelectMessage(msg.id)}
          onClick={(e) => e.stopPropagation()}
          style={{
            alignSelf: 'center',
            width: '18px',
            height: '18px',
            cursor: 'pointer',
            accentColor: '#f97316',
            marginRight: isMe ? '12px' : '0',
            marginLeft: isMe ? '0' : '12px',
            flexShrink: 0
          }}
        />
      )}

      {avatarElement}

      {isDeletedForEveryone ? (
        <div
          className="message-bubble"
          style={{ boxShadow: 'none', color: iconColor, fontStyle: 'italic', userSelect: 'none', pointerEvents: 'none', minWidth: '110px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', wordBreak: 'break-word', paddingBottom: '4px' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" opacity="0.6" style={{ flexShrink: 0 }}>
              <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm4.207 12.793-1.414 1.414L12 13.414l-2.793 2.793-1.414-1.414L10.586 12 7.793 9.207l1.414-1.414L12 10.586l2.793-2.793 1.414 1.414L13.414 12l2.793 2.793z"></path>
            </svg>
            <span>{isMe ? "Bu mesajı herkesten sildiniz" : "Bu mesaj silindi"}</span>
          </div>
          <div className="message-meta" style={{ opacity: 0.7 }}><span>{timeString}</span></div>
        </div>
      ) : (
        <div 
          className="message-bubble" 
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('audio') || target.closest('a') || target.closest('button') || target.closest('input')) {
              return;
            }
            e.stopPropagation();
            if (isSelectMode) {
              toggleSelectMessage(msg.id);
            }
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('audio') || target.closest('a') || target.closest('button') || target.closest('input')) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (!isSelectMode) {
              setOpenOptionsId(openOptionsId === msg.id ? null : msg.id);
            }
          }}
          style={{ 
            position: 'relative', 
            minWidth: '110px', 
            paddingRight: '30px', 
            cursor: 'pointer',
            opacity: msg.isOffline ? 0.65 : 1,
            ...(msg.isPinned ? { borderLeft: '4px solid #f97316' } : {}) 
          }}
        >
          {!isMe && activeConversation?.isGroup && (
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: isSenderInactive ? '#888' : '#f97316', marginBottom: '4px' }}>
              {msg.sender?.username}
            </div>
          )}

          {msg.replyTo && (
            <div style={{ background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', padding: '6px 10px', borderRadius: '5px', marginBottom: '6px', borderLeft: `4px solid ${isReplySenderInactive ? '#888' : '#f97316'}`, fontSize: '12px', cursor: 'pointer' }}>
              <strong style={{ color: isReplySenderInactive ? '#888' : '#f97316', display: 'block', marginBottom: '2px' }}>
                {msg.replyTo.sender?.username}
              </strong>
              <div style={{ opacity: 0.8, color: textColor, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{msg.replyTo.content}</div>
            </div>
          )}

          {msg.fileUrl && (
            <div style={{ marginBottom: msg.content ? '8px' : '0' }}>
              {(msg.fileType === 'image' || msg.fileType?.startsWith('image')) && (
                <img
                  src={msg.fileUrl || undefined}
                  alt="Görsel"
                  style={{ maxWidth: '100%', maxHeight: '250px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' }}
                  onClick={() => msg.fileUrl && setLightboxImageUrl(msg.fileUrl)}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    if (e.currentTarget.parentElement) {
                      e.currentTarget.parentElement.insertAdjacentHTML('beforeend', '<span style="font-size:12px; color:#aebac1;">⏳ Görselin süresi dolmuş</span>');
                    }
                  }}
                />
              )}

              {msg.fileType === 'audio' && msg.fileUrl && (
                <CustomAudioPlayer src={msg.fileUrl} isDarkMode={isDarkMode} />
              )}

              {(msg.fileType === 'document' || (!msg.fileType?.startsWith('image') && msg.fileType !== 'audio')) && (
                <a
                  href={msg.fileUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: textColor }}
                >
                  <span style={{ fontSize: '24px' }}>📄</span>
                  <span style={{ fontSize: '13px', wordBreak: 'break-all' }}>{msg.fileName || "Bilinmeyen Dosya"}</span>
                </a>
              )}
            </div>
          )}

          {msg.content && msg.fileType !== 'audio' && <div style={{ wordBreak: 'break-word' }}>{renderLinkedText(msg.content)}</div>}

          <div className="message-meta">
            {msg.starredByIds?.includes(currentUser.id) && <span style={{ color: '#fbc02d', fontSize: '12px' }}>⭐</span>}
            {msg.editedAt && <span>düzenlendi</span>}
            <span>{timeString}</span>
            {isMe && (
              <span className={`message-ticks ${showBlueTick ? 'read' : ''}`} style={msg.isOffline ? { fontSize: '11px', opacity: 0.8 } : {}}>
                {msg.isOffline ? '⏳' : isDoubleTick ? '✓✓' : '✓'}
              </span>
            )}
          </div>

          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              if (openOptionsId === msg.id) {
                 setOpenOptionsId(null);
              } else {
                 const rect = e.currentTarget.getBoundingClientRect();
                 const windowHeight = window.innerHeight;
                 const windowWidth = window.innerWidth;
                 const dropdownWidth = 170;
                 const dropdownHeight = 350;
                 const alignRight = rect.right >= dropdownWidth + 20;
                 
                 let finalTop = rect.bottom;
                 if (finalTop + dropdownHeight > windowHeight) {
                     finalTop = Math.max(10, windowHeight - dropdownHeight - 10);
                 }

                 setOptionsPos({
                     top: finalTop,
                     bottom: 0,
                     left: alignRight ? undefined : rect.left,
                     right: alignRight ? windowWidth - rect.right : undefined,
                     isAbove: false
                 });
                 setOpenOptionsId(msg.id);
              }
            }}
            style={{ position: 'absolute', top: '5px', right: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: '2px 5px' }}
          >
            <svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor"><path d="M3.3 5.4h11.4L9 12.6z"></path></svg>
          </button>

          {openOptionsId === msg.id && createPortal(
            <>
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); setOpenOptionsId(null); }}></div>

              <div style={{
                position: 'fixed',
                top: optionsPos.top,
                ...(optionsPos.left !== undefined ? { left: optionsPos.left } : { right: optionsPos.right }),
                background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px',
                zIndex: 9999, boxShadow: '0 4px 15px rgba(0,0,0,0.2)', width: '170px', overflow: 'hidden',
                display: 'flex', flexDirection: 'column'
              }}>
                <button className="msg-dropdown-btn" onClick={() => { setMessageInfo(msg); setOpenOptionsId(null); }}>ℹ️ Bilgi</button>
                {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleReply(msg); setOpenOptionsId(null); }}>↩️ Yanıtla</button>}
                {msg.content && <button className="msg-dropdown-btn" onClick={() => handleCopyText(msg.content)}>📋 Kopyala</button>}
                {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => {
                  toggleSelectMessage(msg.id);
                  setOpenOptionsId(null);
                }}>☑️ Seç</button>}
                {!isReadOnlyHistory && isMe && <button className="msg-dropdown-btn" onClick={() => { handleEditMessage(msg); setOpenOptionsId(null); }}>✏️ Düzenle</button>}
                <button className="msg-dropdown-btn" onClick={() => { handleForward(msg); setOpenOptionsId(null); }}>➡️ İlet</button>
                {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleStar(msg.id); setOpenOptionsId(null); }}>
                  {msg.starredByIds?.includes(currentUser.id) ? '⭐ Yıldızı Kaldır' : '⭐ Yıldızla'}
                </button>}
                {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handlePin(msg.id); setOpenOptionsId(null); }}>
                  {msg.isPinned ? '📌 Sabitlemeyi Kaldır' : '📌 Sabitle'}
                </button>}
                {!isReadOnlyHistory && <button className="msg-dropdown-btn" onClick={() => { handleDeleteForMe(msg.id); setOpenOptionsId(null); }}>🗑️ Benden Sil</button>}
                {!isReadOnlyHistory && isMe && <button className="msg-dropdown-btn danger-text" onClick={() => { handleDeleteForEveryone(msg.id); setOpenOptionsId(null); }}>⛔ Herkesten Sil</button>}
              </div>
            </>,
            document.body
          )}
        </div>
      )}
    </div>
  );
}
