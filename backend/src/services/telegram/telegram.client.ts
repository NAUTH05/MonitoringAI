/**
 * Thin, dependency-free Telegram Bot API client.
 *
 * Why not a library: the project already talks HTTP with `fetch` (undici) and
 * we need precise control over timeouts, retries and 429 `retry_after` so the
 * dispatcher can reschedule instead of blocking a worker.
 *
 * Hard rules enforced here:
 *  - The bot token is NEVER included in an error message or a log line
 *    (`redact()` scrubs it, including the `/bot<token>/` URL fragment).
 *  - Every response body is always consumed (`await res.text()`), even on an
 *    early return. An unconsumed body pauses undici's parser and crashes the
 *    whole Node process when the socket is torn down — see the go2rtc
 *    regression in `tests/go2rtc-fetch.test.ts`.
 */
import type {
  TelegramBotInfo,
  TelegramChatInfo,
  TelegramClientLike,
  TelegramSendResult,
} from './telegram.types';

const DEFAULT_BASE_URL = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 400;
/** Above this, a 429 is handed back to the queue instead of blocking a worker. */
const DEFAULT_MAX_INLINE_WAIT_MS = 10_000;

export type TelegramErrorKind =
  | 'CONFIG'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'HTTP'
  | 'API'
  | 'INVALID_TOKEN'
  | 'CHAT_NOT_FOUND'
  | 'FORBIDDEN'
  | 'RATE_LIMIT';

export class TelegramApiError extends Error {
  readonly kind: TelegramErrorKind;
  /** True when retrying later may succeed (network blip, 5xx, 429). */
  readonly retryable: boolean;
  /** True when the token itself is rejected — the bot must be flagged. */
  readonly invalidToken: boolean;
  readonly httpStatus?: number;
  readonly telegramCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      kind: TelegramErrorKind;
      retryable?: boolean;
      invalidToken?: boolean;
      httpStatus?: number;
      telegramCode?: number;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = 'TelegramApiError';
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
    this.invalidToken = options.invalidToken ?? false;
    this.httpStatus = options.httpStatus;
    this.telegramCode = options.telegramCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface TelegramClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  maxInlineWaitMs?: number;
  /** Injected in tests so retries do not actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/** Strip anything that looks like a bot token from a message destined for logs. */
export function redact(value: string, token?: string): string {
  let out = value;
  if (token) out = out.split(token).join('<redacted>');
  // Generic bot-token shape: 123456789:AA...  This also has to catch the token
  // embedded in a `/bot<token>/method` URL, where it follows the letters "bot"
  // — a leading \b would NOT match there, which is exactly the leak we fear.
  return out.replace(/\d{5,}:[A-Za-z0-9_-]{15,}/g, '<redacted>');
}

export class TelegramClient implements TelegramClientLike {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly maxInlineWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.TELEGRAM_API_BASE_URL ?? DEFAULT_BASE_URL)
      .replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.maxInlineWaitMs = options.maxInlineWaitMs ?? DEFAULT_MAX_INLINE_WAIT_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getMe(token: string): Promise<TelegramBotInfo> {
    const result = await this.call<{
      id: number;
      is_bot?: boolean;
      first_name?: string;
      username?: string;
      can_join_groups?: boolean;
      can_read_all_group_messages?: boolean;
    }>(token, 'getMe', {});

    if (!result || typeof result.id !== 'number' || !result.username) {
      throw new TelegramApiError('Telegram getMe returned an unexpected payload', {
        kind: 'API',
      });
    }

    return {
      id: result.id,
      username: result.username,
      firstName: result.first_name ?? result.username,
      canJoinGroups: result.can_join_groups,
      canReadAllGroupMessages: result.can_read_all_group_messages,
    };
  }

  async sendMessage(
    token: string,
    chatId: string,
    html: string,
    options: { disablePreview?: boolean } = {},
  ): Promise<TelegramSendResult> {
    const result = await this.call<{ message_id: number; chat?: { id: number } }>(
      token,
      'sendMessage',
      {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: options.disablePreview ?? true,
      },
    );

    return {
      messageId: String(result?.message_id ?? ''),
      chatId: String(result?.chat?.id ?? chatId),
    };
  }

  async sendPhoto(
    token: string,
    chatId: string,
    photoUrl: string,
    captionHtml: string,
  ): Promise<TelegramSendResult> {
    const result = await this.call<{ message_id: number; chat?: { id: number } }>(
      token,
      'sendPhoto',
      {
        chat_id: chatId,
        photo: photoUrl,
        caption: captionHtml,
        parse_mode: 'HTML',
      },
    );

    return {
      messageId: String(result?.message_id ?? ''),
      chatId: String(result?.chat?.id ?? chatId),
    };
  }

  /**
   * Discover chats the bot has recently seen. Used only as an optional helper
   * in the recipient dialog — a discovered chat still needs a real send to be
   * proven reachable (Telegram permissions are not implied).
   */
  async getUpdates(token: string, offset?: number): Promise<TelegramChatInfo[]> {
    const updates = await this.call<
      {
        message?: { chat?: RawChat; date?: number };
        edited_message?: { chat?: RawChat; date?: number };
        channel_post?: { chat?: RawChat; date?: number };
        my_chat_member?: { chat?: RawChat; date?: number };
      }[]
    >(token, 'getUpdates', {
      offset,
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'my_chat_member'],
    });

