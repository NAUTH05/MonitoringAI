/**
 * Secret encryption tests. These guard the requirement that provider
 * credentials are never stored (or returned) in plaintext.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptSecret, encryptSecret, maskEncrypted, maskSecret } from '../src/services/ai/crypto';

// The crypto module derives its key lazily from the environment. `npm test` does
// not load backend/.env, so the suite provides its own key.
process.env.SETTINGS_ENCRYPTION_KEY = 'test-only-encryption-key-0123456789abcdef';

describe('crypto: AES-256-GCM round trip', () => {
  it('encrypts and decrypts a key', () => {
    const plain = 'AIzaSyTESTKEY_1234567890abcdef';
    const enc = encryptSecret(plain);
    assert.ok(enc);
    assert.match(enc, /^v1:/);
    assert.notEqual(enc, plain);
    assert.equal(decryptSecret(enc), plain);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-secret');
    const b = encryptSecret('same-secret');
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), decryptSecret(b));
  });

  it('returns null for empty input', () => {
    assert.equal(encryptSecret(''), null);
    assert.equal(encryptSecret(null), null);
    assert.equal(decryptSecret(null), null);
  });

  it('returns null instead of throwing on a tampered payload', () => {
    const enc = encryptSecret('secret-value')!;
    const parts = enc.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64')].join(':');
    assert.equal(decryptSecret(tampered), null);
    assert.equal(decryptSecret('garbage'), null);
  });

  it('returns null when the encryption key changed', () => {
    const original = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = 'key-one-aaaaaaaaaaaaaaaaaaaaaaaa';
    const enc = encryptSecret('value-under-key-one');
    process.env.SETTINGS_ENCRYPTION_KEY = 'key-two-bbbbbbbbbbbbbbbbbbbbbbbb';
    assert.equal(decryptSecret(enc), null);
    process.env.SETTINGS_ENCRYPTION_KEY = original;
  });
});

describe('crypto: masking', () => {
  it('keeps only the last four characters', () => {
    assert.equal(maskSecret('AIzaSyABCDEFGH7890'), '••••••••7890');
  });

  it('hides short secrets completely', () => {
    assert.equal(maskSecret('short'), '••••••••');
  });

  it('masks an encrypted payload without exposing it', () => {
    const enc = encryptSecret('AIzaSyABCDEFGH7890');
    const masked = maskEncrypted(enc);
    assert.equal(masked, '••••••••7890');
    assert.ok(!String(masked).includes('AIza'));
  });

  it('returns null for a missing secret', () => {
    assert.equal(maskSecret(null), null);
    assert.equal(maskEncrypted(null), null);
  });
});
