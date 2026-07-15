import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
  roleId: z.string().min(1),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/users
router.get('/', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '20', search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where = search
      ? {
          OR: [
            { username: { contains: search as string, mode: 'insensitive' as const } },
            { email: { contains: search as string, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
        select: {
          id: true,
          username: true,
          email: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          roleId: true,
          role: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      meta: { total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// POST /api/users
router.post('/', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    const body = createUserSchema.parse(req.body);

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: body.username }] },
    });

    if (exists) {
      res.status(409).json({ success: false, message: 'Username or email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: { ...body, password: hashedPassword },
      include: { role: true },
    });

    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json({ success: true, data: userWithoutPassword });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    const body = updateUserSchema.parse(req.body);
    const updateData: Record<string, unknown> = { ...body };

    if (body.password) {
      updateData.password = await bcrypt.hash(body.password, 10);
    } else {
      delete updateData.password;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: { role: true },
    });

    const { password: _, ...userWithoutPassword } = user;
    res.json({ success: true, data: userWithoutPassword });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('Admin'), async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user!.id) {
      res.status(400).json({ success: false, message: 'Cannot delete your own account' });
      return;
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: null });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

// GET /api/users/roles
router.get('/roles', authenticate, async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: roles });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch roles' });
  }
});

export default router;
