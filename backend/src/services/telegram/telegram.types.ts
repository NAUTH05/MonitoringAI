/**
 * Shared domain types for the Telegram integration.
 *
 * These are deliberately decoupled from Prisma models so the dispatcher, the
 * formatter and the automated tests can work with plain objects (and an
 * in-memory store) without a database.
 */

/** Event types the alert pipeline can emit (mirrors the Prisma EventType enum). */
export const TELEGRAM_EVENT_TYPES = [
  'INTRUSION',
  'FIRE',
  'SMOKE',
  'PPE',
  'FACE',
  'VEHICLE',
  'FLOOD',
  'TRAFFIC_VIOLATION',
] as const;

export type TelegramEventType = (typeof TELEGRAM_EVENT_TYPES)[number];

export type TelegramDeliveryStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED';

export interface TelegramBotRecord {
  id: string;
  name: string;
  username: string | null;
  tokenEncrypted: string;
  isEnabled: boolean;
  isVerified: boolean;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramRecipientRecord {
  id: string;
  botId: string;
  chatId: string;
  name: string;
  chatType: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramRuleRecord {
  id: string;
  botId: string;
  eventType: string;
  isEnabled: boolean;
  minConfidence: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramDeliveryRecord {
  id: string;
  botId: string;
  recipientId: string | null;
  eventId: string | null;
  status: TelegramDeliveryStatus;
  telegramMessageId: string | null;
  errorMessage: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Camera slice used by the formatter — never contains credentials. */
export interface TelegramCameraInfo {
  id: string;
  name: string;
  location?: string | null;
}

/** Event slice used by the formatter / dispatcher. */
export interface TelegramEventInfo {
  id: string;
  eventType: string;
  confidence: number;
  timestamp: Date;
  isAlert: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  camera?: TelegramCameraInfo | null;
}

/** A delivery row joined with everything the worker needs to send it. */
export interface TelegramDeliveryJob {
  delivery: TelegramDeliveryRecord;
  bot: TelegramBotRecord;
  recipient: TelegramRecipientRecord | null;
  event: TelegramEventInfo | null;
}

export interface TelegramDeliveryLogQuery {
  botId?: string;
  status?: TelegramDeliveryStatus;
  eventType?: string;
  eventId?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export interface TelegramDeliveryLogRow extends TelegramDeliveryRecord {
  bot?: { id: string; name: string } | null;
  recipient?: { id: string; name: string; chatId: string } | null;
  event?: { id: string; eventType: string; confidence: number; timestamp: Date } | null;
}

export interface TelegramDeliveryLogPage {
  rows: TelegramDeliveryLogRow[];
  total: number;
  page: number;
  limit: number;
}

/** Bot shape returned by the API. `tokenEncrypted` must never appear here. */
export interface PublicTelegramBot {
  id: string;
  name: string;
  username: string | null;
  isEnabled: boolean;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Masked preview such as `••••••••4fGh` — never the real token. */
  tokenMasked: string;
  recipientCount: number;
  enabledRecipientCount: number;
  ruleCount: number;
}

/**
 * Persistence boundary for the Telegram module.
 *
 * The Prisma implementation lives in `telegram.store.ts`; the automated tests
 * use an in-memory implementation. Keeping this narrow is what makes the
 * dispatcher testable without a database.
 */
export interface TelegramStore {
  listBots(): Promise<TelegramBotRecord[]>;
  findBot(id: string): Promise<TelegramBotRecord | null>;
  findBotByName(name: string): Promise<TelegramBotRecord | null>;
  createBot(data: {
    name: string;
    username: string | null;
    tokenEncrypted: string;
    isEnabled: boolean;
    isVerified: boolean;
    lastVerifiedAt: Date | null;
  }): Promise<TelegramBotRecord>;
  updateBot(
    id: string,
    data: Partial<{
      name: string;
      username: string | null;
      tokenEncrypted: string;
      isEnabled: boolean;
      isVerified: boolean;
      lastVerifiedAt: Date | null;
      lastError: string | null;
    }>,
  ): Promise<TelegramBotRecord>;
  deleteBot(id: string): Promise<void>;

  listRecipients(botId: string): Promise<TelegramRecipientRecord[]>;
  findRecipient(id: string): Promise<TelegramRecipientRecord | null>;
  findRecipientByChatId(botId: string, chatId: string): Promise<TelegramRecipientRecord | null>;
  countRecipients(botId: string): Promise<{ total: number; enabled: number }>;
  createRecipient(data: {
    botId: string;
    chatId: string;
    name: string;
    chatType: string | null;
    isEnabled: boolean;
  }): Promise<TelegramRecipientRecord>;
  updateRecipient(
    id: string,
    data: Partial<{ name: string; chatId: string; chatType: string | null; isEnabled: boolean }>,
  ): Promise<TelegramRecipientRecord>;
  deleteRecipient(id: string): Promise<void>;

  listRules(botId: string): Promise<TelegramRuleRecord[]>;
  countRules(botId: string): Promise<number>;
  upsertRule(
    botId: string,
    eventType: string,
    data: { isEnabled: boolean; minConfidence: number | null },
  ): Promise<TelegramRuleRecord>;
  replaceRules(
    botId: string,
    rules: { eventType: string; isEnabled: boolean; minConfidence: number | null }[],
  ): Promise<TelegramRuleRecord[]>;

  /** Enabled bots that still have at least one enabled recipient. */
  listDispatchableBots(): Promise<TelegramBotRecord[]>;

  /** Insert delivery rows, ignoring rows that already exist (dedupe). */
  createDeliveryLogs(
    rows: {
      botId: string;
      recipientId: string;
      eventId: string;
      status: TelegramDeliveryStatus;
      nextAttemptAt: Date | null;
    }[],
  ): Promise<number>;

  createDeliveryLog(data: {
    botId: string;
    recipientId: string | null;
    eventId: string | null;
    status: TelegramDeliveryStatus;
    nextAttemptAt: Date | null;
  }): Promise<TelegramDeliveryRecord>;

  findDeliveryLog(id: string): Promise<TelegramDeliveryRecord | null>;

  /** Atomically move a PENDING row to PROCESSING. False when already claimed. */
  claimDeliveryLog(id: string, now: Date): Promise<boolean>;

  updateDeliveryLog(
    id: string,
    data: Partial<{
      status: TelegramDeliveryStatus;
      telegramMessageId: string | null;
      errorMessage: string | null;
      attemptCount: number;
      nextAttemptAt: Date | null;
      sentAt: Date | null;
    }>,
  ): Promise<TelegramDeliveryRecord>;

  /** PENDING rows whose `nextAttemptAt` is due, joined with bot/recipient/event. */
  listDueDeliveries(now: Date, limit: number): Promise<TelegramDeliveryJob[]>;

  listDeliveryLogs(query: TelegramDeliveryLogQuery): Promise<TelegramDeliveryLogPage>;
}

/** Minimal Telegram API client surface used by services and the dispatcher. */
export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
}

export interface TelegramSendResult {
  messageId: string;
  chatId: string;
}

export interface TelegramChatInfo {
  chatId: string;
  title: string;
  chatType: string;
  lastSeenAt: Date;
}

export interface TelegramClientLike {
  getMe(token: string): Promise<TelegramBotInfo>;
  sendMessage(
    token: string,
    chatId: string,
    html: string,
    options?: { disablePreview?: boolean },
  ): Promise<TelegramSendResult>;
  sendPhoto(
    token: string,
    chatId: string,
    photoUrl: string,
    captionHtml: string,
  ): Promise<TelegramSendResult>;
  getUpdates(token: string, offset?: number): Promise<TelegramChatInfo[]>;
}
