import { spawn } from 'child_process';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

const GO2RTC_API_URL = (process.env.GO2RTC_API_URL || 'http://localhost:1984').replace(/\/$/, '');
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const evidenceDir = path.join(__dirname, '../../evidence');

// Filesystem-safe filename fragment.
function safe(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(0, 60);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// POST /api/capture/:streamName/snapshot  — save a still from go2rtc to evidence/
router.post('/:streamName/snapshot', authenticate, authorize('Admin', 'Manager', 'Operator'), async (req: Request, res: Response) => {
  const streamName = req.params.streamName;
  try {
    const upstream = await fetch(`${GO2RTC_API_URL}/api/frame.jpeg?src=${encodeURIComponent(streamName)}`);
    if (!upstream.ok) {
      res.status(502).json({ success: false, message: `go2rtc snapshot failed (${upstream.status})` });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const filename = `snap_${safe(streamName)}_${stamp()}.jpg`;
    fs.writeFileSync(path.join(evidenceDir, filename), buf);
    res.json({ success: true, data: { url: `/evidence/${filename}` } });
  } catch {
    res.status(502).json({ success: false, message: 'Unable to reach go2rtc' });
  }
});

// POST /api/capture/:streamName/record { duration } — record N seconds to evidence/
router.post('/:streamName/record', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  const streamName = req.params.streamName;
  const duration = Math.min(Math.max(parseInt(String(req.body?.duration ?? 10), 10) || 10, 1), 300);
  const filename = `rec_${safe(streamName)}_${stamp()}.mp4`;
  const outPath = path.join(evidenceDir, filename);
  const input = `${GO2RTC_API_URL}/api/stream.mp4?src=${encodeURIComponent(streamName)}`;

  const ff = spawn(FFMPEG_BIN, [
    '-y',
    '-i', input,
    '-t', String(duration),
    '-c', 'copy',
    '-movflags', '+faststart',
    outPath,
  ]);

  let settled = false;
  const done = (ok: boolean, message?: string) => {
    if (settled) return;
    settled = true;
    if (ok) {
      res.json({ success: true, data: { url: `/evidence/${filename}` } });
    } else {
      res.status(500).json({ success: false, message: message || 'Recording failed' });
    }
  };

  // Hard cap in case ffmpeg hangs (duration + 15s grace).
  const killTimer = setTimeout(() => {
    ff.kill('SIGKILL');
  }, (duration + 15) * 1000);

  ff.on('error', () => {
    clearTimeout(killTimer);
    done(false, 'ffmpeg not available on server');
  });
  ff.on('close', (code) => {
    clearTimeout(killTimer);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      done(true);
    } else {
      done(false, `ffmpeg exited with code ${code}`);
    }
  });
});

export default router;
