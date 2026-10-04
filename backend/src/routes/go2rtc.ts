import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import {
  buildGo2rtcSource,
  deleteStream,
  listStreams,
  listVideoDevices,
  probeStream,
  putStream,
} from '../services/go2rtc';

const router = Router();

const streamSchema = z.object({
  name: z.string().min(1).max(100),
  src: z.string().min(1),
});

// Source description shared by the test + provisioning endpoints.
const sourceSchema = z.object({
  sourceType: z.enum(['rtsp', 'webcam', 'go2rtc', 'nvr']),
  rtspUrl: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  device: z.string().optional(),
  resolution: z.string().optional(),
  fps: z.number().int().positive().optional(),
  streamName: z.string().optional(),
});

// Extract source URLs from a go2rtc stream entry. Unconnected producers
// marshal as { url: <source> }; connected ones may nest it under a conn object.
function extractSources(entry: unknown): string[] {
  const producers = (entry as { producers?: unknown[] })?.producers;
  if (!Array.isArray(producers)) return [];
  return producers
    .map((p) => (p as { url?: string })?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
}

// GET /api/go2rtc/streams  — list all streams with their sources
router.get('/streams', authenticate, async (_req: Request, res: Response) => {
  const raw = await listStreams();
  if (raw === null) {
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
    return;
  }
  const data = Object.entries(raw).map(([name, entry]) => ({
    name,
    sources: extractSources(entry),
  }));
  res.json({ success: true, data });
});

// GET /api/go2rtc/devices — video capture devices on the go2rtc/ffmpeg machine
router.get('/devices', authenticate, async (_req: Request, res: Response) => {
  const devices = await listVideoDevices();
  res.json({ success: true, data: { devices } });
});

// POST /api/go2rtc/test — verify a source is reachable WITHOUT saving anything
router.post('/test', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const body = sourceSchema.parse(req.body);

    if (body.sourceType === 'go2rtc') {
      if (!body.streamName) {
        res.status(400).json({ success: false, message: 'streamName is required' });
        return;
      }
      const ok = await probeStream(body.streamName);
      res.json({ success: ok, message: ok ? 'Stream is reachable' : 'Stream did not become available' });
      return;
    }

    const src = buildGo2rtcSource(body);
    if (!src) {
      res.status(400).json({ success: false, message: 'A source URL or device is required' });
      return;
    }

    const probeName = `__probe_${Date.now().toString(36)}`;
    const put = await putStream(probeName, src);
    if (!put.ok) {
      res.status(400).json({ success: false, message: put.error || 'go2rtc rejected the source' });
      return;
    }
    const ok = await probeStream(probeName);
    await deleteStream(probeName);
    res.json({ success: ok, message: ok ? 'Stream is reachable' : 'Stream did not become available' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
  }
});

// PUT /api/go2rtc/streams — manual add/overwrite (Advanced mode only)
router.put('/streams', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { name, src } = streamSchema.parse(req.body);
    const result = await putStream(name, src);
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: { name, src } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
  }
});

// DELETE /api/go2rtc/streams?src=<name> — remove a stream (Advanced mode only)
router.delete('/streams', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    const name = z.string().min(1).parse(req.query.src);
    const result = await deleteStream(name);
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Stream name (src) is required' });
      return;
    }
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
  }
});

export default router;
