import { AlertStatus, CameraStatus, EventType, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clean up existing data
  await prisma.alert.deleteMany();
  await prisma.event.deleteMany();
  await prisma.cameraModule.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.aiModule.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  // Create roles
  const adminRole = await prisma.role.create({ data: { name: 'Admin' } });
  const managerRole = await prisma.role.create({ data: { name: 'Manager' } });
  const operatorRole = await prisma.role.create({ data: { name: 'Operator' } });
  await prisma.role.create({ data: { name: 'Viewer' } });

  // Create users
  const adminPass = await bcrypt.hash('Admin@123', 10);
  const managerPass = await bcrypt.hash('Manager@123', 10);
  const operatorPass = await bcrypt.hash('Operator@123', 10);

  await prisma.user.createMany({
    data: [
      { username: 'admin', email: 'admin@monitoring.com', password: adminPass, roleId: adminRole.id },
      { username: 'manager01', email: 'manager@monitoring.com', password: managerPass, roleId: managerRole.id },
      { username: 'operator01', email: 'operator@monitoring.com', password: operatorPass, roleId: operatorRole.id },
    ],
  });

  // Create AI modules
  const modules = await Promise.all([
    prisma.aiModule.create({ data: { name: 'Intrusion Detection', code: 'INTRUSION', description: 'Detects unauthorized entry into restricted areas' } }),
    prisma.aiModule.create({ data: { name: 'Fire Detection', code: 'FIRE', description: 'Detects fire and flames in real-time' } }),
    prisma.aiModule.create({ data: { name: 'Smoke Detection', code: 'SMOKE', description: 'Detects smoke presence before fire spreads' } }),
    prisma.aiModule.create({ data: { name: 'PPE Detection', code: 'PPE', description: 'Detects personal protective equipment compliance' } }),
    prisma.aiModule.create({ data: { name: 'Face Recognition', code: 'FACE', description: 'Identifies and verifies registered personnel' } }),
    prisma.aiModule.create({ data: { name: 'Vehicle Detection', code: 'VEHICLE', description: 'Detects and tracks vehicles in monitored areas' } }),
  ]);

  // Create cameras
  const cameras = await Promise.all([
    prisma.camera.create({ data: { name: 'CAM-001', location: 'Main Entrance', rtspUrl: 'rtsp://192.168.1.101:554/stream', status: CameraStatus.ONLINE } }),
    prisma.camera.create({ data: { name: 'CAM-002', location: 'Warehouse A', rtspUrl: 'rtsp://192.168.1.102:554/stream', status: CameraStatus.ONLINE } }),
    prisma.camera.create({ data: { name: 'CAM-003', location: 'Parking Lot', rtspUrl: 'rtsp://192.168.1.103:554/stream', status: CameraStatus.ONLINE } }),
    prisma.camera.create({ data: { name: 'CAM-004', location: 'Control Room', rtspUrl: 'rtsp://192.168.1.104:554/stream', status: CameraStatus.OFFLINE } }),
    prisma.camera.create({ data: { name: 'CAM-005', location: 'Server Room', rtspUrl: 'rtsp://192.168.1.105:554/stream', status: CameraStatus.ONLINE } }),
  ]);

  // Assign modules to cameras
  await prisma.cameraModule.createMany({
    data: [
      { cameraId: cameras[0].id, moduleId: modules[0].id },
      { cameraId: cameras[0].id, moduleId: modules[4].id },
      { cameraId: cameras[1].id, moduleId: modules[1].id },
      { cameraId: cameras[1].id, moduleId: modules[2].id },
      { cameraId: cameras[1].id, moduleId: modules[3].id },
      { cameraId: cameras[2].id, moduleId: modules[0].id },
      { cameraId: cameras[2].id, moduleId: modules[5].id },
      { cameraId: cameras[3].id, moduleId: modules[0].id },
      { cameraId: cameras[4].id, moduleId: modules[0].id },
      { cameraId: cameras[4].id, moduleId: modules[1].id },
    ],
  });

  // Generate events for last 7 days
  const eventTypes: EventType[] = ['INTRUSION', 'FIRE', 'SMOKE', 'PPE', 'FACE', 'VEHICLE'];
  const now = new Date();

  for (let day = 0; day < 7; day++) {
    const eventCount = Math.floor(Math.random() * 15) + 8;

    for (let i = 0; i < eventCount; i++) {
      const camera = cameras[Math.floor(Math.random() * cameras.length)];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const confidence = parseFloat((Math.random() * 0.4 + 0.6).toFixed(3));
      const timestamp = new Date(now);
      timestamp.setDate(timestamp.getDate() - day);
      timestamp.setHours(Math.floor(Math.random() * 24));
      timestamp.setMinutes(Math.floor(Math.random() * 60));

      const isAlert = confidence >= 0.8;

      const event = await prisma.event.create({
        data: {
          cameraId: camera.id,
          eventType,
          confidence,
          // Point at real sample evidence so the viewer renders during demo.
          imageUrl: `/evidence/sample-${eventType.toLowerCase()}.svg`,
          videoUrl: `/evidence/TEST_CAM_1.mp4`,
          timestamp,
          isAlert,
        },
      });

      if (isAlert) {
        const statuses: AlertStatus[] = ['UNREAD', 'READ', 'ACKNOWLEDGED'];
        await prisma.alert.create({
          data: {
            eventId: event.id,
            status: statuses[Math.floor(Math.random() * statuses.length)],
          },
        });
      }
    }
  }

  console.log('✅ Seed complete!');
  console.log('');
  console.log('📋 Login credentials:');
  console.log('  Admin:    admin@monitoring.com    / Admin@123');
  console.log('  Manager:  manager@monitoring.com  / Manager@123');
  console.log('  Operator: operator@monitoring.com / Operator@123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
