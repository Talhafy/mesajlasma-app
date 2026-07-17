import { useState } from 'react';
import './Modals.css';
import type { User } from '../../types/chat';
import Button from '../UI/Button';

interface CreateGroupModalProps {
  // Modal kendi state'ini tutmaz; App.tsx'teki state ve handler'lar props olarak gelir.
  // Böylece grup kurulduktan sonra App sohbet/grup listelerini tek merkezden güncelleyebilir.
  setIsGroupModalOpen: (isOpen: boolean) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  usersList: User[];
  selectedMembers: string[];
  toggleMemberSelection: (userId: string) => void;
  handleCreateGroup: () => void;
}

export default function CreateGroupModal({
  setIsGroupModalOpen, newGroupName, setNewGroupName, usersList,
  selectedMembers, toggleMemberSelection, handleCreateGroup
}: CreateGroupModalProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!newGroupName.trim()) {
      setErrorMessage("Grup adı boş bırakılamaz. Lütfen bir grup adı girin.");
      return;
    }
    setErrorMessage(null);
    handleCreateGroup();
  };

  const isButtonDisabled = selectedMembers.length === 0;

  // Bu component yalnızca arayüzü çizer; doğrulama ve API çağrısı handleCreateGroup içinde App.tsx tarafında yapılır.
  return (
    <div className="settings-overlay">
      <div className="settings-modal" style={{width: '350px'}}>
        <div className="settings-header">
          <h2>👥 Yeni Grup Oluştur</h2>
         <Button text="✕" onClick={() => setIsGroupModalOpen(false)} variant="ghost" />
        </div>
        <div className="settings-body">
          {errorMessage && (
            <div className="settings-msg error" style={{ marginBottom: '15px' }}>
              ⚠️ {errorMessage}
            </div>
          )}
          <input 
            type="text" 
            placeholder="Grup Adı (Örn: Proje Ekibi)" 
            value={newGroupName} 
            onChange={(e) => {
              setNewGroupName(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }} 
            style={{
              width: '100%', 
              padding: '10px 12px', 
              boxSizing: 'border-box', 
              marginBottom: '15px', 
              border: '1px solid var(--border-color, #ddd)', 
              borderRadius: '8px', 
              outline: 'none',
              background: 'transparent',
              color: 'inherit',
              fontSize: '14px'
            }} 
          />
          <h4 style={{fontSize: '14px', color: 'var(--text-color, #555)', margin: '0 0 10px 0', fontWeight: 600}}>Kişileri Seçin</h4>

          <div style={{
            maxHeight: '220px', 
            overflowY: 'auto', 
            marginBottom: '20px', 
            border: '1px solid var(--border-color, #eee)', 
            borderRadius: '8px', 
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            boxSizing: 'border-box'
          }}>
            {usersList.length === 0 ? (
              <p style={{fontSize: '13px', color: '#888', padding: '15px', textAlign: 'center'}}>Sisteme kayıtlı başka kullanıcı yok.</p>
            ) : (
              usersList.map(user => {
                const isSelected = selectedMembers.includes(user.id);
                return (
                  <div 
                    key={user.id} 
                    onClick={() => toggleMemberSelection(user.id)}
                    style={{
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '8px 10px', 
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
                      transition: 'background 0.2s',
                    }}
                    className="group-member-select-item"
                  >
                    {/* Custom Circular Checkbox */}
                    <div style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: `2px solid ${isSelected ? '#f97316' : '#b0b0b0'}`,
                      background: isSelected ? '#f97316' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                      marginRight: '12px',
                      flexShrink: 0
                    }}>
                      {isSelected && <span style={{ color: 'white', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                    </div>

                    {/* Avatar */}
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: '#f97316',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      overflow: 'hidden',
                      marginRight: '12px',
                      flexShrink: 0
                    }}>
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        user.username?.[0]?.toUpperCase()
                      )}
                    </div>

                    {/* Username */}
                    <span style={{ fontSize: '14px', fontWeight: 500 }}>{user.username}</span>
                  </div>
                );
              })
            )}
          </div>
          <Button
            text="Grubu Kur"
            onClick={handleSubmit}
            fullWidth={true}
            disabled={isButtonDisabled}
          />
        </div>
      </div>
    </div>
  );
}
