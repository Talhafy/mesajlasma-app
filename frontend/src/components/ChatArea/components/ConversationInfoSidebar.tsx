import { useState } from 'react';
import type { User, Conversation, Message, ScheduledMessage } from '../../../types/chat';
import AvatarViewerModal from '../../Modals/AvatarViewerModal';

interface ConversationInfoSidebarProps {
  isConversationInfoOpen: boolean;
  setIsConversationInfoOpen: (val: boolean) => void;
  activeConversation: Conversation | null;
  chatPartner: User | undefined;
  partnerStatus: string;
  openGroupSettings: () => void;
  handleBlockToggle: () => void;
  isBlockedLocally: boolean;
  mediaMessages: Message[];
  linkItems: Array<{ messageId: string; url: string }>;
  pendingMessages: ScheduledMessage[];
  conversationStarredMessages: Message[];
  conversationInfoTab: 'media' | 'links' | 'scheduled' | 'starred';
  setConversationInfoTab: (tab: 'media' | 'links' | 'scheduled' | 'starred') => void;
  scrollToMessage: (messageId?: string) => void;
  panelBg: string;
  inputBg: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
  isDarkMode: boolean;
  lightboxImageUrl: string | null;
  setLightboxImageUrl: (url: string | null) => void;
  avatarProfileUser: User | null;
  setAvatarProfileUser: (user: User | null) => void;
  onStartDirectChat?: (targetUser: User) => void;
  onStartCallWithUser?: (targetUser: User, callType: 'audio' | 'video') => void;
}

