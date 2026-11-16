/**
 * Secret-at-rest encryption for provider credentials (Gemini API key, Telegram
 * bot token, local provider key).
 *
 * AES-256-GCM with a key derived from `SETTINGS_ENCRYPTION_KEY`. If that is not
 * set we fall back to `JWT_SECRET` so a local checkout still works, but a warning
 * is logged: rotating JWT_SECRET would then invalidate stored secrets (they are
 * reported as unreadable rather than silently returning garbage).
 *
 * Format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>`
 */
import crypto from 'crypto';

const PREFIX = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let warnedAboutFallback = false;

function deriveKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY (or JWT_SECRET) must be set to store encrypted credentials',
    );
  }
  if (!process.env.SETTINGS_ENCRYPTION_KEY && !warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      '[ai/crypto] SETTINGS_ENCRYPTION_KEY is not set — deriving the secret key from JWT_SECRET. ' +
        'Set SETTINGS_ENCRYPTION_KEY in production so rotating the JWT secret does not lock saved credentials.',
    );
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/** Encrypt a secret. Returns null for empty input so optional fields stay null. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Decrypt a secret. Returns null when the payload is malformed or was encrypted
 * with a different key, so callers can surface "credential needs re-entry"
 * instead of throwing on every request.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
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

/** `••••••••abcd` — safe to return from the API. */
export function maskSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const tail = plain.length > 8 ? plain.slice(-4) : '';
  return `••••••••${tail}`;
}

/** Mask an already-encrypted value without decrypting it twice. */
export function maskEncrypted(payload: string | null | undefined): string | null {
  if (!payload) return null;
  return maskSecret(decryptSecret(payload));
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET);
}
