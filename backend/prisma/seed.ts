import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * ESSENTIAL BOOTSTRAP SEED — non-destructive and idempotent.
 *
 * Creates ONLY what the application needs to boot:
 *   - roles
 *   - AI module definitions
 *   - an optional development admin user (skip with SEED_ADMIN=0)
 *
 * It deliberately does NOT create cameras, events, alerts, evidence or
 * historical statistics, and it NEVER deletes existing rows. Re-running it is
 * safe: every write is an upsert.
 *
 * Real cameras are added through the UI ("Add Camera"); real events are pushed
 * by the AI-Cam runtime. The UI shows genuine empty states until then.
 */

const ROLES = ['Admin', 'Manager', 'Operator', 'Viewer'] as const;

const AI_MODULES = [
  { code: 'INTRUSION', name: 'Intrusion Detection', description: 'Detects unauthorised entry into a restricted zone' },
  { code: 'FIRE', name: 'Fire Detection', description: 'Detects fire and flames in real-time' },
  { code: 'SMOKE', name: 'Smoke Detection', description: 'Detects smoke presence before fire spreads' },
  { code: 'PPE', name: 'PPE Detection', description: 'Detects personal protective equipment compliance' },
  { code: 'FACE', name: 'Face Recognition', description: 'Identifies and verifies registered personnel' },
  { code: 'VEHICLE', name: 'Vehicle Detection', description: 'Detects and tracks vehicles in monitored areas' },
] as const;

const DEV_ADMIN_EMAIL = 'admin@monitoring.com';

async function main() {
  console.log('🌱 Seeding essential bootstrap data (non-destructive)...');

  // ── Roles (upsert by unique name) ────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const name of ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roleIds[name] = role.id;
  }
  console.log(`  roles: ${ROLES.join(', ')}`);

  // ── AI module definitions (upsert by unique code) ────────────────────────
  for (const m of AI_MODULES) {
    await prisma.aiModule.upsert({
      where: { code: m.code },
      update: { name: m.name, description: m.description },
      create: { code: m.code, name: m.name, description: m.description },
    });
  }
  console.log(`  ai modules: ${AI_MODULES.map((m) => m.code).join(', ')}`);

  // ── Optional development admin (skip with SEED_ADMIN=0) ──────────────────
  if (process.env.SEED_ADMIN !== '0') {
    const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
    await prisma.user.upsert({
      where: { email: DEV_ADMIN_EMAIL },
      update: {},
      create: {
        username: 'admin',
        email: DEV_ADMIN_EMAIL,
        password: await bcrypt.hash(password, 10),
        roleId: roleIds.Admin,
      },
    });
    console.log('');
    console.log('👤 Development admin (left unchanged if it already existed):');
    console.log(`  ${DEV_ADMIN_EMAIL}  /  ${password}`);
  } else {
    console.log('  (SEED_ADMIN=0 -> development admin skipped)');
  }

  console.log('');
  console.log('✅ Bootstrap seed complete. No cameras, events, alerts or evidence were created.');
  console.log('   Add cameras via the UI; real events are pushed by the AI-Cam runtime.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
