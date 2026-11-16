/**
 * Telegram bot management API (Admin only).
 *
 *   GET    /api/telegram/status
 *
 *   GET    /api/telegram/bots
 *   POST   /api/telegram/bots
 *   GET    /api/telegram/bots/:id
 *   PATCH  /api/telegram/bots/:id
 *   DELETE /api/telegram/bots/:id
 *   POST   /api/telegram/bots/:id/verify
 *   POST   /api/telegram/bots/:id/test
 *   GET    /api/telegram/bots/:id/updates
 *
 *   GET    /api/telegram/bots/:id/recipients
 *   POST   /api/telegram/bots/:id/recipients
 *   PATCH  /api/telegram/recipients/:recipientId
 *   DELETE /api/telegram/recipients/:recipientId
 *   POST   /api/telegram/recipients/:recipientId/test
 *
 *   GET    /api/telegram/bots/:id/rules
 *   PUT    /api/telegram/bots/:id/rules
 *
 *   GET    /api/telegram/delivery-logs
 *
 * Every endpoint requires the existing JWT auth + the Admin role: bot tokens
 * are high-value credentials, so Managers/Operators cannot read or change them.
 * Responses never contain a plaintext token — only `tokenMasked`.
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { TelegramApiError } from '../services/telegram/telegram.client';
import { TelegramHttpError } from '../services/telegram/telegram.errors';
import { telegramService } from '../services/telegram';
import type { TelegramDeliveryLogQuery, TelegramDeliveryStatus } from '../services/telegram/telegram.types';
import type { TelegramService } from '../services/telegram/telegram.service';

const DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED'] as const;

const createBotSchema = z.object({
  name: z.string().min(1).max(80),
  token: z.string().min(20).max(200),
  isEnabled: z.boolean().optional(),
});

const updateBotSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    // Empty string / null => keep the stored token.
    token: z.string().max(200).nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có thay đổi nào.' });

const testBotSchema = z
  .object({
    recipientId: z.string().uuid().optional(),
    chatId: z.string().max(30).optional(),
  })
  .optional();

const recipientSchema = z.object({
  chatId: z.string().min(3).max(30),
  name: z.string().min(1).max(80),
  chatType: z.enum(['private', 'group', 'supergroup', 'channel']).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

const recipientUpdateSchema = z
  .object({
    chatId: z.string().min(3).max(30).optional(),
    name: z.string().min(1).max(80).optional(),
    chatType: z.enum(['private', 'group', 'supergroup', 'channel']).nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có thay đổi nào.' });

const rulesSchema = z.object({
  rules: z
    .array(
      z.object({
        eventType: z.string().min(1).max(40),
        isEnabled: z.boolean(),
        minConfidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Dữ liệu không hợp lệ';
}

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, message: zodMessage(err) });
    return;
  }
  if (err instanceof TelegramHttpError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  if (err instanceof TelegramApiError) {
    res.status(err.invalidToken ? 400 : 502).json({ success: false, message: err.message });
    return;
  }
  res.status(500).json({ success: false, message: (err as Error)?.message || fallback });
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface TelegramRouterDeps {
  service: TelegramService;
}

export function createTelegramRouter(deps: TelegramRouterDeps): Router {
  const { service } = deps;
  const router = Router();

  // Every route in this module is Admin-only.
  router.use(authenticate, authorize('Admin'));

  // ── Status ────────────────────────────────────────────────────────────────
  router.get('/status', (_req: Request, res: Response) => {
    res.json({ success: true, data: service.encryptionInfo() });
  });

  // ── Bots ──────────────────────────────────────────────────────────────────
  router.get('/bots', async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.listBots() });
    } catch (err) {
      sendError(res, err, 'Không tải được danh sách bot');
    }
  });

  router.post('/bots', async (req: Request, res: Response) => {
    try {
      const body = createBotSchema.parse(req.body);
      const bot = await service.createBot(body);
      res.status(201).json({ success: true, data: bot });
    } catch (err) {
      sendError(res, err, 'Không thêm được bot');
    }
  });

  router.get('/bots/:id', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.getBot(req.params.id) });
    } catch (err) {
      sendError(res, err, 'Không tải được bot');
    }
  });

  router.patch('/bots/:id', async (req: Request, res: Response) => {
    try {
      const body = updateBotSchema.parse(req.body);
      res.json({ success: true, data: await service.updateBot(req.params.id, body) });
    } catch (err) {
      sendError(res, err, 'Không cập nhật được bot');
    }
  });

  router.delete('/bots/:id', async (req: Request, res: Response) => {
    try {
      await service.deleteBot(req.params.id);
      res.json({ success: true, data: { id: req.params.id } });
    } catch (err) {
      sendError(res, err, 'Không xoá được bot');
    }
  });

  router.post('/bots/:id/verify', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.verifyBot(req.params.id) });
    } catch (err) {
      sendError(res, err, 'Không xác thực được bot');
    }
  });

  router.post('/bots/:id/test', async (req: Request, res: Response) => {
    try {
      const body = testBotSchema.parse(req.body);
      const result = await service.sendTest(req.params.id, body ?? {});
      const allOk = result.results.every((r) => r.ok);
      res.status(allOk ? 200 : 207).json({
        success: allOk,
        data: result.results,
        message: allOk
          ? 'Đã gửi tin nhắn thử.'
          : 'Một số người nhận không nhận được tin nhắn.',
      });
    } catch (err) {
      sendError(res, err, 'Không gửi được tin nhắn thử');
    }
  });

  router.get('/bots/:id/updates', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.discoverChats(req.params.id) });
    } catch (err) {
      sendError(res, err, 'Không đọc được danh sách chat');
    }
  });

  // ── Recipients ────────────────────────────────────────────────────────────
  router.get('/bots/:id/recipients', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.listRecipients(req.params.id) });
    } catch (err) {
      sendError(res, err, 'Không tải được danh sách người nhận');
    }
  });

  router.post('/bots/:id/recipients', async (req: Request, res: Response) => {
    try {
      const body = recipientSchema.parse(req.body);
      const recipient = await service.addRecipient(req.params.id, body);
      res.status(201).json({ success: true, data: recipient });
    } catch (err) {
      sendError(res, err, 'Không thêm được người nhận');
    }
  });

  router.patch('/recipients/:recipientId', async (req: Request, res: Response) => {
    try {
      const body = recipientUpdateSchema.parse(req.body);
      res.json({ success: true, data: await service.updateRecipient(req.params.recipientId, body) });
    } catch (err) {
      sendError(res, err, 'Không cập nhật được người nhận');
    }
  });

  router.delete('/recipients/:recipientId', async (req: Request, res: Response) => {
    try {
      await service.deleteRecipient(req.params.recipientId);
      res.json({ success: true, data: { id: req.params.recipientId } });
    } catch (err) {
      sendError(res, err, 'Không xoá được người nhận');
    }
  });

  router.post('/recipients/:recipientId/test', async (req: Request, res: Response) => {
    try {
      const result = await service.testRecipient(req.params.recipientId);
      res.status(result.ok ? 200 : 207).json({
        success: result.ok,
        data: result,
        message: result.ok ? 'Đã gửi tin nhắn thử.' : result.error ?? 'Gửi thất bại',
      });
    } catch (err) {
      sendError(res, err, 'Không gửi được tin nhắn thử');
    }
  });

  // ── Notification rules ────────────────────────────────────────────────────
  router.get('/bots/:id/rules', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.getRules(req.params.id) });
    } catch (err) {
      sendError(res, err, 'Không tải được quy tắc thông báo');
    }
  });

  router.put('/bots/:id/rules', async (req: Request, res: Response) => {
    try {
      const body = rulesSchema.parse(req.body);
      res.json({ success: true, data: await service.setRules(req.params.id, body.rules) });
    } catch (err) {
      sendError(res, err, 'Không lưu được quy tắc thông báo');
    }
  });

  // ── Delivery logs ─────────────────────────────────────────────────────────
  router.get('/delivery-logs', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));

      const status = typeof req.query.status === 'string' && req.query.status
        ? (DELIVERY_STATUSES as readonly string[]).includes(req.query.status)
          ? (req.query.status as TelegramDeliveryStatus)
          : undefined
        : undefined;

      const query: TelegramDeliveryLogQuery = {
        page,
        limit,
        ...(typeof req.query.botId === 'string' && req.query.botId ? { botId: req.query.botId } : {}),
        ...(status ? { status } : {}),
        ...(typeof req.query.eventType === 'string' && req.query.eventType
          ? { eventType: req.query.eventType }
          : {}),
        ...(typeof req.query.eventId === 'string' && req.query.eventId
          ? { eventId: req.query.eventId }
          : {}),
        ...(parseDate(req.query.from) ? { from: parseDate(req.query.from) } : {}),
        ...(parseDate(req.query.to) ? { to: parseDate(req.query.to) } : {}),
      };

      const result = await service.listDeliveryLogs(query);
      res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page: result.page, limit: result.limit },
      });
    } catch (err) {
      sendError(res, err, 'Không tải được lịch sử gửi');
    }
  });

  return router;
}

export default createTelegramRouter({ service: telegramService });
