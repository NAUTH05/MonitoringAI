/**
 * Timezone resolution tests. All assertions use an explicit `now` so they do
 * not depend on when the suite runs. Asia/Ho_Chi_Minh is UTC+7 with no DST.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  describeNowVN,
  resolvePreset,
  startOfDayVN,
  toIsoOrUndefined,
  vnParts,
} from '../src/services/ai/time';

// 2026-11-09 10:30 in Vietnam == 2026-11-09T03:30:00Z
const NOW = new Date('2026-11-09T03:30:00Z');
const iso = (d: Date) => d.toISOString();

describe('time: VN day boundaries', () => {
  it('startOfDayVN is midnight Vietnam, not midnight UTC', () => {
    assert.equal(iso(startOfDayVN(NOW)), '2026-11-08T17:00:00.000Z');
  });

  it('reads wall-clock parts in Vietnam', () => {
    const p = vnParts(NOW);
    assert.equal(p.year, 2026);
    assert.equal(p.month, 11);
    assert.equal(p.day, 9);
    assert.equal(p.hour, 10);
    assert.equal(p.minute, 30);
  });

  it('describes now with the timezone name', () => {
    const text = describeNowVN(NOW);
    assert.match(text, /2026-11-09 10:30/);
    assert.match(text, /Asia\/Ho_Chi_Minh/);
  });
});

describe('time: presets', () => {
  it('today ends at now and starts at VN midnight', () => {
    const r = resolvePreset('today', NOW);
    assert.equal(iso(r.startTime), '2026-11-08T17:00:00.000Z');
    assert.equal(iso(r.endTime), iso(NOW));
    assert.equal(r.label, 'Hôm nay');
  });

  it('yesterday is exactly one VN day long', () => {
    const r = resolvePreset('yesterday', NOW);
    assert.equal(iso(r.startTime), '2026-11-07T17:00:00.000Z');
    assert.equal(iso(r.endTime), '2026-11-08T17:00:00.000Z');
    assert.equal(r.endTime.getTime() - r.startTime.getTime(), 24 * 3600 * 1000);
  });

  it('last_n_days:7 covers 7 calendar days including today', () => {
    const r = resolvePreset('last_n_days:7', NOW);
    assert.equal(iso(r.startTime), '2026-11-02T17:00:00.000Z');
    assert.equal(r.label, '7 ngày gần đây');
  });

  it('last_night spans 18:00 yesterday to 06:00 today', () => {
    const r = resolvePreset('last_night', NOW);
    assert.equal(iso(r.startTime), '2026-11-08T11:00:00.000Z'); // 18:00 VN
    assert.equal(iso(r.endTime), '2026-11-08T23:00:00.000Z'); // 06:00 VN
  });

  it('this_week starts on Monday in Vietnam', () => {
    // 2026-11-09 is a Monday.
    const r = resolvePreset('this_week', NOW);
    assert.equal(iso(r.startTime), '2026-11-08T17:00:00.000Z');
  });

  it('clamps an absurd last_n_days value', () => {
    const r = resolvePreset('last_n_days:9999', NOW);
    assert.ok(r.startTime.getTime() < NOW.getTime());
    assert.ok(r.startTime.getTime() > new Date('2025-01-01T00:00:00Z').getTime());
  });
});

describe('time: helpers', () => {
  it('addDays keeps the instant arithmetic', () => {
    assert.equal(iso(addDays(new Date('2026-11-08T17:00:00Z'), 1)), '2026-11-09T17:00:00.000Z');
  });

  it('rejects unusable ISO input', () => {
    assert.equal(toIsoOrUndefined('not-a-date'), undefined);
    assert.equal(toIsoOrUndefined(123), undefined);
    assert.equal(toIsoOrUndefined('2026-11-09T03:30:00Z'), '2026-11-09T03:30:00.000Z');
  });
});
