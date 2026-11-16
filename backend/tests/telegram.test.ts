/**
 * Telegram integration tests.
 *
 * Everything is hermetic: the Bot API is replaced by `createFakeTelegramClient`
 * and persistence by `createMemoryTelegramStore`, so the suite needs neither a
 * network nor a database. Each `describe` block maps to a numbered requirement
 * from the feature spec.
 *
 * Run:  npm test
 */
import './helpers/telegram-env';

import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createTelegramRouter } from '../src/routes/telegram';
import { TelegramApiError, TelegramClient, redact } from '../src/services/telegram/telegram.client';
import { decryptToken, encryptToken, maskToken } from '../src/services/telegram/telegram.crypto';
import { createTelegramDispatcher } from '../src/services/telegram/telegram.dispatcher';
import { TelegramHttpError } from '../src/services/telegram/telegram.errors';
import {
  buildAlertMessage,
  buildTestMessage,
  escapeHtml,
  formatEventTime,
  resolveEvidencePhotoUrl,
} from '../src/services/telegram/telegram.formatter';
import { createTelegramService } from '../src/services/telegram/telegram.service';
import {
  SECOND_TOKEN,
  VALID_TOKEN,
  createFakeTelegramClient,
  createMemoryTelegramStore,
  makeEvent,
} from './helpers/telegram-harness';

const silentLogger = { warn: () => undefined, error: () => undefined, info: () => undefined };
const DASHBOARD = 'http://localhost:3000';

function setup(options: { maxAttempts?: number; now?: () => Date } = {}) {
  const store = createMemoryTelegramStore();
  const client = createFakeTelegramClient();
  const service = createTelegramService({
    store,
    client,
    dashboardUrl: () => DASHBOARD,
  });
  const dispatcher = createTelegramDispatcher({
    store,
    client,
    dashboardUrl: () => DASHBOARD,
    retryBaseMs: 1,
    maxAttempts: options.maxAttempts ?? 3,
    now: options.now,
    logger: silentLogger,
  });

  // The Prisma store joins the persisted Event row when it hydrates a delivery.
  // The in-memory store needs that row seeded first, so every enqueue registers
  // its event — this keeps the tests exercising the same join the worker does.
  const enqueue = (event: ReturnType<typeof makeEvent>) => {
    store.seedEvent(event);
    return dispatcher.enqueueAlert(event);
  };

  return { store, client, service, dispatcher: { ...dispatcher, enqueueAlert: enqueue } };
}

