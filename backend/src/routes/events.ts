import { Prisma } from '@prisma/client';
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

// Evidence attached to an event (annotated snapshot or recorded video).
const createEvidenceSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO']),
  url: z.string().min(1),
  objectKey: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  capturedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Relations returned with every event (evidence ordered by sequence). */
const eventInclude = {
  camera: { select: { id: true, name: true, location: true } },
  alert: true,
  evidence: { orderBy: { sequence: 'asc' as const } },
};

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
        include: eventInclude,
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
      include: eventInclude,
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

    // A confirmed INTRUSION has already been validated end-to-end by the AI
    // pipeline (person detection + ROI overlap + ByteTrack + debounce + dwell),
    // so it must ALWAYS raise an alert — confidence is metadata only. Other
    // event types keep their confidence-based rule.
    const isAlert = body.eventType === 'INTRUSION' || body.confidence >= 0.8;

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

    // The first evidence image is the event's primary snapshot (sequence 1).
    if (body.imageUrl) {
      await prisma.evidence.create({
        data: {
          eventId: event.id,
          type: 'IMAGE',
          url: body.imageUrl,
          sequence: 1,
          capturedAt: event.timestamp,
        },
      });
    }

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

// POST /api/events/:id/evidence  (called by the AI camera, x-api-key)
// Attaches one annotated snapshot or the recorded video to an existing event.
// An intrusion episode is ONE event that accumulates a sequence of evidence.
router.post('/:id/evidence', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const body = createEvidenceSchema.parse(req.body);

    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    let sequence = body.sequence;
    if (sequence === undefined) {
      const last = await prisma.evidence.findFirst({
        where: { eventId: event.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      sequence = (last?.sequence ?? 0) + 1;
    }

    const evidence = await prisma.evidence.create({
      data: {
        eventId: event.id,
        type: body.type,
        url: body.url,
        objectKey: body.objectKey,
        sequence,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
        durationMs: body.durationMs,
        metadata: body.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    // Mirror into Event.imageUrl / videoUrl for backwards compatibility.
    const patch: Prisma.EventUpdateInput = {};
    if (body.type === 'VIDEO' && !event.videoUrl) patch.videoUrl = body.url;
    if (body.type === 'IMAGE' && !event.imageUrl) patch.imageUrl = body.url;
    if (Object.keys(patch).length > 0) {
      await prisma.event.update({ where: { id: event.id }, data: patch });
    }

    const io = req.app.get('io') as Server;
    io.emit('new-evidence', { eventId: event.id, evidence });

    res.status(201).json({ success: true, data: evidence });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to attach evidence' });
  }
});

// PATCH /api/events/alerts/:alertId/read
// Called when a notification is opened (toast / bell / event detail).
router.patch('/alerts/:alertId/read', authenticate, async (req: Request, res: Response) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.alertId },
      data: { status: 'READ' },
    });
    res.json({ success: true, data: alert });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to mark alert as read' });
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
