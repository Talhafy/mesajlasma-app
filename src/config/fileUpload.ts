import multer = require('multer');
import path = require('path');

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

const allowedMimeTypes = new Set(Object.keys(mimeToExtensions));

// Dosya doğrudan R2'ye gönderileceği için geçici olarak bellekte tutulur.
export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Bu dosya türüne izin verilmiyor.'));
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (!allowedExtensions || !allowedExtensions.includes(ext)) {
      callback(new Error('Dosya uzantısı ile dosya türü (MIME tipi) uyuşmuyor.'));
      return;
    }

    callback(null, true);
  }
}).single('file');
