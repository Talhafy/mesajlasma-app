import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // YENİ EKLENEN KISIM: Vite'a sorunlu paketleri (özellikle React hook'larını) 
  // çift kopya oluşturmadan tek bir merkezden kullanmasını zorunlu kılıyoruz.
  optimizeDeps: {
    include: ['emoji-picker-react'],
    force: true // Her başlatmada bu paketi yeniden optimize et
  },
  resolve: {
    // React'in birden fazla kopyasının çalışmasını (Invalid Hook Call) engellemek 
    // için projedeki tek, gerçek React versiyonunu işaret ediyoruz.
    dedupe: ['react', 'react-dom'] 
  }
})