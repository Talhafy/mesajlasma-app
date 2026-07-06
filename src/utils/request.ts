import { CustomRequest } from '../middleware/authMiddleware';

// Express 5 parametre tipindeki string[] olasılığını route'lardan gizler.
export const getRouteParam = (req: CustomRequest, key: string): string => {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
};

// Bu yardımcı yalnızca authenticateToken sonrasında kullanılır.
export const getAuthenticatedUserId = (req: CustomRequest): string => {
  const userId = req.user?.userId;
  if (!userId) throw new Error('Kimliği doğrulanmış kullanıcı bilgisi bulunamadı.');
  return userId;
};
