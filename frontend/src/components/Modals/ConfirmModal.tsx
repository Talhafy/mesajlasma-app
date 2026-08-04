import React, { useEffect, useRef } from 'react';
import './Modals.css';

/**
 * ConfirmModal bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface ConfirmModalProps {
  /** Modalın açık/kapalı olma durumu */
  isOpen: boolean;
  /** Modal başlığı */
  title: string;
  /** Kullanıcıya gösterilecek onay mesajı metni */
  message: string;
  /** Onay butonunda görüntülenecek metin (örn: "Evet", "Sil", "Gruptan Çık") */
  confirmText: string;
  /** İptal butonunda görüntülenecek metin (örn: "İptal", "Vazgeç") */
  cancelText: string;
  /** İşlemin tehlikeli/kritik olup olmadığını belirler (true ise kırmızı vurgu ve uyarı ikonu kullanılır) */
  isDanger?: boolean;
  /** Kullanıcı işlemi onayladığında tetiklenecek fonksiyon */
  onConfirm: () => void;
  /** Kullanıcı işlemi iptal ettiğinde veya modalı kapattığında tetiklenecek fonksiyon */
  onCancel: () => void;
}

/**
 * Kullanıcıdan silme, ayrılma veya kritik eylemler için onay alan genel amaçlı Onay Modalı (Confirmation Modal).
 * Klavye ile 'Escape' tuşuna basıldığında veya modal dışına tıklandığında iptal olayını tetikler.
 */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Modal kutusunun DOM referansı (dışına tıklanmayı algılamak için kullanılır)
  const modalRef = useRef<HTMLDivElement>(null);

  // Esc (Escape) tuşuna basıldığında modalı kapatma / iptal etme dinleyicisi
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  // Modal kapalıysa DOM'a hiçbir şey çizmeyip null döner
  if (!isOpen) return null;

  // Modal dışındaki karartılmış arka plana (overlay) tıklandığında modalı kapatır
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Tıklanan öğe modal kutusunun kendisi veya içindeki bir eleman değilse iptal et
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onCancel();
    }
  };

  return (
    // Karartılmış arka plan overlay alanı
    <div className="confirm-overlay" onClick={handleOverlayClick}>
      {/* Modal ana içerik kutusu */}
      <div className="confirm-modal-box" ref={modalRef}>
        {/* Modal Başlık Alanı */}
        <div className="confirm-modal-header">
          {/* Tehlikeli işlemlerde uyarı (⚠️), bilgi işlemlerinde (ℹ️) ikonu gösterilir */}
          <div className={`confirm-icon-wrapper ${isDanger ? 'danger' : 'info'}`}>
            {isDanger ? '⚠️' : 'ℹ️'}
          </div>
          <h3>{title}</h3>
        </div>

        {/* Modal Gövde / Mesaj Alanı */}
        <div className="confirm-modal-body">
          <p>{message}</p>
        </div>

        {/* Modal Alt Butonlar Alanı */}
        <div className="confirm-modal-footer">
          {/* İptal Butonu */}
          <button type="button" className="confirm-btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          {/* Onay Butonu (Tehlikeli ise kırmızı 'danger', normal ise 'primary' stili uygulanır) */}
          <button 
            type="button" 
            className={`confirm-btn-action ${isDanger ? 'danger' : 'primary'}`} 
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

