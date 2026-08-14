import { Request, Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/modules
router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const defaultModules = [
      { name: 'Intrusion Detection', code: 'INTRUSION', description: 'Detects unauthorized entry into restricted areas' },
      { name: 'Fire Detection', code: 'FIRE', description: 'Detects fire and flames in real-time' },
      { name: 'Smoke Detection', code: 'SMOKE', description: 'Detects smoke presence before fire spreads' },
      { name: 'PPE Detection', code: 'PPE', description: 'Detects personal protective equipment compliance' },
      { name: 'Face Recognition', code: 'FACE', description: 'Identifies and verifies registered personnel' },
      { name: 'Vehicle Detection & Counting', code: 'VEHICLE', description: 'Thống kê, phân loại và đếm số lượng xe (Ô tô, Xe máy, Xe tải, Bus)' },
      { name: 'Flood Detection', code: 'FLOOD', description: 'Phát hiện ngập nước, đo mực nước và cảnh báo ngập lụt' },
      { name: 'Traffic Violation Detection', code: 'TRAFFIC_VIOLATION', description: 'Phát hiện các hành vi vi phạm giao thông (Vượt đèn đỏ, Ngược chiều, Sai làn)' },
    ];

    for (const m of defaultModules) {
      await prisma.aiModule.upsert({
        where: { code: m.code },
        update: { name: m.name, description: m.description },
        create: m,
      });
    }

    const modules = await prisma.aiModule.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: modules });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch modules' });
  }
});

// GET /api/modules/camera/:cameraId
router.get('/camera/:cameraId', authenticate, async (req: Request, res: Response) => {
  try {
    const cameraModules = await prisma.cameraModule.findMany({
      where: { cameraId: req.params.cameraId },
      include: { module: true },
    });
    res.json({ success: true, data: cameraModules });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch camera modules' });
  }
});

// POST /api/modules/camera/:cameraId/:moduleId
router.post('/camera/:cameraId/:moduleId', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.cameraModule.findUnique({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
    });

    if (existing) {
      res.status(409).json({ success: false, message: 'Module already assigned to this camera' });
      return;
    }

    const cameraModule = await prisma.cameraModule.create({
      data: { cameraId: req.params.cameraId, moduleId: req.params.moduleId },
      include: { module: true },
    });

    res.status(201).json({ success: true, data: cameraModule });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to assign module' });
  }
});

// DELETE /api/modules/camera/:cameraId/:moduleId
router.delete('/camera/:cameraId/:moduleId', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    await prisma.cameraModule.delete({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
    });
    res.json({ success: true, data: null });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to remove module' });
  }
});

// PATCH /api/modules/camera/:cameraId/:moduleId/toggle
router.patch('/camera/:cameraId/:moduleId/toggle', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.cameraModule.findUnique({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Camera module assignment not found' });
      return;
    }

    const updated = await prisma.cameraModule.update({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
      data: { isEnabled: !existing.isEnabled },
      include: { module: true },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to toggle module' });
  }
});

// PATCH /api/modules/camera/:cameraId/:moduleId/config
router.patch('/camera/:cameraId/:moduleId/config', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { config } = req.body;

    const existing = await prisma.cameraModule.findUnique({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Camera module assignment not found' });
      return;
    }

    const updated = await prisma.cameraModule.update({
      where: { cameraId_moduleId: { cameraId: req.params.cameraId, moduleId: req.params.moduleId } },
      data: { config: config ?? null },
      include: { module: true },
    });

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to update module config' });
  }
});

export default router;
