import multer = require('multer');

const allowedMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'video/mp4', 'video/webm',
  'application/pdf', 'text/plain', 'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

// Dosya doğrudan R2'ye gönderileceği için geçici olarak bellekte tutulur.
export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Bu dosya türüne izin verilmiyor.'));
      return;
    }
    callback(null, true);
  }
}).single('file');
