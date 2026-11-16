/**
 * Static guards for the AI Search UI.
 *
 * The sandbox cannot run `next dev` (the safe-delete shim blocks clearing
 * .next), so these tests protect the things a browser run would catch first:
 * missing translation keys, a lost search entry point, and a regression back to
 * a separate AI Search page (the feature must live on the Events page).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

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

const sourceFiles = walk(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('ai search i18n', () => {
  it('every statically referenced aiSearch/nav.settings key exists in both locales', () => {
    const keys = new Set();
    for (const { text } of sourceFiles) {
      for (const match of text.matchAll(/\bt\(\s*["']((?:aiSearch|nav)\.[A-Za-z0-9_.]+)["']/g)) {
        keys.add(match[1]);
      }
    }
    assert.ok(keys.size > 20, `expected many translation keys, found ${keys.size}`);
    for (const key of keys) {
      assert.notEqual(resolveKey(vi, key), undefined, `vi.json is missing ${key}`);
      assert.notEqual(resolveKey(en, key), undefined, `en.json is missing ${key}`);
    }
  });

  it('has a label for every search mode and mode option', () => {
    const modes = [
      'metadata_search',
      'visual_search',
      'hybrid_search',
      'license_plate_search',
      'event_count',
      'event_statistics',
      'evidence_lookup',
    ];
    for (const mode of modes) {
      assert.ok(vi.aiSearch.modes[mode], `vi missing modes.${mode}`);
      assert.ok(en.aiSearch.modes[mode], `en missing modes.${mode}`);
    }
    for (const option of ['auto', 'metadata', 'visual', 'hybrid']) {
      assert.ok(vi.aiSearch.modeOptions[option], `vi missing modeOptions.${option}`);
      assert.ok(en.aiSearch.modeOptions[option], `en missing modeOptions.${option}`);
    }
  });

  it('keeps the vi and en aiSearch sections structurally identical', () => {
    const flatten = (obj, prefix = '') =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    assert.deepEqual(flatten(vi.aiSearch).sort(), flatten(en.aiSearch).sort());
  });
});

describe('ai search placement', () => {
  it('mounts the search bar on the Events page', () => {
    const page = readFileSync(join(SRC, 'app', '(dashboard)', 'events', 'page.tsx'), 'utf8');
    assert.ok(page.includes('EventSearchBar'), 'Events page must render the AI search bar');
    assert.ok(page.includes('/ai-search/query') === false, 'the page must not call the API directly');
  });

  it('does not add a standalone AI Search route', () => {
    assert.equal(
      existsSync(join(SRC, 'app', '(dashboard)', 'ai-search')),
      false,
      'search must stay on the Events page, not a separate AI Search screen',
    );
  });

  it('exposes an AI settings panel and a settings route', () => {
    assert.ok(existsSync(join(SRC, 'components', 'settings', 'AISearchSettingsPanel.tsx')));
    assert.ok(existsSync(join(SRC, 'app', '(dashboard)', 'settings', 'page.tsx')));
    const sidebar = readFileSync(join(SRC, 'components', 'layout', 'Sidebar.tsx'), 'utf8');
    assert.ok(sidebar.includes('/settings'), 'sidebar must link to Settings');
  });

  it('never hardcodes a provider secret in the UI', () => {
    const panel = readFileSync(join(SRC, 'components', 'settings', 'AISearchSettingsPanel.tsx'), 'utf8');
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(panel), 'no API key literal may be embedded');
    assert.ok(panel.includes('type={showKey ? "text" : "password"}'), 'the key field must be masked');
  });

  it('labels the rule-based fallback instead of implying an LLM answered', () => {
    const bar = readFileSync(join(SRC, 'components', 'events', 'EventSearchBar.tsx'), 'utf8');
    assert.ok(bar.includes('aiSearch.byRules'));
    assert.ok(bar.includes('interpretedBy'));
  });
});