/** jsonResponse builds the minimal `Response` shape the client touches. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function jwtFor(role: string): string {
  return jwt.sign({ id: 'usr_1', username: role.toLowerCase(), role }, process.env.JWT_SECRET as string, {
    expiresIn: '1h',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('1-2. bot registration', () => {
  it('adds a valid bot: getMe is called, the token is encrypted, INTRUSION is on by default', async () => {
    const { store, client, service } = setup();

    const bot = await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });

    assert.equal(bot.name, 'Ops Bot');
    assert.equal(bot.username, 'monitoring_test_bot');
    assert.equal(bot.isVerified, true);
    assert.equal(bot.isEnabled, true);
    assert.ok(bot.lastVerifiedAt);
    assert.equal(client.calls.filter((c) => c.method === 'getMe').length, 1);

    const stored = store.snapshot().bots[0];
    assert.ok(stored.tokenEncrypted.startsWith('tgb1:'), 'token must be stored encrypted');
    assert.ok(!stored.tokenEncrypted.includes('AAHtestTokenValue'), 'no plaintext in the row');
    assert.equal(decryptToken(stored.tokenEncrypted), VALID_TOKEN);

    const rules = await service.getRules(bot.id);
    assert.equal(rules.length, 8);
    assert.equal(rules.find((r) => r.eventType === 'INTRUSION')?.isEnabled, true);
    assert.equal(rules.find((r) => r.eventType === 'FIRE')?.isEnabled, false);
  });

  it('rejects an invalid token and persists nothing', async () => {
    const { store, client, service } = setup();
    client.failGetMeWith(
      new TelegramApiError('Unauthorized', { kind: 'INVALID_TOKEN', invalidToken: true, httpStatus: 401 }),
    );

    await assert.rejects(
      () => service.createBot({ name: 'Bad Bot', token: VALID_TOKEN }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 400,
    );
    assert.equal(store.snapshot().bots.length, 0);
  });

  it('rejects a malformed token without calling Telegram', async () => {
    const { client, service } = setup();
    await assert.rejects(
      () => service.createBot({ name: 'Bad Bot', token: 'not-a-token' }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 400,
    );
    assert.equal(client.calls.length, 0);
  });

  it('refuses a duplicate bot (same @username or same name)', async () => {
    // A client whose getMe always reports the same @username, so the second
    // token is recognised as the same Telegram bot.
    const store = createMemoryTelegramStore();
    const client = createFakeTelegramClient({ username: 'fixed_bot' });
    const service = createTelegramService({ store, client, dashboardUrl: () => DASHBOARD });

    await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });

    await assert.rejects(
      () => service.createBot({ name: 'Ops Bot', token: SECOND_TOKEN }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 409,
    );
    await assert.rejects(
      () => service.createBot({ name: 'Other', token: SECOND_TOKEN }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 409,
    );
    assert.equal(store.snapshot().bots.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3-4. token secrecy', () => {
  it('round-trips through AES-256-GCM with a random IV', () => {
    const a = encryptToken(VALID_TOKEN);
    const b = encryptToken(VALID_TOKEN);
    assert.ok(a && b);
    assert.notEqual(a, b, 'same plaintext must not produce the same ciphertext');
    assert.equal(decryptToken(a), VALID_TOKEN);
    assert.equal(decryptToken(b), VALID_TOKEN);
  });

  it('returns null (never throws) for tampered payloads or a rotated key', () => {
    const enc = encryptToken(VALID_TOKEN) as string;
    const parts = enc.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64')].join(':');
    assert.equal(decryptToken(tampered), null);
    assert.equal(decryptToken('garbage'), null);

    const original = process.env.TELEGRAM_ENCRYPTION_KEY;
    process.env.TELEGRAM_ENCRYPTION_KEY = 'another-key-000000000000000000000000';
    assert.equal(decryptToken(enc), null);
    process.env.TELEGRAM_ENCRYPTION_KEY = original;
  });

  it('masks tokens for the UI (id prefix + last 4 chars only)', () => {
    const masked = maskToken(VALID_TOKEN) as string;
    assert.ok(masked.includes('••••••••'));
    assert.ok(!masked.includes('AAHtestTokenValue'));
    assert.ok(masked.startsWith('1234'));
  });

  it('never exposes a plaintext token in any API-shaped response', async () => {
    const { service } = setup();
    const bot = await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });

    const serialized = JSON.stringify(bot);
    assert.ok(!serialized.includes('AAHtestTokenValue'));
    assert.ok(!serialized.includes(VALID_TOKEN));
    assert.ok(!('tokenEncrypted' in bot));
    assert.ok(!('token' in bot));
    assert.ok(serialized.includes('tokenMasked'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. enable / disable', () => {
  it('toggling isEnabled controls dispatch eligibility without a restart', async () => {
    const { store, service, dispatcher } = setup();
    const bot = await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111222333', name: 'On-call' });

    assert.equal((await store.listDispatchableBots()).length, 1);

    const disabled = await service.updateBot(bot.id, { isEnabled: false });
    assert.equal(disabled.isEnabled, false);
    assert.equal((await store.listDispatchableBots()).length, 0);

    const result = await dispatcher.enqueueAlert(makeEvent());
    assert.equal(result.enqueued, 0);
    assert.equal(store.snapshot().logs.length, 0);

    await service.updateBot(bot.id, { isEnabled: true });
    assert.equal((await dispatcher.enqueueAlert(makeEvent())).enqueued, 1);
  });

  it('replacing a token validates it first; an empty token keeps the stored one', async () => {
    const { store, service } = setup();
    const bot = await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });
    const original = store.snapshot().bots[0].tokenEncrypted;

    await service.updateBot(bot.id, { name: 'Renamed', token: '' });
    assert.equal(store.snapshot().bots[0].tokenEncrypted, original, 'empty token must be preserved');
    assert.equal(store.snapshot().bots[0].name, 'Renamed');

    const updated = await service.updateBot(bot.id, { token: SECOND_TOKEN });
    assert.equal(updated.username, 'monitoring_second_bot');
    assert.equal(decryptToken(store.snapshot().bots[0].tokenEncrypted), SECOND_TOKEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. recipients', () => {
  it('manages multiple recipients and blocks duplicate chat ids per bot', async () => {
    const { service } = setup();
    const bot = await service.createBot({ name: 'Ops Bot', token: VALID_TOKEN });

    const a = await service.addRecipient(bot.id, { chatId: '111', name: 'Private' });
    const b = await service.addRecipient(bot.id, { chatId: '-1001234567890', name: 'Security group', chatType: 'supergroup' });
    await service.addRecipient(bot.id, { chatId: '-987654321', name: 'Guards', chatType: 'group' });

    assert.equal((await service.listRecipients(bot.id)).length, 3);
    assert.equal(b.chatType, 'supergroup');

    await assert.rejects(
      () => service.addRecipient(bot.id, { chatId: '111', name: 'Duplicate' }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 409,
    );

    await assert.rejects(
      () => service.addRecipient(bot.id, { chatId: 'abc', name: 'Bad' }),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 400,
    );

    const toggled = await service.updateRecipient(a.id, { isEnabled: false });
    assert.equal(toggled.isEnabled, false);

    await service.deleteRecipient(a.id);
    assert.equal((await service.listRecipients(bot.id)).length, 2);
  });

  it('keeps recipients scoped to their own bot', async () => {
    const { service } = setup();
    const botA = await service.createBot({ name: 'A', token: VALID_TOKEN });
    const botB = await service.createBot({ name: 'B', token: SECOND_TOKEN });

    await service.addRecipient(botA.id, { chatId: '555', name: 'Only A' });

    assert.equal((await service.listRecipients(botB.id)).length, 0);
    // The same chat id is allowed on a different bot.
    const onB = await service.addRecipient(botB.id, { chatId: '555', name: 'Only B' });
    assert.equal(onB.botId, botB.id);
    assert.equal((await service.listRecipients(botA.id)).length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('7. independent notification rules', () => {
  it('applies each bot rule set and confidence threshold independently', async () => {
    const { service, dispatcher, store } = setup();

    const botA = await service.createBot({ name: 'A', token: VALID_TOKEN });
    const botB = await service.createBot({ name: 'B', token: SECOND_TOKEN });
    await service.addRecipient(botA.id, { chatId: '111', name: 'A-ops' });
    await service.addRecipient(botB.id, { chatId: '222', name: 'B-ops' });

    await service.setRules(botA.id, [
      { eventType: 'INTRUSION', isEnabled: true, minConfidence: 0.9 },
      { eventType: 'FIRE', isEnabled: false },
    ]);
    await service.setRules(botB.id, [
      { eventType: 'INTRUSION', isEnabled: false },
      { eventType: 'FIRE', isEnabled: true },
    ]);

    // INTRUSION @0.95 -> only bot A.
    await dispatcher.enqueueAlert(makeEvent({ id: 'evt_intrusion', eventType: 'INTRUSION', confidence: 0.95 }));
    let logs = store.snapshot().logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].botId, botA.id);

    // INTRUSION @0.5 -> below bot A's 0.9 threshold, bot B disabled it.
    await dispatcher.enqueueAlert(makeEvent({ id: 'evt_low', eventType: 'INTRUSION', confidence: 0.5 }));
    assert.equal(store.snapshot().logs.length, 1);

    // FIRE -> only bot B.
    await dispatcher.enqueueAlert(makeEvent({ id: 'evt_fire', eventType: 'FIRE', confidence: 0.9 }));
    logs = store.snapshot().logs;
    assert.equal(logs.length, 2);
    assert.equal(logs[1].botId, botB.id);
  });

  it('rejects an unsupported event type and an out-of-range threshold', async () => {
    const { service } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });

    await assert.rejects(
      () => service.setRules(bot.id, [{ eventType: 'ALIENS', isEnabled: true }]),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 400,
    );
    await assert.rejects(
      () => service.setRules(bot.id, [{ eventType: 'FIRE', isEnabled: true, minConfidence: 1.5 }]),
      (err: unknown) => err instanceof TelegramHttpError && err.status === 400,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('8-9. fan-out to multiple bots and recipients', () => {
  it('queues one delivery per enabled bot and recipient', async () => {
    const { service, dispatcher, store, client } = setup();

    const botA = await service.createBot({ name: 'A', token: VALID_TOKEN });
    const botB = await service.createBot({ name: 'B', token: SECOND_TOKEN });
    await service.addRecipient(botA.id, { chatId: '111', name: 'A1' });
    await service.addRecipient(botA.id, { chatId: '112', name: 'A2' });
    await service.addRecipient(botB.id, { chatId: '221', name: 'B1' });

    const result = await dispatcher.enqueueAlert(makeEvent());
    assert.equal(result.enqueued, 3);
    assert.equal(store.snapshot().logs.length, 3);

    const processed = await dispatcher.processDue();
    assert.equal(processed.processed, 3);
    assert.equal(processed.sent, 3);

    assert.equal(client.calls.filter((c) => c.method === 'sendMessage').length, 3);
    assert.deepEqual(
      store.snapshot().logs.map((l) => l.status),
      ['SENT', 'SENT', 'SENT'],
    );
    assert.ok(store.snapshot().logs.every((l) => l.sentAt instanceof Date));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('10-11. skipping', () => {
  it('skips disabled recipients at enqueue time', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    const off = await service.addRecipient(bot.id, { chatId: '111', name: 'Off' });
    await service.addRecipient(bot.id, { chatId: '222', name: 'On' });
    await service.updateRecipient(off.id, { isEnabled: false });

    const result = await dispatcher.enqueueAlert(makeEvent());
    assert.equal(result.enqueued, 1);
    assert.equal(store.snapshot().logs[0].recipientId !== off.id, true);
  });

  it('marks an already-queued delivery SKIPPED when the recipient is disabled later', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    const recipient = await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    await dispatcher.enqueueAlert(makeEvent());
    await service.updateRecipient(recipient.id, { isEnabled: false });

    const processed = await dispatcher.processDue();
    assert.equal(processed.skipped, 1);
    assert.equal(store.snapshot().logs[0].status, 'SKIPPED');
  });

  it('does not notify for non-alert events', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    const result = await dispatcher.enqueueAlert(makeEvent({ isAlert: false }));
    assert.equal(result.enqueued, 0);
    assert.equal(result.reason, 'not-an-alert');
    assert.equal(store.snapshot().logs.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('12. duplicate prevention', () => {
  it('delivers an event/bot/recipient exactly once, even if enqueued twice', async () => {
    const { service, dispatcher, store, client } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    const first = await dispatcher.enqueueAlert(makeEvent({ id: 'evt_dup' }));
    const second = await dispatcher.enqueueAlert(makeEvent({ id: 'evt_dup' }));

    assert.equal(first.enqueued, 1);
    assert.equal(second.enqueued, 0);
    assert.equal(store.snapshot().logs.length, 1);

    await dispatcher.processDue();
    await dispatcher.processDue();
    assert.equal(client.calls.filter((c) => c.method === 'sendMessage').length, 1);
  });

  it('claims a delivery atomically (second worker pass is a no-op)', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });
    await dispatcher.enqueueAlert(makeEvent());

    const [a, b] = await Promise.all([dispatcher.processDue(), dispatcher.processDue()]);
    assert.equal(a.sent + b.sent, 1);
    assert.equal(store.snapshot().logs[0].status, 'SENT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('13-14. Telegram failures', () => {
  it('marks a permanent API error FAILED without retrying', async () => {
    const { service, dispatcher, store, client } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    client.failSendsWith(
      new TelegramApiError('Telegram chat not reachable: Bad Request: chat not found', {
        kind: 'CHAT_NOT_FOUND',
        httpStatus: 400,
        telegramCode: 400,
      }),
    );

    await dispatcher.enqueueAlert(makeEvent());
    const processed = await dispatcher.processDue();

    assert.equal(processed.failed, 1);
    const log = store.snapshot().logs[0];
    assert.equal(log.status, 'FAILED');
    assert.equal(log.attemptCount, 1);
    assert.equal(log.nextAttemptAt, null, 'permanent failures must not be rescheduled');
    assert.ok(log.errorMessage?.includes('chat not found'));
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    let clock = new Date('2026-11-16T10:00:00Z');
    const { service, dispatcher, store, client } = setup({ now: () => clock });

    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    client.failSendsWith(
      new TelegramApiError('Telegram network error: ECONNRESET', { kind: 'NETWORK', retryable: true }),
    );

    await dispatcher.enqueueAlert(makeEvent());
    const first = await dispatcher.processDue();
    assert.equal(first.retried, 1);

    const log = store.snapshot().logs[0];
    assert.equal(log.status, 'PENDING');
    assert.ok(log.nextAttemptAt && log.nextAttemptAt > clock, 'retry must be scheduled in the future');

    // Not due yet.
    const early = await dispatcher.processDue();
    assert.equal(early.processed, 0);

    clock = new Date(clock.getTime() + 60_000);
    const second = await dispatcher.processDue();
    assert.equal(second.sent, 1);
    assert.equal(store.snapshot().logs[0].status, 'SENT');
    assert.equal(store.snapshot().logs[0].attemptCount, 2);
  });

  it('gives up after maxAttempts instead of retrying forever', async () => {
    let clock = new Date('2026-11-16T10:00:00Z');
    const { service, dispatcher, store, client } = setup({ now: () => clock, maxAttempts: 2 });

    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });
    client.failSendsWith(
      new TelegramApiError('Telegram network error', { kind: 'NETWORK', retryable: true }),
      5,
    );

    await dispatcher.enqueueAlert(makeEvent());
    await dispatcher.processDue();
    clock = new Date(clock.getTime() + 60_000);
    await dispatcher.processDue();

    const log = store.snapshot().logs[0];
    assert.equal(log.status, 'FAILED');
    assert.equal(log.attemptCount, 2);
    assert.equal(log.nextAttemptAt, null);
  });

  it('flags and disables a bot whose token is revoked', async () => {
    const { service, dispatcher, store, client } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    client.failSendsWith(
      new TelegramApiError('Unauthorized', { kind: 'INVALID_TOKEN', invalidToken: true, httpStatus: 401 }),
    );

    await dispatcher.enqueueAlert(makeEvent());
    await dispatcher.processDue();

    const stored = store.snapshot().bots[0];
    assert.equal(stored.isEnabled, false, 'a revoked token must disable the bot');
    assert.equal(stored.isVerified, false);
    assert.ok(stored.lastError);
    assert.ok(!stored.lastError?.includes('AAHtestTokenValue'));
    assert.equal(store.snapshot().logs[0].status, 'FAILED');
  });

  it('honours 429 retry_after inline and defers when the wait is too long', async () => {
    const sleeps: number[] = [];
    let call = 0;
    const client = new TelegramClient({
      maxAttempts: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        call += 1;
        if (call === 1) {
          return jsonResponse(
            { ok: false, error_code: 429, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } },
            429,
          );
        }
        return jsonResponse({ ok: true, result: { message_id: 7, chat: { id: 111 } } });
      },
    });

    const sent = await client.sendMessage(VALID_TOKEN, '111', '<b>hi</b>');
    assert.equal(sent.messageId, '7');
    assert.deepEqual(sleeps, [2000], 'must wait exactly retry_after');

    // A retry_after above the inline ceiling is handed back to the queue.
    const longWait = new TelegramClient({
      maxAttempts: 3,
      maxInlineWaitMs: 1_000,
      sleep: async () => undefined,
      fetchImpl: async () =>
        jsonResponse({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 60 } }, 429),
    });

    await assert.rejects(
      () => longWait.sendMessage(VALID_TOKEN, '111', 'x'),
      (err: unknown) => err instanceof TelegramApiError && err.kind === 'RATE_LIMIT' && err.retryAfterMs === 60_000,
    );
  });

  it('never leaks the token in an error message', async () => {
    const client = new TelegramClient({
      maxAttempts: 1,
      fetchImpl: async () => {
        throw new TypeError(`request to https://api.telegram.org/bot${VALID_TOKEN}/sendMessage failed`);
      },
    });

    await assert.rejects(
      () => client.sendMessage(VALID_TOKEN, '111', 'x'),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.ok(!message.includes('AAHtestTokenValue'), `token leaked: ${message}`);
        assert.ok(message.includes('<redacted>'));
        return true;
      },
    );

    assert.ok(!redact(`/bot${VALID_TOKEN}/getMe`).includes('AAHtestTokenValue'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('15. the event pipeline survives a Telegram outage', () => {
  it('enqueueAlert resolves (never throws) when persistence is broken', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    store.breakAll('connection terminated');

    const result = await dispatcher.enqueueAlert(makeEvent());
    assert.deepEqual(result, { enqueued: 0, reason: 'error' });
  });

  it('enqueueAlert resolves when the store is fine but nothing is configured', async () => {
    const { dispatcher } = setup();
    const result = await dispatcher.enqueueAlert(makeEvent());
    assert.equal(result.enqueued, 0);
    assert.equal(result.reason, 'no-bots');
  });

  it('processDue resolves and records FAILED when Telegram is unreachable', async () => {
    const { service, dispatcher, store, client } = setup({ maxAttempts: 1 });
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    client.failSendsWith(
      new TelegramApiError('Telegram network error: ENOTFOUND', { kind: 'NETWORK', retryable: true }),
    );

    await dispatcher.enqueueAlert(makeEvent());
    const processed = await dispatcher.processDue();
    assert.equal(processed.failed, 1);
    assert.equal(store.snapshot().logs[0].status, 'FAILED');
  });

  it('the worker loop never rejects (start/stop is safe with a broken store)', async () => {
    const { dispatcher, store } = setup();
    store.breakAll('database offline');
    dispatcher.start(5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(dispatcher.isRunning(), true);
    dispatcher.stop();
    assert.equal(dispatcher.isRunning(), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('16. Admin authorization', () => {
  const { service } = setup();
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', createTelegramRouter({ service }));

  let server: ReturnType<typeof app.listen>;
  let base = '';

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects anonymous requests with 401', async () => {
    const res = await fetch(`${base}/api/telegram/bots`);
    assert.equal(res.status, 401);
  });

  it('rejects Manager and Operator roles with 403', async () => {
    for (const role of ['Manager', 'Operator', 'Viewer']) {
      const res = await fetch(`${base}/api/telegram/bots`, {
        headers: { Authorization: `Bearer ${jwtFor(role)}` },
      });
      assert.equal(res.status, 403, `${role} must not manage Telegram bots`);
    }
  });

  it('allows Admin and returns no plaintext token', async () => {
    const res = await fetch(`${base}/api/telegram/bots`, {
      headers: { Authorization: `Bearer ${jwtFor('Admin')}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(!JSON.stringify(body).includes('AAHtestTokenValue'));
  });

  it('validates the request body on POST /bots', async () => {
    const res = await fetch(`${base}/api/telegram/bots`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtFor('Admin')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', token: 'x' }),
    });
    assert.equal(res.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('message formatting', () => {
  it('renders the documented alert layout with escaped values', () => {
    const { html } = buildAlertMessage(
      makeEvent({
        camera: { id: 'cam_0001', name: 'Gate <A> & "B"', location: 'Building A' },
      }),
      { dashboardUrl: DASHBOARD },
    );

    assert.ok(html.includes('🚨 <b>MONITORING AI - SECURITY ALERT</b>'));
    assert.ok(html.includes('<b>Event:</b> INTRUSION'));
    assert.ok(html.includes('<b>Confidence:</b> 95%'));
    assert.ok(html.includes('<b>Time:</b> 16/11/2026 22:30:15'), 'must use Asia/Ho_Chi_Minh');
    assert.ok(html.includes('Gate &lt;A&gt; &amp; &quot;B&quot;'), 'dynamic text must be escaped');
    assert.ok(html.includes(`/events?eventId=evt_0001`));
    assert.ok(html.includes('<b>Event ID:</b> <code>evt_0001</code>'));
  });

  it('formats timestamps in Asia/Ho_Chi_Minh regardless of the host timezone', () => {
    assert.equal(formatEventTime(new Date('2026-11-16T15:30:15Z')), '16/11/2026 22:30:15');
    assert.equal(formatEventTime(new Date('2026-01-01T00:00:00Z')), '01/01/2026 07:00:00');
  });

  it('escapes HTML metacharacters', () => {
    assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
  });

  it('only offers absolute http(s) evidence URLs to sendPhoto', () => {
    assert.equal(resolveEvidencePhotoUrl('http://example.com/a.jpg'), 'http://example.com/a.jpg');
    assert.equal(resolveEvidencePhotoUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
    assert.equal(resolveEvidencePhotoUrl('C:\\evidence\\a.jpg'), null);
    assert.equal(resolveEvidencePhotoUrl('file:///tmp/a.jpg'), null);
    assert.equal(resolveEvidencePhotoUrl('rtsp://cam/stream'), null);
    assert.equal(resolveEvidencePhotoUrl('/api/aicam-media/a.jpg'), null);
    assert.equal(
      resolveEvidencePhotoUrl('/api/aicam-media/a.jpg', 'https://mon.example.com'),
      'https://mon.example.com/api/aicam-media/a.jpg',
    );
  });

  it('attaches the photo and falls back to text when sendPhoto fails', async () => {
    const { service, dispatcher, store, client } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '111', name: 'On-call' });

    await dispatcher.enqueueAlert(makeEvent({ imageUrl: 'https://example.com/evidence.jpg' }));
    await dispatcher.processDue();
    assert.equal(client.calls.filter((c) => c.method === 'sendPhoto').length, 1);
    assert.equal(store.snapshot().logs[0].status, 'SENT');

    // sendPhoto fails (e.g. Telegram cannot fetch the URL) -> text still goes out.
    const second = setup();
    const bot2 = await second.service.createBot({ name: 'A', token: VALID_TOKEN });
    await second.service.addRecipient(bot2.id, { chatId: '222', name: 'On-call' });
    second.client.failPhotosWith(
      new TelegramApiError('wrong file identifier/HTTP URL specified', { kind: 'API' }),
    );

    await second.dispatcher.enqueueAlert(makeEvent({ id: 'evt_img', imageUrl: 'https://example.com/x.jpg' }));
    await second.dispatcher.processDue();

    assert.equal(second.client.calls.filter((c) => c.method === 'sendPhoto').length, 1);
    assert.equal(second.client.calls.filter((c) => c.method === 'sendMessage').length, 1);
    assert.equal(second.store.snapshot().logs[0].status, 'SENT');
  });

  it('builds a test message that names the bot', () => {
    const { html, plainText } = buildTestMessage('Ops Bot', 'On-call');
    assert.ok(html.includes('TEST MESSAGE'));
    assert.ok(html.includes('Ops Bot'));
    assert.ok(plainText.includes('Ops Bot'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('delivery history', () => {
  it('records per-recipient status and supports filtering + pagination', async () => {
    const { service, dispatcher, store } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.setRules(bot.id, [
      { eventType: 'INTRUSION', isEnabled: true },
      { eventType: 'FIRE', isEnabled: true },
    ]);
    await service.addRecipient(bot.id, { chatId: '111', name: 'One' });
    await service.addRecipient(bot.id, { chatId: '222', name: 'Two' });

    await dispatcher.enqueueAlert(makeEvent({ id: 'evt_1', eventType: 'INTRUSION' }));
    await dispatcher.processDue();
    await dispatcher.enqueueAlert(makeEvent({ id: 'evt_2', eventType: 'FIRE', confidence: 0.85 }));
    await dispatcher.processDue();

    const page = await service.listDeliveryLogs({ page: 1, limit: 3 });
    assert.equal(page.total, 4);
    assert.equal(page.rows.length, 3);

    const sent = await service.listDeliveryLogs({ page: 1, limit: 10, status: 'SENT' });
    assert.equal(sent.total, 4);

    const fire = await service.listDeliveryLogs({ page: 1, limit: 10, eventType: 'FIRE' });
    assert.equal(fire.total, 2);
    assert.ok(fire.rows.every((r) => r.event?.eventType === 'FIRE'));

    const byBot = await service.listDeliveryLogs({ page: 1, limit: 10, botId: bot.id });
    assert.equal(byBot.total, 4);

    assert.equal(store.snapshot().logs.length, 4);
  });

  it('discovers chats via getUpdates and marks saved ones', async () => {
    const { service, client } = setup();
    const bot = await service.createBot({ name: 'A', token: VALID_TOKEN });
    await service.addRecipient(bot.id, { chatId: '-100123', name: 'Saved group' });

    client.setChats([
      { chatId: '-100123', title: 'Saved group', chatType: 'supergroup', lastSeenAt: new Date() },
      { chatId: '999', title: 'New DM', chatType: 'private', lastSeenAt: new Date() },
    ]);

    const chats = await service.discoverChats(bot.id);
    assert.equal(chats.length, 2);
    assert.equal(chats.find((c) => c.chatId === '-100123')?.saved, true);
    assert.equal(chats.find((c) => c.chatId === '999')?.saved, false);
  });
});
