/**
 * Minimal HTTP helper for provider calls.
 *
 * IMPORTANT repo rule (see commit 3835274): a `fetch()` response body must
 * ALWAYS be consumed or cancelled. Leaving it unread pauses undici's parser and
 * the assertion it throws on socket teardown is not catchable — it kills the
 * Node process. Every helper here drains the body on success, error and abort.
 */

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Raw body, truncated. Useful for error messages from provider APIs. */
  text: string;
  error?: string;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | FormData;
  timeoutMs?: number;
  /** Hard cap on how much of the response body we keep for diagnostics. */
  maxTextChars?: number;
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}

/** Perform a request and fully read the body, parsing JSON when possible. */
export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<HttpResult<T>> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30000, maxTextChars = 800 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    // Read the body BEFORE inspecting status — this is the crash fix.
    const raw = await res.text().catch(() => '');
    let data: T | null = null;
    if (raw) {
      try {
        data = JSON.parse(raw) as T;
      } catch {
        data = null;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      text: truncate(raw, maxTextChars),
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    // On abort the body is never delivered; make sure the stream is released.
    try {
      controller.abort();
    } catch {
      /* already aborted */
    }
    const aborted = (err as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      text: '',
      error: aborted ? `Timed out after ${timeoutMs}ms` : (err as Error)?.message || 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a binary payload with a hard size cap (used for evidence media). */
export async function httpBinary(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ ok: boolean; status: number; bytes: Buffer | null; contentType: string; error?: string }> {
  const { timeoutMs = 15000, maxBytes = 20 * 1024 * 1024 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return { ok: false, status: res.status, bytes: null, contentType: '', error: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      return {
        ok: false,
        status: res.status,
        bytes: null,
        contentType: res.headers.get('content-type') || '',
        error: `Payload exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`,
      };
    }
    return {
      ok: true,
      status: res.status,
      bytes: buf,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      bytes: null,
      contentType: '',
      error: (err as Error)?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : (err as Error)?.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
