/**
 * ============================================================================
 * FRONTEND VITEST TEST VE KAPSAMA KONFİGÜRASYONU (Frontend Test Suite Config)
 * ============================================================================
 * 
 * Bu dosya, Frontend (React) projesinin birim ve bileşen testlerinin Vitest test
 * koşturucusu (test runner) ve JSDOM sanal tarayıcı ortamında çalışmasını yapılandırır.
 * 
 * MİMARİ SEÇİMLER:
 * 1. environment: 'jsdom' -> Node.js üzerinde gerçek tarayıcı DOM API'lerini (window, document, HTMLElement) taklit eder.
 * 2. provider: 'v8'       -> Node.js dahili V8 motoru ile sıfır ek yükle test kapsama (coverage) raporu üretir.
 * 3. setupFiles           -> Testler başlamadan önce '@testing-library/jest-dom' uzantılarını yükler.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React JSX/TSX bileşenlerini derlemek için Vite React eklentisi
  plugins: [react()],
  test: {
    // Tarayıcı ortamını Node.js içinde simüle eden JSDOM sürücüsü
    environment: 'jsdom',
    
    // Her test dosyasından önce çalıştırılacak kurulum betikleri
    setupFiles: ['./src/test/setup.ts'],
    
    // Çalıştırılacak test dosyası deseni (.test.ts veya .test.tsx)
    include: ['src/**/*.test.{ts,tsx}'],
    
    // Kapsama Raporu (Coverage Configuration)
    coverage: {
      provider: 'v8', // V8 dahili motoru
      reporter: ['text', 'json-summary', 'lcov', 'html'], // Konsol çıktısı, HTML ve LCOV raporları
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/types/**'], // Test ve tip dosyaları hariç tutulur
      
      // Test Kapsama Alt Eşik Sınırları (Quality Gate Thresholds)
      thresholds: {
        statements: 2,
        branches: 1.5,
        functions: 2,
        lines: 2
      }
    }
  }
});
