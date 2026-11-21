/**
 * ============================================================================
 * MLS E2EE CİHAZ GÜVENLİĞİ & ŞİFRELİ YEREL KASA YÖNETİM PANELİ
 * (SecurityVaultModal / SecurityVaultPanel)
 * ============================================================================
 *
 * Bu bileşen, Ayarlar ekranı içinde veya bağımsız modal olarak:
 * 1. Mevcut cihazın RFC 9420 MLS güvenlik parmak izini (60 haneli Safety Number),
 * 2. Hesaba bağlı aktif MLS cihazlarını listelemeyi ve şüpheli cihazları iptal etmeyi,
 * 3. Tek kullanımlık KeyPackage havuzunu yenilemeyi,
 * 4. Kullanıcı kontrollü Kurtarma Anahtarı (Recovery Key) ile Sıfır-Bilgi (Zero-Knowledge)
 *    şifreli geçmiş yedeği oluşturmayı (Cloudflare R2) ve yeni cihazda geri yüklemeyi
 * yönetir.
 */

import { useEffect, useState } from 'react';
import { api } from '../../api/httpClient';
import {
  generateRecoveryKey,
  restoreEncryptedHistoryBackup,
  uploadEncryptedHistoryBackup
} from '../../crypto/historyBackup';
import {
  approveMlsDevice,
  deviceApprovalCode,
  ensureDeviceRegistered,
  revokeMlsDevice,
  replenishKeyPackages
} from '../../crypto/mlsClient';
import {
  getStoredDeviceIdentity,
  isVaultUnlocked,
  openDeviceVault,
  unlockVault,
  getStoredRecoveryKeyHint,
  type StoredDeviceIdentity
} from '../../crypto/vault';

interface RegisteredDeviceItem {
  id: string;
  deviceName: string;
  signaturePublicKey: string;
  createdAt: string;
  lastActiveAt: string;
  availableKeyPackageCount?: number;
  approvedAt: string | null;
}

interface SecurityVaultPanelProps {
  userId: string;
  vaultSetup: 'migration' | 'unavailable' | null;
  onBackupRestored?: () => void;
}

