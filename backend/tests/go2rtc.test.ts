/**
 * go2rtc orchestration helpers: source building, stream-name generation and
 * URL derivation. Pure functions — no go2rtc server needed.
 *
 * Run:  npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aiSourceUrl,
  buildGo2rtcSource,
  makeStreamName,
  playbackUrl,
  withCredentials,
} from '../src/services/go2rtc';

test('makeStreamName generates a sanitized cam_<id>', () => {
  assert.equal(makeStreamName('448a3a48-23d3-4e5f-9a1b-000000000000'), 'cam_448a3a4823d3');
  assert.ok(makeStreamName('A B/C').startsWith('cam_'));
});

test('webcam source becomes an ffmpeg:device spec (never typed by the user)', () => {
  const src = buildGo2rtcSource({
    sourceType: 'webcam',
    device: 'Chicony USB2.0 Camera',
    resolution: '1280x720',
    fps: 30,
  });
  assert.equal(
    src,
    'ffmpeg:device?video=Chicony%20USB2.0%20Camera&video_size=1280x720&framerate=30#video=h264',
  );
});

test('webcam source falls back to sensible defaults', () => {
  const src = buildGo2rtcSource({ sourceType: 'webcam' });
  assert.equal(src, 'ffmpeg:device?video=0&video_size=1280x720&framerate=30#video=h264');
});

test('rtsp source embeds credentials supplied separately', () => {
  assert.equal(
    buildGo2rtcSource({
      sourceType: 'rtsp',
      rtspUrl: 'rtsp://10.0.0.5:554/s1',
      username: 'admin',
      password: 'pw',
    }),
    'rtsp://admin:pw@10.0.0.5:554/s1',
  );
});

test('nvr source without credentials is the raw url', () => {
  assert.equal(
    buildGo2rtcSource({ sourceType: 'nvr', rtspUrl: 'rtsp://10.0.0.5:554/s1' }),
    'rtsp://10.0.0.5:554/s1',
  );
});

test('withCredentials is a no-op unless BOTH username and password are given', () => {
  assert.equal(withCredentials('rtsp://h/p'), 'rtsp://h/p');
  assert.equal(withCredentials('rtsp://h/p', 'admin'), 'rtsp://h/p');
});

test('source validation: a missing url/device yields an empty source', () => {
  assert.equal(buildGo2rtcSource({ sourceType: 'rtsp' }), '');
  assert.equal(buildGo2rtcSource({ sourceType: 'rtsp', rtspUrl: '   ' }), '');
});

test('playback + ai source urls are derived from the stream name', () => {
  assert.equal(playbackUrl('cam_x'), 'http://localhost:1984/api/stream.m3u8?src=cam_x');
  assert.equal(aiSourceUrl('cam_x'), 'rtsp://127.0.0.1:8554/cam_x');
});

test('stream names are URL-encoded in the playback url', () => {
  assert.ok(playbackUrl('cam a').includes('src=cam%20a'));
});
