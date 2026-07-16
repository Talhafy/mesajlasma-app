import React, { useState } from 'react';
import { api } from '../../api/httpClient';
import './Auth.css';
import type { User } from '../../types/chat';

interface AuthProps {
  onLoginSuccess: (token: string, user: User) => void;
}

export default function Auth({ onLoginSuccess }: AuthProps) {
  const [currentView, setCurrentView] = useState<'login' | 'register'>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // UI states
  const [hataMesaji, setHataMesaji] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setHataMesaji('');
    if (password !== confirmPassword) {
      return setHataMesaji('Şifreler birbiriyle eşleşmiyor!');
    }
    
    setIsLoading(true);
    try {
      await api.post('/register', { username, email, password });
      alert('Kayıt başarılı! Lütfen giriş yapın.');
      setCurrentView('login');
      setPassword('');
      setConfirmPassword('');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; details?: Array<{ message: string }> } } };
      const serverError = err.response?.data;
      if (serverError?.details && Array.isArray(serverError.details)) {
        const detailMsg = serverError.details.map((d: { message: string }) => d.message).join(' ');
        setHataMesaji(detailMsg);
      } else {
        setHataMesaji(serverError?.error || 'Kayıt başarısız.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setHataMesaji('');
    setIsLoading(true);
    try {
      const response = await api.post('/login', { identifier, password });
      const { accessToken, user } = response.data;
      onLoginSuccess(accessToken, user);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; details?: Array<{ message: string }> } } };
      const serverError = err.response?.data;
      if (serverError?.details && Array.isArray(serverError.details)) {
        const detailMsg = serverError.details.map((d: { message: string }) => d.message).join(' ');
        setHataMesaji(detailMsg);
      } else {
        setHataMesaji(serverError?.error || 'Giriş başarısız. Bilgilerinizi kontrol edin.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSsoClick = (provider: string) => {
    alert(`${provider} ile giriş özelliği şu anda demo aşamasındadır.`);
  };

  const isLogin = currentView === 'login';

  return (
    <div className="auth-page">
      {/* SOL PANEL (TANITIM ALANI) */}
      <div className="auth-left-panel">
        <div className="brand-header">
          <div className="brand-logo-container">
            <svg className="brand-logo-svg" viewBox="0 0 100 100" width="56" height="56">
              <defs>
                {/* Fractal noise displacement filter to deform straight lines into highly organic, jagged lightning bolts */}
                <filter id="lightning-fractal" x="-30%" y="-30%" width="160%" height="160%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>

              {/* Multiple cascading lightning bolts deformed by the fractal noise */}
              <g filter="url(#lightning-fractal)" strokeLinecap="round" strokeLinejoin="round">
                {/* 4 parallel jagged lightning paths descending from the cloud base */}
                <path className="old-lightning-hair" d="M26 35 L18 52 L28 68 L16 88" fill="none" strokeWidth="2.2" />
                <path className="old-lightning-hair" d="M42 35 L38 52 L48 68 L36 88" fill="none" strokeWidth="2.2" />
                <path className="old-lightning-hair" d="M58 35 L62 52 L54 68 L64 88" fill="none" strokeWidth="2.2" />
                <path className="old-lightning-hair" d="M74 35 L82 52 L72 68 L80 88" fill="none" strokeWidth="2.2" />
              </g>

              {/* Cloud shape with a WhatsApp-style message bubble tail (flashes on strike) */}
              <path className="brand-cloud" d="M20 32 C 20 20, 35 15, 50 20 C 65 15, 80 20, 80 32 C 92 32, 95 42, 85 49 C 75 53, 35 53, 28 52 L 12 65 C 12 65, 18 57, 18 49 C 5 42, 8 32, 20 32 Z" />

              {/* Smiling face elements inside/emerging from the cloud */}
              <circle className="discord-face-element" cx="38" cy="30" r="3" fill="#ffffff" />
              <circle className="discord-face-element" cx="62" cy="30" r="3" fill="#ffffff" />
              <path className="discord-face-element" d="M42 37 Q50 43 58 37" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <span>Thunder</span>
        </div>

        <div className="brand-body">
          <h1>Güvenli İletişimin <span>En Hızlı</span> Hali</h1>
          <p>Arkadaşlarınızla, iş ortaklarınızla veya sevdiklerinizle tamamen gerçek zamanlı, uçtan uca şifrelenmiş ve güçlü araçlarla donatılmış Thunder dünyasında buluşun.</p>
        </div>

        <div className="brand-footer">
          &copy; {new Date().getFullYear()} Thunder.app. Tüm hakları saklıdır.
        </div>
        
        {/* Dekoratif Premium Arka Plan Şekilleri */}
        <div className="brand-graphics">
          <div className="circle-shape-1" />
          <div className="circle-shape-2" />
          <div className="geometric-grid" />
        </div>
      </div>

      {/* SAĞ PANEL (FORM ALANI) */}
      <div className="auth-right-panel">
        <div className="auth-card">
          <div className="auth-header">
            <h2>{isLogin ? 'Tekrar Hoş Geldiniz' : 'Hesap Oluşturun'}</h2>
            <p>{isLogin ? 'Lütfen bilgilerinizi girerek oturum açın.' : 'Aramıza katılmak için formu doldurun.'}</p>
          </div>

          {/* MOCK SSO BUTTONS */}
          <div className="sso-buttons-container">
            <button type="button" className="sso-btn" onClick={() => handleSsoClick('Google')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              Google
            </button>
            <button type="button" className="sso-btn" onClick={() => handleSsoClick('Apple')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C3.83 16.37 3.51 9.94 7.03 9.47c1.39-.19 2.37.5 3.12.5.76 0 2.06-.69 3.65-.5 1.66.19 2.87.88 3.53 1.94-3.44 2.06-2.91 6.84.47 8.2a7.1 7.1 0 0 1-1.07 1.94M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.54-3.74 4.25z"/>
              </svg>
              Apple
            </button>
          </div>

          <div className="auth-divider">
            <span>veya e-posta ile devam edin</span>
          </div>

          {hataMesaji && (
            <div className="error-alert">
              <svg className="error-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{hataMesaji}</span>
            </div>
          )}

          <form onSubmit={isLogin ? handleLogin : handleRegister} className="auth-form-new">
            {!isLogin ? (
              <>
                {/* KAYIT OL INPUTLARI */}
                <div className="input-group">
                  <label htmlFor="reg-username">Kullanıcı Adı</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <input
                      id="reg-username"
                      type="text"
                      className="auth-input-new"
                      placeholder="Kullanıcı adınızı seçin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="reg-email">E-posta</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    <input
                      id="reg-email"
                      type="email"
                      className="auth-input-new"
                      placeholder="E-posta adresinizi girin"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="reg-password">Şifre</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      className="auth-input-new"
                      placeholder="Güçlü bir şifre belirleyin"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="reg-confirm-password">Şifre Tekrar</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <input
                      id="reg-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      className="auth-input-new"
                      placeholder="Şifrenizi tekrar yazın"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* GİRİŞ YAP INPUTLARI */}
                <div className="input-group">
                  <label htmlFor="login-id">E-posta veya Kullanıcı Adı</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <input
                      id="login-id"
                      type="text"
                      className="auth-input-new"
                      placeholder="E-posta veya kullanıcı adı girin"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="login-password">Şifre</label>
                  <div className="input-wrapper">
                    <svg className="input-icon-left" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      className="auth-input-new"
                      placeholder="Şifrenizi girin"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            <button type="submit" className="submit-btn-new" disabled={isLoading}>
              {isLoading && <span className="spinner-new" />}
              <span>{isLogin ? 'Giriş Yap' : 'Kayıt Ol'}</span>
            </button>

            <div className="auth-switch-text">
              {isLogin ? 'Hesabınız yok mu?' : 'Zaten üye misiniz?'}
              <span
                className="auth-switch-link"
                onClick={() => {
                  setCurrentView(isLogin ? 'register' : 'login');
                  setHataMesaji('');
                  setPassword('');
                  setConfirmPassword('');
                }}
              >
                {isLogin ? 'Kayıt Olun' : 'Giriş Yapın'}
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
