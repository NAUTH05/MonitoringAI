import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, apiKeyAuth } from '../middleware/auth';
import {
  aiSourceUrl as streamAiSourceUrl,
  buildGo2rtcSource,
  deleteStream,
  makeStreamName,
  playbackUrl,
  probeStream,
  putStream,
  streamExists,
} from '../services/go2rtc';

const router = Router();

const cameraSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  rtspUrl: z.string().min(1),
  subRtspUrl: z.string().optional(),
  status: z.enum(['ONLINE', 'OFFLINE', 'ERROR']).optional(),
});

// A camera source as described by the wizard. The user never types a go2rtc
// stream name or an `ffmpeg:device?...` string.
const sourceFields = {
  sourceType: z.enum(['rtsp', 'webcam', 'go2rtc', 'nvr']),
  rtspUrl: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  device: z.string().optional(),
  resolution: z.string().optional(),
  fps: z.number().int().positive().optional(),
  streamName: z.string().optional(),
};

const provisionSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  subRtspUrl: z.string().optional(),
  modules: z.array(z.string()).optional(),
  ...sourceFields,
});

const updateSourceSchema = z.object(sourceFields).partial();

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

    const enrichedCameras = cameras.map((cam, index) => {
      const eventCount = cam._count?.events || 0;
      const resolutions = ['1080p Full HD (1920x1080)', '4K UHD (3840x2160)', '1080p Full HD (1920x1080)', '720p HD (1280x720)'];
      const resolution = resolutions[index % resolutions.length];
      const storageGb = parseFloat(((eventCount * 0.45) + 14.2 + (index * 3.5)).toFixed(1));

      return {
        ...cam,
        resolution,
        storageGb,
      };
    });

    res.json({
      success: true,
      data: enrichedCameras,
      meta: { total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch cameras' });
  }
});

// GET /api/cameras/:id/ai-config  (called by the AI-Cam runtime, x-api-key auth)
// Read-only, machine-to-machine: returns ONLY what the AI runtime needs to run
// a task (stream URL + per-module runtime config such as the ROI polygon).
// No user/account data and no secrets are exposed. The Python runtime never
// logs in as a human user.
router.get('/:id/ai-config', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.findUnique({
      where: { id: req.params.id },
      include: { cameraModules: { include: { module: true } } },
    });

    if (!camera) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    const modules = camera.cameraModules.map((cm) => ({
      code: cm.module.code,
      enabled: cm.isEnabled,
      config: cm.config ?? {},
    }));

    res.json({
      success: true,
      data: {
        cameraId: camera.id,
        name: camera.name,
        rtspUrl: camera.rtspUrl,
        subRtspUrl: camera.subRtspUrl,
        modules,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to build AI config' });
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

// POST /api/cameras/provision
// Transactional camera creation: validate source -> configure go2rtc -> verify
// the stream is available -> save the camera -> assign AI modules. If go2rtc
// fails we NEVER create a half-broken camera (and any orphan stream is removed).
router.post('/provision', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  let createdStreamName: string | null = null;
  let cameraCreated = false;
  try {
    const body = provisionSchema.parse(req.body);

    let streamName: string;
    if (body.sourceType === 'go2rtc') {
      if (!body.streamName) {
        res.status(400).json({ success: false, message: 'Select an existing go2rtc stream' });
        return;
      }
      if (!(await streamExists(body.streamName))) {
        res.status(400).json({ success: false, message: `go2rtc stream '${body.streamName}' was not found` });
        return;
      }
      streamName = body.streamName;
    } else {
      const src = buildGo2rtcSource(body);
      if (!src) {
        res.status(400).json({ success: false, message: 'A source URL or capture device is required' });
        return;
      }
      streamName = makeStreamName(randomUUID());
      const put = await putStream(streamName, src);
      if (!put.ok) {
        res.status(400).json({ success: false, message: `go2rtc rejected the source: ${put.error}` });
        return;
      }
      createdStreamName = streamName;
    }

    // Verify the stream is really available BEFORE persisting anything.
    if (!(await probeStream(streamName))) {
      if (createdStreamName) await deleteStream(createdStreamName);
      res.status(400).json({
        success: false,
        message: 'The stream did not become available. Check the source and try again.',
      });
      return;
    }

    const camera = await prisma.camera.create({
      data: {
        name: body.name,
        location: body.location,
        rtspUrl: playbackUrl(streamName),
        subRtspUrl: body.subRtspUrl,
        streamName,
        aiSourceUrl: streamAiSourceUrl(streamName),
        status: 'ONLINE',
      },
    });
    cameraCreated = true;

    const codes = (body.modules ?? []).map((c) => c.toUpperCase());
    if (codes.length > 0) {
      const modules = await prisma.aiModule.findMany({ where: { code: { in: codes } } });
      for (const module of modules) {
        await prisma.cameraModule.upsert({
          where: { cameraId_moduleId: { cameraId: camera.id, moduleId: module.id } },
          update: { isEnabled: true },
          create: { cameraId: camera.id, moduleId: module.id, isEnabled: true },
        });
      }
    }

    const full = await prisma.camera.findUnique({
      where: { id: camera.id },
      include: { cameraModules: { include: { module: true } } },
    });
    res.status(201).json({ success: true, data: full });
  } catch (err) {
    if (createdStreamName && !cameraCreated) {
      await deleteStream(createdStreamName); // roll back the orphan stream
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to provision camera' });
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
// Editing the source updates the EXISTING managed go2rtc stream in place (no
// new camera, no orphan stream).
router.put('/:id', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    const body = cameraSchema.partial().parse(req.body);
    const source = updateSourceSchema.parse(req.body);
    const data: Prisma.CameraUpdateInput = { ...body };

    if (source.sourceType) {
      const spec = { ...source, sourceType: source.sourceType };
      if (spec.sourceType === 'go2rtc') {
        if (spec.streamName) {
          if (!(await streamExists(spec.streamName))) {
            res.status(400).json({ success: false, message: `go2rtc stream '${spec.streamName}' was not found` });
            return;
          }
          data.streamName = spec.streamName;
          data.aiSourceUrl = streamAiSourceUrl(spec.streamName);
          data.rtspUrl = playbackUrl(spec.streamName);
        }
      } else {
        const src = buildGo2rtcSource(spec);
        if (!src) {
          res.status(400).json({ success: false, message: 'A source URL or capture device is required' });
          return;
        }
        const streamName = existing.streamName || makeStreamName(existing.id);
        const put = await putStream(streamName, src);
        if (!put.ok) {
          res.status(400).json({ success: false, message: `go2rtc rejected the source: ${put.error}` });
          return;
        }
        if (!(await probeStream(streamName))) {
          res.status(400).json({ success: false, message: 'The stream did not become available. Check the source and try again.' });
          return;
        }
        data.streamName = streamName;
        data.aiSourceUrl = streamAiSourceUrl(streamName);
        data.rtspUrl = playbackUrl(streamName);
      }
    }

    const camera = await prisma.camera.update({
      where: { id: req.params.id },
      data,
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
// Soft-deletes the camera and removes its MANAGED go2rtc stream when no other
// active camera still uses it (never touches a shared/external stream).
router.delete('/:id', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    const camera = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!camera) {
      res.status(404).json({ success: false, message: 'Camera not found' });
      return;
    }

    await prisma.camera.update({ where: { id: req.params.id }, data: { isActive: false } });

    const streamName = camera.streamName;
    if (streamName && streamName.startsWith('cam_')) {
      const stillUsed = await prisma.camera.count({
        where: { streamName, isActive: true },
      });
      if (stillUsed === 0) {
        await deleteStream(streamName);
      }
    }

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
