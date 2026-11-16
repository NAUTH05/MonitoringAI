/**
 * Telegram bot / recipient / rule management.
 *
 * This layer owns every business rule that is not "talk to Telegram" (that is
 * `telegram.client.ts`) or "store a row" (that is `telegram.store.ts`):
 * token validation, encryption, masking, uniqueness, rule evaluation and the
 * public serialisation that guarantees a plaintext token never leaves the
 * server.
 */
import { TelegramApiError } from './telegram.client';
import { decryptToken, encryptToken, isEncryptionConfigured, encryptionKeySource, looksLikeBotToken, maskEncryptedToken } from './telegram.crypto';
import { TelegramHttpError } from './telegram.errors';
import { buildTestMessage } from './telegram.formatter';
import type {
  PublicTelegramBot,
  TelegramBotRecord,
  TelegramChatInfo,
  TelegramClientLike,
  TelegramDeliveryLogPage,
  TelegramDeliveryLogQuery,
  TelegramDeliveryStatus,
  TelegramEventType,
  TelegramRecipientRecord,
  TelegramRuleRecord,
  TelegramStore,
} from './telegram.types';
import { TELEGRAM_EVENT_TYPES } from './telegram.types';

export interface PublicTelegramRecipient {
  id: string;
  botId: string;
  chatId: string;
  name: string;
  chatType: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicTelegramRule {
  eventType: TelegramEventType;
  isEnabled: boolean;
  minConfidence: number | null;
  /** False when the row does not exist yet (defaults are applied in the UI). */
  configured: boolean;
}

export interface TestDeliveryResult {
  target: string;
  chatId: string | null;
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface TelegramServiceDeps {
  store: TelegramStore;
  client: TelegramClientLike;
  /** Frontend base URL for the "View Event Details" link. */
  dashboardUrl?: () => string | null;
  now?: () => Date;
}

export interface TelegramService {
  encryptionInfo(): { configured: boolean; keySource: string | null };
  listBots(): Promise<PublicTelegramBot[]>;
  getBot(id: string): Promise<PublicTelegramBot>;
  createBot(input: { name: string; token: string; isEnabled?: boolean }): Promise<PublicTelegramBot>;
  updateBot(
    id: string,
    input: { name?: string; token?: string | null; isEnabled?: boolean },
  ): Promise<PublicTelegramBot>;
  deleteBot(id: string): Promise<void>;
  verifyBot(id: string): Promise<PublicTelegramBot>;
  sendTest(
    botId: string,
    input: { recipientId?: string; chatId?: string; text?: string },
  ): Promise<{ results: TestDeliveryResult[] }>;
  listRecipients(botId: string): Promise<PublicTelegramRecipient[]>;
  addRecipient(
    botId: string,
    input: { chatId: string; name: string; chatType?: string | null; isEnabled?: boolean },
  ): Promise<PublicTelegramRecipient>;
  updateRecipient(
    recipientId: string,
    input: { name?: string; chatId?: string; chatType?: string | null; isEnabled?: boolean },
  ): Promise<PublicTelegramRecipient>;
  deleteRecipient(recipientId: string): Promise<void>;
  testRecipient(recipientId: string): Promise<TestDeliveryResult>;
  getRules(botId: string): Promise<PublicTelegramRule[]>;
  setRules(
    botId: string,
    rules: { eventType: string; isEnabled: boolean; minConfidence?: number | null }[],
  ): Promise<PublicTelegramRule[]>;
  listDeliveryLogs(query: TelegramDeliveryLogQuery): Promise<TelegramDeliveryLogPage>;
  discoverChats(botId: string): Promise<(TelegramChatInfo & { saved: boolean })[]>;
}

const CHAT_ID_RE = /^-?\d{3,20}$/;

/** Chat ids are numeric; a supergroup id starts with -100. */
export function normalizeChatId(raw: string): string {
  const value = raw.trim();
  if (!CHAT_ID_RE.test(value)) {
    throw new TelegramHttpError(
      400,
      'Chat ID không hợp lệ — phải là dãy số (nhóm/supergroup có dấu trừ ở đầu).',
    );
  }
  return value;
}

function serializeRecipient(row: TelegramRecipientRecord): PublicTelegramRecipient {
  return {
    id: row.id,
    botId: row.botId,
    chatId: row.chatId,
    name: row.name,
    chatType: row.chatType,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertEventType(value: string): TelegramEventType {
  if (!(TELEGRAM_EVENT_TYPES as readonly string[]).includes(value)) {
    throw new TelegramHttpError(400, `Loại sự kiện không hỗ trợ: ${value}`);
  }
  return value as TelegramEventType;
}

function cleanName(raw: string, field: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < 1) throw new TelegramHttpError(400, `${field} không được để trống.`);
  if (value.length > 80) throw new TelegramHttpError(400, `${field} quá dài (tối đa 80 ký tự).`);
  return value;
}

/** Map a Telegram client failure to a user-facing HTTP error (token never included). */
function toHttpError(err: unknown, action: string): TelegramHttpError {
  if (err instanceof TelegramApiError) {
    if (err.invalidToken) {
      return new TelegramHttpError(400, 'Bot token không hợp lệ hoặc đã bị thu hồi.');
    }
    if (err.kind === 'RATE_LIMIT') {
      return new TelegramHttpError(429, 'Telegram đang giới hạn tần suất, vui lòng thử lại sau.');
    }
    return new TelegramHttpError(502, `Không ${action} được: ${err.message}`);
  }
  return new TelegramHttpError(502, `Không ${action} được: ${(err as Error)?.message ?? 'lỗi không xác định'}`);
}

export function createTelegramService(deps: TelegramServiceDeps): TelegramService {
  const { store, client } = deps;
  const now = deps.now ?? (() => new Date());
  const dashboardUrl = deps.dashboardUrl ?? (() => process.env.DASHBOARD_BASE_URL ?? process.env.FRONTEND_URL ?? null);

  async function serializeBot(bot: TelegramBotRecord): Promise<PublicTelegramBot> {
    const [counts, ruleCount] = await Promise.all([
      store.countRecipients(bot.id),
      store.countRules(bot.id),
    ]);

    return {
      id: bot.id,
      name: bot.name,
      username: bot.username,
      isEnabled: bot.isEnabled,
      isVerified: bot.isVerified,
      lastVerifiedAt: bot.lastVerifiedAt ? bot.lastVerifiedAt.toISOString() : null,
      lastError: bot.lastError,
      createdAt: bot.createdAt.toISOString(),
      updatedAt: bot.updatedAt.toISOString(),
      tokenMasked: maskEncryptedToken(bot.tokenEncrypted) ?? '••••••••',
      recipientCount: counts.total,
      enabledRecipientCount: counts.enabled,
      ruleCount,
    };
  }

  async function requireBot(id: string): Promise<TelegramBotRecord> {
    const bot = await store.findBot(id);
    if (!bot) throw new TelegramHttpError(404, 'Không tìm thấy bot Telegram.');
    return bot;
  }

  function requireToken(bot: TelegramBotRecord): string {
    const token = decryptToken(bot.tokenEncrypted);
    if (!token) {
      throw new TelegramHttpError(
        409,
        'Không giải mã được bot token (khoá mã hoá đã thay đổi?). Hãy nhập lại token cho bot này.',
      );
    }
    return token;
  }

  /** Verify a token with Telegram and return the bot metadata (never stored raw). */
  async function verifyToken(token: string): Promise<{ username: string; firstName: string }> {
    try {
      const me = await client.getMe(token);
      return { username: me.username, firstName: me.firstName };
    } catch (err) {
      throw toHttpError(err, 'xác thực bot');
    }
  }

  async function deliverTest(
    bot: TelegramBotRecord,
    target: { recipient?: TelegramRecipientRecord | null; chatId?: string; label: string },
  ): Promise<TestDeliveryResult> {
    const token = decryptToken(bot.tokenEncrypted);
    if (!token) {
      return {
        target: target.label,
        chatId: target.chatId ?? target.recipient?.chatId ?? null,
        ok: false,
        error: 'Không giải mã được bot token.',
      };
    }

    const chatId = target.chatId ?? target.recipient?.chatId;
    if (!chatId) {
      return { target: target.label, chatId: null, ok: false, error: 'Thiếu chat ID.' };
    }

    const message = buildTestMessage(bot.name, target.recipient?.name ?? null, {
      dashboardUrl: dashboardUrl(),
    });

    // Test sends are recorded too, so the delivery history shows them
    // (eventId is null => the UI labels the row as a test message).
    const log = await store.createDeliveryLog({
      botId: bot.id,
      recipientId: target.recipient?.id ?? null,
      eventId: null,
      status: 'PROCESSING',
      nextAttemptAt: null,
    });

    try {
      const sent = await client.sendMessage(token, chatId, message.html);
      await store.updateDeliveryLog(log.id, {
        status: 'SENT',
        telegramMessageId: sent.messageId,
        sentAt: now(),
        attemptCount: 1,
        errorMessage: null,
      });
      return { target: target.label, chatId, ok: true, messageId: sent.messageId };
    } catch (err) {
      const apiError = err instanceof TelegramApiError ? err : null;
      const message2 = (err as Error)?.message ?? 'Gửi thất bại';
      await store.updateDeliveryLog(log.id, {
        status: 'FAILED',
        errorMessage: message2.slice(0, 500),
        attemptCount: 1,
        nextAttemptAt: null,
      });
      if (apiError?.invalidToken) {
        await store.updateBot(bot.id, {
          isVerified: false,
          lastError: 'Telegram từ chối bot token.',
        });
      }
      return { target: target.label, chatId, ok: false, error: message2 };
    }
  }

  /** Effective rule set: every supported event type, with row-less defaults. */
  async function rulesFor(botId: string): Promise<PublicTelegramRule[]> {
    const rows = await store.listRules(botId);
    const byType = new Map<string, TelegramRuleRecord>(rows.map((r) => [r.eventType, r]));

    return TELEGRAM_EVENT_TYPES.map((eventType) => {
      const row = byType.get(eventType);
      return {
        eventType,
        isEnabled: row?.isEnabled ?? false,
        minConfidence: row?.minConfidence ?? null,
        configured: Boolean(row),
      };
    });
  }

  return {
    encryptionInfo() {
      return { configured: isEncryptionConfigured(), keySource: encryptionKeySource() };
    },

    async listBots() {
      const bots = await store.listBots();
      return Promise.all(bots.map(serializeBot));
    },

    async getBot(id) {
      return serializeBot(await requireBot(id));
    },

    async createBot(input) {
      const name = cleanName(input.name, 'Tên bot');
      const token = input.token.trim();

      if (!looksLikeBotToken(token)) {
        throw new TelegramHttpError(
          400,
          'Bot token sai định dạng. Token BotFather có dạng 123456789:AA... (không có khoảng trắng).',
        );
      }
      if (!isEncryptionConfigured()) {
        throw new TelegramHttpError(
          503,
          'TELEGRAM_ENCRYPTION_KEY chưa được cấu hình trên server — không thể lưu token an toàn.',
        );
      }

      const existingByName = await store.findBotByName(name);
      if (existingByName) {
        throw new TelegramHttpError(409, 'Đã có bot Telegram trùng tên.');
      }

      // Validate with Telegram BEFORE persisting: an invalid token is never saved.
      const me = await verifyToken(token);

      const sameUsername = (await store.listBots()).find(
        (b) => b.username && b.username.toLowerCase() === me.username.toLowerCase(),
      );
      if (sameUsername) {
        throw new TelegramHttpError(
          409,
          `Bot @${me.username} đã được đăng ký (${sameUsername.name}).`,
        );
      }

      const bot = await store.createBot({
        name,
        username: me.username,
        tokenEncrypted: encryptToken(token) as string,
        isEnabled: input.isEnabled ?? true,
        isVerified: true,
        lastVerifiedAt: now(),
      });

      // Sensible default so a freshly added bot starts alerting on intrusions.
      await store.upsertRule(bot.id, 'INTRUSION', { isEnabled: true, minConfidence: null });

      return serializeBot(bot);
    },

    async updateBot(id, input) {
      const bot = await requireBot(id);
      const patch: Parameters<TelegramStore['updateBot']>[1] = {};

      if (input.name !== undefined) {
        const name = cleanName(input.name, 'Tên bot');
        const clash = await store.findBotByName(name);
        if (clash && clash.id !== bot.id) {
          throw new TelegramHttpError(409, 'Đã có bot Telegram trùng tên.');
        }
        patch.name = name;
      }

      // Empty token => keep the current one (the UI never receives it back).
      if (input.token !== undefined && input.token !== null && input.token.trim() !== '') {
        const token = input.token.trim();
        if (!looksLikeBotToken(token)) {
          throw new TelegramHttpError(400, 'Bot token sai định dạng.');
        }
        const me = await verifyToken(token);
        const clash = (await store.listBots()).find(
          (b) => b.id !== bot.id && b.username && b.username.toLowerCase() === me.username.toLowerCase(),
        );
        if (clash) {
          throw new TelegramHttpError(409, `Bot @${me.username} đã được đăng ký (${clash.name}).`);
        }
        patch.tokenEncrypted = encryptToken(token) as string;
        patch.username = me.username;
        patch.isVerified = true;
        patch.lastVerifiedAt = now();
        patch.lastError = null;
      }

      if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled;

      const updated = await store.updateBot(id, patch);
      return serializeBot(updated);
    },

    async deleteBot(id) {
      await requireBot(id);
      await store.deleteBot(id);
    },

    async verifyBot(id) {
      const bot = await requireBot(id);
      const token = decryptToken(bot.tokenEncrypted);

      if (!token) {
        await store.updateBot(id, {
          isVerified: false,
          lastError: 'Không giải mã được bot token.',
        });
        throw new TelegramHttpError(409, 'Không giải mã được bot token — hãy nhập lại token.');
      }

      try {
        const me = await client.getMe(token);
        const updated = await store.updateBot(id, {
          username: me.username,
          isVerified: true,
          lastVerifiedAt: now(),
          lastError: null,
        });
        return serializeBot(updated);
      } catch (err) {
        const apiError = err instanceof TelegramApiError ? err : null;
        const reason = (err as Error)?.message ?? 'Không xác thực được bot';

        if (apiError?.invalidToken) {
          // A revoked token can never work again: flag AND disable the bot so
          // the dispatcher stops queueing deliveries for it.
          await store.updateBot(id, {
            isVerified: false,
            isEnabled: false,
            lastError: 'Telegram từ chối bot token — bot đã bị tắt.',
          });
        } else {
          await store.updateBot(id, {
            isVerified: false,
            lastError: reason.slice(0, 300),
          });
        }

        throw toHttpError(err, 'xác thực bot');
      }
    },

    async sendTest(botId, input) {
      const bot = await requireBot(botId);

      if (input.recipientId) {
        const recipient = await store.findRecipient(input.recipientId);
        if (!recipient || recipient.botId !== bot.id) {
          throw new TelegramHttpError(404, 'Không tìm thấy người nhận cho bot này.');
        }
        return { results: [await deliverTest(bot, { recipient, label: recipient.name })] };
      }

      if (input.chatId) {
        const chatId = normalizeChatId(input.chatId);
        return {
          results: [await deliverTest(bot, { chatId, label: input.chatId.trim() })],
        };
      }

      const recipients = (await store.listRecipients(bot.id)).filter((r) => r.isEnabled);
      if (recipients.length === 0) {
        throw new TelegramHttpError(
          400,
          'Bot chưa có người nhận nào đang bật. Hãy thêm chat ID trước khi gửi thử.',
        );
      }

      // Sequential on purpose: keeps us inside Telegram's per-chat rate limit
      // and makes partial failures easy to report.
      const results: TestDeliveryResult[] = [];
      for (const recipient of recipients) {
        results.push(await deliverTest(bot, { recipient, label: recipient.name }));
      }
      return { results };
    },

    async listRecipients(botId) {
      await requireBot(botId);
      const rows = await store.listRecipients(botId);
      return rows.map(serializeRecipient);
    },

    async addRecipient(botId, input) {
      await requireBot(botId);
      const chatId = normalizeChatId(input.chatId);
      const name = cleanName(input.name, 'Tên người nhận');

      const existing = await store.findRecipientByChatId(botId, chatId);
      if (existing) {
        throw new TelegramHttpError(409, `Chat ID ${chatId} đã có trong danh sách của bot này.`);
      }

      const created = await store.createRecipient({
        botId,
        chatId,
        name,
        chatType: input.chatType ?? null,
        isEnabled: input.isEnabled ?? true,
      });
      return serializeRecipient(created);
    },

    async updateRecipient(recipientId, input) {
      const recipient = await store.findRecipient(recipientId);
      if (!recipient) throw new TelegramHttpError(404, 'Không tìm thấy người nhận.');

      const patch: Parameters<TelegramStore['updateRecipient']>[1] = {};

      if (input.name !== undefined) patch.name = cleanName(input.name, 'Tên người nhận');
      if (input.chatId !== undefined) {
        const chatId = normalizeChatId(input.chatId);
        if (chatId !== recipient.chatId) {
          const clash = await store.findRecipientByChatId(recipient.botId, chatId);
          if (clash) throw new TelegramHttpError(409, `Chat ID ${chatId} đã tồn tại cho bot này.`);
          patch.chatId = chatId;
        }
      }
      if (input.chatType !== undefined) patch.chatType = input.chatType;
      if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled;

      const updated = await store.updateRecipient(recipientId, patch);
      return serializeRecipient(updated);
    },

    async deleteRecipient(recipientId) {
      const recipient = await store.findRecipient(recipientId);
      if (!recipient) throw new TelegramHttpError(404, 'Không tìm thấy người nhận.');
      await store.deleteRecipient(recipientId);
    },

    async testRecipient(recipientId) {
      const recipient = await store.findRecipient(recipientId);
      if (!recipient) throw new TelegramHttpError(404, 'Không tìm thấy người nhận.');
      const bot = await requireBot(recipient.botId);
      return deliverTest(bot, { recipient, label: recipient.name });
    },

    async getRules(botId) {
      await requireBot(botId);
      return rulesFor(botId);
    },

    async setRules(botId, rules) {
      await requireBot(botId);

      const seen = new Set<string>();
      const normalized = rules.map((rule) => {
        const eventType = assertEventType(rule.eventType);
        if (seen.has(eventType)) {
          throw new TelegramHttpError(400, `Loại sự kiện bị lặp: ${eventType}`);
        }
        seen.add(eventType);

        if (
          rule.minConfidence !== undefined
          && rule.minConfidence !== null
          && (Number.isNaN(rule.minConfidence) || rule.minConfidence < 0 || rule.minConfidence > 1)
        ) {
          throw new TelegramHttpError(400, `Ngưỡng tin cậy của ${eventType} phải trong khoảng 0..1.`);
        }

        return {
          eventType,
          isEnabled: Boolean(rule.isEnabled),
          minConfidence: rule.minConfidence ?? null,
        };
      });

      await store.replaceRules(botId, normalized);
      return rulesFor(botId);
    },

    listDeliveryLogs(query) {
      return store.listDeliveryLogs(query);
    },

    async discoverChats(botId) {
      const bot = await requireBot(botId);
      const token = requireToken(bot);

      let chats: TelegramChatInfo[];
      try {
        chats = await client.getUpdates(token);
      } catch (err) {
        throw toHttpError(err, 'đọc danh sách chat');
      }

      const saved = new Set((await store.listRecipients(botId)).map((r) => r.chatId));
      return chats.map((chat) => ({ ...chat, saved: saved.has(chat.chatId) }));
    },
  };
}

export type { TelegramDeliveryStatus };
