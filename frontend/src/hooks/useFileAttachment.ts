import { useCallback, useEffect, useRef, useState } from 'react';

/** Yüklenebilecek maksimum dosya boyutu sınırı (50 Megabayt) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Dosya seçme, önizleme oluşturma, panodan (clipboard) görsel yapıştırma ve
 * dosya iptal etme yaşam döngüsünü yöneten özel (custom) React Hook.
 */
export const useFileAttachment = () => {
  /** Gizli dosya seçme (input type=file) DOM elemanına erişim referansı */
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Dosya seçicide kabul edilecek MIME tipleri (Örn: 'image/*', tüm türler) */
  const [fileAccept, setFileAccept] = useState('*/*');
  /** Seçilen aktif dosya nesnesi */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  /** Görsel ise önizleme Blob URL'si, diğer dosyalarda dosya adı metni */
  const [filePreview, setFilePreview] = useState<string | null>(null);

  /**
   * Bellek sızıntılarını önlemek için oluşturulmuş Blob URL'lerini serbest bırakır (revokeObjectURL) ve önizlemeyi sıfırlar.
   */
  const clearPreview = useCallback(() => {
    setFilePreview((previous) => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  /**
   * Seçili dosyayı ve önizlemesini iptal edip temizler.
   */
  const cancelFile = useCallback(() => {
    setSelectedFile(null);
    clearPreview();
  }, [clearPreview]);

  /**
   * Bir dosyayı seçer, boyut kontrolünü yapar (Maks 50MB) ve gerekirse önizleme URL'si oluşturur.
   * @param file Seçilen File nesnesi
   * @returns Dosya geçerliyse true, boyutu aşıyorsa false
   */
  const selectFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert('Maksimum 50 MB dosya yükleyebilirsiniz.');
      return false;
    }

    setSelectedFile(file);
    clearPreview();
    // Resim dosyası ise geçici blob URL'si oluştur, değilsa dosya adını önizleme olarak ayarla
    setFilePreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : file.name);
    return true;
  }, [clearPreview]);

  /**
   * Dosya seçici input değiştiğinde (onChange) çalışan olay işleyicisi.
   */
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectFile(file);
    // Aynı dosya tekrar seçilebilsin diye input değerini sıfırla
    event.target.value = '';
  }, [selectFile]);

  /**
   * Belirtilen MIME türü kabulü ile dosya seçme penceresini programatik olarak açar.
   * @param acceptType Kabul edilecek dosya tipleri (Örn: 'image/*', '.pdf,.doc')
   */
  const openFilePicker = useCallback((acceptType: string) => {
    setFileAccept(acceptType);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }, []);

  /**
   * Pano (Clipboard) öğeleri arasından resim dosyasını tespit edip seçer.
   */
  const attachClipboardImage = useCallback((items: DataTransferItemList) => {
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) return selectFile(file);
    }
    return false;
  }, [selectFile]);

  /**
   * Metin alanına resim yapıştırıldığında (Ctrl+V) çalışan olay işleyicisi.
   */
  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    if (attachClipboardImage(event.clipboardData.items)) event.preventDefault();
  }, [attachClipboardImage]);

  // Sayfa genelindeki (window) yapıştırma olaylarını dinler (Chat alanı dışından da kopyalanan resimler için)
  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      // Chat alanındaki React olayı zaten işlendiyse mükerrer seçimi engelle
      if ((event.target as Element | null)?.closest?.('.chat-area')) return;
      if (event.clipboardData && attachClipboardImage(event.clipboardData.items)) event.preventDefault();
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [attachClipboardImage]);

  // Bileşen kaldırıldığında (unmount) önizleme bellek adresini temizle
  useEffect(() => () => clearPreview(), [clearPreview]);

  return {
    fileAccept,
    fileInputRef,
    filePreview,
    selectedFile,
    cancelFile,
    handleFileUpload,
    handlePaste,
    openFilePicker,
    selectFile
  };
};
