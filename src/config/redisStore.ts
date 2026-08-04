/**
 * ============================================================================
 * REDIS RATE LIMIT STORE OLUŞTURUCU (Distributed Rate Limiting Engine)
 * ============================================================================
 * 
 * Bu modül, Express Hız Sınırlayıcılarının (rate-limit) sayaçlarını sunucu belleğinde (RAM)
 * tutmak yerine merkezi bir Redis veritabanına bağlar.
 * 
 * NEDEN REDIS KULLANILIR?
 * - Sunucunuzu birden fazla Node.js süreci (Docker / Kubernetes / PM2 Cluster) olarak
 *   çalıştırdığınızda, dahili RAM sayaçları her sunucuda bağımsız olur ve DDoS koruması delinebilir.
 * - Redis kullanıldığında tüm sunucu örnekleri aynı merkezi sayacı paylaşır.
 * - Redis kapalıysa veya test ortamındaysak, sistem çökmemek için otomatik varsayılan
 *   in-memory (bellek) deposuna düşer (fallback).
 */

import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import { redisUrl } from './env';
import { logger } from './logger';

/**
 * Belirtilen ön ek (prefix) ile Redis tabanlı rate-limit deposu nesnesi üretir.
 * 
 * @param prefix Sınırlayıcının adı (ör. 'login', 'register', 'global')
 * @returns RedisStore örneği veya varsayılan in-memory depo için 'undefined'
 */
export const createRedisRateLimitStore = (prefix: string) => {
  // Eğer ortam değişkenlerinde REDIS_URL tanımlı değilse (ör. yerel birim testler), varsayılan bellek deposunu kullan
  if (!redisUrl) {
    return undefined;
  }

  try {
    // Redis istemcisini bağlantı adresi ile oluşturuyoruz
    const client = createClient({ url: redisUrl });
    
    // Redis hata dinleyicisi
    client.on('error', (err) => {
      logger.error({ event: 'rate_limit.redis_error', err, prefix }, 'Redis rate limit store error');
    });

    // İstemci bağlantısını arka planda başlatıyoruz
    client.connect().catch((err) => {
      logger.warn({ event: 'rate_limit.redis_connect_warn', err, prefix }, 'Redis rate limit store connect failed');
    });

    // rate-limit-redis mağazasını Redis v4+ sendCommand yapısı ile bağlıyoruz
    return new RedisStore({
      sendCommand: (...args: string[]) => client.sendCommand(args),
      prefix: `rl:${prefix}:` // Redis anahtarlarını ayrıştırmak için (ör: rl:login:127.0.0.1)
    });
  } catch (error) {
    logger.warn({ event: 'rate_limit.redis_fallback', err: error, prefix }, 'Redis store creation failed, using memory fallback');
    return undefined;
  }
};

