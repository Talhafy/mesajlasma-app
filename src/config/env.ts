// Ortam değişkenlerini tek noktada doğrular; hatalı ayarda sunucu yarım çalışmaz.
export const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
export const port = Number(process.env.PORT || 3000);
export const trustProxy = process.env.TRUST_PROXY === 'true';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT geçerli bir port numarası olmalıdır.');
}
