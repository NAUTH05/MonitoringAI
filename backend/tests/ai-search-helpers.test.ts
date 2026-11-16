/**
 * Search-helper tests. Only pure functions are exercised here (no database), so
 * the suite runs without PostgreSQL.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEventWhere, CameraIndexEntry, matchCamera, matchPlateCamera } from '../src/services/ai/search';

const CAMERAS: CameraIndexEntry[] = [
  {
    id: 'cam-1',
    name: 'IP_CAMERA',
    location: 'MAIN',
    streamName: 'cam_e5782da088b8',
    rtspUrl: 'http://localhost:1984/api/stream.m3u8?src=cam_e5782da088b8',
    aiSourceUrl: 'rtsp://127.0.0.1:8554/cam_e5782da088b8',
  },
  {
    id: 'cam-2',
    name: 'Camera Cổng Chính',
    location: 'Cổng số 1',
    streamName: 'laptop_webcam',
    rtspUrl: 'http://localhost:1984/api/stream.m3u8?src=laptop_webcam',
    aiSourceUrl: 'rtsp://127.0.0.1:8554/laptop_webcam',
  },
];

describe('search: camera resolution', () => {
  it('matches an exact name', () => {
    const m = matchCamera('IP_CAMERA', CAMERAS);
    assert.equal(m?.camera.id, 'cam-1');
    assert.equal(m?.score, 1);
  });

  it('matches a Vietnamese name typed without diacritics', () => {
    const m = matchCamera('camera cong chinh', CAMERAS);
    assert.equal(m?.camera.id, 'cam-2');
  });

  it('matches a location phrase', () => {
    const m = matchCamera('cổng số 1', CAMERAS);
    assert.equal(m?.camera.id, 'cam-2');
  });

  it('returns null when nothing matches', () => {
    assert.equal(matchCamera('bãi xe tầng hầm', CAMERAS), null);
  });

  it('returns null for empty input', () => {
    assert.equal(matchCamera(undefined, CAMERAS), null);
    assert.equal(matchCamera('   ', CAMERAS), null);
  });
});

describe('search: plate camera mapping never guesses', () => {
  it('maps by managed stream name', () => {
    assert.equal(matchPlateCamera('cam_e5782da088b8', CAMERAS)?.id, 'cam-1');
  });

  it('maps by stream name inside the RTSP URL', () => {
    assert.equal(matchPlateCamera('laptop_webcam', CAMERAS)?.id, 'cam-2');
  });

  it('returns null for an unknown stream instead of a hash-based camera', () => {
    // Regression: the old code did hash(stream_id) % cameras.length and could
    // attribute a plate to ANY camera.
    assert.equal(matchPlateCamera('stream_unknown_xyz', CAMERAS), null);
    assert.equal(matchPlateCamera(null, CAMERAS), null);
  });
});

describe('search: where-clause building', () => {
  it('maps every scalar filter', () => {
    const where = buildEventWhere(
      {
        eventType: 'INTRUSION',
        isAlert: true,
        minConfidence: 0.5,
        maxConfidence: 0.9,
        startTime: '2026-11-01T00:00:00.000Z',
        endTime: '2026-11-02T00:00:00.000Z',
        hasEvidence: true,
      },
      'cam-1',
    );
    assert.equal(where.eventType, 'INTRUSION');
    assert.equal(where.cameraId, 'cam-1');
    assert.equal(where.isAlert, true);
    assert.deepEqual(where.confidence, { gte: 0.5, lte: 0.9 });
    assert.deepEqual(where.timestamp, {
      gte: new Date('2026-11-01T00:00:00.000Z'),
      lte: new Date('2026-11-02T00:00:00.000Z'),
    });
    assert.deepEqual(where.evidence, { some: {} });
  });

  it('omits filters that were not requested', () => {
    const where = buildEventWhere({}, undefined);
    assert.deepEqual(where, {});
  });

  it('expresses hasEvidence=false as "no evidence rows"', () => {
    const where = buildEventWhere({ hasEvidence: false }, undefined);
    assert.deepEqual(where.evidence, { none: {} });
  });
});
