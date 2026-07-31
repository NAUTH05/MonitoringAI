import { PrismaClient } from '@prisma/client';

const globalForAicam = globalThis as unknown as { aicamPrisma: PrismaClient };

// Fallback to DATABASE_URL replacing /smart_monitoring with /aicam if AICAM_DATABASE_URL is not set
const defaultAicamUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/\/smart_monitoring(\?.*)?$/, '/aicam$1')
  : 'postgresql://monitoring:monitoring_pass@localhost:5432/aicam';

const aicamUrl = process.env.AICAM_DATABASE_URL || defaultAicamUrl;

export const aicamPrisma =
  globalForAicam.aicamPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: aicamUrl,
      },
    },
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') globalForAicam.aicamPrisma = aicamPrisma;

export default aicamPrisma;
