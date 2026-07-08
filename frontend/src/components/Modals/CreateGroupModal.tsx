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
  // Bu component yalnızca arayüzü çizer; doğrulama ve API çağrısı handleCreateGroup içinde App.tsx tarafında yapılır.
  return (
    <div className="settings-overlay">
      <div className="settings-modal" style={{width: '350px'}}>
        <div className="settings-header">
          <h2>👥 Yeni Grup Oluştur</h2>
         <Button text="✕" onClick={() => setIsGroupModalOpen(false)} variant="ghost" />
        </div>
        <div className="settings-body">
          <input type="text" placeholder="Grup Adı (Örn: Proje Ekibi)" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} style={{width: '100%', padding: '10px', marginBottom: '15px', border: '1px solid #ddd', borderRadius: '6px', outline: 'none'}} />
          <h4 style={{fontSize: '14px', color: '#555', margin: '0 0 10px 0'}}>Kişileri Seçin</h4>

          <div style={{maxHeight: '200px', overflowY: 'auto', marginBottom: '15px', border: '1px solid #eee', borderRadius: '6px', padding: '10px'}}>
            {usersList.length === 0 ? (
              <p style={{fontSize: '13px', color: '#888'}}>Sisteme kayıtlı başka kullanıcı yok.</p>
            ) : (
              usersList.map(user => (
                <label key={user.id} style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', cursor: 'pointer'}}>
                  <input type="checkbox" checked={selectedMembers.includes(user.id)} onChange={() => toggleMemberSelection(user.id)} style={{width: '18px', height: '18px', cursor: 'pointer'}} />
                  <span>{user.username}</span>
                </label>
              ))
            )}
          </div>
          <Button
               text="Grubu Kur"
              onClick={handleCreateGroup}
              fullWidth={true}
                    />
        </div>
      </div>
    </div>
  );
}
