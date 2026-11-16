/** Error with an HTTP status, thrown by the Telegram service and mapped by the route. */
export class TelegramHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TelegramHttpError';
    this.status = status;
  }
}
