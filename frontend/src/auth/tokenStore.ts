import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { api, authApi } from '../api/httpClient';

let accessToken: string | null = null;
let refreshPromise: Promise<RefreshResponse> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

// Bu dosya frontend'in oturum merkezidir.
// Access token localStorage/sessionStorage'a yazılmaz; sadece bu modül içindeki bellekte tutulur.
// Refresh token ise frontend JS tarafından okunamaz, backend tarafından HttpOnly cookie olarak yönetilir.
interface RefreshResponse {
  accessToken: string;
  user?: unknown;
}

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const scheduleRefresh = (token: string) => {
  if (refreshTimer) clearTimeout(refreshTimer);
  try {
    // JWT payload'ındaki exp alanını sadece süre hesaplamak için okuyoruz.
    // Burada token doğrulaması yapmıyoruz; gerçek doğrulama her zaman backend'de yapılır.
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: number };
    if (!payload.exp) return;
    // Token süresi dolmadan yaklaşık 1 dakika önce sessiz refresh yapıyoruz.
    // Böylece kullanıcı aktifken 401 görmeden yeni access token alınır.
    const delay = Math.max(1_000, payload.exp * 1000 - Date.now() - 60_000);
    refreshTimer = setTimeout(() => {
      void refreshAccessSession().catch(() => undefined);
    }, delay);
  } catch {
    refreshTimer = null;
  }
};

export const getAccessToken = () => accessToken;

export const setAccessToken = (token: string | null) => {
  // Token değişince eski refresh timer iptal edilir; yeni token varsa yeni timer kurulur.
  // Logout veya refresh hatasında token null olur ve dinleyicilere oturumun bittiği bildirilir.
  accessToken = token;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (token) scheduleRefresh(token);
  tokenListeners.forEach((listener) => listener(token));
};

export const subscribeAccessToken = (listener: (token: string | null) => void) => {
  // App.tsx gibi üst bileşenler token değişimini buradan takip edebilir.
  // Fonksiyon cleanup döndürür; component unmount olunca listener sızıntısı olmaz.
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
};

export const refreshAccessSession = async (): Promise<RefreshResponse> => {
  if (!refreshPromise) {
    // Aynı anda birden fazla API isteği 401 alırsa hepsi ayrı refresh başlatmasın diye promise paylaşılır.
    // Bu, refresh token rotation yapılan sistemlerde çok önemlidir; paralel refresh token reuse gibi görünebilir.
    // Web Locks aynı tarayıcıdaki sekmelerin refresh cookie'yi eş zamanlı döndürmesini engeller.
    const performRefresh = () => authApi.post<RefreshResponse>('/refresh');
    const refreshRequest = navigator.locks
      ? navigator.locks.request('mesajlasma-refresh-token', performRefresh)
      : performRefresh();

    refreshPromise = refreshRequest
      .then((response) => {
        setAccessToken(response.data.accessToken);
        return response.data;
      })
      .catch((error) => {
        // Refresh başarısızsa access token temizlenir ve uygulama login ekranına dönebilmek için global event alır.
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

export const closeRefreshSession = async () => {
  try {
    // Logout backend'deki refresh session'ı iptal eder; finally bloğu frontend belleğini her durumda temizler.
    await authApi.post('/logout');
  } finally {
    setAccessToken(null);
  }
};

export const configureAxiosAuth = () => {
  // Bu fonksiyon uygulama başlarken bir kez çağrılır ve axios interceptor'larını bağlar.
  // Access token kalıcı depoya yazılmaz; her istekte bellekten okunur.
  api.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryableConfig | undefined;
      const path = config?.url || '';
      const isAuthRoute = ['/login', '/register', '/refresh'].some((route) => path.endsWith(route));

      // Auth endpoint'lerinde 401 alınırsa tekrar refresh denemesi yapmıyoruz.
      // Aksi halde login/refresh hataları sonsuz döngüye girebilir.
      if (error.response?.status !== 401 || !config || config._retry || isAuthRoute) {
        throw error;
      }

      config._retry = true;
      // 401 alan normal API isteği için önce access token yenilenir, sonra aynı istek bir kez daha denenir.
      const refreshed = await refreshAccessSession();
      config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
      return api(config);
    }
  );
};
