import React, { useState, useCallback, useRef } from 'react';
import ConfirmModal from '../components/Modals/ConfirmModal';
import { ConfirmContext, type ConfirmOptions } from './confirmContext';

/**
 * Tüm uygulamayı sarmalayarak async `confirm()` çağrıları ile dinamik olarak 
 * Onay Modalı gösterilmesini ve sonucunun Promise olarak döndürülmesini sağlayan Provider bileşeni.
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Modalın açık olma durumu ve o anki onay seçenekleri
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions | null;
  }>({
    isOpen: false,
    options: null,
  });

  // Kullanıcının kararı (true/false) verilene kadar bekleyecek olan Promise resolve fonksiyonu referansı
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  /**
   * Onay modalını açan ve kullanıcının vereceği cevabı bekleyen asenkron fonksiyon.
   * `await confirm({ message: "Silmek istediğinize emin misiniz?" })` şeklinde kullanılır.
   */
  const confirm = useCallback((options: ConfirmOptions) => {
    setModalState({
      isOpen: true,
      options,
    });
    // Kullanıcı butona basana kadar çözülmeyecek bir Promise döndürür
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  /**
   * Kullanıcı Evet veya İptal butonuna bastığında çağrılır.
   * Modalı kapatır ve askıdaki Promise'i kullanıcının kararı ile çözer (resolve eder).
   */
  const handleClose = useCallback((value: boolean) => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {/* Alt bileşenler */}
      {children}
      
      {/* Onay modalı açık ise ConfirmModal bileşenini ekrana çizer */}
      {modalState.isOpen && modalState.options && (
        <ConfirmModal
          isOpen={modalState.isOpen}
          title={modalState.options.title || 'Onay Gerekiyor'}
          message={modalState.options.message}
          confirmText={modalState.options.confirmText || 'Evet'}
          cancelText={modalState.options.cancelText || 'İptal'}
          isDanger={modalState.options.isDanger || false}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
};

export type { ConfirmOptions };

