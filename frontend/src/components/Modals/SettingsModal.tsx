import { useState, useEffect } from 'react';
import type { User } from '../../types/chat';
import './Modals.css';
import ImageCropperModal from './ImageCropperModal';
import AvatarViewerModal from './AvatarViewerModal';
import SecurityVaultModal from './SecurityVaultModal';
import { api } from '../../api/httpClient';

/**
 * SettingsModal bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface SettingsModalProps {
  vaultSetup: 'migration' | 'unavailable' | null;
  /** Ayarlar modalının görünürlük durumunu güncelleyen setter fonksiyonu */
  setIsSettingsOpen: (isOpen: boolean) => void;
  /** İşlem sonucu gösterilecek mesaj nesnesi ({ type: 'success'|'error', text: string }) */
  settingsMessage: { type: string; text: string };
  /** Ayarlar mesajını güncelleyen setter fonksiyonu */
  setSettingsMessage: (msg: { type: string; text: string }) => void;
  /** Kullanıcı adı değiştirme alanındaki yeni kullanıcı adı değeri */
  newUsernameSettings: string | null;
  /** Yeni kullanıcı adı değerini güncelleyen setter fonksiyonu */
  setNewUsernameSettings: (val: string) => void;
  /** Kullanıcı adı güncelleme işlemini tetikleyen fonksiyon */
  handleUpdateUsername: () => Promise<void>;
  /** E-posta değiştirme alanındaki yeni e-posta değeri */
  newEmailSettings: string | null;
  /** Yeni e-posta değerini güncelleyen setter fonksiyonu */
  setNewEmailSettings: (val: string) => void;
  /** E-posta adresi güncelleme işlemini tetikleyen fonksiyon */
  handleUpdateEmail: () => Promise<void>;
  /** Oturum açmış olan mevcut kullanıcı bilgisi */
  currentUser: User | null;
  /** Okundu bilgisi (mavi tik) tercihini değiştiren fonksiyon */
  handleToggleReadReceipts: (val: boolean) => void;
  /** Şifre değiştirme alanındaki mevcut (eski) şifre */
  oldPasswordSettings: string;
  /** Eski şifre değerini güncelleyen setter fonksiyonu */
  setOldPasswordSettings: (val: string) => void;
  /** Şifre değiştirme alanındaki yeni şifre */
  newPasswordSettings: string;
  /** Yeni şifre değerini güncelleyen setter fonksiyonu */
  setNewPasswordSettings: (val: string) => void;
  /** Şifre güncelleme işlemini tetikleyen fonksiyon */
  handleUpdatePassword: () => void;
  /** Profil resmini sunucuya yükleme ve güncelleme fonksiyonu */
  handleUpdateAvatar: (file: File) => Promise<void>;
  /** Kullanıcı hesabını kalıcı olarak silme fonksiyonu */
  handleDeleteAccount: () => Promise<void>;
  /** Kullanıcının oturumunu sonlandıran çıkış yap fonksiyonu */
  cikisYap: () => void;
}

/**
 * Kullanıcı profil bilgilerinin (kullanıcı adı, e-posta, avatar, okundu bilgisi),
 * hesap güvenlik ayarlarının (şifre değiştirme, hesap silme) ve engellenen kullanıcılar listesinin yönetildiği ana ayarlar modalı.
 */
