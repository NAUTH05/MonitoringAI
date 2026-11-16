/**
 * Intent parsing tests.
 *
 * The Vietnamese cases are regression guards for real bugs found while wiring
 * this up: diacritic folding turned "xâm nhập" into "xam" (grey) and "tìm" into
 * "tim" (purple), so every intrusion query was misclassified as a visual search.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractPlate,
  normalizeIntent,
  parseIntentJson,
  parseVisualDescription,
  ruleBasedIntent,
} from '../src/services/ai/intent';

const NOW = new Date('2026-11-09T03:30:00Z'); // 10:30 in Vietnam
const CAMERAS = [
  { name: 'IP_CAMERA', location: 'MAIN' },
  { name: 'Camera Cổng Chính', location: 'Cổng số 1' },
  { name: 'Kho Hàng', location: 'Khu vực kho' },
];

describe('intent: rule-based, no false visual detection', () => {
  it('"xâm nhập" is not read as the colour grey', () => {
    const intent = ruleBasedIntent('Tìm tất cả sự kiện xâm nhập ngày hôm qua', CAMERAS, NOW);
    assert.equal(intent.intent, 'metadata_search');
    assert.equal(intent.structuredFilters.eventType, 'INTRUSION');
    assert.equal(intent.visualQuery, undefined);
  });

  it('"tìm" is not read as the colour purple', () => {
    const intent = ruleBasedIntent('tìm sự kiện hôm nay', CAMERAS, NOW);
    assert.equal(intent.visualQuery, undefined);
  });

  it('"ban đêm" is not read as a count request', () => {
    const intent = ruleBasedIntent('sự kiện ban đêm', CAMERAS, NOW);
    assert.notEqual(intent.intent, 'event_count');
  });

  it('still detects a real clothing colour', () => {
    const intent = ruleBasedIntent('Tìm người mặc áo đỏ ở cổng', CAMERAS, NOW);
    assert.equal(intent.intent, 'visual_search');
    assert.ok(intent.visualQuery?.description);
  });

  it('detects a carried object', () => {
    const intent = ruleBasedIntent('tìm người đeo ba lô', CAMERAS, NOW);
    assert.equal(intent.intent, 'visual_search');
  });

  it('detects English colours', () => {
    const intent = ruleBasedIntent('find a person with a red backpack', CAMERAS, NOW);
    assert.equal(intent.intent, 'visual_search');
  });
});

describe('intent: rule-based metadata', () => {
  it('resolves "hôm qua" to a real VN day range', () => {
    const intent = ruleBasedIntent('sự kiện xâm nhập hôm qua', CAMERAS, NOW);
    assert.equal(intent.structuredFilters.startTime, '2026-11-07T17:00:00.000Z');
    assert.equal(intent.structuredFilters.endTime, '2026-11-08T17:00:00.000Z');
    assert.equal(intent.structuredFilters.timeLabel, 'Hôm qua');
  });

  it('detects a count request with an alert filter', () => {
    const intent = ruleBasedIntent('Có bao nhiêu cảnh báo xâm nhập trong 7 ngày gần nhất', CAMERAS, NOW);
    assert.equal(intent.intent, 'event_count');
    assert.equal(intent.structuredFilters.isAlert, true);
    assert.equal(intent.structuredFilters.eventType, 'INTRUSION');
  });

  it('detects a statistics request grouped by camera', () => {
    const intent = ruleBasedIntent('thống kê sự kiện theo camera', CAMERAS, NOW);
    assert.equal(intent.intent, 'event_statistics');
    assert.equal(intent.groupBy, 'camera');
  });

  it('resolves a camera by exact name', () => {
    const intent = ruleBasedIntent('sự kiện ở IP_CAMERA', CAMERAS, NOW);
    assert.equal(intent.structuredFilters.cameraName, 'IP_CAMERA');
  });

  it('resolves a camera by location words', () => {
    const intent = ruleBasedIntent('sự kiện ở khu vực kho', CAMERAS, NOW);
    assert.ok(intent.structuredFilters.cameraName);
  });

  it('does not invent a camera when nothing matches', () => {
    const intent = ruleBasedIntent('sự kiện ở nhà xe tầng hầm', CAMERAS, NOW);
    assert.equal(intent.structuredFilters.cameraName, undefined);
  });
});

describe('intent: licence plates', () => {
  it('extracts a plate with a dash', () => {
    assert.equal(extractPlate('Tìm xe có biển số 59A-12345'), '59A12345');
  });

  it('extracts a plate with a dot suffix', () => {
    assert.equal(extractPlate('xe 51F-123.45'), '51F12345');
  });

  it('returns undefined when there is no plate', () => {
    assert.equal(extractPlate('tìm người mặc áo đỏ'), undefined);
  });

  it('classifies a plate query', () => {
    const intent = ruleBasedIntent('Tìm xe có biển số 59A-12345 trong tuần này', CAMERAS, NOW);
    assert.equal(intent.intent, 'license_plate_search');
    assert.equal(intent.structuredFilters.licensePlate, '59A12345');
  });
});

describe('intent: normalisation of model output', () => {
  it('clamps the limit and keeps only valid enum values', () => {
    const intent = normalizeIntent(
      {
        intent: 'metadata_search',
        limit: 999,
        structuredFilters: { eventType: 'NOT_A_TYPE', cameraName: '  IP_CAMERA  ' },
      },
      { source: 'test' },
    );
    assert.equal(intent.limit, 50);
    assert.equal(intent.structuredFilters.eventType, undefined);
    assert.equal(intent.structuredFilters.cameraName, 'IP_CAMERA');
  });

  it('swaps inverted time ranges', () => {
    const intent = normalizeIntent(
      {
        structuredFilters: {
          startTime: '2026-11-09T10:00:00Z',
          endTime: '2026-11-09T08:00:00Z',
        },
      },
      { source: 'test' },
    );
    assert.ok(intent.structuredFilters.startTime! < intent.structuredFilters.endTime!);
  });

  it('drops a visual intent that has no description', () => {
    const intent = normalizeIntent({ intent: 'visual_search' }, { source: 'test' });
    assert.equal(intent.intent, 'metadata_search');
  });

  it('infers hybrid when a visual query also has metadata filters', () => {
    const intent = normalizeIntent(
      {
        structuredFilters: { eventType: 'INTRUSION' },
        visualQuery: { description: 'person in red' },
      },
      { source: 'test' },
    );
    assert.equal(intent.intent, 'hybrid_search');
  });

  it('parses a fenced JSON response', () => {
    const raw = '```json\n{"intent":"event_count","limit":5}\n```';
    const intent = parseIntentJson(raw, { source: 'test' });
    assert.equal(intent.intent, 'event_count');
    assert.equal(intent.limit, 5);
  });

  it('throws a typed error on non-JSON', () => {
    assert.throws(() => parseIntentJson('I cannot help with that', { source: 'test' }), /JSON/);
  });
});

describe('intent: visual description parsing', () => {
  it('normalises arrays and lowercases attributes', () => {
    const desc = parseVisualDescription(
      JSON.stringify({
        summary: 'A person walks near the gate.',
        objects: ['Person', 'Backpack'],
        attributes: ['Red Shirt'],
        activities: ['Walking'],
        scene: 'Gate',
        uncertainty: [],
      }),
    );
    assert.deepEqual(desc.objects, ['person', 'backpack']);
    assert.deepEqual(desc.attributes, ['red shirt']);
    assert.equal(desc.scene, 'gate');
  });

  it('degrades gracefully on plain text output', () => {
    const desc = parseVisualDescription('a person in a red shirt');
    assert.equal(desc.summary, 'a person in a red shirt');
    assert.ok(desc.uncertainty.length > 0);
  });

  it('never throws on malformed JSON', () => {
    const desc = parseVisualDescription('{not json');
    assert.ok(typeof desc.summary === 'string');
  });
});
