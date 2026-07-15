import { Request, Response, Router } from 'express';
import os from 'os';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/health
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const cpus = os.cpus();
    const loadAvg = os.loadavg()[0];
    const cpuUsage = ((loadAvg / cpus.length) * 100).toFixed(1);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = ((usedMem / totalMem) * 100).toFixed(1);

    let dbStatus = 'OK';
    try {
      await prisma.$runCommandRaw({ ping: 1 });
    } catch (error) {
      console.error('Database Health Check Error:', error);
      dbStatus = 'ERROR';
    }

    const uptimeSeconds = process.uptime();
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

    res.json({
      success: true,
      data: {
        server: {
          status: 'OK',
          uptime: `${uptimeHours}h ${uptimeMinutes}m`,
          cpuUsage: `${cpuUsage}%`,
          memUsage: `${memUsage}%`,
          totalMem: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          freeMem: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          nodeVersion: process.version,
          platform: os.platform(),
        },
        database: {
          status: dbStatus,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch health status' });
  }
});

export default router;
