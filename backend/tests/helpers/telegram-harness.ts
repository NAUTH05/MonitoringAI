/**
 * Test-only helpers for the Telegram module.
 *
 * `createMemoryTelegramStore` implements `TelegramStore` in memory (including
 * the unique constraints that matter: one recipient per chat id per bot, one
 * rule per event type per bot, one delivery per event+bot+recipient), and
 * `createFakeTelegramClient` stands in for the Bot API.
 */
import type {
  TelegramBotInfo,
  TelegramBotRecord,
  TelegramChatInfo,
  TelegramClientLike,
  TelegramDeliveryJob,
  TelegramDeliveryLogPage,
  TelegramDeliveryLogQuery,
  TelegramDeliveryLogRow,
  TelegramDeliveryRecord,
  TelegramDeliveryStatus,
  TelegramEventInfo,
  TelegramRecipientRecord,
  TelegramRuleRecord,
  TelegramSendResult,
  TelegramStore,
} from '../../src/services/telegram/telegram.types';

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${(seq += 1).toString().padStart(4, '0')}`;

export interface MemoryStore extends TelegramStore {
  /** Insert an event so `listDueDeliveries` can hydrate it. */
  seedEvent(event: TelegramEventInfo): void;
  snapshot(): {
    bots: TelegramBotRecord[];
    recipients: TelegramRecipientRecord[];
    rules: TelegramRuleRecord[];
    logs: TelegramDeliveryRecord[];
  };
  /** Force a failure on any store call (simulates the DB being down). */
  breakAll(reason?: string): void;
  repair(): void;
}

export function createMemoryTelegramStore(): MemoryStore {
  const bots: TelegramBotRecord[] = [];
  const recipients: TelegramRecipientRecord[] = [];
  const rules: TelegramRuleRecord[] = [];
  const logs: TelegramDeliveryRecord[] = [];
  const events = new Map<string, TelegramEventInfo>();
  let broken: string | null = null;

  function guard() {
    if (broken) throw new Error(broken);
  }

  const store: MemoryStore = {
    seedEvent(event) {
      events.set(event.id, event);
    },

    snapshot() {
      return {
        bots: [...bots],
        recipients: [...recipients],
        rules: [...rules],
        logs: [...logs],
      };
    },

    breakAll(reason = 'database unavailable') {
      broken = reason;
    },

    repair() {
      broken = null;
    },

    async listBots() {
      guard();
      return [...bots];
    },

    async findBot(id) {
      guard();
      return bots.find((b) => b.id === id) ?? null;
    },

    async findBotByName(name) {
      guard();
      return bots.find((b) => b.name.toLowerCase() === name.toLowerCase()) ?? null;
    },

    async createBot(data) {
      guard();
      const now = new Date();
      const row: TelegramBotRecord = {
        id: nextId('bot'),
        createdAt: now,
        updatedAt: now,
        lastError: null,
        ...data,
      };
      bots.push(row);
      return row;
    },

    async updateBot(id, data) {
      guard();
      const row = bots.find((b) => b.id === id);
      if (!row) throw new Error('bot not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },

    async deleteBot(id) {
      guard();
      const index = bots.findIndex((b) => b.id === id);
      if (index < 0) throw new Error('bot not found');
      bots.splice(index, 1);
      for (let i = recipients.length - 1; i >= 0; i -= 1) {
        if (recipients[i].botId === id) recipients.splice(i, 1);
      }
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        if (rules[i].botId === id) rules.splice(i, 1);
      }
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        if (logs[i].botId === id) logs.splice(i, 1);
      }
    },

    async listRecipients(botId) {
      guard();
      return recipients.filter((r) => r.botId === botId);
    },

    async findRecipient(id) {
      guard();
      return recipients.find((r) => r.id === id) ?? null;
    },

    async findRecipientByChatId(botId, chatId) {
      guard();
      return recipients.find((r) => r.botId === botId && r.chatId === chatId) ?? null;
    },

    async countRecipients(botId) {
      guard();
      const rows = recipients.filter((r) => r.botId === botId);
      return { total: rows.length, enabled: rows.filter((r) => r.isEnabled).length };
    },

    async createRecipient(data) {
      guard();
      if (recipients.some((r) => r.botId === data.botId && r.chatId === data.chatId)) {
        const err = new Error('Unique constraint failed on botId_chatId');
        (err as Error & { code?: string }).code = 'P2002';
        throw err;
      }
      const now = new Date();
      const row: TelegramRecipientRecord = { id: nextId('rcp'), createdAt: now, updatedAt: now, ...data };
      recipients.push(row);
      return row;
    },

    async updateRecipient(id, data) {
      guard();
      const row = recipients.find((r) => r.id === id);
      if (!row) throw new Error('recipient not found');
      if (data.chatId) {
        const clash = recipients.find(
          (r) => r.botId === row.botId && r.chatId === data.chatId && r.id !== id,
        );
        if (clash) {
          const err = new Error('Unique constraint failed on botId_chatId');
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },

    async deleteRecipient(id) {
      guard();
      const index = recipients.findIndex((r) => r.id === id);
      if (index < 0) throw new Error('recipient not found');
      recipients.splice(index, 1);
    },

    async listRules(botId) {
      guard();
      return rules.filter((r) => r.botId === botId);
    },

    async countRules(botId) {
      guard();
      return rules.filter((r) => r.botId === botId && r.isEnabled).length;
    },

    async upsertRule(botId, eventType, data) {
      guard();
      const existing = rules.find((r) => r.botId === botId && r.eventType === eventType);
      if (existing) {
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }
      const now = new Date();
      const row: TelegramRuleRecord = {
        id: nextId('rule'),
        botId,
        eventType,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      rules.push(row);
      return row;
    },

    async replaceRules(botId, incoming) {
      guard();
      const out: TelegramRuleRecord[] = [];
      for (const rule of incoming) {
        out.push(await store.upsertRule(botId, rule.eventType, {
          isEnabled: rule.isEnabled,
          minConfidence: rule.minConfidence,
        }));
      }
      return out;
    },

    async listDispatchableBots() {
      guard();
      return bots.filter(
        (b) => b.isEnabled && recipients.some((r) => r.botId === b.id && r.isEnabled),
      );
    },

    async createDeliveryLogs(rows) {
      guard();
      let created = 0;
      for (const row of rows) {
        const duplicate = logs.some(
          (l) =>
            l.eventId === row.eventId
            && l.botId === row.botId
            && l.recipientId === row.recipientId,
        );
        if (duplicate) continue;
        const now = new Date();
        logs.push({
          id: nextId('log'),
          botId: row.botId,
          recipientId: row.recipientId,
          eventId: row.eventId,
          status: row.status,
          telegramMessageId: null,
          errorMessage: null,
          attemptCount: 0,
          nextAttemptAt: row.nextAttemptAt,
          sentAt: null,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
      return created;
    },

    async createDeliveryLog(data) {
      guard();
      const now = new Date();
      const row: TelegramDeliveryRecord = {
        id: nextId('log'),
        telegramMessageId: null,
        errorMessage: null,
        attemptCount: 0,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      logs.push(row);
      return row;
    },

    async findDeliveryLog(id) {
      guard();
      return logs.find((l) => l.id === id) ?? null;
    },

    async claimDeliveryLog(id, now) {
      guard();
      const row = logs.find((l) => l.id === id);
      if (!row || row.status !== 'PENDING') return false;
      if (row.nextAttemptAt && row.nextAttemptAt > now) return false;
      row.status = 'PROCESSING';
      row.attemptCount += 1;
      row.updatedAt = new Date();
      return true;
    },

    async updateDeliveryLog(id, data) {
      guard();
      const row = logs.find((l) => l.id === id);
      if (!row) throw new Error('delivery log not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },

    async listDueDeliveries(now, limit): Promise<TelegramDeliveryJob[]> {
      guard();
      const due = logs
        .filter((l) => l.status === 'PENDING' && (!l.nextAttemptAt || l.nextAttemptAt <= now))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);

      return due.map((delivery) => ({
        // Copies, like Prisma: a claimed row must not mutate the job the worker
        // is already holding (the worker derives the attempt number from it).
        delivery: { ...delivery },
        bot: { ...(bots.find((b) => b.id === delivery.botId) as TelegramBotRecord) },
        recipient: recipients.find((r) => r.id === delivery.recipientId)
          ? { ...recipients.find((r) => r.id === delivery.recipientId)! }
          : null,
        event: delivery.eventId ? events.get(delivery.eventId) ?? null : null,
      }));
    },

    async listDeliveryLogs(query: TelegramDeliveryLogQuery): Promise<TelegramDeliveryLogPage> {
      guard();
      let rows: TelegramDeliveryLogRow[] = logs.map((l) => ({
        ...l,
        bot: bots.find((b) => b.id === l.botId) ?? null,
        recipient: recipients.find((r) => r.id === l.recipientId) ?? null,
        event: (l.eventId ? events.get(l.eventId) : null)
          ? {
            id: l.eventId as string,
            eventType: events.get(l.eventId as string)!.eventType,
            confidence: events.get(l.eventId as string)!.confidence,
            timestamp: events.get(l.eventId as string)!.timestamp,
          }
          : null,
      }));

      if (query.botId) rows = rows.filter((r) => r.botId === query.botId);
      if (query.status) rows = rows.filter((r) => r.status === query.status);
      if (query.eventType) rows = rows.filter((r) => r.event?.eventType === query.eventType);
      if (query.from) rows = rows.filter((r) => r.createdAt >= query.from!);
      if (query.to) rows = rows.filter((r) => r.createdAt <= query.to!);

      const total = rows.length;
      const start = (query.page - 1) * query.limit;
      return { rows: rows.slice(start, start + query.limit), total, page: query.page, limit: query.limit };
    },
  };

  return store;
}

export interface FakeClient extends TelegramClientLike {
  calls: { method: string; chatId?: string; text?: string; photoUrl?: string }[];
  /** Queue a failure for the next N sendMessage calls. */
  failSendsWith(err: Error, times?: number): void;
  /** Queue a failure for the next N sendPhoto calls. */
  failPhotosWith(err: Error, times?: number): void;
  failGetMeWith(err: Error): void;
  setChats(chats: TelegramChatInfo[]): void;
}

export function createFakeTelegramClient(options: {
  username?: string;
  botId?: number;
} = {}): FakeClient {
  const calls: FakeClient['calls'] = [];
  const queuedSendErrors: Error[] = [];
  const queuedPhotoErrors: Error[] = [];
  let getMeError: Error | null = null;
  let chats: TelegramChatInfo[] = [];
  let messageId = 100;

  return {
    calls,

    failSendsWith(err, times = 1) {
      for (let i = 0; i < times; i += 1) queuedSendErrors.push(err);
    },

    failPhotosWith(err, times = 1) {
      for (let i = 0; i < times; i += 1) queuedPhotoErrors.push(err);
    },

    failGetMeWith(err) {
      getMeError = err;
    },

    setChats(next) {
      chats = next;
    },

    async getMe(token: string): Promise<TelegramBotInfo> {
      calls.push({ method: 'getMe' });
      if (getMeError) throw getMeError;

      // Two tokens = two bots, like the real API (username is per token).
      const derivedId = Number(token.split(':')[0]) || 123456789;
      const derivedUsername = token === SECOND_TOKEN
        ? 'monitoring_second_bot'
        : 'monitoring_test_bot';

      return {
        id: options.botId ?? derivedId,
        username: options.username ?? derivedUsername,
        firstName: 'Monitoring Test',
      };
    },

    async sendMessage(_token, chatId, html): Promise<TelegramSendResult> {
      calls.push({ method: 'sendMessage', chatId, text: html });
      const error = queuedSendErrors.shift();
      if (error) throw error;
      messageId += 1;
      return { messageId: String(messageId), chatId };
    },

    async sendPhoto(_token, chatId, photoUrl, caption): Promise<TelegramSendResult> {
      calls.push({ method: 'sendPhoto', chatId, photoUrl, text: caption });
      const error = queuedPhotoErrors.shift();
      if (error) throw error;
      messageId += 1;
      return { messageId: String(messageId), chatId };
    },

    async getUpdates(): Promise<TelegramChatInfo[]> {
      calls.push({ method: 'getUpdates' });
      return chats;
    },
  };
}

export const VALID_TOKEN = '123456789:AAHtestTokenValue_abcdefghijklmnop';
export const SECOND_TOKEN = '987654321:BBKotherTokenValue_abcdefghijklmnop';

export function makeEvent(overrides: Partial<TelegramEventInfo> = {}): TelegramEventInfo {
  return {
    id: 'evt_0001',
    eventType: 'INTRUSION',
    confidence: 0.95,
    timestamp: new Date('2026-11-16T15:30:15Z'),
    isAlert: true,
    imageUrl: null,
    videoUrl: null,
    camera: { id: 'cam_0001', name: 'Main Entrance', location: 'Building A' },
    ...overrides,
  };
}

export type { TelegramDeliveryStatus };
