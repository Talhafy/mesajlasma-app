import { logger } from '../config/logger';

/**
 * Dosyanın ilk 4-12 byte'lık imzasını (magic bytes) kontrol ederek 
 * sahte MIME tipi (MIME spoofing) ve stored XSS saldırılarını engeller.
 */
export const verifyFileSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (!buffer || buffer.length < 4) return false;

  const hex = buffer.toString('hex', 0, 4).toUpperCase();

  switch (mimeType) {
    case 'image/jpeg':
      // JPEG dosyaları FF D8 FF ile başlar
      return hex.startsWith('FFD8FF');

    case 'image/png':
      // PNG dosyaları 89 50 4E 47 ile başlar
      return hex === '89504E47';

    case 'image/gif':
      // GIF dosyaları 47 49 46 38 ile başlar
      return hex === '47494638';

    case 'image/webp':
      // WebP RIFF (52 49 46 46) ve WEBP (57 45 42 50) taşır
      if (buffer.length < 12) return false;
      const riff = buffer.toString('hex', 0, 4).toUpperCase();
      const webp = buffer.toString('hex', 8, 12).toUpperCase();
      return riff === '52494646' && webp === '57454250';

    case 'application/pdf':
      // PDF dosyaları %PDF (25 50 44 46) ile başlar
      return hex === '25504446';

    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': // .docx
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': // .xlsx
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': // .pptx
      // ZIP ve Modern Office XML arşivleri PK (50 4B 03 04) ile başlar
      return hex === '504B0304';

    case 'application/msword': // .doc
      // Eski binary word formatı D0 CF 11 E0 ile başlar
      return hex === 'D0CF11E0';

    case 'audio/mpeg':
      // MP3 ID3v2 tag (49 44 33) veya Frame Sync (FF FB / FF F3 / FF F2)
      return hex.startsWith('494433') || hex.startsWith('FFF');

    case 'audio/wav':
      // WAV RIFF (52 49 46 46) ve WAVE (57 41 56 45)
      if (buffer.length < 12) return false;
      const wavRiff = buffer.toString('hex', 0, 4).toUpperCase();
      const wave = buffer.toString('hex', 8, 12).toUpperCase();
      return wavRiff === '52494646' && wave === '57415645';

    case 'text/plain':
      // Düz metin dosyalarında binary karakter olmamalıdır (ASCII / UTF-8 kontrolü)
      for (let i = 0; i < Math.min(buffer.length, 512); i++) {
        const code = buffer[i];
        // 9 (TAB), 10 (LF), 13 (CR) dışındaki 32 altı kontrol karakterleri binary demektir
        if (code < 9 || (code > 13 && code < 32)) {
          return false;
        }
      }
      return true;

    default:
      // Diğer kategoriler için genel güvenlik önlemi olarak izin ver
      return true;
  }
};
