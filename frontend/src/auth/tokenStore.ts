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

const scheduleRefresh = (token: string) => {
  if (refreshTimer) clearTimeout(refreshTimer);
  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: number };
    if (!payload.exp) return;
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
  accessToken = token;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (token) scheduleRefresh(token);
  tokenListeners.forEach((listener) => listener(token));
};

export const subscribeAccessToken = (listener: (token: string | null) => void) => {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
};

export const refreshAccessSession = async (): Promise<RefreshResponse> => {
  if (!refreshPromise) {
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
    await authApi.post('/logout');
  } finally {
    setAccessToken(null);
  }
};

export const configureAxiosAuth = () => {
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
