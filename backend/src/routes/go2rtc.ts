import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

const GO2RTC_API_URL = (process.env.GO2RTC_API_URL || 'http://localhost:1984').replace(/\/$/, '');

const streamSchema = z.object({
  name: z.string().min(1).max(100),
  src: z.string().min(1),
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
  try {
    const upstream = await fetch(`${GO2RTC_API_URL}/api/streams`);
    if (!upstream.ok) {
      res.status(502).json({ success: false, message: `go2rtc responded ${upstream.status}` });
      return;
    }
    const raw = (await upstream.json()) as Record<string, unknown>;
    const data = Object.entries(raw).map(([name, entry]) => ({
      name,
      sources: extractSources(entry),
    }));
    res.json({ success: true, data });
  } catch {
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
  }
});

// PUT /api/go2rtc/streams  — add or overwrite a stream (persisted to go2rtc.yaml)
router.put('/streams', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { name, src } = streamSchema.parse(req.body);
    const url = `${GO2RTC_API_URL}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
    const upstream = await fetch(url, { method: 'PUT' });
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(400).json({ success: false, message: text || `go2rtc rejected the stream (${upstream.status})` });
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

// DELETE /api/go2rtc/streams?src=<name>  — remove a stream (persisted to go2rtc.yaml)
router.delete('/streams', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    const name = z.string().min(1).parse(req.query.src);
    const upstream = await fetch(`${GO2RTC_API_URL}/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(400).json({ success: false, message: text || `go2rtc rejected the request (${upstream.status})` });
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