export default function ConversationInfoSidebar({
  isConversationInfoOpen, setIsConversationInfoOpen, activeConversation, chatPartner, partnerStatus,
  openGroupSettings, handleBlockToggle, isBlockedLocally, mediaMessages, linkItems, pendingMessages,
  conversationStarredMessages, conversationInfoTab, setConversationInfoTab, scrollToMessage,
  panelBg, inputBg, borderColor, textColor, iconColor, isDarkMode, lightboxImageUrl, setLightboxImageUrl,
  avatarProfileUser, setAvatarProfileUser, onStartDirectChat, onStartCallWithUser
}: ConversationInfoSidebarProps) {
  const [viewerUser, setViewerUser] = useState<{ avatarUrl: string | null; username: string } | null>(null);

  return (
    <>
      {isConversationInfoOpen && (
        <div className="conversation-info-sidebar" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          background: panelBg,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
          animation: 'slideInRight 0.25s ease-out'
        }}>
          {/* YAN PANEL HEADER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '0 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', flexShrink: 0 }}>
            <button onClick={() => setIsConversationInfoOpen(false)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center' }}>✖</button>
            <h3 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: 500 }}>{activeConversation?.isGroup ? 'Grup bilgisi' : 'Kişi bilgisi'}</h3>
          </div>

          {/* YAN PANEL İÇERİK (Scrollable) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0', color: textColor }}>

            {/* PROFİL FOTO VE İSİM (BÜYÜK) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 20px', background: inputBg, marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div 
                onClick={() => setViewerUser({ 
                  avatarUrl: activeConversation?.isGroup ? (activeConversation.avatarUrl ?? null) : (chatPartner?.avatarUrl || null), 
                  username: activeConversation?.isGroup ? (activeConversation.name ?? '') : (chatPartner?.username || '') 
                })}
                title="Profil resmini görüntüle"
                style={{ width: '200px', height: '200px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64px', overflow: 'hidden', marginBottom: '20px', cursor: 'pointer' }}
              >
                {activeConversation?.isGroup && activeConversation?.avatarUrl
                  ? <img src={activeConversation.avatarUrl} alt="Grup" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : !activeConversation?.isGroup && chatPartner?.avatarUrl
                    ? <img src={chatPartner.avatarUrl} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username)?.[0]?.toUpperCase()}
              </div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '24px', color: textColor, textAlign: 'center' }}>{activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username}</h2>
              {!activeConversation?.isGroup && partnerStatus && <div style={{ fontSize: '14px', color: iconColor }}>{partnerStatus}</div>}

              {/* GRUPLAR İÇİN GRUP AYARLARI BUTONU */}
              {activeConversation?.isGroup && activeConversation.isActive !== false && !activeConversation.isDeleted && (
                <button onClick={openGroupSettings} style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '8px', border: `1px solid ${borderColor}`, background: panelBg, color: textColor, cursor: 'pointer', fontWeight: 600 }}>
                  ⚙️ Grup Ayarları
                </button>
              )}

              {/* BİREYSEL SOHBETLER İÇİN ENGELLE BUTONU */}
              {!activeConversation?.isGroup && chatPartner && (
                <button 
                  onClick={handleBlockToggle} 
                  style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '8px', border: `1px solid ${isBlockedLocally ? '#f97316' : '#e53935'}`, background: panelBg, color: isBlockedLocally ? '#f97316' : '#e53935', cursor: 'pointer', fontWeight: 600 }}
                >
                  {isBlockedLocally ? '✅ Engeli Kaldır' : '🚫 Kişiyi Engelle'}
                </button>
              )}
            </div>

            {/* MEDYA / LİNKLER / SÜRELİ İÇERİK ALANI */}
            <div style={{ background: inputBg, padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {[
                  { key: 'media', label: `Medya (${mediaMessages.length})` },
                  { key: 'links', label: `Linkler (${linkItems.length})` },
                  { key: 'scheduled', label: `Süreli (${pendingMessages.length})` },
                  { key: 'starred', label: `Yıldızlı (${conversationStarredMessages.length})` }
                ].map((tab) => {
                  const isSelected = conversationInfoTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setConversationInfoTab(tab.key as 'media' | 'links' | 'scheduled' | 'starred')}
                      style={{ border: `1px solid ${isSelected ? '#f97316' : borderColor}`, background: isSelected ? (isDarkMode ? 'rgba(249, 115, 22,0.18)' : '#ffedd5') : panelBg, color: isSelected ? '#f97316' : textColor, borderRadius: '999px', padding: '7px 11px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'all 0.2s' }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* TAB İÇERİKLERİ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                {/* MEDYA SEKME İÇERİĞİ */}
                {conversationInfoTab === 'media' && (
                  mediaMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Hiç medya yok</div> :
                    mediaMessages.map((message) => (
                      <div key={message.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '10px', background: panelBg }}>
                        <button onClick={() => message.fileUrl && window.open(message.fileUrl, '_blank')} style={{ width: '50px', height: '50px', borderRadius: '8px', border: 'none', background: '#f97316', color: 'white', cursor: message.fileUrl ? 'pointer' : 'default', overflow: 'hidden', flexShrink: 0 }}>
                          {(message.fileType === 'image' || message.fileType?.startsWith('image')) && message.fileUrl
                            ? <img src={message.fileUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : '📎'}
                        </button>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{message.fileName || "Bilinmeyen Dosya"}</div>
                          <button onClick={() => scrollToMessage(message.id)} style={{ border: 'none', background: 'transparent', color: '#f97316', padding: 0, cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}>Mesaja git</button>
                        </div>
                      </div>
                    ))
                )}

                {/* LİNK SEKME İÇERİĞİ */}
                {conversationInfoTab === 'links' && (
                  linkItems.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Hiç link yok</div> :
                    linkItems.map(({ messageId, url }, index) => (
                      <div key={`${messageId}-${index}`} style={{ padding: '12px', borderRadius: '10px', background: panelBg }}>
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#f97316', fontSize: '14px', wordBreak: 'break-all', textDecoration: 'none' }}>{url}</a>
                        <div style={{ marginTop: '8px' }}>
                          <button onClick={() => scrollToMessage(messageId)} style={{ border: 'none', background: 'transparent', color: iconColor, padding: '0', cursor: 'pointer', fontSize: '13px' }}>Mesaja git</button>
                        </div>
                      </div>
                    ))
                )}

                {/* SÜRELİ MESAJ SEKME İÇERİĞİ */}
                {conversationInfoTab === 'scheduled' && (
                  pendingMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Bekleyen mesaj yok</div> :
                    pendingMessages.map((message) => (
                      <div key={message.id} style={{ padding: '12px', borderRadius: '12px', background: panelBg, borderLeft: '4px solid #f97316', border: `1px solid ${borderColor}`, borderLeftWidth: '4px', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                        <div style={{ fontSize: '12px', color: '#f97316', marginBottom: '6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          ⏳ {new Date(message.sendAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                        <div style={{ fontSize: '13px', color: textColor, wordBreak: 'break-word', lineHeight: '1.4' }}>
                          {message.fileUrl && (
                            <div style={{ fontSize: '11px', color: iconColor, marginBottom: '4px', fontWeight: 600 }}>
                              📎 {message.fileType === 'image' || message.fileType?.startsWith('image') ? 'Görsel eklentisi' : message.fileName || 'Dosya eklentisi'}
                            </div>
                          )}
                          {message.content}
                        </div>
                      </div>
                    ))
                )}

                {/* YILDIZLI MESAJ SEKME İÇERİĞİ */}
                {conversationInfoTab === 'starred' && (
                  conversationStarredMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Yıldızlı mesaj yok</div> :
                    conversationStarredMessages.map((message) => (
                      <div key={message.id} style={{ padding: '12px', borderRadius: '10px', background: panelBg }}>
                        <div style={{ fontSize: '13px', color: iconColor, marginBottom: '6px', fontWeight: 600 }}>
                          ⭐ {message.sender?.username || 'Kullanıcı'}
                        </div>
                        <div style={{ fontSize: '14px', color: textColor, wordBreak: 'break-word' }}>
                          {message.content || message.fileName || 'Dosyalı mesaj'}
                        </div>
                        <button onClick={() => scrollToMessage(message.id)} style={{ border: 'none', background: 'transparent', color: '#f97316', padding: '8px 0 0', cursor: 'pointer', fontSize: '13px' }}>Mesaja git</button>
                      </div>
                    ))
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxImageUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxImageUrl(null)}>
          <button className="lightbox-close-btn" onClick={() => setLightboxImageUrl(null)} aria-label="Kapat">✕</button>
          <img src={lightboxImageUrl} alt="Görsel önizleme" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {avatarProfileUser && (
        <div className="channel-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAvatarProfileUser(null); }}>
          <div className="channel-modal" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ width: '360px', padding: '24px', position: 'relative', borderRadius: '16px', background: isDarkMode ? '#1e293b' : '#ffffff', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            
            <button 
              onClick={() => setAvatarProfileUser(null)} 
              style={{ 
                position: 'absolute', 
                top: '12px', 
                right: '12px', 
                border: 'none', 
                background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', 
                color: textColor, 
                width: '28px', 
                height: '28px', 
                borderRadius: '50%', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontSize: '12px', 
                fontWeight: 'bold',
                transition: 'all 0.2s ease'
              }}
            >
              ✕
            </button>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginTop: '12px' }}>
              <div 
                onClick={() => setViewerUser({ 
                  avatarUrl: avatarProfileUser.avatarUrl || null, 
                  username: avatarProfileUser.username 
                })}
                title="Profil resmini görüntüle"
                style={{ 
                  width: '90px', 
                  height: '90px', 
                  borderRadius: '50%', 
                  background: '#f97316', 
                  color: 'white', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '36px',
                  fontWeight: 'bold',
                  overflow: 'hidden',
                  marginBottom: '16px',
                  cursor: 'pointer'
                }}
              >
                {avatarProfileUser.avatarUrl ? (
                  <img src={avatarProfileUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  avatarProfileUser.username?.[0]?.toUpperCase()
                )}
              </div>
              
              <h3 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 700, color: textColor }}>{avatarProfileUser.username}</h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', width: '100%' }}>
                <button
                  onClick={() => {
                    if (onStartDirectChat) {
                      onStartDirectChat(avatarProfileUser);
                      setAvatarProfileUser(null);
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${borderColor}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: textColor,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease'
                  }}
                  className="profile-action-btn"
                >
                  <span style={{ fontSize: '18px' }}>💬</span>
                  Mesaj
                </button>

                <button
                  onClick={() => {
                    if (onStartCallWithUser) {
                      onStartCallWithUser(avatarProfileUser, 'audio');
                      setAvatarProfileUser(null);
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${borderColor}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: textColor,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease'
                  }}
                  className="profile-action-btn"
                >
                  <span style={{ fontSize: '18px' }}>📞</span>
                  Sesli Ara
                </button>

                <button
                  onClick={() => {
                    if (onStartCallWithUser) {
                      onStartCallWithUser(avatarProfileUser, 'video');
                      setAvatarProfileUser(null);
                    }
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${borderColor}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: textColor,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease'
                  }}
                  className="profile-action-btn"
                >
                  <span style={{ fontSize: '18px' }}>📹</span>
                  Görüntülü Ara
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {viewerUser && (
        <AvatarViewerModal
          avatarUrl={viewerUser.avatarUrl}
          username={viewerUser.username}
          onClose={() => setViewerUser(null)}
        />
      )}
    </>
  );
}
