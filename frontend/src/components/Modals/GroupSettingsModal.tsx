import { useState } from 'react';
import './Modals.css';
import type { User, Conversation } from '../../types/chat';
import Button from '../UI/Button';

interface GroupSettingsModalProps {
  setIsGroupSettingsOpen: (isOpen: boolean) => void;
  activeConversation: Conversation;
  currentUser: User | null;
  editGroupName: string;
  setEditGroupName: (name: string) => void;
  handleUpdateGroupName: () => void;
  handleUpdateGroupAvatar: (file: File) => Promise<void>;
  groupMembers: User[];
  handleRemoveMember: (userId: string) => void;
  handleDeleteGroup: () => void;
  usersList: User[];
  handleAddMembersToGroup: (userIds: string[]) => void;
  handleTransferAdmin: (newAdminId: string) => void;
  startChat: (user: User) => void;
}

export default function GroupSettingsModal({
  setIsGroupSettingsOpen, activeConversation, currentUser, editGroupName,
  setEditGroupName, handleUpdateGroupName, handleUpdateGroupAvatar, groupMembers, handleRemoveMember, handleDeleteGroup,
  usersList, handleAddMembersToGroup, handleTransferAdmin, startChat
}: GroupSettingsModalProps) {

  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<User | null>(null);

  const isAdmin = activeConversation.adminId === currentUser?.id;
  const availableUsersToAdd = usersList.filter(u => !groupMembers.some(gm => gm.id === u.id));

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

          <div className="settings-section" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '68px', height: '68px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: 800, overflow: 'hidden', flexShrink: 0 }}>
              {activeConversation.avatarUrl ? <img src={activeConversation.avatarUrl} alt="Grup" onClick={() => setIsAvatarModalOpen(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} /> : activeConversation.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h4 style={{ margin: '0 0 6px' }}>Grup Resmi</h4>
              <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#8696a0' }}>Sohbet başlığında ve listede görünen grup fotoğrafı.</p>
              {isAdmin && (
                <label className="modern-primary-btn" style={{ display: 'inline-block', cursor: isAvatarUploading ? 'wait' : 'pointer' }}>
                  {isAvatarUploading ? 'Yükleniyor...' : 'Fotoğraf Seç'}
                  <input type="file" accept="image/*" hidden disabled={isAvatarUploading} onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setIsAvatarUploading(true);
                    try { await handleUpdateGroupAvatar(file); }
                    finally { setIsAvatarUploading(false); event.target.value = ''; }
                  }} />
                </label>
              )}
            </div>
          </div>

          {/* GRUP ADI DEĞİŞTİRME */}
          {isAdmin && (
            <div className="settings-section">
              <h4>Grup Adını Değiştir</h4>
              <div className="settings-input-group">
                <input type="text" placeholder="Yeni Grup Adı" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} />
                <button className="modern-primary-btn" onClick={handleUpdateGroupName}>Kaydet</button>
              </div>
            </div>
          )}

          {/* KİŞİ EKLEME BÖLÜMÜ (Sadece Admin) */}
          {isAdmin && (
            <div className="settings-section">
               <div className="section-header-row">
                  <h4>Yeni Üye Ekle</h4>
                  <button className="add-member-toggle-btn" onClick={() => setShowAddMember(!showAddMember)}>
                    {showAddMember ? "İptal" : "+ Ekle"}
                  </button>
               </div>

               {showAddMember && (
                 <div className="add-member-box">
                   {availableUsersToAdd.length === 0 ? (
                     <p style={{fontSize: '13px', color: '#8696a0', textAlign: 'center', margin: '10px 0'}}>Eklenebilecek kimse kalmadı.</p>
                   ) : (
                     <div style={{maxHeight: '120px', overflowY: 'auto', marginBottom: '10px'}}>
                       {availableUsersToAdd.map(u => (
                         <label key={u.id} className="member-checkbox-label">
                           <input type="checkbox" checked={selectedNewMembers.includes(u.id)} onChange={() => {
                             setSelectedNewMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                           }}/>
                           <span>{u.username}</span>
                         </label>
                       ))}
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
            <h4 style={{marginBottom: '10px'}}>Grup Üyeleri</h4>
            <div className="member-list-container">
              {groupMembers.map(member => {
                const isMemberAdmin = activeConversation.adminId === member.id;
                const isMe = member.id === currentUser?.id;

                return (
                  <div key={member.id} className="member-list-item">
                    <button
                      className="member-info"
                      onClick={() => setSelectedMemberProfile(member)}
                      style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                      title="Profili görüntüle"
                    >
                      <span className="member-name">{isMe ? "Sen" : member.username}</span>
                      {isMemberAdmin && <span className="member-role">Yönetici</span>}
                    </button>

                    <div className="member-actions">

                      {isAdmin && !isMe && (
                        <button onClick={() => handleTransferAdmin(member.id)} className="action-btn-outline">
                          Yönetici Yap
                        </button>
                      )}

                      {(isAdmin || isMe) && (
                        <button onClick={() => handleRemoveMember(member.id)} className="action-btn-danger">
                          {isMe ? "Ayrıl" : "Çıkar"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* KOMPLE SİLME BUTONU (ŞIK SVG TASARIMI) */}
        {isAdmin && (
            <div className="settings-section" style={{marginTop: '25px', borderTop: '1px solid var(--border-color)', paddingTop: '20px'}}>
              <button className="danger-action-btn" onClick={handleDeleteGroup}>
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Grubu Kalıcı Olarak Sil
              </button>
            </div>
          )}

        </div>
      </div>

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
              maxWidth: '100%',
              background: 'var(--panel-bg, #ffffff)',
              color: 'inherit',
              borderRadius: '16px',
              padding: '22px',
              boxShadow: '0 18px 55px rgba(0,0,0,0.35)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: 800, overflow: 'hidden', flexShrink: 0 }}>
                {selectedMemberProfile.avatarUrl
                  ? <img src={selectedMemberProfile.avatarUrl} alt={selectedMemberProfile.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : selectedMemberProfile.username[0]?.toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '20px' }}>{selectedMemberProfile.username}</h3>
                <p style={{ margin: 0, color: '#8696a0', fontSize: '13px' }}>
                  {selectedMemberProfile.email || 'E-posta bilgisi yok'}
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '8px', marginBottom: '18px', fontSize: '13px', color: '#8696a0' }}>
              <span>Durum: {selectedMemberProfile.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
              {selectedMemberProfile.lastSeenAt && (
                <span>Son görülme: {new Date(selectedMemberProfile.lastSeenAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="action-btn-outline" onClick={() => setSelectedMemberProfile(null)}>Kapat</button>
              {selectedMemberProfile.id !== currentUser?.id && (
                <button
                  className="modern-primary-btn"
                  onClick={() => {
                    startChat(selectedMemberProfile);
                    setSelectedMemberProfile(null);
                    setIsGroupSettingsOpen(false);
                  }}
                  style={{ padding: '6px 12px', fontSize: '13px' }}
                >
                  💬 Sohbet Başlat
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
