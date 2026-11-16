/**
 * Telegram integration — module entry point.
 *
 * Exposes the two singletons the rest of the backend uses:
 *  - `telegramService`   for the Admin API (bot/recipient/rule management)
 *  - `telegramDispatcher` for the alert pipeline and the background worker
 */
import { telegramClient } from './telegram.client';
import { createTelegramDispatcher, type TelegramDispatcher } from './telegram.dispatcher';
import { createTelegramService, type TelegramService } from './telegram.service';
import { telegramStore } from './telegram.store';

export const telegramService: TelegramService = createTelegramService({
  store: telegramStore,
  client: telegramClient,
});

export const telegramDispatcher: TelegramDispatcher = createTelegramDispatcher({
  store: telegramStore,
  client: telegramClient,
});

export { telegramClient, telegramStore };
export * from './telegram.types';
