import { Request, Response, Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// A single grid item: react-grid-layout shape (i, x, y, w, h).
const layoutItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const saveLayoutSchema = z.object({
  // Map of breakpoint -> layout items (e.g. { lg: [...], md: [...] }).
  layout: z.record(z.array(layoutItemSchema)),
  uniform: z.boolean().optional(),
});

const GLOBAL_LAYOUT_USER_ID = 'GLOBAL_SYSTEM_LAYOUT';

// GET /api/layout - shared camera-wall layout across all users and devices
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const record = await prisma.dashboardLayout.findFirst({
      where: { userId: GLOBAL_LAYOUT_USER_ID },
    });
    if (!record) {
      res.json({ success: true, data: null });
      return;
    }
    const raw = record.layout as any;
    if (raw && typeof raw === 'object' && 'layouts' in raw) {
      res.json({
        success: true,
        data: {
          layout: raw.layouts,
          uniform: typeof raw.uniform === 'boolean' ? raw.uniform : false,
        },
      });
    } else {
      res.json({
        success: true,
        data: {
          layout: raw,
          uniform: false,
        },
      });
    }
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch layout' });
  }
});

// PUT /api/layout - upsert shared camera-wall layout and broadcast update
router.put('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { layout, uniform = false } = saveLayoutSchema.parse(req.body);

    const payload = { layouts: layout, uniform };

    const record = await prisma.dashboardLayout.upsert({
      where: { userId: GLOBAL_LAYOUT_USER_ID },
      create: { userId: GLOBAL_LAYOUT_USER_ID, layout: payload },
      update: { layout: payload },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('layout-updated', { layout, uniform });
    }

    res.json({ success: true, data: { layout, uniform } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to save layout' });
  }
});

export default router;
