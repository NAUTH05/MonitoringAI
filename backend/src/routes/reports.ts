import { Request, Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/reports/dashboard
router.get('/dashboard', authenticate, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const [totalCameras, onlineCameras, offlineCameras, todayAlerts, weekAlerts] = await Promise.all([
      prisma.camera.count({ where: { isActive: true } }),
      prisma.camera.count({ where: { status: 'ONLINE', isActive: true } }),
      prisma.camera.count({ where: { status: 'OFFLINE', isActive: true } }),
      prisma.event.count({ where: { isAlert: true, timestamp: { gte: todayStart } } }),
      prisma.event.count({ where: { isAlert: true, timestamp: { gte: weekStart } } }),
    ]);

    const dailyStats = await (async () => {
      const events7d = await prisma.event.findMany({
        where: { timestamp: { gte: weekStart } },
        select: { timestamp: true },
      });
      const map: Record<string, number> = {};
      for (const e of events7d) {
        const date = e.timestamp.toISOString().split('T')[0];
        map[date] = (map[date] ?? 0) + 1;
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));
    })();

    const topCameras = await (async () => {
      const groups = await prisma.event.groupBy({
        by: ['cameraId'],
        where: { isAlert: true },
        _count: { _all: true },
      });
      groups.sort((a, b) => b._count._all - a._count._all);
      const top5 = groups.slice(0, 5);
      const cameraIds = top5.map((g) => g.cameraId);
      const cams = await prisma.camera.findMany({
        where: { id: { in: cameraIds } },
        select: { id: true, name: true },
      });
      return top5.map((g) => ({
        cameraId: g.cameraId,
        cameraName: cams.find((c) => c.id === g.cameraId)?.name ?? 'Unknown',
        count: g._count._all,
      }));
    })();

    res.json({
      success: true,
      data: {
        totalCameras,
        onlineCameras,
        offlineCameras,
        todayAlerts,
        weekAlerts,
        dailyStats,
        topCameras,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
});

// GET /api/reports/daily
router.get('/daily', authenticate, async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const events = await prisma.event.findMany({
      where: { timestamp: { gte: dayStart, lte: dayEnd } },
      include: { camera: { select: { name: true, location: true } } },
      orderBy: { timestamp: 'desc' },
    });

    const byType: Record<string, number> = {};
    events.forEach((e) => {
      byType[e.eventType] = (byType[e.eventType] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        date: dayStart.toISOString().split('T')[0],
        totalEvents: events.length,
        totalAlerts: events.filter((e) => e.isAlert).length,
        byType,
        events,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch daily report' });
  }
});

// GET /api/reports/weekly
router.get('/weekly', authenticate, async (req: Request, res: Response) => {
  try {
    const { startDate } = req.query;
    const weekStart = startDate ? new Date(startDate as string) : new Date();
    if (!startDate) weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);

    const weeklyEvents = await prisma.event.findMany({
      where: { timestamp: { gte: weekStart, lte: weekEnd } },
      select: { timestamp: true, isAlert: true },
    });
    const weeklyDayMap: Record<string, { count: number; alerts: number }> = {};
    for (const e of weeklyEvents) {
      const date = e.timestamp.toISOString().split('T')[0];
      if (!weeklyDayMap[date]) weeklyDayMap[date] = { count: 0, alerts: 0 };
      weeklyDayMap[date].count++;
      if (e.isAlert) weeklyDayMap[date].alerts++;
    }
    const dailyData = Object.entries(weeklyDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, count: d.count, alerts: d.alerts }));

    const weeklyByType = await prisma.event.groupBy({
      by: ['eventType'],
      where: { timestamp: { gte: weekStart, lte: weekEnd } },
      _count: { _all: true },
    });

    res.json({
      success: true,
      data: {
        startDate: weekStart.toISOString().split('T')[0],
        endDate: weekEnd.toISOString().split('T')[0],
        dailyData,
        byType: weeklyByType.map((b) => ({ type: b.eventType, count: b._count._all })),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch weekly report' });
  }
});

// GET /api/reports/monthly
router.get('/monthly', authenticate, async (req: Request, res: Response) => {
  try {
    const { year, month } = req.query;
    const now = new Date();
    const targetYear = parseInt(year as string) || now.getFullYear();
    const targetMonth = parseInt(month as string) || now.getMonth() + 1;

    const monthStart = new Date(targetYear, targetMonth - 1, 1);
    const monthEnd = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const monthlyEvents = await prisma.event.findMany({
      where: { timestamp: { gte: monthStart, lte: monthEnd } },
      select: { timestamp: true, isAlert: true },
    });
    const monthlyDayMap: Record<string, { count: number; alerts: number }> = {};
    for (const e of monthlyEvents) {
      const date = e.timestamp.toISOString().split('T')[0];
      if (!monthlyDayMap[date]) monthlyDayMap[date] = { count: 0, alerts: 0 };
      monthlyDayMap[date].count++;
      if (e.isAlert) monthlyDayMap[date].alerts++;
    }
    const monthlyDailyData = Object.entries(monthlyDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, count: d.count, alerts: d.alerts }));

    const monthlyByType = await prisma.event.groupBy({
      by: ['eventType'],
      where: { timestamp: { gte: monthStart, lte: monthEnd } },
      _count: { _all: true },
    });

    res.json({
      success: true,
      data: {
        year: targetYear,
        month: targetMonth,
        dailyData: monthlyDailyData,
        byType: monthlyByType.map((b) => ({ type: b.eventType, count: b._count._all })),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch monthly report' });
  }
});

export default router;
