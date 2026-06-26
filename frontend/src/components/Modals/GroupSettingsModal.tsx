import './Modals.css';
import type { User, Conversation } from '../../App';
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
}

export default function GroupSettingsModal({
  setIsGroupSettingsOpen, activeConversation, currentUser, editGroupName, 
  setEditGroupName, handleUpdateGroupName, groupMembers, handleRemoveMember, handleDeleteGroup
}: GroupSettingsModalProps) {
  return (
    <div className="settings-overlay">
      <div className="settings-modal" style={{width: '400px'}}>
        <div className="settings-header">
          <h2>⚙️ Grup Ayarları</h2>
          <button className="close-btn" onClick={() => setIsGroupSettingsOpen(false)}>✕</button>
        </div>
        
        <div className="settings-body">
          {activeConversation.adminId === currentUser?.id && (
            <div className="settings-section">
              <h4>Grup Adını Değiştir</h4>
              <div className="settings-input-group">
                <input type="text" placeholder="Yeni Grup Adı" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} />
                
                 {/* KAYDET BUTONU INPUT'UN YANINDA BURADA OLMALI */}
                <Button text="Kaydet" onClick={handleUpdateGroupName} />
                
              </div>
            </div>
          )}

          <div className="settings-section">
            <h4 style={{marginBottom: '10px'}}>Grup Üyeleri</h4>
            <div style={{maxHeight: '150px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '6px', padding: '10px'}}>
              {groupMembers.map(member => {
                const isAdmin = activeConversation.adminId === currentUser?.id;
                const isMe = member.id === currentUser?.id;
                return (
                  <div key={member.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5'}}>
                    <span>
                      {isMe ? "Sen" : member.username}
                      {activeConversation.adminId === member.id && <span style={{fontSize: '10px', color: '#00a884', marginLeft: '5px'}}>(Yönetici)</span>}
                    </span>
                    {(isAdmin || isMe) && (
                     <Button 
                        text={isMe ? "Ayrıl" : "Çıkar"} 
                        onClick={() => handleRemoveMember(member.id)} 
                        variant="danger" 
                        size="small" 
                                />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

         {activeConversation.adminId === currentUser?.id && (
            <div className="settings-section" style={{marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
              
              <Button 
                text="🗑️ Grubu Kalıcı Olarak Sil" 
                onClick={handleDeleteGroup} 
                variant="danger" 
                fullWidth={true} 
              />
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}