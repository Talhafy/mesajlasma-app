import React, { useState } from 'react';
import { api } from '../../api/httpClient';
import './Auth.css';
import Button from '../UI/Button';

interface AuthProps {
  // Giriş başarılı olduğunda App.tsx'e haber verecek fonksiyon
  onLoginSuccess: (token: string, user: any) => void;
}

export default function Auth({ onLoginSuccess }: AuthProps) {
  const [currentView, setCurrentView] = useState<'login' | 'register'>('login');

  // Sadece bu ekrana özel State'ler
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [hataMesaji, setHataMesaji] = useState("");
  const [identifier, setIdentifier] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setHataMesaji("");
    if (password !== confirmPassword) return setHataMesaji("Şifreler birbiriyle eşleşmiyor!");
    try {
      await api.post('/register', { username, email, password });
      alert("Kayıt başarılı! Lütfen giriş yap.");
      setCurrentView('login');
      setPassword(""); setConfirmPassword("");
    } catch (error: any) { setHataMesaji(error.response?.data?.error || "Kayıt başarısız."); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setHataMesaji("");
    try {
      const response = await api.post('/login', { identifier, password });
      const { accessToken, user } = response.data;
      // Giriş başarılıysa App.tsx'e verileri gönderiyoruz
      onLoginSuccess(accessToken, user);
    } catch (error: any) { setHataMesaji(error.response?.data?.error || "Kullanıcı bilgileri hatalı."); }
  };

  const isLogin = currentView === 'login';

  return (
    <div className="auth-wrapper">
      <div className="auth-container">
        <form className="auth-form" onSubmit={isLogin ? handleLogin : handleRegister}>
          <h2>{isLogin ? 'Giriş Yap' : 'Kayıt Ol'}</h2>
          {hataMesaji && <div className="hata-mesaji">{hataMesaji}</div>}
          {!isLogin && (
            <>
              <input type="text" placeholder="Kullanıcı Adı" value={username} onChange={(e) => setUsername(e.target.value)} required />
              <input type="email" placeholder="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input type="password" placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <input type="password" placeholder="Şifrenizi Tekrar Girin" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </>
          )}
          {isLogin && (
            <>
              <input type="text" placeholder="E-posta veya Kullanıcı Adı" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
              <input type="password" placeholder="Şifre" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          )}
        <Button
            type="submit"
            text={isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
              fullWidth={true}
                />
          <p onClick={() => { setCurrentView(isLogin ? 'register' : 'login'); setHataMesaji(""); setPassword(""); setConfirmPassword(""); }}>
            {isLogin ? 'Hesabın yok mu? Kayıt Ol' : 'Zaten hesabın var mı? Giriş Yap'}
          </p>
        </form>
      </div>
    </div>
  );
}
