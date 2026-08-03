/**
 * ============================================================================
 * FRONTEND TOKEN VE OTURUM YÖNETİM MERKEZİ (In-Memory Token Store & Interceptors)
 * ============================================================================
 * 
 * Bu dosya, Frontend uygulamasının güvenlik mimarisinin kalbidir.
 * 
 * GÜVENLİK İLKELERİ:
 * 1. In-Memory Storage (Bellekte Saklama):
 *    - JWT Access Token kesinlikle LocalStorage veya SessionStorage'a YAZILMAZ.
 *    - Bunun sebebi XSS (Cross-Site Scripting) zafiyeti durumunda kötü niyetli
 *      scriptlerin LocalStorage'ı okuyabilmesidir. Token yalnızca JS belleğinde saklanır.
 * 2. HttpOnly Refresh Cookie:
 *    - Refresh Token JS tarafından hiç okunamaz; backend tarafından HttpOnly cookie olarak yönetilir.
 * 3. Web Locks API & Eşzamanlı Refresh Engelleme:
 *    - Birden fazla sekme aynı anda açıkken veya paralel API istekleri 401 aldığında
 *      tarayıcı sekme kilitleri (`navigator.locks`) kullanılarak tek bir refresh isteği yapılır.
 * 4. Sessiz Yenileme (Silent Refresh Timer):
 *    - Token süresi dolmadan 1 dakika önce arka planda otomatik yeni token alınır.
 */

import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { api, authApi } from '../api/httpClient';

let accessToken: string | null = null;
let refreshPromise: Promise<RefreshResponse> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

interface RefreshResponse {
  accessToken: string;
  user?: unknown;
}

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/**
 * SESSİZ REFRESH ZAMANLAYICI (Silent Refresh Scheduler)
 * JWT süresi dolmadan 60 saniye önce arka planda yenileme tetikler.
 */
const scheduleRefresh = (token: string) => {
  if (refreshTimer) clearTimeout(refreshTimer);
  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: number };
    if (!payload.exp) return;

    // Token süresi dolmadan 1 dakika önce sessizce yeniliyoruz
    const delay = Math.max(1_000, payload.exp * 1000 - Date.now() - 60_000);
    refreshTimer = setTimeout(() => {
      void refreshAccessSession().catch(() => undefined);
    }, delay);
  } catch {
    refreshTimer = null;
  }
};

/** Bellekteki aktif Access Token'ı döner */
export const getAccessToken = () => accessToken;

/**
 * Bellekteki Access Token'ı günceller, zamanlayıcıyı yeniler ve dinleyen bileşenlere bildirir.
 */
export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (token) scheduleRefresh(token);
  tokenListeners.forEach((listener) => listener(token));
};

/**
 * Access Token değişimlerini takip etmek isteyen React bileşenleri için abonelik mekanizması.
 */
export const subscribeAccessToken = (listener: (token: string | null) => void) => {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
};

/**
 * OTURUM YENİLEME (Refresh Access Session)
 * Web Locks kilit mekanizması ve tekil Promise paylaşımı ile 401 durumlarında oturumu yeniler.
 */
export const refreshAccessSession = async (): Promise<RefreshResponse> => {
  if (!refreshPromise) {
    const performRefresh = () => authApi.post<RefreshResponse>('/refresh');
    // Web Locks API ile tarayıcı sekmeleri arası yarış durumunu (race condition) engelliyoruz
    const refreshRequest = navigator.locks
      ? navigator.locks.request('mesajlasma-refresh-token', performRefresh)
      : performRefresh();

    refreshPromise = refreshRequest
      .then((response) => {
        setAccessToken(response.data.accessToken);
        return response.data;
      })
      .catch((error) => {
        setAccessToken(null);
        window.dispatchEvent(new Event('auth:expired'));
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

/** Oturumu Güvenle Kapatma */
export const closeRefreshSession = async () => {
  try {
    await authApi.post('/logout');
  } finally {
    setAccessToken(null);
  }
};

/**
 * AXIOS AUTHENTICATION INTERCEPTORS
 * Uygulama başlarken Axios istek ve yanıt önleyicilerini bağlar.
 */
export const configureAxiosAuth = () => {
  // Her giden API isteğine 'Authorization: Bearer <token>' başlığını ekler
  api.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  // Gelen yanıt 401 Unauthorized ise otomatik token yenileyip isteği 1 kez tekrar dener
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;
      const path = config?.url || '';
      const isAuthRoute = ['/login', '/register', '/refresh'].some((route) => path.endsWith(route));

      if (error.response?.status !== 401 || !config || config._retry || isAuthRoute) {
        throw error;
      }

      config._retry = true;
      const refreshed = await refreshAccessSession();
      config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
      return api(config);
    }
  );
};
