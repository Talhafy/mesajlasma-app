/**
 * ============================================================================
 * SOHBET DETAY VE MEDYA YAN PANELİ (ConversationInfoSidebar Component)
 * ============================================================================
 * 
 * Bu bileşen, aktif sohbetin veya grubun detaylarını, medya galericisini,
 * paylaşılan bağlantıları, yıldızlı mesajları ve bekleyen zamanlanmış mesajları gösteren
 * sağ yan paneldir.
 * 
 * TAB SEKMELERİ:
 * 1. 'media'     -> Paylaşılan fotoğraflar, videolar ve belgeler galerisi.
 * 2. 'links'     -> Sohbet içinde paylaşılan tüm web bağlantıları (URL'ler).
 * 3. 'scheduled' -> İleriki bir tarihte iletilmek üzere bekleyen mesajlar.
 * 4. 'starred'   -> Kullanıcının favorilere eklediği (yıldızladığı) mesajlar.
 */

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
  openGroupSettings, handleBlockToggle: _handleBlockToggle, isBlockedLocally: _isBlockedLocally, mediaMessages, linkItems, pendingMessages,
  conversationStarredMessages, conversationInfoTab, setConversationInfoTab, scrollToMessage,
  panelBg, inputBg, borderColor, textColor, iconColor, isDarkMode: _isDarkMode, lightboxImageUrl, setLightboxImageUrl,
  avatarProfileUser: _avatarProfileUser, setAvatarProfileUser: _setAvatarProfileUser, onStartDirectChat: _onStartDirectChat, onStartCallWithUser: _onStartCallWithUser
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
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 20px',
            borderBottom: `1px solid ${borderColor}`,
            height: '71px',
            boxSizing: 'border-box'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: 600 }}>
              {activeConversation?.isGroup ? 'Grup Bilgisi' : 'Kişi Bilgisi'}
            </h3>
            <button
              onClick={() => setIsConversationInfoOpen(false)}
              aria-label="Kapat"
              style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: iconColor }}
            >
              ✖
            </button>
          </div>

          {/* KULLANICI / GRUP PROFİL ÖZET ALANI */}
          <div style={{ padding: '24px 20px', textAlign: 'center', borderBottom: `1px solid ${borderColor}` }}>
            <div
              className="avatar-circle large"
              style={{ margin: '0 auto 12px auto', width: '80px', height: '80px', fontSize: '32px', cursor: 'pointer' }}
              onClick={() => {
                const url = activeConversation?.isGroup ? activeConversation?.avatarUrl : chatPartner?.avatarUrl;
                const name = activeConversation?.isGroup ? activeConversation?.name || 'Grup' : chatPartner?.username || 'Kullanıcı';
                setViewerUser({ avatarUrl: url || null, username: name });
              }}
            >
              {activeConversation?.isGroup && activeConversation?.avatarUrl
                ? <img src={activeConversation?.avatarUrl || undefined} alt="Grup" />
                : !activeConversation?.isGroup && chatPartner?.avatarUrl
                  ? <img src={chatPartner?.avatarUrl || undefined} alt="Profil" />
                  : (activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username)?.[0]?.toUpperCase()}
            </div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '18px', color: textColor }}>
              {activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username}
            </h2>
            {!activeConversation?.isGroup && (
              <p style={{ margin: 0, fontSize: '12px', color: iconColor }}>{partnerStatus}</p>
            )}

            {/* GRUP AYARLARI BUTONU */}
            {activeConversation?.isGroup && (
              <button
                onClick={openGroupSettings}
                style={{
                  marginTop: '12px',
                  padding: '8px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '20px',
                  color: textColor,
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                ⚙️ Grup Ayarları & Üyeler
              </button>
            )}
          </div>

          {/* TAB SEKMELERİ (Medya, Bağlantılar, Zamanlanmış, Yıldızlı) */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${borderColor}`, background: inputBg }}>
            {(['media', 'links', 'scheduled', 'starred'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setConversationInfoTab(tab)}
                style={{
                  flex: 1,
                  padding: '12px 4px',
                  background: 'none',
                  border: 'none',
                  borderBottom: conversationInfoTab === tab ? '2px solid #f97316' : '2px solid transparent',
                  color: conversationInfoTab === tab ? '#f97316' : iconColor,
                  fontSize: '12px',
                  fontWeight: conversationInfoTab === tab ? 'bold' : 'normal',
                  cursor: 'pointer'
                }}
              >
                {tab === 'media' && '🖼️ Medya'}
                {tab === 'links' && '🔗 Bağlantı'}
                {tab === 'scheduled' && `⏳ (${pendingMessages.length})`}
                {tab === 'starred' && `⭐ (${conversationStarredMessages.length})`}
              </button>
            ))}
          </div>

          {/* TAB İÇERİKLERİ */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {/* 1. MEDYA VE DOSYALAR TABI */}
            {conversationInfoTab === 'media' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {mediaMessages.length === 0 ? (
                  <p style={{ textAlign: 'center', color: iconColor, fontSize: '14px', padding: '20px 0' }}>Henüz medya paylaşılmadı.</p>
                ) : (
                  mediaMessages.map((message) => (
                    <div
                      key={message.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '10px', background: inputBg }}
                    >
                      <button
                        type="button"
                        aria-label={message.fileName ? `${message.fileName} dosyasını aç` : 'Medyayı aç'}
                        onClick={() => {
                          if (!message.fileUrl) return;
                          if (message.fileType === 'image' || message.fileType?.startsWith('image')) {
                            setLightboxImageUrl(message.fileUrl);
                          } else {
                            window.open(message.fileUrl, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        style={{ width: '50px', height: '50px', padding: 0, borderRadius: '8px', border: 'none', background: '#f97316', color: '#ffffff', cursor: message.fileUrl ? 'pointer' : 'default', overflow: 'hidden', flexShrink: 0 }}
                      >
                        {(message.fileType === 'image' || message.fileType?.startsWith('image')) && message.fileUrl
                          ? <img src={message.fileUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <span aria-hidden="true" style={{ fontSize: '20px' }}>📎</span>}
                      </button>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: textColor, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {message.fileName || (message.fileType === 'image' ? 'Görsel' : 'Dosya')}
                        </div>
                        <button
                          type="button"
                          onClick={() => scrollToMessage(message.id)}
                          style={{ border: 'none', background: 'transparent', color: '#f97316', padding: 0, cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}
                        >
                          Mesaja git
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 2. PAYLAŞILAN BAĞLANTILAR TABI */}
            {conversationInfoTab === 'links' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkItems.length === 0 ? (
                  <p style={{ textAlign: 'center', color: iconColor, fontSize: '13px' }}>Henüz bağlantı paylaşılmadı.</p>
                ) : (
                  linkItems.map((item, idx) => (
                    <a key={idx} href={item.url} target="_blank" rel="noreferrer" style={{ padding: '8px 12px', background: inputBg, borderRadius: '8px', color: '#3b82f6', textDecoration: 'none', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      🔗 {item.url}
                    </a>
                  ))
                )}
              </div>
            )}

            {/* 3. BEKLEYEN ZAMANLANMIŞ MESAJLAR TABI */}
            {conversationInfoTab === 'scheduled' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pendingMessages.length === 0 ? (
                  <p style={{ textAlign: 'center', color: iconColor, fontSize: '13px' }}>Bekleyen zamanlanmış mesaj yok.</p>
                ) : (
                  pendingMessages.map((msg) => (
                    <div key={msg.id} style={{ padding: '10px 12px', background: inputBg, borderRadius: '8px', borderLeft: '3px solid #f97316' }}>
                      <div style={{ fontSize: '13px', color: textColor }}>{msg.content}</div>
                      <div style={{ fontSize: '11px', color: iconColor, marginTop: '4px' }}>⏰ {new Date(msg.sendAt).toLocaleString('tr-TR')}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 4. YILDIZLI MESAJLAR TABI */}
            {conversationInfoTab === 'starred' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {conversationStarredMessages.length === 0 ? (
                  <p style={{ textAlign: 'center', color: iconColor, fontSize: '13px' }}>Yıldızlı mesaj bulunmuyor.</p>
                ) : (
                  conversationStarredMessages.map((msg) => (
                    <div key={msg.id} onClick={() => scrollToMessage(msg.id)} style={{ padding: '10px 12px', background: inputBg, borderRadius: '8px', cursor: 'pointer', borderLeft: '3px solid #eab308' }}>
                      <div style={{ fontSize: '11px', color: '#eab308', fontWeight: 'bold', marginBottom: '2px' }}>{msg.sender?.username || 'Kullanıcı'}</div>
                      <div style={{ fontSize: '13px', color: textColor }}>{msg.content}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {lightboxImageUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxImageUrl(null)}>
          <button
            type="button"
            className="lightbox-close-btn"
            onClick={() => setLightboxImageUrl(null)}
            aria-label="Görsel önizlemeyi kapat"
          >
            ✕
          </button>
          <img
            src={lightboxImageUrl}
            alt="Görsel önizleme"
            className="lightbox-img"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      {/* AVATAR GÖRÜNTÜLEME MODALI */}
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
