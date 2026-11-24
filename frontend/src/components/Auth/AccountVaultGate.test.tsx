import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AccountVaultGate from './AccountVaultGate';

const fillNewPassword = (label: string, password: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Kasa parolasını doğrula'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Devam et' }));
  return (screen.getByLabelText('Yeni kasa kurtarma kodu') as HTMLInputElement).value;
};

it('sets up the vault only after the user has saved a recovery code', async () => {
  const open = vi.fn(async () => {});
  render(<AccountVaultGate mode="setup" open={open} recover={vi.fn()} retry={vi.fn()} logout={vi.fn()} />);

  const password = 'İlk kasa parolası 55';
  const code = fillNewPassword('Kasa parolası', password);
  expect(code).toHaveLength(43);
  expect(screen.getByRole('button', { name: 'Kasayı oluştur' })).toBeDisabled();
  expect(open).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText('Kurtarma kodumu kaydettim.'));
  fireEvent.click(screen.getByRole('button', { name: 'Kasayı oluştur' }));
  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(password, '', code));
});

it('recovers with the saved code and opens the vault with the replacement password', async () => {
  const open = vi.fn(async () => {});
  const recover = vi.fn(async () => {});
  render(<AccountVaultGate mode="unlock" open={open} recover={recover} retry={vi.fn()} logout={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Kasa parolamı unuttum' }));
  const oldCode = 'Eski-kurtarma-kodu';
  const password = 'Yeni kasa parolası 55';
  fireEvent.change(screen.getByLabelText('Kaydettiğin kurtarma kodu'), { target: { value: oldCode } });
  const replacementCode = fillNewPassword('Yeni kasa parolası', password);
  fireEvent.click(screen.getByLabelText('Kurtarma kodumu kaydettim.'));
  fireEvent.click(screen.getByRole('button', { name: 'Kasayı kurtar' }));

  await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(password, ''));
  expect(recover).toHaveBeenCalledExactlyOnceWith(oldCode, password, replacementCode);
});
