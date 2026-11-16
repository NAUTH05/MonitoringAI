/**
 * Prisma-backed implementation of `TelegramStore`.
 *
 * Everything the Telegram module needs from PostgreSQL lives here, which keeps
 * the service/dispatcher free of Prisma types (and unit-testable with an
 * in-memory store).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import prismaClient from '../../lib/prisma';
import type {
  TelegramBotRecord,
  TelegramDeliveryJob,
  TelegramDeliveryLogPage,
  TelegramDeliveryLogQuery,
  TelegramDeliveryLogRow,
  TelegramDeliveryRecord,
  TelegramDeliveryStatus,
  TelegramRecipientRecord,
  TelegramRuleRecord,
  TelegramStore,
} from './telegram.types';

type Db = PrismaClient;

const deliveryInclude = {
  bot: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true, chatId: true } },
  event: { select: { id: true, eventType: true, confidence: true, timestamp: true } },
} satisfies Prisma.TelegramDeliveryLogInclude;

const deliveryJobInclude = {
  bot: true,
  recipient: true,
  event: {
    include: { camera: { select: { id: true, name: true, location: true } } },
  },
} satisfies Prisma.TelegramDeliveryLogInclude;

function toDeliveryRecord(row: {
  id: string;
  botId: string;
  recipientId: string | null;
  eventId: string | null;
  status: string;
  telegramMessageId: string | null;
  errorMessage: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TelegramDeliveryRecord {
  return {
    id: row.id,
    botId: row.botId,
    recipientId: row.recipientId,
    eventId: row.eventId,
    status: row.status as TelegramDeliveryStatus,
    telegramMessageId: row.telegramMessageId,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaTelegramStore(db: Db = prismaClient): TelegramStore {
  return {
    // ── Bots ────────────────────────────────────────────────────────────────
    listBots() {
      return db.telegramBot.findMany({ orderBy: { createdAt: 'asc' } });
    },

    findBot(id) {
      return db.telegramBot.findUnique({ where: { id } });
    },

    findBotByName(name) {
      return db.telegramBot.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
    },

    createBot(data) {
      return db.telegramBot.create({ data });
    },

    updateBot(id, data) {
      const patch: Prisma.TelegramBotUpdateInput = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.username !== undefined) patch.username = data.username;
      if (data.tokenEncrypted !== undefined) patch.tokenEncrypted = data.tokenEncrypted;
      if (data.isEnabled !== undefined) patch.isEnabled = data.isEnabled;
      if (data.isVerified !== undefined) patch.isVerified = data.isVerified;
      if (data.lastVerifiedAt !== undefined) patch.lastVerifiedAt = data.lastVerifiedAt;
      if (data.lastError !== undefined) patch.lastError = data.lastError;
      return db.telegramBot.update({ where: { id }, data: patch });
    },

    async deleteBot(id) {
      await db.telegramBot.delete({ where: { id } });
    },

    // ── Recipients ──────────────────────────────────────────────────────────
    listRecipients(botId) {
      return db.telegramRecipient.findMany({
        where: { botId },
        orderBy: { createdAt: 'asc' },
      });
    },

    findRecipient(id) {
      return db.telegramRecipient.findUnique({ where: { id } });
    },

    findRecipientByChatId(botId, chatId) {
      return db.telegramRecipient.findUnique({
        where: { botId_chatId: { botId, chatId } },
      });
    },

    async countRecipients(botId) {
      const [total, enabled] = await Promise.all([
        db.telegramRecipient.count({ where: { botId } }),
        db.telegramRecipient.count({ where: { botId, isEnabled: true } }),
      ]);
      return { total, enabled };
    },

    createRecipient(data) {
      return db.telegramRecipient.create({ data });
    },

    updateRecipient(id, data) {
      const patch: Prisma.TelegramRecipientUpdateInput = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.chatId !== undefined) patch.chatId = data.chatId;
      if (data.chatType !== undefined) patch.chatType = data.chatType;
      if (data.isEnabled !== undefined) patch.isEnabled = data.isEnabled;
      return db.telegramRecipient.update({ where: { id }, data: patch });
    },

    async deleteRecipient(id) {
      await db.telegramRecipient.delete({ where: { id } });
    },

    // ── Rules ───────────────────────────────────────────────────────────────
    listRules(botId) {
      return db.telegramNotificationRule.findMany({
        where: { botId },
        orderBy: { eventType: 'asc' },
      });
    },

    countRules(botId) {
      return db.telegramNotificationRule.count({
        where: { botId, isEnabled: true },
      });
    },

    upsertRule(botId, eventType, data) {
      return db.telegramNotificationRule.upsert({
        where: { botId_eventType: { botId, eventType } },
        create: { botId, eventType, ...data },
        update: data,
      });
    },

    async replaceRules(botId, rules) {
      // One transaction so the UI never sees a half-applied rule set.
      const results = await db.$transaction(
        rules.map((rule) =>
          db.telegramNotificationRule.upsert({
            where: { botId_eventType: { botId, eventType: rule.eventType } },
            create: {
              botId,
              eventType: rule.eventType,
              isEnabled: rule.isEnabled,
              minConfidence: rule.minConfidence,
            },
            update: {
              isEnabled: rule.isEnabled,
              minConfidence: rule.minConfidence,
            },
          }),
        ),
      );
      return results;
    },

    // ── Dispatch ────────────────────────────────────────────────────────────
    listDispatchableBots() {
      return db.telegramBot.findMany({
        where: {
          isEnabled: true,
          recipients: { some: { isEnabled: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    },

    async createDeliveryLogs(rows) {
      if (rows.length === 0) return 0;
      const result = await db.telegramDeliveryLog.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return result.count;
    },

    createDeliveryLog(data) {
      return db.telegramDeliveryLog.create({ data });
    },

    findDeliveryLog(id) {
      return db.telegramDeliveryLog.findUnique({ where: { id } });
    },

    async claimDeliveryLog(id, now) {
      // Atomic claim: only one worker can move PENDING -> PROCESSING.
      const result = await db.telegramDeliveryLog.updateMany({
        where: { id, status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
      });
      return result.count > 0;
    },

    updateDeliveryLog(id, data) {
      const patch: Prisma.TelegramDeliveryLogUpdateInput = {};
      if (data.status !== undefined) patch.status = data.status;
      if (data.telegramMessageId !== undefined) patch.telegramMessageId = data.telegramMessageId;
      if (data.errorMessage !== undefined) patch.errorMessage = data.errorMessage;
      if (data.attemptCount !== undefined) patch.attemptCount = data.attemptCount;
      if (data.nextAttemptAt !== undefined) patch.nextAttemptAt = data.nextAttemptAt;
      if (data.sentAt !== undefined) patch.sentAt = data.sentAt;
      return db.telegramDeliveryLog.update({ where: { id }, data: patch });
    },

    async listDueDeliveries(now, limit): Promise<TelegramDeliveryJob[]> {
      const rows = await db.telegramDeliveryLog.findMany({
        where: {
          status: 'PENDING',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        include: deliveryJobInclude,
      });

      return rows.map((row) => ({
        delivery: toDeliveryRecord(row),
        bot: row.bot,
        recipient: row.recipient,
        event: row.event
          ? {
            id: row.event.id,
            eventType: row.event.eventType,
            confidence: row.event.confidence,
            timestamp: row.event.timestamp,
            isAlert: row.event.isAlert,
            imageUrl: row.event.imageUrl,
            videoUrl: row.event.videoUrl,
            camera: row.event.camera,
          }
          : null,
      }));
    },

    async listDeliveryLogs(query: TelegramDeliveryLogQuery): Promise<TelegramDeliveryLogPage> {
      const where: Prisma.TelegramDeliveryLogWhereInput = {};

      if (query.botId) where.botId = query.botId;
      if (query.status) where.status = query.status;
      if (query.eventId) where.eventId = query.eventId;
      if (query.eventType) where.event = { eventType: query.eventType as never };
      if (query.from || query.to) {
        where.createdAt = {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        };
      }

      const [rows, total] = await Promise.all([
        db.telegramDeliveryLog.findMany({
          where,
          include: deliveryInclude,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        db.telegramDeliveryLog.count({ where }),
      ]);

      return {
        rows: rows.map((row) => ({ ...toDeliveryRecord(row), bot: row.bot, recipient: row.recipient, event: row.event })) as TelegramDeliveryLogRow[],
        total,
        page: query.page,
        limit: query.limit,
      };
    },
  };
}

/** Shared singleton store bound to the application Prisma client. */
export const telegramStore = createPrismaTelegramStore();

export type { TelegramBotRecord, TelegramRecipientRecord, TelegramRuleRecord };
