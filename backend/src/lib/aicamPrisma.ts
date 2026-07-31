import { PrismaClient } from '@prisma/client';

const globalForAicam = globalThis as unknown as { aicamPrisma: PrismaClient };

const aicamUrl =
  process.env.AICAM_DATABASE_URL ||
  process.env.DATABASE_URL?.replace('/smart_monitoring', '/aicam') ||
  'postgresql://postgres:postgres@localhost:5432/aicam';

export const aicamPrisma =
  globalForAicam.aicamPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: aicamUrl,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForAicam.aicamPrisma = aicamPrisma;

export default aicamPrisma;
