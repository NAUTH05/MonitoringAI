/**
 * Bot-token encryption at rest.
 *
 * Telegram bot tokens are bearer credentials: whoever holds one owns the bot.
 * They are therefore encrypted with AES-256-GCM before being written to
 * `telegram_bots.token_encrypted`, and the API only ever returns a mask.
 *
 * Key: `TELEGRAM_ENCRYPTION_KEY` (required for a dedicated key). For backward
 * compatibility with deployments that already set the AI Search key we fall
 * back to `SETTINGS_ENCRYPTION_KEY`, and finally to `JWT_SECRET`, logging a
 * warning — a fallback key rotation makes stored tokens unreadable, in which
 * case the admin must re-enter the token (surfaced as `tokenReadable: false`).
 *
 * Payload format: `tgb1:<iv b64>:<authTag b64>:<ciphertext b64>`
 */
import crypto from 'crypto';

const PREFIX = 'tgb1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let warnedAboutFallback = false;

/** Which environment variable supplied the key (useful for diagnostics/UI). */
export function encryptionKeySource(): 'TELEGRAM_ENCRYPTION_KEY' | 'SETTINGS_ENCRYPTION_KEY' | 'JWT_SECRET' | null {
  if (process.env.TELEGRAM_ENCRYPTION_KEY) return 'TELEGRAM_ENCRYPTION_KEY';
  if (process.env.SETTINGS_ENCRYPTION_KEY) return 'SETTINGS_ENCRYPTION_KEY';
  if (process.env.JWT_SECRET) return 'JWT_SECRET';
  return null;
}

function deriveKey(): Buffer {
  const raw = process.env.TELEGRAM_ENCRYPTION_KEY
    || process.env.SETTINGS_ENCRYPTION_KEY
    || process.env.JWT_SECRET;

  if (!raw) {
    throw new Error(
      'TELEGRAM_ENCRYPTION_KEY must be set to store Telegram bot tokens securely',
    );
  }

  if (!process.env.TELEGRAM_ENCRYPTION_KEY && !warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[telegram/crypto] TELEGRAM_ENCRYPTION_KEY is not set — falling back to ' +
        'SETTINGS_ENCRYPTION_KEY/JWT_SECRET. Set a dedicated TELEGRAM_ENCRYPTION_KEY ' +
        'so rotating another secret does not lock stored bot tokens.',
    );
  }

  // SHA-256 gives us a stable 32-byte key from an arbitrary-length secret.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptToken(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Decrypt a stored token. Returns null when the payload is malformed or was
 * encrypted under a different key, so callers can report "token needs
 * re-entry" instead of throwing on every dispatch attempt.
 */
export function decryptToken(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Safe preview for the Admin UI: keeps the bot id prefix and the last 4
 * characters of the secret part — the shape admins recognise from BotFather
 * (`123456789:AAH...4fGh`) — and nothing else.
 */
export function maskToken(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const [idPart, secretPart] = plain.split(':');
  if (!secretPart) {
    const tail = plain.length > 4 ? plain.slice(-4) : '';
    return `••••••••${tail}`;
  }
  const id = idPart.length > 4 ? `${idPart.slice(0, 4)}…` : idPart;
  const tail = secretPart.length > 4 ? secretPart.slice(-4) : '';
  return `${id}••••••••${tail}`;
}

/** Mask an encrypted payload without keeping the plaintext around. */
export function maskEncryptedToken(payload: string | null | undefined): string | null {
  const plain = decryptToken(payload);
  if (!plain) return '••••••••';
  return maskToken(plain);
}

export function isEncryptionConfigured(): boolean {
  return encryptionKeySource() !== null;
}

/** Telegram tokens look like `<numeric id>:<35ish url-safe chars>`. */
export function looksLikeBotToken(value: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
