/**
 * Test environment. Imported FIRST by `telegram.test.ts` so the modules that
 * read `process.env` at load time (Prisma client, JWT) see a valid setup.
 *
 * `npm test` does not load backend/.env, and these tests never query the
 * database (they inject an in-memory store) — the DATABASE_URL only satisfies
 * the PrismaClient constructor.
 */
process.env.TELEGRAM_ENCRYPTION_KEY ??= 'test-only-telegram-encryption-key-0123456789abcdef';
process.env.JWT_SECRET ??= 'test-only-jwt-secret';
process.env.DATABASE_URL ??= 'postgresql://monitoring:monitoring_pass@127.0.0.1:5432/smart_monitoring';
// Never start the delivery worker from a test import.
process.env.TELEGRAM_WORKER_INTERVAL_MS = '0';

export {};
