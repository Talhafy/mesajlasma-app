import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/httpClient';
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
  restoreEncryptedHistoryBackup,
  uploadEncryptedHistoryBackup
} from '../../crypto/historyBackup';
import { revokeMlsDevice } from '../../crypto/mlsClient';
import {
  getStoredDeviceIdentity,
  isVaultUnlocked,
  openDeviceVault,
  unlockVault,
  type StoredDeviceIdentity
} from '../../crypto/vault';
import './Modals.css';
import AccountVaultAccessSettings from './AccountVaultAccessSettings';

interface RegisteredDevice {
  id: string;
  deviceName: string;
  approvedAt: string | null;
}

interface SecurityVaultPanelProps {
  userId: string;
  vaultSetup: 'migration' | 'unavailable' | null;
  onBackupRestored?: () => void;
}

type StatusMessage = { type: 'success' | 'error'; text: string };
type BackupAction = 'create' | 'restore';

export default function SecurityVaultModal({
  userId,
  vaultSetup,
  onBackupRestored
}: SecurityVaultPanelProps) {
  const [identity, setIdentity] = useState<StoredDeviceIdentity | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(() => !vaultSetup && isVaultUnlocked(userId));
  const [needsPassphrase, setNeedsPassphrase] = useState(vaultSetup === 'migration');
  const [devices, setDevices] = useState<RegisteredDevice[] | null>(null);
  const [latestBackupAt, setLatestBackupAt] = useState<string | null>();
  const [backupLoadFailed, setBackupLoadFailed] = useState(false);
  const [backupAction, setBackupAction] = useState<BackupAction | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [backupMessage, setBackupMessage] = useState<StatusMessage | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    if (!vaultUnlocked || !userId) return;
    const controller = new AbortController();
    const { signal } = controller;

    void Promise.all([
      getStoredDeviceIdentity(userId),
      api.get<{ devices: RegisteredDevice[] }>('/mls/devices', { signal })
    ]).then(([localIdentity, { data }]) => {
      if (signal.aborted) return;
      setIdentity(localIdentity);
      setDevices(data.devices);
    }).catch(() => {
      if (signal.aborted) return;
      setStatusMessage({ type: 'error', text: 'Bağlı cihazlar yüklenemedi.' });
    });

    void api.get<{ backup: { updatedAt: string } | null }>('/mls/backups/latest', { signal })
      .then(({ data }) => {
        if (!signal.aborted) setLatestBackupAt(data.backup?.updatedAt ?? null);
      })
      .catch(() => {
        if (!signal.aborted) setBackupLoadFailed(true);
      });

    return () => controller.abort();
  }, [userId, vaultUnlocked]);

  const openVault = async () => {
    setStatusMessage(null);
    setIsWorking(true);
    try {
      if (needsPassphrase) await unlockVault(userId, vaultPassphrase);
      else if (!(await openDeviceVault(userId))) {
        setNeedsPassphrase(true);
        return;
      }
      setVaultUnlocked(true);
      setVaultPassphrase('');
      window.dispatchEvent(new Event('message-vault-unlocked'));
    } catch {
      setStatusMessage({
        type: 'error',
        text: needsPassphrase
          ? 'Geçiş tamamlanamadı. Önceki kasa parolanı kontrol et.'
          : 'Bu tarayıcıda şifreli kasa açılamadı.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!identity || isWorking) return;
    setStatusMessage(null);
    setIsWorking(true);
    try {
      await revokeMlsDevice(identity, deviceId);
      setDevices((current) => current?.filter((device) => device.id !== deviceId) ?? null);
      setStatusMessage({ type: 'success', text: 'Cihazın erişimi kaldırıldı.' });
    } catch {
      setStatusMessage({ type: 'error', text: 'Cihazın erişimi kaldırılamadı. Tekrar dene.' });
    } finally {
      setIsWorking(false);
    }
  };

  const selectBackupAction = (action: BackupAction | null) => {
    setRecoveryKey('');
    setBackupMessage(null);
    setBackupAction(action);
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setBackupMessage({ type: 'success', text: 'Kurtarma anahtarı kopyalandı.' });
    } catch {
      setBackupMessage({ type: 'error', text: 'Anahtar kopyalanamadı. Anahtarı seçip kopyalayabilirsin.' });
    }
  };

  const handleBackup = async (event: FormEvent) => {
    event.preventDefault();
    if (!backupAction || isWorking) return;
    if (normalizeRecoveryKey(recoveryKey).length < 16) {
      setBackupMessage({ type: 'error', text: 'Kurtarma anahtarının tamamını gir.' });
      return;
    }

    setBackupMessage(null);
    setIsWorking(true);
    try {
      if (backupAction === 'create') {
        const backup = await uploadEncryptedHistoryBackup(userId, recoveryKey);
        setLatestBackupAt(backup.updatedAt);
        setBackupLoadFailed(false);
        setBackupMessage({ type: 'success', text: 'Şifreli yedek kaydedildi.' });
      } else {
        await restoreEncryptedHistoryBackup(userId, recoveryKey);
        setBackupMessage({ type: 'success', text: 'Yedek bu cihaza geri yüklendi.' });
        window.dispatchEvent(new Event('message-vault-unlocked'));
        onBackupRestored?.();
      }
      setRecoveryKey('');
      setBackupAction(null);
    } catch {
      setBackupMessage({
        type: 'error',
        text: backupAction === 'create'
          ? 'Yedek kaydedilemedi. Biraz sonra tekrar dene.'
          : 'Yedek geri yüklenemedi. Kurtarma anahtarını kontrol edip tekrar dene.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  if (!vaultUnlocked) return (
    <div>
      <h2 className="settings-title">{needsPassphrase ? 'Önceki şifreli geçmişi kurtar' : 'Şifreli kasa'}</h2>
      {needsPassphrase ? (
        <>
          <p>Önceki sürümde ayrı parolayla korunan geçmişini taşımak için eski kasa parolanı gir.</p>
          <label className="settings-field">
            Önceki kasa parolası
            <input type="password" value={vaultPassphrase} autoComplete="off"
              onChange={(event) => setVaultPassphrase(event.target.value)} />
          </label>
        </>
      ) : <p>{window.isSecureContext
        ? 'Tarayıcı mesaj kasasını açamadı. Site depolamasına izin verildiğini kontrol et.'
        : 'Mesajlarına erişmek için uygulamayı güvenli bağlantı üzerinden aç.'}</p>}
      <button type="button" disabled={isWorking || (needsPassphrase && !vaultPassphrase)} onClick={() => void openVault()}>
        {needsPassphrase ? 'Şifreli geçmişi taşı' : 'Tekrar dene'}
      </button>
      {statusMessage && <p role="alert">{statusMessage.text}</p>}
    </div>
  );

  return (
    <div className="security-vault-panel">
      <div>
        <h2 className="settings-title">Şifreli kasa</h2>
        <p>Yeni bir cihazda mesajlarını açmak için giriş yaptıktan sonra kasa parolanı gir.</p>
      </div>

      <section className="security-vault-section">
        <h3>Bağlı cihazlar</h3>
        {statusMessage && (
          <div className={`settings-msg ${statusMessage.type}`} role={statusMessage.type === 'error' ? 'alert' : 'status'}>
            {statusMessage.text}
          </div>
        )}
        {devices === null ? (
          !statusMessage && <p role="status">Cihazlar yükleniyor…</p>
        ) : devices.length === 0 ? (
          <p>Bağlı cihaz bulunamadı.</p>
        ) : (
          <ul className="security-vault-devices">
            {devices.map((device) => {
              const isCurrent = device.id === identity?.deviceId;
              return (
                <li key={device.id}>
                  <div>
                    <strong>{device.deviceName}</strong>
                    {isCurrent && <div>Bu cihaz</div>}
                    {!device.approvedAt && <div>Onay bekliyor</div>}
                  </div>
                  {identity && !isCurrent && (
                    <button
                      type="button"
                      className="danger-action-btn"
                      aria-label={`${device.deviceName} cihazının erişimini kaldır`}
                      onClick={() => void handleRevokeDevice(device.id)}
                      disabled={isWorking}
                    >
                      Erişimi kaldır
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AccountVaultAccessSettings identity={identity} />

      <details className="security-vault-section">
        <summary>Yedekten kurtar</summary>
        <div className="security-vault-backup">
          {latestBackupAt && (
            <p>Son yedek <time dateTime={latestBackupAt}>{new Date(latestBackupAt).toLocaleString('tr-TR')}</time></p>
          )}
          {latestBackupAt === null && <p>Henüz elle oluşturulmuş bir yedeğin yok.</p>}
          {backupLoadFailed && <p role="status">Yedek bilgisi alınamadı.</p>}
          {latestBackupAt === undefined && !backupLoadFailed && <p role="status">Yedek bilgisi yükleniyor…</p>}

          {backupMessage && (
            <div className={`settings-msg ${backupMessage.type}`} role={backupMessage.type === 'error' ? 'alert' : 'status'}>
              {backupMessage.text}
            </div>
          )}
          {backupAction === null ? (
            <div className="security-vault-actions">
              {(latestBackupAt || backupLoadFailed) && (
                <button type="button" className="modern-primary-btn" disabled={isWorking}
                  onClick={() => selectBackupAction('restore')}>
                  Yedeği geri yükle
                </button>
              )}
              {(latestBackupAt !== undefined || backupLoadFailed) && (
                <button type="button" className="security-vault-secondary-btn" disabled={isWorking}
                  onClick={() => selectBackupAction('create')}>
                  {latestBackupAt ? 'Yedeği güncelle' : 'Yedek oluştur'}
                </button>
              )}
            </div>
          ) : (
            <form className="security-vault-backup" onSubmit={(event) => void handleBackup(event)}>
              <p>{backupAction === 'create'
                ? 'Bu cihazda açabildiğin mesajları yedekle. Yedeği ileride açabilmek için kurtarma anahtarını sakla.'
                : 'Yedeği oluştururken kullandığın kurtarma anahtarını gir.'}</p>
              <label className="security-vault-key">
                Kurtarma anahtarı
                <input
                  type={backupAction === 'create' ? 'text' : 'password'}
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  className="settings-modern-input"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isWorking}
                  required
                />
              </label>
              {backupAction === 'create' && (
                <div className="security-vault-actions">
                  <button type="button" className="security-vault-secondary-btn" disabled={isWorking}
                    onClick={() => {
                      setRecoveryKey(generateRecoveryKey());
                      setBackupMessage(null);
                    }}>
                    Yeni anahtar oluştur
                  </button>
                  {recoveryKey && (
                    <button type="button" className="security-vault-secondary-btn" disabled={isWorking}
                      onClick={() => void handleCopyKey()}>
                      Anahtarı kopyala
                    </button>
                  )}
                </div>
              )}
              <div className="security-vault-actions">
                <button type="submit" className="modern-primary-btn" disabled={isWorking || !recoveryKey.trim()}>
                  {isWorking ? 'İşleniyor…' : backupAction === 'create' ? 'Yedeği kaydet' : 'Geri yükle'}
                </button>
                <button type="button" className="security-vault-secondary-btn" disabled={isWorking}
                  onClick={() => selectBackupAction(null)}>
                  Vazgeç
                </button>
              </div>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}
