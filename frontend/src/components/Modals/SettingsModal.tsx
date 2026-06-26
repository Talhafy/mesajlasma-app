import './Modals.css';
import type { User } from '../../App';
import Button from '../UI/Button';

interface SettingsModalProps {
  setIsSettingsOpen: (isOpen: boolean) => void;
  settingsMessage: { type: string; text: string };
  setSettingsMessage: (msg: { type: string; text: string }) => void;
  newUsernameSettings: string;
  setNewUsernameSettings: (val: string) => void;
  handleUpdateUsername: () => void;
  currentUser: User | null;
  handleToggleReadReceipts: (isEnabled: boolean) => void; // App.tsx'ten gelecek yeni fonksiyon
  oldPasswordSettings: string;
  setOldPasswordSettings: (val: string) => void;
  newPasswordSettings: string;
  setNewPasswordSettings: (val: string) => void;
  handleUpdatePassword: () => void;
  handleDeleteAccount: () => void;
}

export default function SettingsModal({
  setIsSettingsOpen, settingsMessage, setSettingsMessage, newUsernameSettings, setNewUsernameSettings,
  handleUpdateUsername, currentUser, handleToggleReadReceipts, oldPasswordSettings, setOldPasswordSettings,
  newPasswordSettings, setNewPasswordSettings, handleUpdatePassword, handleDeleteAccount
}: SettingsModalProps) {
  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>⚙️ Hesap Ayarları</h2>
          <button className="close-btn" onClick={() => {setIsSettingsOpen(false); setSettingsMessage({type: '', text: ''})}}>✕</button>
        </div>
        <div className="settings-body">
          {settingsMessage.text && <div className={`settings-msg ${settingsMessage.type}`}>{settingsMessage.text}</div>}
          
          <div className="settings-section">
            <h4>Kullanıcı Adı Değiştir</h4>
            <div className="settings-input-group">
              <input type="text" placeholder="Yeni Kullanıcı Adı" value={newUsernameSettings} onChange={(e) => setNewUsernameSettings(e.target.value)} />
              <Button text="Güncelle" onClick={handleUpdateUsername} />
            </div>
          </div>

          <div className="settings-section" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px', marginBottom: '15px'}}>
            <h4 style={{margin: 0}}>Görüldü Bilgisi (Mavi Tik)</h4>
            <label style={{display: 'flex', alignItems: 'center', cursor: 'pointer'}}>
              <input 
                type="checkbox" 
                checked={currentUser?.readReceiptsOn !== false} 
                onChange={(e) => handleToggleReadReceipts(e.target.checked)}
                style={{width: '16px', height: '16px', margin: 0}}
              />
              <span style={{marginLeft: '8px', fontSize: '13px', color: '#555'}}>{currentUser?.readReceiptsOn !== false ? 'Açık' : 'Kapalı'}</span>
            </label>
          </div>

          <div className="settings-section">
            <h4>Şifre Değiştir</h4>
            <div className="settings-input-group" style={{flexDirection: 'column', gap: '8px'}}>
              <input type="password" placeholder="Mevcut Şifre" value={oldPasswordSettings} onChange={(e) => setOldPasswordSettings(e.target.value)} />
              <input type="password" placeholder="Yeni Şifre" value={newPasswordSettings} onChange={(e) => setNewPasswordSettings(e.target.value)} />
              <Button text="Şifreyi Değiştir" onClick={handleUpdatePassword} fullWidth={true} />
            </div>
          </div>
          
          <div className="settings-section" style={{marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
            <h4 style={{color: '#d32f2f'}}>Tehlikeli Alan</h4>
            <Button 
            text="🗑️ Hesabımı Sil" 
            onClick={handleDeleteAccount} 
            variant="danger" 
            fullWidth={true} 
                  />
          </div>
        </div>
      </div>
    </div>
  );
}