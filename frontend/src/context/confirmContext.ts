import { createContext } from 'react';

/**
 * Onay diyaloğu çağrılırken iletilebilecek yapılandırma seçenekleri arayüzü.
 */
export interface ConfirmOptions {
  /** Diyalog penceresinin başlığı (Örn: "Hesap Silme", "Gruptan Çık") */
  title?: string;
  /** Kullanıcıya gösterilecek ana onay mesajı metni */
  message: string;
  /** Onay butonundaki metin (Örn: "Evet", "Sil", "Ayrıl") */
  confirmText?: string;
  /** İptal butonundaki metin (Örn: "İptal", "Vazgeç") */
  cancelText?: string;
  /** İşlemin tehlikeli/kritik olup olmadığı (true ise kırmızı vurgulu diyalog gösterilir) */
  isDanger?: boolean;
}

/**
 * ConfirmContext içeriğinde sunulan metotların tip tanımlaması.
 */
export interface ConfirmContextType {
  /**
   * Onay modalını açar ve kullanıcının cevabını (true/false) dönen bir Promise başlatır.
   * @param options Onay penceresi seçenekleri
   * @returns Kullanıcı onay verirse true, iptal ederse false dönen Promise
   */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

/**
 * Onay mekanizmasını uygulama ağacında dağıtmak için oluşturulan React Context nesnesi.
 */
export const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

