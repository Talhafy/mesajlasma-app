import type { SetStateAction, Dispatch } from 'react';
import type { User, Conversation, Message, ScheduledMessage } from '../../../types/chat';
import Button from '../../UI/Button';

interface ChatHeaderProps {
  isSelectMode: boolean;
  setIsSelectMode: (val: boolean) => void;
  selectedMessageIds: Set<string>;
  setSelectedMessageIds: Dispatch<SetStateAction<Set<string>>>;
  closeChat: () => void;
  activeConversation: Conversation | null;
  chatPartner: User | undefined;
  partnerStatus: string;
  typingUsername?: string | null;
  recordingUsername?: string | null;
  handleHeaderClick: () => void;
  iconColor: string;
  textColor: string;
  panelBg: string;
  borderColor: string;
  messages: Message[];
  setForwardMessages: (messages: Message[]) => void;
  handleBulkStar: () => void;
  isBulkDeleteMenuOpen: boolean;
  setIsBulkDeleteMenuOpen: (val: boolean) => void;
  handleBulkDeleteForMe: () => void;
  handleBulkDeleteForEveryone: () => void;
  onStartCall: (callType: 'audio' | 'video') => void;
  isPendingModalOpen: boolean;
  setIsPendingModalOpen: (val: boolean) => void;
  pendingMessages: ScheduledMessage[];
  isSearchOpen: boolean;
  setIsSearchOpen: (val: boolean) => void;
  setMessageSearchTerm: (val: string) => void;
  isChatMenuOpen: boolean;
  setIsChatMenuOpen: Dispatch<SetStateAction<boolean>>;
  openConversationInfoPanel: (tab: 'media' | 'links' | 'scheduled' | 'starred') => void;
  onToggleConversationMute: (conversationId: string) => void;
  onToggleConversationPin: (conversationId: string) => void;
  onToggleConversationArchive: (conversationId: string) => void;
  handleDisappearingMode: () => void;
  isBlockedLocally: boolean;
  handleBlockToggle: () => void;
}

