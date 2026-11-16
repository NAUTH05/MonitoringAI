/**
 * Alert → Telegram delivery pipeline.
 *
 * Design goals (in order):
 *  1. NEVER break event ingest. `enqueueAlert` swallows every error and the
 *     caller fires it without awaiting, so a Telegram outage can neither fail
 *     nor slow down `POST /api/events`.
 *  2. Durability. A delivery is a row in `telegram_delivery_logs`; the worker
 *     drains PENDING rows, so a restart does not lose queued alerts.
 *  3. No duplicates. The unique index (event, bot, recipient) plus an atomic
 *     PENDING→PROCESSING claim guarantee one message per target.
 *  4. Bounded retries. Transient failures are retried with exponential
 *     backoff; permanent ones (bad chat, blocked bot, revoked token) stop
 *     immediately.
 */
import { TelegramApiError } from './telegram.client';
import { decryptToken } from './telegram.crypto';
import { buildAlertMessage } from './telegram.formatter';
import type {
  TelegramClientLike,
  TelegramDeliveryJob,
  TelegramEventInfo,
  TelegramStore,
} from './telegram.types';

/** Telegram captions are capped at 1024 characters. */
const MAX_PHOTO_CAPTION = 1024;

export interface TelegramDispatcherDeps {
  store: TelegramStore;
  client: TelegramClientLike;
  dashboardUrl?: () => string | null;
  now?: () => Date;
  /** Total attempts per delivery before it is marked FAILED. */
  maxAttempts?: number;
  /** First retry delay; doubles per attempt, capped at 5 minutes. */
  retryBaseMs?: number;
  batchSize?: number;
  logger?: Pick<Console, 'warn' | 'error' | 'info'>;
}

export interface EnqueueResult {
  enqueued: number;
  reason?: 'not-an-alert' | 'no-bots' | 'no-rule' | 'error';
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
}

export interface TelegramDispatcher {
  enqueueAlert(event: TelegramEventInfo): Promise<EnqueueResult>;
  processDue(limit?: number): Promise<ProcessResult>;
  start(intervalMs?: number): void;
  stop(): void;
  isRunning(): boolean;
}

const EMPTY_RESULT: ProcessResult = {
  processed: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  retried: 0,
};