    const byChat = new Map<string, TelegramChatInfo>();

    for (const update of updates ?? []) {
      const node = update.message ?? update.edited_message ?? update.channel_post ?? update.my_chat_member;
      const chat = node?.chat;
      if (!chat || chat.id === undefined) continue;

      const chatId = String(chat.id);
      const seen = node?.date ? new Date(node.date * 1000) : new Date();
      const existing = byChat.get(chatId);

      if (!existing || existing.lastSeenAt < seen) {
        const personName = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
        byChat.set(chatId, {
          chatId,
          title: chat.title ?? (personName || (chat.username ? `@${chat.username}` : chatId)),
          chatType: chat.type ?? 'private',
          lastSeenAt: seen,
        });
      }
    }

    return [...byChat.values()].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  private async call<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
    if (!token) {
      throw new TelegramApiError('No bot token available', { kind: 'CONFIG' });
    }

    let lastError: TelegramApiError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.attempt<T>(token, method, payload);
      } catch (err) {
        const error = err instanceof TelegramApiError
          ? err
          : new TelegramApiError(redact((err as Error).message || 'Telegram request failed', token), {
            kind: 'NETWORK',
            retryable: true,
          });

        lastError = error;

        if (!error.retryable) throw error;
        if (attempt >= this.maxAttempts) throw error;

        // 429 with a long retry_after: give it back to the queue rather than
        // holding a worker (and the event loop) hostage.
        if (error.kind === 'RATE_LIMIT' && (error.retryAfterMs ?? 0) > this.maxInlineWaitMs) {
          throw error;
        }

        const wait = error.kind === 'RATE_LIMIT'
          ? Math.max(0, error.retryAfterMs ?? 0)
          : Math.min(this.retryBaseMs * 2 ** (attempt - 1), 4_000);

        if (wait > 0) await this.sleep(wait);
      }
    }

    throw lastError ?? new TelegramApiError('Telegram request failed', { kind: 'NETWORK' });
  }

  private async attempt<T>(
    token: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    let raw = '';

    try {
      res = await this.fetchImpl(`${this.baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Always drain the body: an unconsumed body can crash the process later.
      raw = await res.text().catch(() => '');
    } catch (err) {
      const isAbort = (err as Error)?.name === 'AbortError';
      throw new TelegramApiError(
        isAbort
          ? `Telegram request timed out after ${this.timeoutMs}ms`
          : `Telegram network error: ${redact((err as Error)?.message ?? 'unknown', token)}`,
        { kind: isAbort ? 'TIMEOUT' : 'NETWORK', retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    let body: TelegramApiResponse<T> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as TelegramApiResponse<T>) : null;
    } catch {
      body = null;
    }

    if (res.ok && body?.ok !== false) {
      return body?.result as T;
    }

    throw this.toApiError(res.status, body, raw, token);
  }

  private toApiError(
    status: number,
    body: TelegramApiResponse<unknown> | null,
    raw: string,
    token: string,
  ): TelegramApiError {
    const description = redact(body?.description ?? raw.slice(0, 300) ?? '', token) || `HTTP ${status}`;
    const telegramCode = body?.error_code ?? status;
    const retryAfterSeconds = body?.parameters?.retry_after;

    if (status === 429 || telegramCode === 429) {
      const retryAfterMs = (retryAfterSeconds ?? 1) * 1000;
      return new TelegramApiError(`Telegram rate limit: ${description}`, {
        kind: 'RATE_LIMIT',
        retryable: true,
        httpStatus: status,
        telegramCode,
        retryAfterMs,
      });
    }

    if (status === 401 || telegramCode === 401) {
      return new TelegramApiError(`Telegram rejected the bot token: ${description}`, {
        kind: 'INVALID_TOKEN',
        invalidToken: true,
        httpStatus: status,
        telegramCode,
      });
    }

    if (status === 403 || telegramCode === 403) {
      return new TelegramApiError(`Telegram refused the request: ${description}`, {
        kind: 'FORBIDDEN',
        httpStatus: status,
        telegramCode,
      });
    }

    if (status === 400 || telegramCode === 400) {
      const notFound = /chat not found|user not found|chat_id is empty|PEER_ID_INVALID/i.test(description);
      return new TelegramApiError(
        notFound ? `Telegram chat not reachable: ${description}` : `Telegram rejected the request: ${description}`,
        {
          kind: notFound ? 'CHAT_NOT_FOUND' : 'API',
          httpStatus: status,
          telegramCode,
        },
      );
    }

    if (status === 409) {
      return new TelegramApiError(
        `Telegram conflict (a webhook may be active): ${description}`,
        { kind: 'API', httpStatus: status, telegramCode },
      );
    }

    const retryable = status >= 500 || status === 408;
    return new TelegramApiError(`Telegram HTTP ${status}: ${description}`, {
      kind: 'HTTP',
      retryable,
      httpStatus: status,
      telegramCode,
    });
  }
}

interface RawChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** Shared singleton used by the HTTP layer and the dispatcher. */
export const telegramClient = new TelegramClient();