export default function ChatHeader({
  isSelectMode, setIsSelectMode, selectedMessageIds, setSelectedMessageIds,
  closeChat, activeConversation, chatPartner, partnerStatus, typingUsername, recordingUsername,
  handleHeaderClick, iconColor, textColor, panelBg, borderColor, messages, setForwardMessages,
  handleBulkStar, isBulkDeleteMenuOpen, setIsBulkDeleteMenuOpen, handleBulkDeleteForMe, handleBulkDeleteForEveryone,
  onStartCall, isPendingModalOpen, setIsPendingModalOpen, pendingMessages, isSearchOpen, setIsSearchOpen,
  setMessageSearchTerm, isChatMenuOpen, setIsChatMenuOpen, openConversationInfoPanel,
  onToggleConversationMute, onToggleConversationPin, onToggleConversationArchive,
  handleDisappearingMode, isBlockedLocally, handleBlockToggle
}: ChatHeaderProps) {
  const isReadOnlyHistory = Boolean(
    activeConversation?.isGroup &&
    (activeConversation.isActive === false || activeConversation.isDeleted)
  );

  return (
    <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', boxSizing: 'border-box' }}>
      {isSelectMode ? (
        <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 auto' }}>
          <button onClick={() => { setIsSelectMode(false); setSelectedMessageIds(new Set()); }} aria-label="Seçimi kapat" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: iconColor }}>✖</button>
          <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600' }}>
            {selectedMessageIds.size} mesaj seçildi
          </h2>
        </div>
      ) : (
        <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 auto' }}>
          <button className="mobile-back-btn" onClick={closeChat} aria-label="Sohbeti kapat" style={{ fontSize: '20px', color: iconColor }}>←</button>
          <button className="avatar-circle" onClick={handleHeaderClick} disabled={isReadOnlyHistory} title={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'} aria-label={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'}>
            {activeConversation?.isGroup && activeConversation?.avatarUrl
              ? <img src={activeConversation?.avatarUrl || undefined} alt="Grup" />
              : !activeConversation?.isGroup && chatPartner?.avatarUrl
                ? <img src={chatPartner?.avatarUrl || undefined} alt="Profil" />
                : (activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username)?.[0]?.toUpperCase()}
          </button>
          <button onClick={handleHeaderClick} disabled={isReadOnlyHistory} title={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'} aria-label={activeConversation?.isGroup ? 'Grup detayları' : 'Sohbet detayları'} style={{ minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: isReadOnlyHistory ? 'default' : 'pointer' }}>
            <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username}
            </h2>
            {!activeConversation?.isGroup && partnerStatus && !(chatPartner?.isBlocked || chatPartner?.blockedByOther) && (
              <div style={{ marginTop: '2px', fontSize: '11px', color: typingUsername || recordingUsername || chatPartner?.isOnline ? '#f97316' : iconColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {(typingUsername || recordingUsername) && <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>}
                <span>{partnerStatus}</span>
              </div>
            )}
          </button>
        </div>
      )}
      
      {isSelectMode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, position: 'relative' }}>
          <Button variant="icon" onClick={() => {
            const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
            setForwardMessages(selectedMsgs);
          }} disabled={selectedMessageIds.size === 0} title="Seçilenleri İlet" aria-label="Seçilenleri ilet" style={{ color: iconColor }} icon={
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm1 14v-3h-4v-2h4V8l5 4-5 4z"></path></svg>
          } />
          <Button variant="icon" onClick={handleBulkStar} disabled={selectedMessageIds.size === 0} title="Seçilenleri Yıldızla" aria-label="Seçilenleri yıldızla" style={{ color: iconColor }} icon={
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>
          } />
          
          <div style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => setIsBulkDeleteMenuOpen(!isBulkDeleteMenuOpen)} disabled={selectedMessageIds.size === 0} title="Seçilenleri Sil" aria-label="Seçilenleri sil" style={{ color: iconColor }} icon={
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
            } />
            {isBulkDeleteMenuOpen && (
              <>
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} onClick={() => setIsBulkDeleteMenuOpen(false)}></div>
                <div className="dropdown-menu" style={{ top: '35px', right: '0', width: '150px' }}>
                  <button className="msg-dropdown-btn" onClick={handleBulkDeleteForMe}>🗑️ Benden Sil</button>
                  <button className="msg-dropdown-btn danger-text" onClick={handleBulkDeleteForEveryone}>⛔ Herkesten Sil</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
          <Button variant="icon" onClick={() => onStartCall('audio')} disabled={!activeConversation?.id || isReadOnlyHistory} title="Sesli Ara" aria-label="Sesli arama yap" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z"></path></svg>} />
          <Button variant="icon" onClick={() => onStartCall('video')} disabled={!activeConversation?.id || isReadOnlyHistory} title="Görüntülü Ara" aria-label="Görüntülü arama yap" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17 10.5V6c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-4.5l4 4v-11z"></path></svg>} />
          <Button variant="icon" onClick={() => setIsPendingModalOpen(!isPendingModalOpen)} disabled={isReadOnlyHistory} title="Bekleyen Mesajlar" aria-label="Bekleyen zamanlanmış mesajlar" style={{ color: iconColor, position: 'relative' }} icon={<><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"></path></svg>{pendingMessages.length > 0 && (<span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#e53935', color: 'white', fontSize: '10px', fontWeight: 'bold', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${panelBg}` }}>{pendingMessages.length}</span>)}</>} />
          <Button variant="icon" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} title="Mesajlarda Ara" aria-label="Mesajlarda ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.8 0a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"></path></svg>} />
          <div style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => setIsChatMenuOpen((previous) => !previous)} disabled={isReadOnlyHistory} title="Sohbet seçenekleri" aria-label="Sohbet seçeneklerini aç" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"></path></svg>} />
            {isChatMenuOpen && activeConversation?.id && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsChatMenuOpen(false)} />
                <div className="dropdown-menu" style={{ right: 0, top: '42px', width: '245px', color: textColor }}>
                  <button className="msg-dropdown-btn" onClick={() => openConversationInfoPanel('media')}>🖼️ Medya, dosyalar ve linkler</button>
                  <button className="msg-dropdown-btn" onClick={() => openConversationInfoPanel('starred')}>⭐ Yıldızlı mesajlar</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationMute(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isMuted ? '🔔 Sesi aç' : '🔕 Sessize al'}</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationPin(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isPinned ? '📌 Sabitlemeyi kaldır' : '📌 Sohbeti sabitle'}</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationArchive(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isArchived ? '🗄️ Arşivden çıkar' : '🗄️ Arşivle'}</button>
                  <button className="msg-dropdown-btn" onClick={handleDisappearingMode}>⏳ Kaybolan mesaj modu</button>
                  {!activeConversation.isGroup && (
                    <button className="msg-dropdown-btn danger-text" onClick={() => { handleBlockToggle(); setIsChatMenuOpen(false); }}>
                      {isBlockedLocally ? '✅ Engeli Kaldır' : '🚫 Kişiyi Engelle'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
