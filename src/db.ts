/**
 * ============================================================================
 * VERİTABANI BAĞLANTI VE SÜRÜCÜ YAPILANDIRMASI (Database Pool & Prisma 7)
 * ============================================================================
 * 
 * Bu dosya, PostgreSQL veritabanına erişimi sağlayan bağlantı havuzunu (node-postgres Pool)
 * ve Prisma ORM sürücüsünü (PrismaPg Adapter) yapılandırır.
 * 
 * BAĞLANTI HAVUZU VE TIMEOUT GÜVENLİK PARAMETRELERİ:
 * - max: Sunucu ve RAM kaynaklarını korumak için eşzamanlı maksimum veritabanı bağlantı sayısı.
 * - idleTimeoutMillis: Kullanılmayan boştaki bağlantıların sistemde asılı kalmaması için kapatılma süresi.
 * - connectionTimeoutMillis: Bağlantı havuzu dolduğunda yeni gelen isteklerin sonsuza kadar asılı kalmasını
 *   önleyen fail-fast zamanaşımı süresi.
 * - statement_timeout: Kilitleyici veya yavaş sorguların veritabanını felç etmesini önleyen sorgu zamanaşımı.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  dbPoolConnectionTimeoutMs,
  dbPoolIdleTimeoutMs,
  dbPoolMax,
  dbStatementTimeoutMs
} from './config/env';
import { logger } from './config/logger';

/**
 * PostgreSQL bağlantı havuzu örneği (pg Pool).
 * Uygulamadaki tüm veritabanı sorguları bu havuz üzerinden yönetilir.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: dbPoolMax,
  idleTimeoutMillis: dbPoolIdleTimeoutMs,
  connectionTimeoutMillis: dbPoolConnectionTimeoutMs,
  statement_timeout: dbStatementTimeoutMs
});

/**
 * Arka planda aniden kopan veritabanı soket hatalarını yakalar ve loglar.
 */
pool.on('error', (error) => {
  logger.error({ event: 'system.database_pool_error', err: error }, 'Unexpected PostgreSQL pool error');
});

/**
 * Prisma 7 sürücü adaptörü (PrismaPg) ile pg Pool birleştirilir.
 */
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Uygulama başlarken veritabanı bağlantısını test eder ve log üretir.
 */
prisma.$connect()
  .then(() => {
    logger.info({
      event: 'system.database_connected',
      poolMax: dbPoolMax,
      connectionTimeoutMs: dbPoolConnectionTimeoutMs,
      statementTimeoutMs: dbStatementTimeoutMs
    }, 'Database connected with connection pool limits');
  })
  .catch((error) => {
    logger.error({ event: 'system.database_connection_failed', err: error }, 'Database connection failed');
  });

/**
 * Sunucu kapatılırken (Graceful Shutdown) veritabanı havuzunu güvenle kapatan yardımcı fonksiyon.
 */
export const closeDatabasePool = async () => {
  try {
    await prisma.$disconnect();
    await pool.end();
    logger.info({ event: 'system.database_pool_closed' }, 'Database pool closed cleanly');
  } catch (error) {
    logger.error({ event: 'system.database_pool_close_failed', err: error }, 'Failed to close database pool');
  }
};

export default prisma;

