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
});

// GET /api/layout - current user's saved camera-wall layout
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const record = await prisma.dashboardLayout.findUnique({
      where: { userId: req.user!.id },
    });
    res.json({ success: true, data: record?.layout ?? null });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch layout' });
  }
});

// PUT /api/layout - upsert current user's layout
router.put('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { layout } = saveLayoutSchema.parse(req.body);
    const userId = req.user!.id;

    const record = await prisma.dashboardLayout.upsert({
      where: { userId },
      create: { userId, layout },
      update: { layout },
    });

    res.json({ success: true, data: record.layout });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to save layout' });
  }
});

export default router;
