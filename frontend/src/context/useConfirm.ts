import { useContext } from 'react';
import { ConfirmContext } from './confirmContext';

/**
 * Uygulama içerisindeki herhangi bir bileşenden onay diyaloğu çağırabilmeyi sağlayan özel (custom) React Hook.
 * 
 * Örnek Kullanım:
 * ```tsx
 * const confirm = useConfirm();
 * const isConfirmed = await confirm({
 *   title: "Gruptan Çık",
 *   message: "Gruptan ayrılmak istediğinizden emin misiniz?",
 *   confirmText: "Çık",
 *   isDanger: true
 * });
 * if (isConfirmed) { // silme / çıkma işlemini yap }
 * ```
 * 
 * @throws {Error} Eğer bu hook `ConfirmProvider` sarmalayıcısı dışında çağrılırsa hata fırlatır.
 * @returns {Function} `confirm(options)` fonksiyonunu döndürür.
 */
export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm hook\'u bir ConfirmProvider bileşeni içerisinde kullanılmalıdır.');
  }
  return context.confirm;
};