export default function SettingsModal(props: SettingsModalProps) {
  // --- LOCAL STATE (YEREL DURUMLAR) ---
  /** Aktif sekme: Profil, Hesap, Şifreli kasa veya Engellenenler. */
  const [activeTab, setActiveTab] = useState<'profile' | 'account' | 'security' | 'blocked'>(
    props.vaultSetup ? 'security' : 'profile'
  );
  /** Avatar yükleme işleminin devam edip etmediği durumu */
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  /** Kırpma modala aktarılmak üzere seçilen ham resim dosyası */
  const [selectedFileForCrop, setSelectedFileForCrop] = useState<File | null>(null);
  /** Kullanıcının kendi profil avatarını büyük görmesini sağlayan modalın durumu */
  const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);
  /** Sunucudan çekilen engellenen kullanıcılar listesi */
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  /** Engellenenler listesi yüklenirken gösterilen yükleniyor durumu */
  const [isBlockedUsersLoading, setIsBlockedUsersLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'username' | 'email' | 'delete' | null>(null);

  const runAction = async (action: NonNullable<typeof pendingAction>, run: () => Promise<void>) => {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await run();
    } finally {
      setPendingAction(null);
    }
  };

  const profileFields = [
    { id: 'username', label: 'Kullanıcı adı', type: 'text', min: 3, max: 30,
      current: props.currentUser?.username, draft: props.newUsernameSettings,
      edit: props.setNewUsernameSettings, save: props.handleUpdateUsername },
    { id: 'email', label: 'E-posta adresi', type: 'email', min: undefined, max: 254,
      current: props.currentUser?.email, draft: props.newEmailSettings,
      edit: props.setNewEmailSettings, save: props.handleUpdateEmail }
  ] as const;

  /**
   * Engellenen kullanıcılar listesini backend API'sinden çeker.
   */
  const fetchBlockedUsers = async () => {
    setIsBlockedUsersLoading(true);
    try {
      const res = await api.get('/users/blocked/list');
      setBlockedUsers(res.data);
    } catch (err) {
      console.error("Engellenen kullanıcılar getirilemedi.", err);
    } finally {
      setIsBlockedUsersLoading(false);
    }
  };

  /**
   * Belirtilen kullanıcının engelini kaldırır ve listeyi günceller.
   */
  const handleUnblock = async (id: string) => {
    try {
      await api.delete(`/users/${id}/block`);
      setBlockedUsers(prev => prev.filter(u => u.id !== id));
    } catch {
      alert("Engel kaldırılamadı.");
    }
  };

  // 'Engellenenler' sekmesine geçildiğinde engellenen kullanıcılar listesini otomatik çek
  useEffect(() => {
    if (activeTab === 'blocked') {
      void fetchBlockedUsers();
    }
  }, [activeTab]);

  return (
    // Modal Karartılmış Overlay Alanı
    <div className="settings-overlay" onClick={() => props.setIsSettingsOpen(false)}>

      {/* Modal Ana Düzen Kapsayıcısı */}
      <div className="settings-layout-container" onClick={(e) => e.stopPropagation()}>

        {/* --- SOL TARAFTAKİ SEKME NAVİGASYON MENÜSÜ --- */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            Ayarlar
          </div>

          <div className="settings-sidebar-tabs">
            {/* Profil Sekme Butonu */}
            <button
              onClick={() => { setActiveTab('profile'); props.setSettingsMessage({ type: '', text: '' }); }}
              className={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            >
              <span>👤</span> Profil
            </button>

            {/* Hesap Sekme Butonu */}
            <button
              onClick={() => { setActiveTab('account'); props.setSettingsMessage({ type: '', text: '' }); }}
              className={`settings-tab-btn ${activeTab === 'account' ? 'active' : ''}`}
            >
              <span>⚙️</span> Hesap
            </button>

            <button
              onClick={() => { setActiveTab('security'); props.setSettingsMessage({ type: '', text: '' }); }}
              className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            >
              <span aria-hidden="true">🔒</span> Şifreli kasa
            </button>

            {/* Engellenenler Sekme Butonu */}
            <button
              onClick={() => { setActiveTab('blocked'); props.setSettingsMessage({ type: '', text: '' }); }}
              className={`settings-tab-btn ${activeTab === 'blocked' ? 'active' : ''}`}
            >
              <span>🚫</span> Engellenenler
            </button>
          </div>

          {/* Sol Alt Çıkış Yap Butonu */}
          <div className="settings-sidebar-footer">
            <button onClick={props.cikisYap} className="settings-logout-btn">
              Çıkış Yap
            </button>
          </div>
        </div>

        {/* --- SAĞ TARAFTAKİ İÇERİK ALANI --- */}
        <div className="settings-content">

          {/* Modal Kapatma Çarpı İkonu */}
          <button onClick={() => props.setIsSettingsOpen(false)} className="settings-close-icon">✖</button>

          {/* ================= PROFİL SEKMESİ İÇERİĞİ ================= */}
          {activeTab === 'profile' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 className="settings-title">Profil Bilgileri</h2>

              {/* Bilgi / Hata Mesajı Bildirimi */}
              {props.settingsMessage.text && (
                <div className={`settings-msg ${props.settingsMessage.type}`} role={props.settingsMessage.type === "error" ? "alert" : "status"}>
                  {props.settingsMessage.text}
                </div>
              )}

              {/* Profil Resmi Düzenleme Alanı */}
              <div className="settings-avatar-row">
                <div
                  className="settings-avatar"
                  onClick={() => setIsAvatarViewerOpen(true)}
                  style={{ overflow: 'hidden', cursor: 'pointer' }}
                  title="Profil resmini büyük gör"
                >
                  {props.currentUser?.avatarUrl ? (
                    <img src={props.currentUser.avatarUrl} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    props.currentUser?.username?.[0]?.toUpperCase()
                  )}
                </div>
                <div>
                  <h3 className="settings-username">{props.currentUser?.username}</h3>
                  <label className="modern-primary-btn" style={{ display: 'inline-block', marginTop: '8px', cursor: isAvatarUploading ? 'wait' : 'pointer' }}>
                    {isAvatarUploading ? 'Yükleniyor...' : 'Fotoğrafı Değiştir'}
                    <input type="file" accept="image/*" hidden disabled={isAvatarUploading} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setSelectedFileForCrop(file);
                      event.target.value = '';
                    }} />
                  </label>
                </div>
              </div>

              <div className="settings-profile-fields">
                {profileFields.map(({ id, label, type, min, max, current, draft, edit, save }) => (
                  <form key={id} className="settings-edit-card" onSubmit={(event) => {
                    event.preventDefault();
                    if (draft?.trim() && draft.trim() !== current) void runAction(id, save);
                  }}>
                    <label className="settings-edit-label" htmlFor={'settings-' + id}>{label}</label>
                    {draft !== null && current && draft !== current && (
                      <span className="settings-edit-current">Şu an kayıtlı değer {current}</span>
                    )}
                    <div className="settings-edit-row">
                      <input id={'settings-' + id} type={type} autoComplete={id} minLength={min} maxLength={max} required
                        className="settings-modern-input" value={draft ?? current ?? ''} disabled={pendingAction === id}
                        onChange={(event) => edit(event.target.value)} />
                      <button type="submit" className="modern-primary-btn"
                        disabled={Boolean(pendingAction) || !draft?.trim() || draft.trim() === current}>
                        {pendingAction === id ? 'Kaydediliyor…' : 'Kaydet'}
                      </button>
                    </div>
                  </form>
                ))}
                {/* Okundu Bilgisi (Mavi Tik) Anahtarı */}
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

          {/* ================= HESAP SEKMESİ İÇERİĞİ ================= */}
          {activeTab === 'account' && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 className="settings-title">Hesap Ayarları</h2>

              {/* Bilgi / Hata Mesajı Bildirimi */}
              {props.settingsMessage.text && (
                <div className={`settings-msg ${props.settingsMessage.type}`} role={props.settingsMessage.type === "error" ? "alert" : "status"}>
                  {props.settingsMessage.text}
                </div>
              )}

              {/* Şifre Güncelleme Formu */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '40px' }}>
                <label className="settings-label" style={{ marginBottom: 0 }}>Şifre Değiştir</label>
                <input
                  type="password"
                  placeholder="Mevcut Şifreniz"
                  value={props.oldPasswordSettings}
                  onChange={(e) => props.setOldPasswordSettings(e.target.value)}
                  className="settings-modern-input"
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  placeholder="Yeni Şifreniz"
                  value={props.newPasswordSettings}
                  onChange={(e) => props.setNewPasswordSettings(e.target.value)}
                  className="settings-modern-input"
                  autoComplete="new-password"
                />
                <button onClick={props.handleUpdatePassword} className="modern-primary-btn" style={{ alignSelf: 'flex-start' }}>Şifreyi Güncelle</button>
              </div>

              <section className="settings-edit-card settings-delete-card">
                <h3 className="settings-edit-label">Hesabı sil</h3>
                <p>Hesabın ve hesabına ait veriler kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
                <button type="button" className="settings-delete-button" disabled={Boolean(pendingAction)}
                  onClick={() => void runAction('delete', props.handleDeleteAccount)}>
                  {pendingAction === 'delete' ? 'İşlem sürüyor…' : 'Hesabımı sil'}
                </button>
              </section>
            </div>
          )}

          {activeTab === 'security' && props.currentUser && (
            <SecurityVaultModal userId={props.currentUser.id} vaultSetup={props.vaultSetup} />
          )}

          {/* ================= ENGELLENENLER SEKMESİ İÇERİĞİ ================= */}
          {activeTab === 'blocked' && (
            <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%' }}>
              <h2 className="settings-title">Engellenen Kullanıcılar</h2>
              <p className="settings-label" style={{ marginBottom: '20px' }}>
                Engellediğiniz kullanıcıların engelini buradan kaldırabilirsiniz. Bu kullanıcılar size mesaj gönderemez veya arayamaz.
              </p>

              {/* Engellenen Kullanıcılar Listesi */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', paddingRight: '5px' }}>
                {isBlockedUsersLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#8696a0', fontSize: '14px' }}>Yükleniyor...</div>
                ) : blockedUsers.length > 0 ? (
                  blockedUsers.map((user) => (
                    <div
                      key={user.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        transition: 'background 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          background: '#f97316',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold',
                          fontSize: '16px',
                          overflow: 'hidden'
                        }}>
                          {user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.username.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-color)' }}>{user.username}</span>
                      </div>
                      <button
                        onClick={() => handleUnblock(user.id)}
                        className="action-btn-outline"
                        style={{
                          padding: '6px 14px',
                          fontSize: '12px',
                          borderRadius: '8px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Engeli Kaldır
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#8696a0', fontSize: '14px', border: '1.5px dashed var(--border-color)', borderRadius: '12px' }}>
                    Engellenen kullanıcı bulunmuyor.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* --- KULLANICI FOTOĞRAFI KIRPMA MODALI --- */}
      {selectedFileForCrop && (
        <ImageCropperModal
          file={selectedFileForCrop}
          onClose={() => setSelectedFileForCrop(null)}
          onCropComplete={async (croppedFile) => {
            setSelectedFileForCrop(null);
            setIsAvatarUploading(true);
            try {
              await props.handleUpdateAvatar(croppedFile);
            } finally {
              setIsAvatarUploading(false);
            }
          }}
        />
      )}

      {/* --- KENDİ AVATARINI BÜYÜK BOYUTTA GÖRÜNTÜLEME MODALI --- */}
      {isAvatarViewerOpen && props.currentUser && (
        <AvatarViewerModal
          avatarUrl={props.currentUser.avatarUrl ?? null}
          username={props.currentUser.username}
          onClose={() => setIsAvatarViewerOpen(false)}
        />
      )}
    </div>
  );
}

