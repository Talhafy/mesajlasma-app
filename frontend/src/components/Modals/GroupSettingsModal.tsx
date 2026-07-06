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
  groupMembers: User[];
  handleRemoveMember: (userId: string) => void;
  handleDeleteGroup: () => void;
  usersList: User[];
  handleAddMembersToGroup: (userIds: string[]) => void;
  handleTransferAdmin: (newAdminId: string) => void;
}

export default function GroupSettingsModal({
  setIsGroupSettingsOpen, activeConversation, currentUser, editGroupName,
  setEditGroupName, handleUpdateGroupName, groupMembers, handleRemoveMember, handleDeleteGroup,
  usersList, handleAddMembersToGroup, handleTransferAdmin
}: GroupSettingsModalProps) {

  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);

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
                    <div className="member-info">
                      <span className="member-name">{isMe ? "Sen" : member.username}</span>
                      {isMemberAdmin && <span className="member-role">Yönetici</span>}
                    </div>

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
    </div>
  );
}
