/**
 * Static guards for the Telegram settings UI.
 *
 * `next dev`/`next build` cannot run in this sandbox, so these tests protect
 * the things a browser pass would catch first: missing translations, a lost
 * entry point, and — most importantly — any regression that could render a bot
 * token in the page.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const TELEGRAM_DIR = join(SRC, 'components', 'settings', 'telegram');

function readLocale(locale) {
  return JSON.parse(readFileSync(join(SRC, 'locales', `${locale}.json`), 'utf8'));
}

const vi = readLocale('vi');
const en = readLocale('en');

function resolveKey(dict, key) {
  return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), dict);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const telegramFiles = walk(TELEGRAM_DIR).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('telegram i18n', () => {
  it('every statically referenced telegram key exists in both locales', () => {
    const keys = new Set();
    for (const { text } of sourceFiles) {
      for (const match of text.matchAll(/\bt\(\s*["'](telegram\.[A-Za-z0-9_.]+)["']/g)) {
        keys.add(match[1]);
      }
    }
    assert.ok(keys.size > 40, `expected many telegram keys, found ${keys.size}`);
    for (const key of keys) {
      assert.notEqual(resolveKey(vi, key), undefined, `vi.json is missing ${key}`);
      assert.notEqual(resolveKey(en, key), undefined, `en.json is missing ${key}`);
    }
  });

  it('keeps the vi and en telegram sections structurally identical', () => {
    const flatten = (obj, prefix = '') =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    assert.deepEqual(flatten(vi.telegram).sort(), flatten(en.telegram).sort());
  });

  it('labels every delivery status the backend can return', () => {
    for (const status of ['Pending', 'Processing', 'Sent', 'Failed', 'Skipped']) {
      assert.ok(vi.telegram[`status${status}`], `vi missing status${status}`);
      assert.ok(en.telegram[`status${status}`], `en missing status${status}`);
    }
  });
});

describe('telegram placement', () => {
  it('mounts the bot panel as a Settings tab', () => {
    const page = readFileSync(join(SRC, 'app', '(dashboard)', 'settings', 'page.tsx'), 'utf8');
    assert.ok(page.includes('TelegramBotsPanel'), 'Settings page must render the Telegram panel');
    assert.ok(page.includes('?tab=telegram') || page.includes('"telegram"'), 'must be reachable as a tab');
  });

  it('exposes the panel and its dialogs', () => {
    for (const file of [
      'TelegramBotsPanel.tsx',
      'TelegramBotDialog.tsx',
      'TelegramRecipientsDialog.tsx',
      'TelegramRulesDialog.tsx',
      'TelegramDeliveryLogs.tsx',
      'shared.tsx',
    ]) {
      assert.ok(existsSync(join(TELEGRAM_DIR, file)), `${file} is missing`);
    }
  });

  it('talks only to the authenticated /telegram API namespace', () => {
    for (const { text } of telegramFiles) {
      const calls = [...text.matchAll(/api\.(get|post|patch|put|delete)<[^>]*>\(\s*[`"']([^`"']+)/g)];
      for (const [, , endpoint] of calls) {
        assert.ok(endpoint.startsWith('/telegram/'), `unexpected endpoint ${endpoint}`);
      }
    }
  });
});

describe('telegram token safety in the UI', () => {
  it('never hardcodes a bot token literal', () => {
    for (const { path, text } of telegramFiles) {
      assert.ok(
        !/\b\d{8,12}:[A-Za-z0-9_-]{30,}/.test(text),
        `${path} contains something that looks like a bot token`,
      );
    }
  });

  it('masks the token input', () => {
    const dialog = readFileSync(join(TELEGRAM_DIR, 'TelegramBotDialog.tsx'), 'utf8');
    assert.ok(
      dialog.includes('type={showToken ? "text" : "password"}'),
      'the token field must be a password input by default',
    );
    assert.ok(dialog.includes('autoComplete="off"'), 'the token field must not be autocompleted');
  });

  it('only renders the masked token returned by the API', () => {
    const dialog = readFileSync(join(TELEGRAM_DIR, 'TelegramBotDialog.tsx'), 'utf8');
    assert.ok(dialog.includes('tokenMasked'), 'the dialog must use the masked preview');
    for (const { path, text } of telegramFiles) {
      assert.ok(
        !/\.tokenEncrypted|tokenEncrypted/.test(text),
        `${path} must never reference the encrypted column`,
      );
    }
  });

  it('gates management controls on the Admin role', () => {
    const panel = readFileSync(join(TELEGRAM_DIR, 'TelegramBotsPanel.tsx'), 'utf8');
    assert.ok(panel.includes('useAuth'), 'the panel must read the current role');
    assert.ok(panel.includes('telegram.onlyAdmin'), 'a non-admin must see an explanatory banner');
  });
});
