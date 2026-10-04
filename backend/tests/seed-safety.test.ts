/**
 * Guards against the seed (re)introducing mock/demo data.
 *
 *  - Static: the seed source must not delete data or create cameras/events.
 *  - Live:   the database must contain no seeded fake cameras or mock evidence
 *            (skipped gracefully when the database is unreachable).
 *
 * Run:  npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const seedSource = readFileSync(
  path.join(__dirname, '..', 'prisma', 'seed.ts'),
  'utf8',
);

test('seed never deletes existing data', () => {
  assert.ok(!/deleteMany\s*\(/.test(seedSource), 'seed must not call deleteMany()');
  assert.ok(!/\.delete\s*\(/.test(seedSource), 'seed must not call .delete()');
  assert.ok(!/force-reset/i.test(seedSource), 'seed must not reset the database');
});

test('seed creates no cameras, events, alerts or evidence', () => {
  for (const forbidden of [
    'camera.create',
    'event.create',
    'alert.create',
    'evidence.create',
    'createMany',
  ]) {
    assert.ok(
      !seedSource.includes(forbidden),
      `seed must not call ${forbidden} (mock/demo data)`,
    );
  }
  assert.ok(!/Math\.random/.test(seedSource), 'seed must not generate random data');
});

test('seed only upserts essential bootstrap data', () => {
  assert.ok(seedSource.includes('role.upsert'), 'roles must be upserted');
  assert.ok(seedSource.includes('aiModule.upsert'), 'AI modules must be upserted');
  assert.ok(seedSource.includes('user.upsert'), 'the dev admin must be upserted');
});

test('database contains no seeded fake cameras or mock evidence', async (t) => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    t.skip('database not reachable');
    return;
  }
  try {
    const fakeCameras = await prisma.camera.count({
      where: { rtspUrl: { startsWith: 'rtsp://192.168.1.10' } },
    });
    assert.equal(fakeCameras, 0, 'no seeded fake cameras (192.168.1.10x)');

    const mockEvidence = await prisma.event.count({
      where: { imageUrl: { contains: 'sample-' } },
    });
    assert.equal(mockEvidence, 0, 'no mock /evidence/sample-* evidence');
  } finally {
    await prisma.$disconnect();
  }
});
