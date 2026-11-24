type Props = {
  code: string;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  disabled: boolean;
};

export default function VaultRecoveryCode({ code, confirmed, onConfirm, disabled }: Props) {
  const downloadCode = () => {
    const url = URL.createObjectURL(new Blob([code + '\n'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mesaj-kasasi-kurtarma-kodu.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="security-vault-backup">
      <p>Kasa parolanı unutursan bu kodla mesajlarına yeniden erişebilirsin. Güvenli bir yerde sakla.</p>
      <label className="security-vault-key">
        Yeni kasa kurtarma kodu
        <input className="settings-modern-input" readOnly value={code} onFocus={(event) => event.target.select()} />
      </label>
      <div className="security-vault-actions">
        <button className="security-vault-secondary-btn" type="button" onClick={downloadCode} disabled={disabled}>Kodu indir</button>
      </div>
      <label>
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} disabled={disabled} required />
        {' '}Kurtarma kodumu kaydettim.
      </label>
    </div>
  );
}
