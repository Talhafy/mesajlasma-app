import { useState } from 'react';
import './Modals.css';
import type { User, Conversation } from '../../types/chat';
import Button from '../UI/Button';
import ImageCropperModal from './ImageCropperModal';
import AvatarViewerModal from './AvatarViewerModal';

interface GroupSettingsModalProps {
  setIsGroupSettingsOpen: (isOpen: boolean) => void;
  activeConversation: Conversation;
  currentUser: User | null;
  handleUpdateGroupName: (newName?: string) => Promise<void>;
  handleUpdateGroupAvatar: (file: File) => Promise<void>;
  groupMembers: User[];
  handleRemoveMember: (userId: string, skipConfirm?: boolean) => void;
  handleDeleteConversationHistory: (conversationId: string) => void;
  usersList: User[];
  handleAddMembersToGroup: (userIds: string[]) => void;
  handleTransferAdmin: (newAdminId: string) => void;
  startChat: (user: User) => void;
  isDarkMode: boolean;
  onStartCallWithUser?: (targetUser: User, callType: 'audio' | 'video') => void;
}

export default function GroupSettingsModal({
  setIsGroupSettingsOpen, activeConversation, currentUser, handleUpdateGroupName, handleUpdateGroupAvatar, groupMembers, handleRemoveMember, handleDeleteConversationHistory,
  usersList, handleAddMembersToGroup, handleTransferAdmin, startChat, isDarkMode, onStartCallWithUser
}: GroupSettingsModalProps) {

  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<User | null>(null);
  const [viewerUser, setViewerUser] = useState<{ avatarUrl: string | null; username: string } | null>(null);
  const [selectedFileForCrop, setSelectedFileForCrop] = useState<File | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(activeConversation.name || '');
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const myMemberInfo = groupMembers.find(m => m.id === currentUser?.id);
  const isMyMemberActive = myMemberInfo ? myMemberInfo.isActive !== false : true;

  const isDeleted = activeConversation.isDeleted === true;
  const isAdmin = activeConversation.adminId === currentUser?.id;
  const activeMembers = groupMembers.filter(m => m.isActive !== false);
  const formerMembers = groupMembers.filter(m => {
    if (m.isActive !== false) return false;
    if (!m.leftAt) return false;
    const leftTime = new Date(m.leftAt).getTime();
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return leftTime >= threeDaysAgo;
  });
  const availableUsersToAdd = usersList.filter(u => {
    const member = groupMembers.find(gm => gm.id === u.id);
    return !member || member.isActive === false;
  });

  const handleSaveName = async () => {
    const trimmed = tempName.trim();
    if (!trimmed || trimmed === activeConversation.name) {
      setIsEditingName(false);
      return;
    }
    await handleUpdateGroupName(trimmed);
    setIsEditingName(false);
  };

  const submitNewMembers = () => {
    handleAddMembersToGroup(selectedNewMembers);
    setShowAddMember(false);
    setSelectedNewMembers([]);
  };

  return (
    <div className="settings-overlay" onClick={() => setIsGroupSettingsOpen(false)}>
      <div className="settings-modal" style={{ width: '420px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>

        <div className="settings-header">
          <h2>⚙️ Grup Ayarları</h2>
          <button className="close-btn" onClick={() => setIsGroupSettingsOpen(false)}>✕</button>
        </div>

        <div className="settings-body">
          {/* GROUP HERO HEADER */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '15px 0 20px', borderBottom: `1px solid var(--border-color, #eee)`, marginBottom: '20px' }}>
            {/* Avatar container */}
            <div style={{ position: 'relative', width: '100px', height: '100px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px', fontWeight: 800, overflow: 'hidden', marginBottom: '15px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', flexShrink: 0 }}>
              {activeConversation.avatarUrl ? (
                <img src={activeConversation.avatarUrl} alt="Grup" onClick={() => setIsAvatarModalOpen(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
              ) : (
                activeConversation.name?.[0]?.toUpperCase()
              )}

              {isMyMemberActive && isAdmin && !isDeleted && (
                <label style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s', cursor: 'pointer' }} className="group-avatar-overlay">
                  Değiştir
                  <input type="file" accept="image/*" hidden disabled={isAvatarUploading} onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setSelectedFileForCrop(file);
                    event.target.value = '';
                  }} />
                </label>
              )}
            </div>

            {/* Editable Group Name */}
            {isEditingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '85%', justifyContent: 'center' }}>
                <input
                  type="text"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, #ddd)',
                    background: 'var(--input-bg, transparent)',
                    color: 'var(--text-color, inherit)',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    outline: 'none',
                    width: '70%'
                  }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') { setIsEditingName(false); setTempName(activeConversation.name || ''); }
                  }}
                />
                <button onClick={handleSaveName} style={{ border: 'none', background: '#25d366', color: 'white', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }} title="Kaydet">✓</button>
                <button onClick={() => { setIsEditingName(false); setTempName(activeConversation.name || ''); }} style={{ border: 'none', background: '#e53935', color: 'white', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }} title="İptal">✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: 'var(--text-color, inherit)' }}>{activeConversation.name}</h3>
                {isMyMemberActive && isAdmin && !isDeleted && (
                  <button onClick={() => { setIsEditingName(true); setTempName(activeConversation.name || ''); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '15px', padding: '4px', borderRadius: '4px' }} title="İsmi Düzenle">✏️</button>
                )}
              </div>
            )}

            <div style={{ fontSize: '13px', color: 'var(--icon-color, #8696a0)', marginTop: '6px' }}>
              Grup · {groupMembers.length} Üye
            </div>
          </div>

          {/* KİŞİ EKLEME BÖLÜMÜ (Sadece Admin) */}
          {isMyMemberActive && isAdmin && !isDeleted && (
            <div className="settings-section" style={{ borderBottom: '1px solid var(--border-color, #eee)', paddingBottom: '15px', marginBottom: '15px' }}>
              <div className="section-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0, fontWeight: 600 }}>Yeni Üye Ekle</h4>
                <button className="add-member-toggle-btn" onClick={() => setShowAddMember(!showAddMember)} style={{ border: 'none', background: 'transparent', color: '#f97316', cursor: 'pointer', fontWeight: 600, fontSize: '13.5px' }}>
                  {showAddMember ? "İptal" : "+ Ekle"}
                </button>
              </div>

              {showAddMember && (
                <div className="add-member-box" style={{ background: 'var(--input-bg, rgba(0,0,0,0.02))', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color, #eee)' }}>
                  {availableUsersToAdd.length === 0 ? (
                    <p style={{ fontSize: '13px', color: 'var(--icon-color, #8696a0)', textAlign: 'center', margin: '10px 0' }}>Eklenebilecek kimse kalmadı.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto', marginBottom: '10px' }}>
                      {availableUsersToAdd.map(u => {
                        const isSelected = selectedNewMembers.includes(u.id);
                        return (
                          <div
                            key={u.id}
                            onClick={() => {
                              setSelectedNewMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: isSelected ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
                              transition: 'background 0.2s',
                            }}
                            className="group-member-select-item"
                          >
                            <div style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              border: `2px solid ${isSelected ? '#f97316' : '#b0b0b0'}`,
                              background: isSelected ? '#f97316' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginRight: '10px',
                              flexShrink: 0
                            }}>
                              {isSelected && <span style={{ color: 'white', fontSize: '10px', fontWeight: 'bold' }}>✓</span>}
                            </div>

                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', overflow: 'hidden', marginRight: '10px', flexShrink: 0 }}>
                              {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username?.[0]?.toUpperCase()}
                            </div>

                            <span style={{ fontSize: '13.5px', fontWeight: 500 }}>{u.username}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selectedNewMembers.length > 0 && (
                    <Button text={`Seçili Kişileri Ekle (${selectedNewMembers.length})`} onClick={submitNewMembers} fullWidth={true} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* MEVCUT ÜYELERİ LİSTELEME */}
          <div className="settings-section">
            <h4 style={{ marginBottom: '12px', fontWeight: 600 }}>Grup Üyeleri ({activeMembers.length})</h4>
            <div className="member-list-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeMembers.map(member => {
                const isMemberAdmin = activeConversation.adminId === member.id;
                const isMe = member.id === currentUser?.id;

                return (
                  <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '8px', borderBottom: '1px solid var(--border-color, #f4f4f4)' }} className="member-list-item-row">
                    <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setSelectedMemberProfile(member)}>
                      {/* Avatar */}
                      <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 'bold', overflow: 'hidden', marginRight: '12px', flexShrink: 0 }}>
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          member.username?.[0]?.toUpperCase()
                        )}
                      </div>

                      {/* Name & Role */}
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-color, inherit)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {isMe ? "Sen" : member.username}
                        </span>
                        {isMemberAdmin && (
                          <span style={{ fontSize: '11px', color: '#f97316', fontWeight: 600, marginTop: '2px' }}>
                            Yönetici
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {isMyMemberActive && isAdmin && !isDeleted && !isMe && (
                        <button
                          onClick={() => handleTransferAdmin(member.id)}
                          className="action-btn-outline"
                          style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border-color, #ddd)', background: 'transparent', cursor: 'pointer' }}
                        >
                          Yönetici Yap
                        </button>
                      )}

                      {isMyMemberActive && isAdmin && !isDeleted && !isMe && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="action-btn-danger"
                          style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '6px', background: 'rgba(229,57,53,0.1)', border: 'none', color: '#e53935', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Çıkar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ESKİ ÜYELERİ LİSTELEME */}
          {formerMembers.length > 0 && (
            <div className="settings-section" style={{ marginTop: '20px' }}>
              <h4 style={{ marginBottom: '12px', fontWeight: 600, color: '#888' }}>Eski Üyeler</h4>
              <div className="member-list-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {formerMembers.map(member => {
                  const isMe = member.id === currentUser?.id;
                  const isKicked = member.leftReason === 'KICK';
                  const statusText = isKicked ? 'Çıkarıldı' : 'Ayrıldı';
                  const formattedLeftAt = member.leftAt
                    ? new Date(member.leftAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                    : '';

                  return (
                    <div key={member.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '8px', borderBottom: '1px solid var(--border-color, #f4f4f4)', opacity: 0.65 }} className="member-list-item-row">
                      <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, minWidth: 0 }} onClick={() => setSelectedMemberProfile(member)}>
                        {/* Avatar */}
                        <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#b0b0b0', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 'bold', overflow: 'hidden', marginRight: '12px', flexShrink: 0 }}>
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            member.username?.[0]?.toUpperCase()
                          )}
                        </div>

                        {/* Name & Role */}
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-color, inherit)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {isMe ? (isKicked ? "Sen (Çıkarıldın)" : "Sen (Ayrıldın)") : member.username}
                          </span>
                          <span style={{ fontSize: '11px', color: '#888', fontStyle: 'italic', marginTop: '2px' }}>
                            {statusText} · {formattedLeftAt}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GRUBU TERK ETME / SİLME BUTONU */}
          {isMyMemberActive && !isDeleted && (
            <div className="settings-section" style={{ marginTop: '25px', borderTop: '1px solid var(--border-color, #eee)', paddingTop: '20px' }}>
              <button className="danger-action-btn" onClick={() => setShowExitConfirm(true)} style={{ width: '100%', padding: '12px', border: 'none', background: 'rgba(229,57,53,0.08)', color: '#e53935', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Gruptan Çık
              </button>
            </div>
          )}

          {/* SOHBETİ TAMAMEN SİLME BUTONU (Silinmiş veya Ayrılmış Üyeler İçin) */}
          {(!isMyMemberActive || isDeleted) && (
            <div className="settings-section" style={{ marginTop: '25px', borderTop: '1px solid var(--border-color, #eee)', paddingTop: '20px' }}>
              <button className="danger-action-btn" onClick={() => {
                setIsGroupSettingsOpen(false);
                handleDeleteConversationHistory(activeConversation.id);
              }} style={{ width: '100%', padding: '12px', border: 'none', background: 'rgba(229,57,53,0.08)', color: '#e53935', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Grubu Sil (Sohbet Geçmişini Temizle)
              </button>
            </div>
          )}

        </div>
      </div>

      {/* --- GRUBU ONAYLI TERK ETME PENCERESİ --- */}
      {showExitConfirm && (
        <div className="exit-confirm-overlay" onClick={() => setShowExitConfirm(false)}>
          <div className="exit-confirm-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Gruptan Çık</h3>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', opacity: 0.85 }}>
              Bu gruptan çıkmak istediğinize emin misiniz? Sadece gruptan ayrılabilir (sohbet kalsın) veya geçmişiyle birlikte tamamen silebilirsiniz (webden sil).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <button
                className="exit-confirm-btn-green"
                onClick={() => {
                  if (currentUser) {
                    handleRemoveMember(currentUser.id, true);
                  }
                  setShowExitConfirm(false);
                  setIsGroupSettingsOpen(false);
                }}
              >
                Gruptan Çık
              </button>

              <button
                className="exit-confirm-btn-green"
                onClick={() => setShowExitConfirm(false)}
              >
                İptal
              </button>

              <button
                className="exit-confirm-btn-danger"
                onClick={() => {
                  handleDeleteConversationHistory(activeConversation.id);
                  setShowExitConfirm(false);
                  setIsGroupSettingsOpen(false);
                }}
              >
                Çık ve Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- TAM EKRAN GRUP RESMİ GÖRÜNTÜLEYİCİ BURAYA GELDİ --- */}
      {isAvatarModalOpen && activeConversation.avatarUrl && (
        <div
          className="settings-overlay"
          onClick={() => setIsAvatarModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(5px)'
          }}
        >
          <button
            onClick={() => setIsAvatarModalOpen(false)}
            style={{
              position: 'absolute', top: '20px', right: '30px',
              background: 'none', border: 'none', color: 'white',
              fontSize: '32px', cursor: 'pointer', zIndex: 100001
            }}
          >
            ✕
          </button>
          <img
            src={activeConversation.avatarUrl}
            alt="Büyük Grup Resmi"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: '12px',
              objectFit: 'contain',
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
            }}
          />
        </div>
      )}

      {selectedMemberProfile && (
        <div
          className="settings-overlay"
          onClick={() => setSelectedMemberProfile(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '360px',
              padding: '24px',
              position: 'relative',
              borderRadius: '16px',
              background: isDarkMode ? '#1e293b' : '#ffffff',
              color: isDarkMode ? '#f8fafc' : '#0f172a',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
            }}
          >
            <button 
              onClick={() => setSelectedMemberProfile(null)} 
              style={{ 
                position: 'absolute', 
                top: '12px', 
                right: '12px', 
                border: 'none', 
                background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', 
                color: isDarkMode ? '#f8fafc' : '#0f172a', 
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
                  avatarUrl: selectedMemberProfile.avatarUrl || null, 
                  username: selectedMemberProfile.username 
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
                {selectedMemberProfile.avatarUrl ? (
                  <img src={selectedMemberProfile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  selectedMemberProfile.username?.[0]?.toUpperCase()
                )}
              </div>
              
              <h3 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 700, color: isDarkMode ? '#f8fafc' : '#0f172a' }}>
                {selectedMemberProfile.username}
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', width: '100%' }}>
                <button
                  onClick={() => {
                    startChat(selectedMemberProfile);
                    setSelectedMemberProfile(null);
                    setIsGroupSettingsOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: isDarkMode ? '#f8fafc' : '#0f172a',
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
                      onStartCallWithUser(selectedMemberProfile, 'audio');
                      setSelectedMemberProfile(null);
                      setIsGroupSettingsOpen(false);
                    }
                  }}
                  disabled={selectedMemberProfile.id === currentUser?.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: isDarkMode ? '#f8fafc' : '#0f172a',
                    cursor: selectedMemberProfile.id === currentUser?.id ? 'not-allowed' : 'pointer',
                    opacity: selectedMemberProfile.id === currentUser?.id ? 0.5 : 1,
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
                      onStartCallWithUser(selectedMemberProfile, 'video');
                      setSelectedMemberProfile(null);
                      setIsGroupSettingsOpen(false);
                    }
                  }}
                  disabled={selectedMemberProfile.id === currentUser?.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px 6px',
                    borderRadius: '12px',
                    border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                    background: isDarkMode ? '#334155' : '#f1f5f9',
                    color: isDarkMode ? '#f8fafc' : '#0f172a',
                    cursor: selectedMemberProfile.id === currentUser?.id ? 'not-allowed' : 'pointer',
                    opacity: selectedMemberProfile.id === currentUser?.id ? 0.5 : 1,
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
      ) /* selectedMemberProfile end */}

      {selectedFileForCrop && (
        <ImageCropperModal
          file={selectedFileForCrop}
          onClose={() => setSelectedFileForCrop(null)}
          onCropComplete={async (croppedFile) => {
            setSelectedFileForCrop(null);
            setIsAvatarUploading(true);
            try {
              await handleUpdateGroupAvatar(croppedFile);
            } finally {
              setIsAvatarUploading(false);
            }
          }}
        />
      )}

      {viewerUser && (
        <AvatarViewerModal
          avatarUrl={viewerUser.avatarUrl}
          username={viewerUser.username}
          onClose={() => setViewerUser(null)}
        />
      )}
    </div>
  );
}
