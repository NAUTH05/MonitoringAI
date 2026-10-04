/**
 * Frontend regression guards (no test framework needed — Node's built-in runner).
 *
 * These assert on the SOURCE TREE so they run in CI without a DOM/browser:
 *  - the 2x2 mock violation view and its mock data are gone
 *  - there is ONE global event-detail mechanism, wired to every notification surface
 *  - the event dialog renders a real evidence collection
 *  - the camera wizard provisions through the backend transaction
 *
 * Run:  npm test
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(src);
const read = (rel) => readFileSync(path.join(src, rel), 'utf8');

test('the 2x2 mock violation component is deleted', () => {
  assert.ok(
    !existsSync(path.join(src, 'components/live/ViolationGrid2x2.tsx')),
    'ViolationGrid2x2.tsx must not exist',
  );
});

test('no mock violation data anywhere in the source tree', () => {
  for (const file of allFiles) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(
      !text.includes('DEFAULT_MOCK_VIOLATIONS'),
      `DEFAULT_MOCK_VIOLATIONS still referenced in ${file}`,
    );
    assert.ok(
      !/\/evidence\/sample-/.test(text),
      `mock /evidence/sample-* still referenced in ${file}`,
    );
  }
});

test('LiveWall no longer has the 2x2 violation toggle (real wall stays)', () => {
  const liveWall = read('components/live/LiveWall.tsx');
  assert.ok(!liveWall.includes('is2x2Grid'), 'is2x2Grid state must be gone');
  assert.ok(!liveWall.includes('Lưới 2x2'), 'the 2x2 button label must be gone');
  assert.ok(liveWall.includes('CameraFeed'), 'the normal camera wall must remain');
  assert.ok(!liveWall.includes('ViolationGrid2x2'));
});

test('ONE global EventDetailProvider is mounted at the dashboard layout', () => {
  assert.ok(
    existsSync(path.join(src, 'components/events/EventDetailProvider.tsx')),
    'EventDetailProvider.tsx must exist',
  );
  const layout = read('app/(dashboard)/layout.tsx');
  assert.ok(layout.includes('EventDetailProvider'), 'layout must import the provider');
  assert.ok(layout.includes('<EventDetailProvider>'), 'layout must mount the provider');
});

test('every notification surface opens the dialog (no route to /events)', () => {
  const alertProvider = read('components/alerts/AlertProvider.tsx');
  assert.ok(alertProvider.includes('openEvent'), 'toast must call openEvent');
  assert.ok(
    alertProvider.includes('stopPropagation'),
    'the toast close button must only dismiss (stopPropagation)',
  );

  const header = read('components/layout/Header.tsx');
  assert.ok(header.includes('openEvent'), 'the bell dropdown must call openEvent');

  const eventsPage = read('app/(dashboard)/events/page.tsx');
  assert.ok(eventsPage.includes('openEvent'), 'the events page View action must call openEvent');
  assert.ok(
    !eventsPage.includes('selectedEvent'),
    'the events page must not keep its own dialog state',
  );
  assert.ok(
    !eventsPage.includes('EventDetailDialog'),
    'the events page must not mount its own dialog',
  );
});

test('EventDetailDialog renders the evidence collection with an unavailable state', () => {
  const dialog = read('components/events/EventDetailDialog.tsx');
  assert.ok(dialog.includes('event.evidence'), 'must read the evidence collection');
  assert.ok(dialog.includes('evidenceUnavailable'), 'must have an "unavailable" state');
  assert.ok(/<video/.test(dialog), 'must render a video player');
  assert.ok(dialog.includes('images.map'), 'must render the snapshot timeline');
  assert.ok(dialog.includes('Download'), 'must offer downloads');
});

test('the camera wizard provisions through the backend transaction', () => {
  const wizard = read('components/cameras/CameraFormDialog.tsx');
  assert.ok(wizard.includes('/cameras/provision'), 'create must go through /cameras/provision');
  assert.ok(wizard.includes('/go2rtc/test'), 'must offer Test connection');
  assert.ok(wizard.includes('/go2rtc/devices'), 'must enumerate local devices');

  // Strip comments first: the file *mentions* ffmpeg:device in a docstring that
  // says the user never types it, so only real code matters.
  const code = wizard
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(
    !/ffmpeg:device/.test(code),
    'the wizard must never ask the user to type an ffmpeg:device string',
  );
});
