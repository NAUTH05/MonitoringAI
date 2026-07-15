import { Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, apiKeyAuth } from '../middleware/auth';

const router = Router();

const cameraSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  rtspUrl: z.string().min(1),
  status: z.enum(['ONLINE', 'OFFLINE', 'ERROR']).optional(),
});

// GET /api/cameras
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '20', search, status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = { isActive: true };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { location: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [cameras, total] = await Promise.all([
      prisma.camera.findMany({
        where,
        include: {
          cameraModules: {
            where: { isEnabled: true },
            include: { module: true },
          },
          _count: { select: { events: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.camera.count({ where }),
    ]);

    res.json({
      success: true,
      data: cameras,
      meta: { total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch cameras' });
  }
});

// GET /api/cameras/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.findUnique({
      where: { id: req.params.id },
      include: {
        cameraModules: { include: { module: true } },
        _count: { select: { events: true } },
      },
    });

    if (!camera) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    res.json({ success: true, data: camera });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch camera' });
  }
});

// POST /api/cameras
router.post('/', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const body = cameraSchema.parse(req.body);
    const camera = await prisma.camera.create({
      data: body,
      include: { cameraModules: { include: { module: true } } },
    });
    res.status(201).json({ success: true, data: camera });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create camera' });
  }
});

// PUT /api/cameras/:id
router.put('/:id', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const body = cameraSchema.partial().parse(req.body);
    const camera = await prisma.camera.update({
      where: { id: req.params.id },
      data: body,
      include: { cameraModules: { include: { module: true } } },
    });
    res.json({ success: true, data: camera });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update camera' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    await prisma.camera.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true, data: null });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to delete camera' });
  }
});

// PATCH /api/cameras/:id/status
router.patch('/:id/status', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['ONLINE', 'OFFLINE', 'ERROR']) }).parse(req.body);
    const camera = await prisma.camera.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ success: true, data: camera });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update camera status' });
  }
});

// POST /api/cameras/:id/heartbeat  (called by Camera AI, protected by x-api-key)
router.post('/:id/heartbeat', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!camera) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    const updated = await prisma.camera.update({
      where: { id: req.params.id },
      data: { status: 'ONLINE', lastHeartbeat: new Date() },
    });

    const io = req.app.get('io') as Server;
    io.emit('camera-status', {
      id: updated.id,
      status: updated.status,
      lastHeartbeat: updated.lastHeartbeat,
    });

    res.json({ success: true, data: { id: updated.id, status: updated.status, lastHeartbeat: updated.lastHeartbeat } });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to process heartbeat' });
  }
});

export default router;