export function createTelegramDispatcher(deps: TelegramDispatcherDeps): TelegramDispatcher {
  const { store, client } = deps;
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? console;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  const retryBaseMs = deps.retryBaseMs ?? 5_000;
  const batchSize = deps.batchSize ?? 20;
  const dashboardUrl = deps.dashboardUrl
    ?? (() => process.env.DASHBOARD_BASE_URL ?? process.env.FRONTEND_URL ?? null);

  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  function backoffMs(attempt: number): number {
    return Math.min(retryBaseMs * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
  }

  /**
   * Decide whether a bot wants this event: an enabled rule for the event type
   * and, when set, a confidence at or above the threshold.
   */
  async function botWantsEvent(botId: string, event: TelegramEventInfo): Promise<boolean> {
    const rules = await store.listRules(botId);
    const rule = rules.find((r) => r.eventType === event.eventType);
    if (!rule || !rule.isEnabled) return false;
    if (rule.minConfidence !== null && rule.minConfidence !== undefined) {
      if (event.confidence < rule.minConfidence) return false;
    }
    return true;
  }

  async function enqueueAlert(event: TelegramEventInfo): Promise<EnqueueResult> {
    try {
      if (!event.isAlert) return { enqueued: 0, reason: 'not-an-alert' };

      const bots = await store.listDispatchableBots();
      if (bots.length === 0) return { enqueued: 0, reason: 'no-bots' };

      const rows: {
        botId: string;
        recipientId: string;
        eventId: string;
        status: 'PENDING';
        nextAttemptAt: null;
      }[] = [];

      for (const bot of bots) {
        if (!(await botWantsEvent(bot.id, event))) continue;

        const recipients = (await store.listRecipients(bot.id)).filter((r) => r.isEnabled);
        for (const recipient of recipients) {
          rows.push({
            botId: bot.id,
            recipientId: recipient.id,
            eventId: event.id,
            status: 'PENDING',
            nextAttemptAt: null,
          });
        }
      }

      if (rows.length === 0) return { enqueued: 0, reason: 'no-rule' };

      // skipDuplicates => the (event, bot, recipient) unique index dedupes
      // retries of the same event without a read-then-write race.
      const enqueued = await store.createDeliveryLogs(rows);
      return { enqueued };
    } catch (err) {
      // The event pipeline must not care. Log a sanitized line and move on.
      logger.warn(`[telegram] enqueue failed: ${(err as Error)?.message ?? 'unknown error'}`);
      return { enqueued: 0, reason: 'error' };
    }
  }

  /** Send one job. Returns the outcome so the caller can update counters. */
  async function deliver(
    job: TelegramDeliveryJob,
    attempt: number,
  ): Promise<{ outcome: 'sent' | 'retry' | 'failed' | 'skipped'; error?: string; messageId?: string }> {
    const { delivery, bot, recipient, event } = job;

    if (!bot.isEnabled) return { outcome: 'skipped', error: 'Bot đã bị tắt' };
    if (!recipient) return { outcome: 'skipped', error: 'Người nhận đã bị xoá' };
    if (!recipient.isEnabled) return { outcome: 'skipped', error: 'Người nhận đã bị tắt' };
    if (!event) return { outcome: 'skipped', error: 'Sự kiện không còn tồn tại' };
    if (attempt > maxAttempts) {
      return { outcome: 'failed', error: `Vượt quá ${maxAttempts} lần thử` };
    }

    const token = decryptToken(bot.tokenEncrypted);
    if (!token) {
      return { outcome: 'failed', error: 'Không giải mã được bot token' };
    }

    const message = buildAlertMessage(event, { dashboardUrl: dashboardUrl() });

    try {
      let sent;
      if (message.photoUrl && message.html.length <= MAX_PHOTO_CAPTION) {
        try {
          sent = await client.sendPhoto(token, recipient.chatId, message.photoUrl, message.html);
        } catch (photoErr) {
          // Evidence image unavailable (unreachable host, Telegram cannot fetch
          // it, file expired) — degrade to text instead of losing the alert.
          logger.warn(
            `[telegram] sendPhoto failed for delivery ${delivery.id}, falling back to text: `
            + `${(photoErr as Error)?.message ?? 'unknown'}`,
          );
          sent = await client.sendMessage(token, recipient.chatId, message.html);
        }
      } else {
        sent = await client.sendMessage(token, recipient.chatId, message.html);
      }

      return { outcome: 'sent', messageId: sent.messageId };
    } catch (err) {
      const apiError = err instanceof TelegramApiError ? err : null;
      const reason = (err as Error)?.message ?? 'Gửi thất bại';

      if (apiError?.invalidToken) {
        // Revoked token: flag + disable so the queue stops growing.
        await store
          .updateBot(bot.id, {
            isVerified: false,
            isEnabled: false,
            lastError: 'Telegram từ chối bot token — bot đã bị tắt.',
          })
          .catch(() => undefined);
        return { outcome: 'failed', error: 'Bot token không hợp lệ — bot đã bị tắt.' };
      }

      if (apiError?.retryable) {
        return { outcome: 'retry', error: reason };
      }

      return { outcome: 'failed', error: reason };
    }
  }

  async function processJob(job: TelegramDeliveryJob, result: ProcessResult): Promise<void> {
    const { delivery } = job;

    // Pre-checks run before claiming so a disabled bot/recipient does not burn
    // an attempt counter.
    if (!job.bot.isEnabled) {
      await store.updateDeliveryLog(delivery.id, {
        status: 'SKIPPED',
        errorMessage: 'Bot đã bị tắt',
        nextAttemptAt: null,
      });
      result.skipped += 1;
      return;
    }
    if (!job.recipient || !job.recipient.isEnabled) {
      await store.updateDeliveryLog(delivery.id, {
        status: 'SKIPPED',
        errorMessage: job.recipient ? 'Người nhận đã bị tắt' : 'Người nhận đã bị xoá',
        nextAttemptAt: null,
      });
      result.skipped += 1;
      return;
    }
    if (!job.event) {
      await store.updateDeliveryLog(delivery.id, {
        status: 'SKIPPED',
        errorMessage: 'Sự kiện không còn tồn tại',
        nextAttemptAt: null,
      });
      result.skipped += 1;
      return;
    }

    const claimed = await store.claimDeliveryLog(delivery.id, now());
    if (!claimed) return; // another worker owns it, or it is not due anymore

    const attempt = delivery.attemptCount + 1;
    const outcome = await deliver(job, attempt);

    if (outcome.outcome === 'sent') {
      await store.updateDeliveryLog(delivery.id, {
        status: 'SENT',
        telegramMessageId: outcome.messageId ?? null,
        errorMessage: null,
        sentAt: now(),
        nextAttemptAt: null,
      });
      result.sent += 1;
      return;
    }

    if (outcome.outcome === 'skipped') {
      await store.updateDeliveryLog(delivery.id, {
        status: 'SKIPPED',
        errorMessage: outcome.error ?? null,
        nextAttemptAt: null,
      });
      result.skipped += 1;
      return;
    }

    if (outcome.outcome === 'retry' && attempt < maxAttempts) {
      await store.updateDeliveryLog(delivery.id, {
        status: 'PENDING',
        errorMessage: (outcome.error ?? 'Tạm thời thất bại').slice(0, 500),
        nextAttemptAt: new Date(now().getTime() + backoffMs(attempt)),
      });
      result.retried += 1;
      return;
    }

    await store.updateDeliveryLog(delivery.id, {
      status: 'FAILED',
      errorMessage: (outcome.error ?? 'Gửi thất bại').slice(0, 500),
      nextAttemptAt: null,
    });
    result.failed += 1;
  }

  async function processDue(limit?: number): Promise<ProcessResult> {
    const result: ProcessResult = { ...EMPTY_RESULT };

    let jobs: TelegramDeliveryJob[];
    try {
      jobs = await store.listDueDeliveries(now(), limit ?? batchSize);
    } catch (err) {
      logger.error(`[telegram] could not read the delivery queue: ${(err as Error)?.message ?? ''}`);
      return result;
    }

    for (const job of jobs) {
      result.processed += 1;
      try {
        await processJob(job, result);
      } catch (err) {
        // A single bad row must never stop the queue.
        logger.error(`[telegram] delivery ${job.delivery.id} crashed: ${(err as Error)?.message ?? ''}`);
        await store
          .updateDeliveryLog(job.delivery.id, {
            status: 'FAILED',
            errorMessage: ((err as Error)?.message ?? 'Worker error').slice(0, 500),
            nextAttemptAt: null,
          })
          .catch(() => undefined);
        result.failed += 1;
      }
    }

    return result;
  }

  return {
    enqueueAlert,
    processDue,

    start(intervalMs = 10_000) {
      if (timer) return;
      // unref so the worker never keeps a test process / CLI alive.
      timer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void processDue()
          .catch(() => undefined)
          .finally(() => {
            ticking = false;
          });
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    isRunning() {
      return timer !== null;
    },
  };
}
