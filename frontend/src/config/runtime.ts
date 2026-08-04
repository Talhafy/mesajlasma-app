/**
   * Sunucu API kök adresi (Origin).
   * Vite ortam değişkeni (`VITE_API_ORIGIN`) tanımlı ise o kullanılır, aksi halde yerel geliştirme adresi (`http://localhost:3000`) varsayılan alınır.
   * Sonundaki bölü işareti (/) temizlenir.
   */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Frontend uygulamasının HTTP isteklerini göndereceği temel API v1 endpoint adresi.
 * Örneğin: `http://localhost:3000/api/v1`
 */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

