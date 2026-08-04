/**
 * Uygulamanın Başlangıç (Giriş) Noktası (main.tsx)
 * 
 * Bu dosya, tüm uygulamanın web tarayıcısında çalışmaya başladığı ilk yerdir.
 * HTML sayfasındaki `<div id="root"></div>` alanına React uygulamasını bağlar ve ekrana çizer (render eder).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Uygulamanın genel CSS görsel stilleri
import './index.css';

// Uygulamanın ana bileşeni (Tüm sayfaları ve sohbet ekranını içeren ana yapı)
import App from './App.tsx';

// HTTP istekleri (API) için güvenlik ve jeton (token) ayarları
import { configureAxiosAuth } from './auth/tokenStore.ts';

// Kullanıcıya "Emin misiniz?" onay kutularını gösteren sağlayıcı (Provider)
import { ConfirmProvider } from './context/ConfirmContext.tsx';

/**
 * 1. Adım: API Güvenlik Yapılandırması
 * Uygulama ekrana çizilmeden önce Axios HTTP kütüphanesine oturum doğrulama kurallarını ekler.
 * Bu sayede yapılan ilk sunucu isteğinde bile kullanıcının oturum bilgisi güvenle gönderilir.
 */
configureAxiosAuth();

/**
 * 2. Adım: React Uygulamasını HTML Sayfasına Bağlama ve Ekrana Çizme
 * index.html içindeki "root" id'li div elemanını bulur ve React uygulamasını onun içine yerleştirir.
 */
createRoot(document.getElementById('root')!).render(
  // StrictMode: Geliştirme aşamasında potansiyel kod hatalarını yakalamak için ekstra kontroller yapar.
  <StrictMode>
    {/* ConfirmProvider: Tüm uygulama genelinde açılabilen onay penceresi (Modal) desteği sağlar */}
    <ConfirmProvider>
      {/* Ana Uygulama Bileşeni */}
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
