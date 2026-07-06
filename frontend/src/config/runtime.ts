// Vite ortam değişkeni tanımlanmazsa yerel geliştirme adresi kullanılır.
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
export const API_BASE_URL = `${API_ORIGIN}/api`;
