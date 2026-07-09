import { useState } from 'react';
import type { User } from '../../types/chat';
import './Modals.css';

interface SettingsModalProps {
  setIsSettingsOpen: (isOpen: boolean) => void;
  settingsMessage: { type: string; text: string };
  setSettingsMessage: (msg: { type: string; text: string }) => void;
  newUsernameSettings: string;
  setNewUsernameSettings: (val: string) => void;
  handleUpdateUsername: () => void;
  newEmailSettings: string;
  setNewEmailSettings: (val: string) => void;
  handleUpdateEmail: () => void;
  currentUser: User | null;
  handleToggleReadReceipts: (val: boolean) => void;
  oldPasswordSettings: string;
  setOldPasswordSettings: (val: string) => void;
  newPasswordSettings: string;
  setNewPasswordSettings: (val: string) => void;
  handleUpdatePassword: () => void;
  handleUpdateAvatar: (file: File) => Promise<void>;
  handleDeleteAccount: () => void;
  cikisYap: () => void;
}

export default function SettingsModal(props: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'account'>('profile');
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);

  return (
    <div className="settings-overlay" onClick={() => props.setIsSettingsOpen(false)}>

      <div className="settings-layout-container" onClick={(e) => e.stopPropagation()}>

        {/* SOL TARAFTAKİ SEKME MENÜSÜ */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            Ayarlar
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '0 10px', flex: 1 }}>
            <button
              onClick={() => { setActiveTab('profile'); props.setSettingsMessage({type: '', text: ''}); }}
              className={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            >
              <span>👤</span> Profil
            </button>
            <button
              onClick={() => { setActiveTab('account'); props.setSettingsMessage({type: '', text: ''}); }}
              className={`settings-tab-btn ${activeTab === 'account' ? 'active' : ''}`}
            >
              <span>⚙️</span> Hesap
            </button>
          </div>

          <div className="settings-sidebar-footer">
            <button onClick={props.cikisYap} className="settings-logout-btn">
              🚪 Çıkış Yap
            </button>
          </div>
        </div>

        {/* SAĞ TARAFTAKİ İÇERİK ALANI */}
        <div className="settings-content">

          <button onClick={() => props.setIsSettingsOpen(false)} className="settings-close-icon">✖</button>

          {/* PROFİL SEKMESİ İÇERİĞİ */}
          {activeTab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 className="settings-title">Profil Bilgileri</h2>

              {props.settingsMessage.text && (
                <div className={`settings-msg ${props.settingsMessage.type}`}>
                  {props.settingsMessage.text}
                </div>
              )}

              <div className="settings-avatar-row">
                <div className="settings-avatar" style={{ overflow: 'hidden' }}>
                  {props.currentUser?.avatarUrl ? <img src={props.currentUser.avatarUrl} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : props.currentUser?.username?.[0]?.toUpperCase()}
                </div>
                <div>
                  <h3 className="settings-username">{props.currentUser?.username}</h3>
                  <label className="modern-primary-btn" style={{ display: 'inline-block', marginTop: '8px', cursor: isAvatarUploading ? 'wait' : 'pointer' }}>
                    {isAvatarUploading ? 'Yükleniyor...' : 'Fotoğrafı Değiştir'}
                    <input type="file" accept="image/*" hidden disabled={isAvatarUploading} onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setIsAvatarUploading(true);
                      try { await props.handleUpdateAvatar(file); }
                      finally { setIsAvatarUploading(false); event.target.value = ''; }
                    }} />
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="settings-label">Kullanıcı Adını Değiştir</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="text"
                      placeholder="Yeni kullanıcı adı"
                      value={props.newUsernameSettings}
                      onChange={(e) => props.setNewUsernameSettings(e.target.value)}
                      className="settings-modern-input"
                    />
                    <button onClick={props.handleUpdateUsername} className="modern-primary-btn">Kaydet</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="settings-label">E-posta Hesabı</label>
                  <div style={{ fontSize: '13px', color: '#8696a0' }}>{props.currentUser?.email}</div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="email"
                      placeholder="Yeni e-posta"
                      value={props.newEmailSettings}
                      onChange={(e) => props.setNewEmailSettings(e.target.value)}
                      className="settings-modern-input"
                    />
                    <button onClick={props.handleUpdateEmail} className="modern-primary-btn">Kaydet</button>
                  </div>
                </div>

                {/* Okundu Bilgisi Ayarı */}
                <div className="settings-info-box">
                  <div className="settings-info-box-text">
                    <h4>Okundu Bilgisi (Mavi Tik)</h4>
                    <p>Kapatırsanız, başkalarının mesajlarını okuduğunuzu göremezler ve siz de onlarınkini göremezsiniz.</p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={props.currentUser?.readReceiptsOn !== false}
                      onChange={(e) => props.handleToggleReadReceipts(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* HESAP SEKMESİ İÇERİĞİ */}
          {activeTab === 'account' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 className="settings-title">Hesap Ayarları</h2>

              {props.settingsMessage.text && (
                <div className={`settings-msg ${props.settingsMessage.type}`}>
                  {props.settingsMessage.text}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '40px' }}>
                <label className="settings-label" style={{marginBottom: 0}}>Şifre Değiştir</label>
                <input
                  type="password"
                  placeholder="Mevcut Şifreniz"
                  value={props.oldPasswordSettings}
                  onChange={(e) => props.setOldPasswordSettings(e.target.value)}
                  className="settings-modern-input"
                />
                <input
                  type="password"
                  placeholder="Yeni Şifreniz"
                  value={props.newPasswordSettings}
                  onChange={(e) => props.setNewPasswordSettings(e.target.value)}
                  className="settings-modern-input"
                />
                <button onClick={props.handleUpdatePassword} className="modern-primary-btn" style={{alignSelf: 'flex-start'}}>Şifreyi Güncelle</button>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#d32f2f', fontSize: '16px' }}>Tehlikeli Bölge</h4>
                <p className="settings-label" style={{marginBottom: '15px'}}>Hesabınızı silerseniz, tüm sohbet geçmişiniz, gruplarınız ve verileriniz kalıcı olarak yok olur.</p>
                <button onClick={props.handleDeleteAccount} className="danger-action-btn" style={{justifyContent: 'center'}}>
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  Hesabımı Kalıcı Olarak Sil
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
