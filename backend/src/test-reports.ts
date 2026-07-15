import prisma from './lib/prisma';
async function test() {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    console.log("Running counts...");
    const [totalCameras, onlineCameras, offlineCameras, todayAlerts, weekAlerts] = await Promise.all([
      prisma.camera.count({ where: { isActive: true } }),
      prisma.camera.count({ where: { status: 'ONLINE', isActive: true } }),
      prisma.camera.count({ where: { status: 'OFFLINE', isActive: true } }),
      prisma.event.count({ where: { isAlert: true, timestamp: { gte: todayStart } } }),
      prisma.event.count({ where: { isAlert: true, timestamp: { gte: weekStart } } }),
    ]);
    console.log("Counts completed:", { totalCameras, onlineCameras, offlineCameras, todayAlerts, weekAlerts });

    console.log("Running dailyStats...");
    const events7d = await prisma.event.findMany({
      where: { timestamp: { gte: weekStart } },
      select: { timestamp: true },
    });
    console.log("Found 7d events:", events7d.length);

    console.log("Running topCameras groupBy...");
    const groups = await prisma.event.groupBy({
      by: ['cameraId'],
      where: { isAlert: true },
      _count: { _all: true },
    });
    console.log("GroupBy completed, groups found:", groups.length);
    
    console.log("SUCCESS: All dashboard report queries completed successfully.");
  } catch (err) {
    console.error("ERROR: Dashboard report queries failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}
test();