export default function SecurityVaultModal({
  userId,
  vaultSetup,
  onBackupRestored
}: SecurityVaultPanelProps) {
  const [identity, setIdentity] = useState<StoredDeviceIdentity | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(() => isVaultUnlocked(userId));
  const [needsPassphrase, setNeedsPassphrase] = useState(vaultSetup === 'migration');
  const [approvalCode, setApprovalCode] = useState('');
  const [localCode, setLocalCode] = useState('');
  const [devices, setDevices] = useState<RegisteredDeviceItem[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryKeyHint, setRecoveryKeyHint] = useState<string | null>(null);
  const [latestBackupMeta, setLatestBackupMeta] = useState<{
    backupVersion: number;
    sizeBytes: number;
    updatedAt: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const loadSecurityState = async () => {
    if (!userId) return;
    setIsLoadingDevices(true);
    try {
      await ensureDeviceRegistered(userId);
      const localIdentity = await getStoredDeviceIdentity(userId);
      setIdentity(localIdentity);
      setLocalCode(localIdentity ? await deviceApprovalCode(localIdentity.signaturePublicKeyBase64) : '');

      const hint = await getStoredRecoveryKeyHint(userId);
      setRecoveryKeyHint(hint);

      const [devicesRes, backupRes] = await Promise.allSettled([
        api.get<{ devices: RegisteredDeviceItem[] }>('/mls/devices'),
        api.get<{
          backup: { backupVersion: number; sizeBytes: number; updatedAt: string } | null;
        }>('/mls/backups/latest')
      ]);

      if (devicesRes.status === 'fulfilled') {
        setDevices(devicesRes.value.data?.devices || []);
      }
      if (backupRes.status === 'fulfilled') {
        setLatestBackupMeta(backupRes.value.data?.backup || null);
      }
    } catch {
      // Sessizce devam et
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    void loadSecurityState();
  }, [userId]);

  const handleGenerateKey = () => {
    const generated = generateRecoveryKey();
    setRecoveryKey(generated);
    setStatusMessage({
      type: 'success',
      text: 'Yeni 160-bit Kurtarma Anahtarı üretildi. Lütfen güvenli bir yere kaydedin.'
    });
  };

  const handleCopyKey = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setStatusMessage({
        type: 'success',
        text: 'Kurtarma Anahtarı panoya kopyalandı.'
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Panoya kopyalanamadı.'
      });
    }
  };

  const handleCreateBackup = async () => {
    if (!recoveryKey.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Yedek oluşturmak için önce bir Kurtarma Anahtarı üretin veya girin.'
      });
      return;
    }
    setIsWorking(true);
    setStatusMessage(null);
    try {
      const res = await uploadEncryptedHistoryBackup(userId, recoveryKey);
      setStatusMessage({
        type: 'success',
        text: `Şifreli geçmiş yedeği (Sürüm #${res.backupVersion}) başarıyla yüklendi (${res.messageCount} mesaj, ${res.conversationCount} sohbet anahtarı).`
      });
      await loadSecurityState();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Şifreli yedek oluşturulurken hata meydana geldi.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!recoveryKey.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Yedeği geri yüklemek için Kurtarma Anahtarınızı girin.'
      });
      return;
    }
    setIsWorking(true);
    setStatusMessage(null);
    try {
      const res = await restoreEncryptedHistoryBackup(userId, recoveryKey);
      setStatusMessage({
        type: 'success',
        text: `Sürüm #${res.backupVersion} yedeği çözüldü: ${res.importedMessages} mesaj ve ${res.importedConversations} sohbet anahtarı yerel kasaya aktarıldı.`
      });
      await loadSecurityState();
      onBackupRestored?.();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Şifreli yedek geri yüklenemedi. Kurtarma anahtarınızı kontrol edin.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!identity) return;
    setIsWorking(true);
    try {
      await revokeMlsDevice(identity, deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      setStatusMessage({
        type: 'success',
        text: 'Cihazın MLS yetkisi ve KeyPackage anahtarları iptal edildi.'
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Cihaz iptal edilemedi.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleReplenishPackages = async () => {
    setIsWorking(true);
    try {
      const count = await replenishKeyPackages(userId, 15);
      setStatusMessage({
        type: 'success',
        text: `KeyPackage havuzu yenilendi (Aktif hazır paket: ${count}).`
      });
      await loadSecurityState();
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'KeyPackage havuzu yenilenemedi.'
      });
    } finally {
      setIsWorking(false);
    }
  };

  const openVault = async () => {
    setIsWorking(true);
    try {
      if (needsPassphrase) await unlockVault(userId, vaultPassphrase);
      else if (!(await openDeviceVault(userId))) {
        setNeedsPassphrase(true);
        return;
      }
      setVaultUnlocked(true);
      window.dispatchEvent(new Event('message-vault-unlocked'));
      setVaultPassphrase('');
      await loadSecurityState();
    } catch {
      setStatusMessage({ type: 'error', text: needsPassphrase
        ? 'Geçiş tamamlanamadı. Önceki kasa parolanızı kontrol edin.'
        : 'Bu tarayıcıda şifreli depolama açılamadı.' });
    } finally {
      setIsWorking(false);
    }
  };

  const handleApproval = async (device: RegisteredDeviceItem) => {
    if (!identity) return;
    setIsWorking(true);
    try {
      await approveMlsDevice(identity, device, approvalCode);
      setApprovalCode('');
      await loadSecurityState();
    } catch {
      setStatusMessage({ type: 'error', text: 'Onay başarısız. Yeni cihazın kodunu kontrol edin.' });
    } finally {
      setIsWorking(false);
    }
  };

  if (!vaultUnlocked) return (
    <div>
      <h2 className="settings-title">{needsPassphrase ? 'Önceki şifreli geçmişi kurtar' : 'Şifreli depolama'}</h2>
      {needsPassphrase ? (
        <>
          <p>Önceki sürümde ayrı parolayla korunan geçmişinizin kurtarılması gerekiyor. Önceki kasa parolasıyla geçiş tamamlandığında mesajlar girişinizle birlikte otomatik açılır.</p>
          <label className="settings-field">
            Önceki kasa parolası
            <input type="password" value={vaultPassphrase} autoComplete="off"
              onChange={(event) => setVaultPassphrase(event.target.value)} />
          </label>
        </>
      ) : <p>Bu tarayıcıda şifreli depolama açılamadı.</p>}
      <button type="button" disabled={isWorking || (needsPassphrase && vaultPassphrase.length < 12)} onClick={() => void openVault()}>
        {needsPassphrase ? 'Şifreli geçmişi taşı' : 'Tekrar dene'}
      </button>
      {statusMessage && <p role="alert">{statusMessage.text}</p>}
    </div>
  );

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <h2 className="settings-title" style={{ marginBottom: '4px' }}>
        Uçtan Uca Şifreleme (MLS) & Şifreli Kasa
      </h2>

      {statusMessage && (
        <div className={`settings-msg ${statusMessage.type}`}>
          {statusMessage.text}
        </div>
      )}

      {/* 1. MEVCUT CİHAZ KİMLİĞİ VE GÜVENLİK PARMAK İZİ */}
      <div
        style={{
          padding: '14px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          background: 'rgba(249, 115, 22, 0.06)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong style={{ fontSize: '14px', color: '#f97316' }}>
            🔒 Bu Cihazın MLS Kimliği (RFC 9420)
          </strong>
          <button
            type="button"
            onClick={handleReplenishPackages}
            disabled={isWorking}
            className="modern-primary-btn"
            style={{ padding: '5px 10px', fontSize: '12px' }}
          >
            KeyPackage Yenile
          </button>
        </div>

        {identity ? (
          <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
            <div>
              <strong>Cihaz:</strong> {identity.deviceName} ({identity.deviceId.slice(0, 8)}...)
            </div>
            <div>
              <strong>CipherSuite:</strong>{' '}
              <code>MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519</code> + <code>AES-256-GCM</code>
            </div>
            <div style={{ marginTop: '6px' }}>
              <strong>Güvenlik Numarası (Safety Fingerprint):</strong>
              <div
                style={{
                  marginTop: '4px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'rgba(0,0,0,0.18)',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                  wordBreak: 'break-all'
                }}
              >
                {identity.safetyFingerprint}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#8696a0' }}>
            Cihaz kriptografik kimliği hazırlanıyor...
          </div>
        )}
      </div>

      {/* 2. SIFIR-BİLGİ (ZERO-KNOWLEDGE) ŞİFRELİ GEÇMİŞ YEDEĞİ */}
      <div
        style={{
          padding: '14px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}
      >
        <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>
          🛡️ Kullanıcı Kontrollü Şifreli Geçmiş Yedeği (Zero-Knowledge)
        </h4>
        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#8696a0', lineHeight: 1.45 }}>
          Mesaj geçmişiniz ve MLS epoch anahtarlarınız, yalnızca sizin bildiğiniz Kurtarma Anahtarı
          ile <code>PBKDF2-SHA256 (600.000 iterasyon)</code> + <code>AES-256-GCM</code> kullanılarak
          tarayıcınızda şifrelenir. Sunucu bu anahtarı asla görmez.
        </p>

        {latestBackupMeta && (
          <div style={{ fontSize: '12px', marginBottom: '8px', color: '#10b981' }}>
            ✓ Buluttaki Son Yedek: Sürüm #{latestBackupMeta.backupVersion} •{' '}
            {(latestBackupMeta.sizeBytes / 1024).toFixed(1)} KB •{' '}
            {new Date(latestBackupMeta.updatedAt).toLocaleString('tr-TR')}
          </div>
        )}
        {recoveryKeyHint && (
          <div style={{ fontSize: '12px', marginBottom: '8px', color: '#8696a0' }}>
            Son kullanılan anahtar ipucu: <code>{recoveryKeyHint}</code>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            className="settings-modern-input"
            style={{ fontFamily: 'monospace', fontSize: '12px' }}
          />
          <button
            type="button"
            onClick={handleGenerateKey}
            disabled={isWorking}
            className="modern-primary-btn"
            style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '8px 12px' }}
          >
            Anahtar Üret
          </button>
          {recoveryKey && (
            <button
              type="button"
              onClick={handleCopyKey}
              className="modern-primary-btn"
              style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '8px 12px' }}
            >
              Kopyala
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={isWorking}
            className="modern-primary-btn"
            style={{ fontSize: '13px' }}
          >
            {isWorking ? 'İşleniyor...' : '☁️ Şifreli Yedek Oluştur / Güncelle'}
          </button>
          <button
            type="button"
            onClick={handleRestoreBackup}
            disabled={isWorking}
            className="modern-primary-btn"
            style={{ fontSize: '13px', background: '#0f766e' }}
          >
            📥 Yedeği Bu Cihaza Geri Yükle
          </button>
        </div>
      </div>

      {/* 3. AKTİF MLS CİHAZLARI LİSTESİ */}
      <div
        style={{
          padding: '14px',
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}
      >
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
          📱 Kayıtlı MLS Cihazları ({devices.length})
        </h4>
        {localCode && <p>Cihaz doğrulama kodu <code>{localCode}</code></p>}
        {devices.some((device) => !device.approvedAt && device.id !== identity?.deviceId) && (
          <label>
            Yeni cihazın ekranındaki kod
            <input value={approvalCode} onChange={(event) => setApprovalCode(event.target.value)} autoComplete="off" />
          </label>
        )}
        {isLoadingDevices ? (
          <div style={{ fontSize: '12px', color: '#8696a0' }}>Cihazlar yükleniyor...</div>
        ) : devices.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#8696a0' }}>Kayıtlı cihaz bulunamadı.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devices.map((dev) => {
              const isCurrent = dev.id === identity?.deviceId;
              return (
                <div
                  key={dev.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <div style={{ fontSize: '12px' }}>
                    <strong>
                      {dev.deviceName} {isCurrent ? '(Bu Cihaz)' : ''} {!dev.approvedAt && 'Onay bekliyor'}
                    </strong>
                    <div style={{ color: '#8696a0', fontSize: '11px' }}>
                      ID: {dev.id.slice(0, 8)}... • Hazır KeyPackage:{' '}
                      {dev.availableKeyPackageCount ?? 0}
                    </div>
                  </div>
                  {!isCurrent && !dev.approvedAt && (
                    <button type="button" disabled={isWorking || !approvalCode} onClick={() => void handleApproval(dev)}>
                      Cihazı onayla
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRevokeDevice(dev.id)}
                      disabled={isWorking}
                      className="danger-action-btn"
                      style={{ padding: '4px 10px', fontSize: '11px' }}
                    >
                      İptal Et
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
