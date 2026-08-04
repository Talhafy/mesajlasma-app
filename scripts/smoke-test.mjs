/**
 * ============================================================================
 * SİSTEM DUMAN TESTİ SCRIPT'İ (Smoke Test Script)
 * ============================================================================
 * 
 * Bu script, canlıya alma (deployment) veya derleme sonrasında
 * API sunucusunun ve Frontend istemcisinin ayakta ve sağlıklı çalışır durumda
 * olup olmadığını hızlıca kontrol eden otomatik bir test aracıdır.
 * 
 * ÇALIŞTIRMA:
 * node scripts/smoke-test.mjs
 */

// API ve Web istemcisi temel URL adresleri (Ortam değişkenlerinden alınır veya varsayılana düşer)
const apiBaseUrl = (process.env.SMOKE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const webBaseUrl = (process.env.SMOKE_WEB_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');

// Yeniden deneme sayısı ve denemeler arası bekleme süresi (Milisaniye)
const attempts = Number(process.env.SMOKE_ATTEMPTS || 30);
const retryDelayMs = Number(process.env.SMOKE_RETRY_DELAY_MS || 1000);

/**
 * Belirtilen milisaniye kadar asenkron bekletme sağlayan yardımcı fonksiyon.
 */
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Sunucu hemen yanıt vermezse (örneğin henüz açılıyorsa) belirlenen deneme sayısı kadar
 * istek atmayı tekrarlayan (retry) asenkron HTTP istemcisi.
 */
const fetchWithRetry = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // 5 saniye zaman aşımı (timeout) ile istek at
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    // Deneme hakkı kaldıysa belirtilen süre kadar bekle
    if (attempt < attempts) await wait(retryDelayMs);
  }
  throw lastError;
};

// 1. ADIM: Backend API Sağlık Endpoint'ini Kontrol Et (`/api/v1/health/ready`)
const healthResponse = await fetchWithRetry(`${apiBaseUrl}/api/v1/health/ready`);
const health = await healthResponse.json();
if (health.status !== 'ready' || !health.timestamp) {
  throw new Error('API health payload is invalid.');
}

// 2. ADIM: Frontend Web Sunucusunu Kontrol Et (HTML içinde `<div id="root">` var mı?)
const webResponse = await fetchWithRetry(webBaseUrl);
const html = await webResponse.text();
if (!html.includes('<div id="root"></div>')) {
  throw new Error('Frontend root document is invalid.');
}

// Test Başarılı Mesajı
process.stdout.write(`Smoke test passed: ${apiBaseUrl} and ${webBaseUrl}\n`);

