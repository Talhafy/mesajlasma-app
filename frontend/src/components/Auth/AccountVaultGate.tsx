import { useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { generateAccountVaultRecoveryCode } from '../../crypto/accountHistory';
import VaultRecoveryCode from './VaultRecoveryCode';

type Props = {
  mode: 'setup' | 'migrate' | 'unlock' | 'unavailable';
  open: (passphrase: string, legacyPassword: string, recoveryCode?: string) => Promise<void>;
  recover: (oldCode: string, passphrase: string, newCode: string) => Promise<void>;
  retry: () => void;
  logout: () => void;
};

const vaultErrorMessage = (error: unknown) => {
  if (!isAxiosError<{ code?: string }>(error)) {
    return error instanceof Error ? error.message : 'Kasa açılamadı.';
  }
  const response = error.response;
  if (response?.status === 429) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  if (response?.status === 401) return 'Oturumun sona erdi. Yeniden giriş yap.';
  if (response?.status === 403) return 'Tarayıcı onaylanamadı. Yeniden giriş yapıp kasanı aç.';
  if (response?.status === 409) return 'Kasa bilgileri değişti. Güncel parolan veya kurtarma kodunla tekrar dene.';
  return 'Kasa işlemi tamamlanamadı. Biraz sonra tekrar dene.';
};

export default function AccountVaultGate({ mode, open, recover, retry, logout }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [legacyPassword, setLegacyPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [oldCode, setOldCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const settingUp = mode === 'setup' || mode === 'migrate';
  const creatingPassword = settingUp || recovering;

  const switchRecovery = (enabled: boolean) => {
    setPassphrase('');
    setConfirmation('');
    setOldCode('');
    setNewCode('');
    setConfirmed(false);
    setError('');
    setRecovering(enabled);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    if (creatingPassword && passphrase !== confirmation) {
      setError('Kasa parolaları eşleşmiyor.');
      return;
    }
    setError('');
    if (creatingPassword && !newCode) {
      setNewCode(generateAccountVaultRecoveryCode());
      return;
    }
    if (creatingPassword && !confirmed) return;

    setWorking(true);
    try {
      if (recovering) {
        await recover(oldCode, passphrase, newCode);
        switchRecovery(false);
        await open(passphrase, '');
      } else {
        await open(passphrase, legacyPassword, newCode || undefined);
      }
    } catch (failure) {
      setError(vaultErrorMessage(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="settings-overlay">
      <section className="settings-modal account-vault-gate">
        <h2>{recovering ? 'Mesaj kasanı kurtar' : settingUp ? 'Mesaj kasanı oluştur' : 'Mesaj kasanı aç'}</h2>
        {mode === 'unavailable' ? (
          <>
            <p role="alert">Kasa bilgileri alınamadı.</p>
            <button type="button" onClick={retry}>Tekrar dene</button>
          </>
        ) : (
          <form onSubmit={submit} className="security-vault-backup">
            {recovering ? (
              <p>Başka bir cihazında kasan açıksa <strong>Ayarlar → Şifreli kasa → Kasa erişimi</strong> bölümünden parolanı değiştir. Kurtarma kodun varsa aşağıdan devam et.</p>
            ) : (
              <p>{settingUp ? 'Hesap parolandan farklı, en az 12 karakterli bir kasa parolası oluştur.' :
                'Sohbetlerini açmak için kasa parolanı gir.'}</p>
            )}
            {recovering && (
              <label className="security-vault-key">Kaydettiğin kurtarma kodu
                <input className="settings-modern-input" type="password" value={oldCode} onChange={(event) => setOldCode(event.target.value)}
                  autoComplete="off" spellCheck={false} maxLength={64} required disabled={working} />
              </label>
            )}
            {mode === 'migrate' && <label className="settings-field">Geçiş için mevcut hesap parolası
              <input type="password" value={legacyPassword} onChange={(event) => setLegacyPassword(event.target.value)} required />
            </label>}
            <label className="security-vault-key">{recovering ? 'Yeni kasa parolası' : 'Kasa parolası'}
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required autoFocus
                className="settings-modern-input" disabled={working}
                minLength={creatingPassword ? 12 : undefined} maxLength={256} autoComplete={creatingPassword ? 'new-password' : 'off'} />
            </label>
            {creatingPassword && <label className="security-vault-key">Kasa parolasını doğrula
              <input className="settings-modern-input" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                required autoComplete="new-password" disabled={working} />
            </label>}
            {creatingPassword && newCode && <VaultRecoveryCode code={newCode} confirmed={confirmed} onConfirm={setConfirmed} disabled={working} />}
            {recovering && newCode && <p>Kurtarma bitince yeni kodun etkinleşir ve önceki kodun geçersiz olur.</p>}
            {error && <p role="alert">{error}</p>}
            <button className="modern-primary-btn" type="submit" disabled={working || Boolean(creatingPassword && newCode && !confirmed)}>
              {working ? 'Hazırlanıyor…' : creatingPassword && !newCode ? 'Devam et' : recovering ? 'Kasayı kurtar' :
                settingUp ? 'Kasayı oluştur' : 'Kasayı aç'}
            </button>
          </form>
        )}
        {mode === 'unlock' && <button className="security-vault-secondary-btn" type="button" disabled={working}
          onClick={() => switchRecovery(!recovering)}>
          {recovering ? 'Kasa parolasına dön' : 'Kasa parolamı unuttum'}
        </button>}
        <button type="button" onClick={logout} style={{ marginTop: 12 }}>Çıkış yap</button>
      </section>
    </main>
  );
}
