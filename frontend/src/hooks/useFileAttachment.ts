import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Dosya seçme, önizleme ve panodan görsel alma yaşam döngüsünü ChatArea'dan ayırır.
export const useFileAttachment = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState('*/*');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const clearPreview = useCallback(() => {
    setFilePreview((previous) => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  const cancelFile = useCallback(() => {
    setSelectedFile(null);
    clearPreview();
  }, [clearPreview]);

  const selectFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert('Maksimum 50 MB dosya yükleyebilirsiniz.');
      return false;
    }

    setSelectedFile(file);
    clearPreview();
    setFilePreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : file.name);
    return true;
  }, [clearPreview]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectFile(file);
    event.target.value = '';
  }, [selectFile]);

  const openFilePicker = useCallback((acceptType: string) => {
    setFileAccept(acceptType);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }, []);

  const attachClipboardImage = useCallback((items: DataTransferItemList) => {
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) return selectFile(file);
    }
    return false;
  }, [selectFile]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    if (attachClipboardImage(event.clipboardData.items)) event.preventDefault();
  }, [attachClipboardImage]);

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      // Chat alanındaki React olayı zaten işlendiği için aynı dosyayı iki kez seçmeyiz.
      if ((event.target as Element | null)?.closest?.('.chat-area')) return;
      if (event.clipboardData && attachClipboardImage(event.clipboardData.items)) event.preventDefault();
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [attachClipboardImage]);

  useEffect(() => () => clearPreview(), [clearPreview]);

  return {
    fileAccept,
    fileInputRef,
    filePreview,
    selectedFile,
    cancelFile,
    handleFileUpload,
    handlePaste,
    openFilePicker
  };
};
