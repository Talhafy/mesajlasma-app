/**
 * ============================================================================
 * VİTEST ENTEGRASYON VE BİRİM TEST ORTAM YAPILANDIRMASI (Test Setup Config)
 * ============================================================================
 * 
 * Bu dosya, Vitest test koşucusu (runner) tarafından her test süreci öncesinde
 * çalıştırılarak test ortam değişkenlerini (Environment Variables) varsayılana ayarlar.
 * 
 * YAPILANDIRMA AYARLARI:
 * - NODE_ENV = 'test'           -> Ortamın test olduğunu belirler, bazı middleware'leri baypas eder.
 * - LOG_LEVEL = 'silent'        -> Test çalışırken konsolu kirletmemek için log seviyesini sessize alır.
 * - LOG_FILE_ENABLED = 'false'  -> Test esnasında gereksiz log dosyaları yazılmasını engeller.
 * - SERVICE_NAME = 'mesajlasma-test' -> Test logları için servis adını ayarlar.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_FILE_ENABLED = 'false';
process.env.SERVICE_NAME = 'mesajlasma-test';

