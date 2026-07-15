import { Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, apiKeyAuth } from '../middleware/auth';

const router = Router();

const createEventSchema = z.object({
  cameraId: z.string().min(1),
  eventType: z.enum(['INTRUSION', 'FIRE', 'SMOKE', 'PPE', 'FACE', 'VEHICLE']),
  confidence: z.number().min(0).max(1),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  timestamp: z.string().optional(),
});

// GET /api/events
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '20', type, cameraId, startDate, endDate, isAlert } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (type) where.eventType = type;
    if (cameraId) where.cameraId = cameraId;
    if (isAlert !== undefined) where.isAlert = isAlert === 'true';
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.gte = new Date(startDate as string);
      if (endDate) dateFilter.lte = new Date(endDate as string);
      where.timestamp = dateFilter;
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          camera: { select: { id: true, name: true, location: true } },
          alert: true,
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.event.count({ where }),
    ]);

    res.json({
      success: true,
      data: events,
      meta: { total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch events' });
  }
});

// GET /api/events/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        camera: { select: { id: true, name: true, location: true } },
        alert: true,
      },
    });

    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    res.json({ success: true, data: event });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch event' });
  }
});

// POST /api/events  (called by AI camera, protected by x-api-key)
router.post('/', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const body = createEventSchema.parse(req.body);

    const camera = await prisma.camera.findUnique({ where: { id: body.cameraId } });
    if (!camera) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    const isAlert = body.confidence >= 0.8;

    const event = await prisma.event.create({
      data: {
        cameraId: body.cameraId,
        eventType: body.eventType,
        confidence: body.confidence,
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl,
        timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
        isAlert,
      },
      include: {
        camera: { select: { id: true, name: true, location: true } },
      },
    });

    const io = req.app.get('io') as Server;
    io.emit('new-event', event);

    if (isAlert) {
      const alert = await prisma.alert.create({
        data: { eventId: event.id },
        include: { event: { include: { camera: { select: { id: true, name: true, location: true } } } } },
      });
      io.emit('new-alert', alert);
    }

    res.status(201).json({ success: true, data: event });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
});

// PATCH /api/events/alerts/:alertId/acknowledge
router.patch('/alerts/:alertId/acknowledge', authenticate, async (req: Request, res: Response) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.alertId },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    res.json({ success: true, data: alert });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to acknowledge alert' });
  }
});

export default router;
