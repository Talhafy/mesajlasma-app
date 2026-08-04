/**
 * ============================================================================
 * DOSYA YÜKLEME KONFİGÜRASYONU (File Upload & Multer Config)
 * ============================================================================
 * 
 * Bu modül, kullanıcıların sohbetlerde paylaştığı veya profillerine yüklediği
 * görseller, ses kayıtları, videolar ve belgeler için dosya yükleme (Multer) 
 * kurallarını ve güvenlik filtrelerini tanımlar.
 */

import multer = require('multer');
import path = require('path');

/**
 * İzin verilen MIME türleri ve bunlara karşılık gelen geçerli dosya uzantıları haritası.
 * Güvenlik Açığı Koruması: Sahte uzantılı (ör. malz.exe -> photo.png) zararlı dosyaları engeller.
 */
const mimeToExtensions: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'audio/webm': ['.webm'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'application/zip': ['.zip'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
};

/** İzin verilen tüm MIME tiplerinin kümesi (Set) */
const allowedMimeTypes = new Set(Object.keys(mimeToExtensions));

/**
 * Tekli dosya yükleme ara yazılımı (Multer Middleware).
 * 
 * - Depolama: Dosyayı geçici olarak sunucu RAM'inde (memoryStorage) tutar.
 *   (Daha sonra ClamAV ile taranıp Cloudflare R2 / S3 nesne depolamasına aktarılır).
 * - Limit: Maksimum 50 Megabayt boyut ve 1 dosya sınırı.
 */
export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    // 1. Güvenlik Kontrolü: MIME Türü İzin Verilenler Arasında mı?
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Bu dosya türüne izin verilmiyor.'));
      return;
    }

    // 2. Güvenlik Kontrolü: Dosya Uzantısı ile MIME Türü Uyuşuyor mu?
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (!allowedExtensions || !allowedExtensions.includes(ext)) {
      callback(new Error('Dosya uzantısı ile dosya türü (MIME tipi) uyuşmuyor.'));
      return;
    }

    // Doğrulama başarılı
    callback(null, true);
  }
}).single('file');

