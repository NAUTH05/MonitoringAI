/**
 * Regression test for the 2026-10-04 backend crash.
 *
 * `fetch()` responses whose body is never consumed leave undici's HTTP parser
 * paused. When the socket is then torn down, undici throws
 * `assert(!this.paused)` from a socket callback — uncatchable around the fetch,
 * so the whole Node process dies. These tests run the go2rtc helpers against a
 * stub server that forces `Connection: close`, so a body left unconsumed is
 * torn down immediately. If the drain regresses, the test process crashes.
 *
 * Run:  npm test
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import {
  deleteStream,
  listStreams,
  probeStream,
  putStream,
} from '../src/services/go2rtc';

let server: http.Server;
let requests = 0;
let rejectPut = false;

before(async () => {
  server = http.createServer((req, res) => {
    requests += 1;
    const url = new URL(req.url ?? '/', 'http://stub');
    // Force a fresh socket per response: an unconsumed body is then torn down
    // right away, which is exactly what used to kill the process.
    res.setHeader('Connection', 'close');

    if (url.pathname === '/api/frame.jpeg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    if (req.method === 'PUT') {
      if (rejectPut) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad source');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('deleted');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cam_a: { producers: [] } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.GO2RTC_API_URL = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

test('listStreams parses the JSON body', async () => {
  assert.deepEqual(await listStreams(), { cam_a: { producers: [] } });
});

test('putStream returns ok and consumes the body', async () => {
  assert.deepEqual(await putStream('cam_x', 'rtsp://x'), { ok: true });
});

test('deleteStream returns ok and consumes the body', async () => {
  assert.deepEqual(await deleteStream('cam_x'), { ok: true });
});

test('probeStream drains the JPEG frame and detects the image type', async () => {
  assert.equal(await probeStream('cam_x', 3000), true);
});

test('putStream surfaces a go2rtc error message (and still drains)', async () => {
  rejectPut = true;
  try {
    const result = await putStream('cam_x', 'nope');
    assert.equal(result.ok, false);
    assert.match(String(result.error), /bad source/);
  } finally {
    rejectPut = false;
  }
});

test('repeated calls over closing sockets never crash the process', async () => {
  const before = requests;
  for (let i = 0; i < 25; i++) {
    await listStreams();
    await putStream('cam_x', 'rtsp://x');
    await deleteStream('cam_x');
    await probeStream('cam_x', 3000);
  }
  assert.ok(requests > before, 'the stub server was actually exercised');
  // The undici assertion fires asynchronously on socket teardown — give the
  // event loop time to run it. Reaching the next line means nothing threw.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await probeStream('cam_x', 3000), true);
});
