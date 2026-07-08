import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from './config/logger';

// Prisma 7 bu projede @prisma/adapter-pg ile çalışıyor.
// DATABASE_URL pg Pool'e verilir; PrismaClient bu pool üstünden PostgreSQL'e bağlanır.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
