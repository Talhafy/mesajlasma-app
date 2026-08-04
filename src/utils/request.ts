/**
 * ============================================================================
 * HTTP İSTEK VE PARAMETRE YARDIMCILARI (Express Request Utilities)
 * ============================================================================
 * 
 * Bu yardımcı modül, Express 5+ rota parametrelerini güvenle okuma ve
 * authMiddleware tarafından req nesnesine eklenen kullanıcı kimliğini (`userId`)
 * tip güvenliğiyle çekme işlevlerini sunar.
 */

import { CustomRequest } from '../middleware/authMiddleware';

/**
 * Express 5 parametre tipindeki `string | string[]` belirsizliğini çözer.
 * Rota parametresini garanti string olarak döner.
 */
export const getRouteParam = (req: CustomRequest, key: string): string => {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Oturum açmış kullanıcının ID'sini `req.user` nesnesinden güvenle çeker.
 * Kullanıcı kimliği doğrulanmamışsa veya yoksa hata fırlatır.
 */
export const getAuthenticatedUserId = (req: CustomRequest): string => {
  const userId = req.user?.userId;
  if (!userId) throw new Error('Kimliği doğrulanmış kullanıcı bilgisi bulunamadı.');
  return userId;
};

