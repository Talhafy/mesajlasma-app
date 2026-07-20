import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from './config/logger';

// Prisma 7 requires an explicit driver adapter (or Accelerate) for PostgreSQL database connections.
// We configure pg Pool and map it to PrismaPg adapter.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Uygulama başlarken DB bağlantısını test ediyoruz.
// Bağlantı hatası loglanır; böylece Elastic/Kibana tarafında sistem açılış problemleri görülebilir.
prisma.$connect()
  .then(() => {
    logger.info({ event: 'system.database_connected' }, 'Database connected');
  })
  .catch((error) => {
    logger.error({ event: 'system.database_connection_failed', err: error }, 'Database connection failed');
  });

export default prisma;
