import { Request, Response, Router } from 'express';
import prisma from '../lib/prisma';
import { apiKeyAuth } from '../middleware/auth';

const router = Router();

type CameraRow = {
  streamName: string | null;
  aiSourceUrl: string | null;
  rtspUrl: string;
};

/** Managed go2rtc stream name: explicit, else the `src=` param of the rtspUrl. */
function deriveStreamName(camera: CameraRow): string | null {
  if (camera.streamName) return camera.streamName;
  const match = (camera.rtspUrl || '').match(/[?&]src=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** URL the AI runtime consumes. go2rtc is an internal detail. */
function deriveAiSourceUrl(
  camera: CameraRow,
  streamName: string | null,
  go2rtcRtspBase: string,
): string | null {
  if (camera.aiSourceUrl) return camera.aiSourceUrl;
  const url = (camera.rtspUrl || '').trim();
  if (/^rtsps?:\/\//i.test(url)) return url; // direct IP camera / NVR channel
  if (streamName) return `${go2rtcRtspBase.replace(/\/+$/, '')}/${streamName}`;
  return null;
}

/**
 * GET /api/ai/runtime-config   (machine-to-machine, x-api-key)
 *
 * The AI runtime polls this to discover which cameras to run and how. Returns
 * ONLY runtime-required data — no user/account data, no secrets, no frontend
 * credentials. Each camera carries the modules (with their runtime config, e.g.
 * the intrusion ROI) so the AI service never reads per-camera values from .env.
 */
router.get('/runtime-config', apiKeyAuth, async (_req: Request, res: Response) => {
  try {
    const go2rtcRtspBase = process.env.GO2RTC_RTSP_URL || 'rtsp://127.0.0.1:8554';

    const cameras = await prisma.camera.findMany({
      where: { isActive: true },
      include: { cameraModules: { include: { module: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const data = cameras.map((camera) => {
      const streamName = deriveStreamName(camera);
      const aiSourceUrl = deriveAiSourceUrl(camera, streamName, go2rtcRtspBase);
      return {
        cameraId: camera.id,
        name: camera.name,
        streamName,
        aiSourceUrl,
        // A camera with no resolvable source cannot be run by the AI service.
        enabled: Boolean(camera.isActive && aiSourceUrl),
        modules: camera.cameraModules.map((cm) => ({
          code: cm.module.code,
          enabled: cm.isEnabled,
          config: cm.config ?? {},
        })),
      };
    });

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to build runtime config' });
  }
});

export default router;
