import React, { useState, useCallback, useRef } from 'react';
import ConfirmModal from '../components/Modals/ConfirmModal';
import { ConfirmContext, type ConfirmOptions } from './confirmContext';

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions | null;
  }>({
    isOpen: false,
    options: null,
  });

  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setModalState({
      isOpen: true,
      options,
    });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleClose = useCallback((value: boolean) => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
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
