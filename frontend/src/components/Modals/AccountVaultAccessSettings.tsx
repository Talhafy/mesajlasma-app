import { useState, type FormEvent } from 'react';
import { generateAccountVaultRecoveryCode, updateVaultAccessFromDevice } from '../../crypto/accountHistory';
import { getTsMlsCiphersuite } from '../../crypto/mlsClient';
import { base64ToBytes, type StoredDeviceIdentity } from '../../crypto/vault';
import VaultRecoveryCode from '../Auth/VaultRecoveryCode';

type Mode = 'password' | 'recovery';

export default function AccountVaultAccessSettings({ identity }: { identity: StoredDeviceIdentity | null }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; text: string }>();

  const selectMode = (nextMode: Mode | null) => {
    setMode(nextMode);
    setPassword('');
    setConfirmation('');
    setCode(nextMode === 'recovery' ? generateAccountVaultRecoveryCode() : '');
    setSaved(false);
    setStatus(undefined);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!identity || !mode || working || (mode === 'recovery' && !saved)) return;
    if (mode === 'password' && password !== confirmation) {
      setStatus({ type: 'error', text: 'Kasa parolaları eşleşmiyor.' });
      return;
    }
    setWorking(true);
    setStatus(undefined);
    let privateKey: Uint8Array | undefined;
    try {
      const suite = await getTsMlsCiphersuite();
      const signer = base64ToBytes(identity.signaturePrivateKeyPkcs8Base64);
      privateKey = signer;
      await updateVaultAccessFromDevice(identity.userId, identity.deviceId, (data) => suite.signature.sign(signer, data),
        mode === 'password' ? { passphrase: password } : { recoveryCode: code });
      selectMode(null);
      setStatus({ type: 'success', text: mode === 'password' ? 'Kasa parolan güncellendi.' : 'Yeni kurtarma kodun etkin.' });
    } catch {
      setStatus({ type: 'error', text: 'Kasa erişimi güncellenemedi. Onaylı bir cihazda kasanı açıp tekrar dene.' });
    } finally {
      privateKey?.fill(0);
      setWorking(false);
    }
  };

  return (
    <details className="security-vault-section" onToggle={(event) => {
      if (!event.currentTarget.open && !working) selectMode(null);
    }}>
      <summary>Kasa erişimi</summary>
      <div className="security-vault-backup">
        {status && <div className={`settings-msg ${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.text}</div>}
        {mode === null ? (
          <div className="security-vault-actions">
            <button className="security-vault-secondary-btn" type="button" disabled={!identity || working} onClick={() => selectMode('password')}>
              Kasa parolasını değiştir
            </button>
            <button className="security-vault-secondary-btn" type="button" disabled={!identity || working} onClick={() => selectMode('recovery')}>
              Kurtarma kodu oluştur
            </button>
          </div>
        ) : (
          <form className="security-vault-backup" onSubmit={save}>
            {mode === 'password' ? (
              <>
                <label className="security-vault-key">Yeni kasa parolası
                  <input className="settings-modern-input" type="password" autoComplete="new-password" required
                    minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={working} />
                </label>
                <label className="security-vault-key">Yeni kasa parolasını doğrula
                  <input className="settings-modern-input" type="password" autoComplete="new-password" required
                    value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={working} />
                </label>
              </>
            ) : (
              <>
                <VaultRecoveryCode code={code} confirmed={saved} onConfirm={setSaved} disabled={working} />
                <p>Yeni kodu kaydettiğinde varsa önceki kodun geçersiz olur.</p>
              </>
            )}
            <div className="security-vault-actions">
              <button className="modern-primary-btn" type="submit" disabled={working || (mode === 'recovery' && !saved)}>
                {working ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
              <button className="security-vault-secondary-btn" type="button" disabled={working} onClick={() => selectMode(null)}>Vazgeç</button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
