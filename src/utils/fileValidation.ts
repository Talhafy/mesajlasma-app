/**
 * ============================================================================
 * DOSYA İMZASI VE MAGIC-BYTE DOĞRULAMA (OWASP ASVS V12.1.2)
 * ============================================================================
 * 
 * Bu yardımcı fonksiyon, yüklenen dosyanın ikili (binary) verisinin ilk 4-12 byte'lık
 * imzasını (Magic Bytes) inceleyerek beyan edilen MIME tipi ile uyuşup uyuşmadığını denetler.
 * 
 * GÜVENLİK AMACI:
 * - Uzantı Sahteciliği (MIME Spoofing) Engelleme: Örneğin `.exe` veya `.php` zararlı bir
 *   yazılımın uzantısı `.png` yapılarak sunucuya gönderilirse, uzantı PNG görünür ancak
 *   binary imzası 'MZ' (4D 5A) veya '<?php' olur. Bu kontrol sahtekarlığı tespit eder.
 */

import { logger } from '../config/logger';

/**
 * Dosya tamponunun (Buffer) ikili imzasını beyan edilen MIME tipi ile karşılaştırır.
 * 
 * @param buffer Dosyanın ikili veri tamponu
 * @param mimeType İstemcinin beyan ettiği MIME türü (ör. 'image/png')
 * @returns true ise imza geçerli, false ise imza sahte/uyumsuz
 */
export const verifyFileSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (!buffer || buffer.length < 4) return false;

  // İlk 4 byte'ı Hexadecimal (Onatılıklı) dizgiye dönüştürüyoruz
  const hex = buffer.toString('hex', 0, 4).toUpperCase();

  switch (mimeType) {
    case 'image/jpeg':
      // JPEG dosyaları her zaman FF D8 FF başlığı ile başlar
      return hex.startsWith('FFD8FF');

    case 'image/png':
      // PNG dosyaları her zaman 89 50 4E 47 (\x89PNG) başlığı ile başlar
      return hex === '89504E47';

    case 'image/gif':
      // GIF dosyaları 47 49 46 38 (GIF8) başlığı ile başlar
      return hex === '47494638';

    case 'image/webp':
      // WebP dosyaları RIFF (52 49 46 46) ve WEBP (57 45 42 50) başlıkları taşır
      if (buffer.length < 12) return false;
      const riff = buffer.toString('hex', 0, 4).toUpperCase();
      const webp = buffer.toString('hex', 8, 12).toUpperCase();
      return riff === '52494646' && webp === '57454250';

    case 'application/pdf':
      // PDF dosyaları %PDF (25 50 44 46) başlığı ile başlar
      return hex === '25504446';

    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': // .docx
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': // .xlsx
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': // .pptx
      // ZIP ve Modern Office XML arşivleri PK (50 4B 03 04) başlığı ile başlar
      return hex === '504B0304';

    case 'application/msword': // .doc
      // Eski binary Word formatı D0 CF 11 E0 başlığı ile başlar
      return hex === 'D0CF11E0';

    case 'audio/mpeg':
      // MP3 ID3v2 etiket başlığı (49 44 33) veya Frame Sync (FFF)
      return hex.startsWith('494433') || hex.startsWith('FFF');

    case 'audio/wav':
      // WAV dosyaları RIFF (52 49 46 46) ve WAVE (57 41 56 45) başlıkları taşır
      if (buffer.length < 12) return false;
      const wavRiff = buffer.toString('hex', 0, 4).toUpperCase();
      const wave = buffer.toString('hex', 8, 12).toUpperCase();
      return wavRiff === '52494646' && wave === '57415645';

    case 'text/plain':
      // Düz metin dosyalarında çalıştırılabilir ikili (binary) kontrol karakterleri bulunmamalıdır
      for (let i = 0; i < Math.min(buffer.length, 512); i++) {
        const code = buffer[i];
        // 9 (TAB), 10 (LF), 13 (CR) dışındaki kontrol karakterleri metin değil ikili veridir
        if (code < 9 || (code > 13 && code < 32)) {
          return false;
        }
      }
      return true;

    default:
      return true;
  }
};
