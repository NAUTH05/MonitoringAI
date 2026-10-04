/**
 * go2rtc orchestration (internal implementation detail).
 *
 * The backend owns go2rtc: the UI never asks the user for an `ffmpeg:device?…`
 * string, a go2rtc host or a stream name. This module builds the source spec,
 * writes/removes streams through the go2rtc REST API, verifies a stream really
 * becomes available, and enumerates local capture devices.
 */
import { spawn } from 'child_process';

export function go2rtcApiBase(): string {
  return (process.env.GO2RTC_API_URL || 'http://localhost:1984').replace(/\/+$/, '');
}

export function go2rtcRtspBase(): string {
  return (process.env.GO2RTC_RTSP_URL || 'rtsp://127.0.0.1:8554').replace(/\/+$/, '');
}

/** Playback URL the frontend/go2rtc player consumes. */
export function playbackUrl(streamName: string): string {
  return `${go2rtcApiBase()}/api/stream.m3u8?src=${encodeURIComponent(streamName)}`;
}

/** URL the AI runtime consumes for this stream. */
export function aiSourceUrl(streamName: string): string {
  return `${go2rtcRtspBase()}/${streamName}`;
}

export type SourceType = 'rtsp' | 'webcam' | 'go2rtc' | 'nvr';

export interface SourceSpec {
  sourceType: SourceType;
  rtspUrl?: string;
  username?: string;
  password?: string;
  device?: string;
  resolution?: string; // e.g. 1280x720
  fps?: number;
  streamName?: string; // for sourceType = 'go2rtc'
}

/** Embed credentials into an RTSP URL when supplied separately. */
export function withCredentials(url: string, username?: string, password?: string): string {
  if (!username || !password) return url;
  try {
    const parsed = new URL(url);
    parsed.username = username;
    parsed.password = password;
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Build the go2rtc `src` string for a source (never shown to the user). */
export function buildGo2rtcSource(spec: SourceSpec): string {
  if (spec.sourceType === 'webcam') {
    const device = spec.device || '0';
    const resolution = spec.resolution || '1280x720';
    const fps = spec.fps || 30;
    // go2rtc runs ffmpeg to capture the device and re-encode to H264 so browsers
    // can play it. The user only picks a device/resolution/FPS.
    return `ffmpeg:device?video=${encodeURIComponent(device)}&video_size=${resolution}&framerate=${fps}#video=h264`;
  }
  const url = withCredentials((spec.rtspUrl || '').trim(), spec.username, spec.password);
  return url;
}

// ── go2rtc REST helpers ────────────────────────────────────────────────────
export interface Go2rtcResult {
  ok: boolean;
  error?: string;
}

export async function listStreams(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${go2rtcApiBase()}/api/streams`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function streamExists(name: string): Promise<boolean> {
  const streams = await listStreams();
  return Boolean(streams && Object.prototype.hasOwnProperty.call(streams, name));
}

export async function putStream(name: string, src: string): Promise<Go2rtcResult> {
  try {
    const url = `${go2rtcApiBase()}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
    const res = await fetch(url, { method: 'PUT' });
    if (!res.ok) return { ok: false, error: (await res.text()) || `go2rtc responded ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Unable to reach go2rtc: ${(err as Error).message}` };
  }
}

export async function deleteStream(name: string): Promise<Go2rtcResult> {
  try {
    const url = `${go2rtcApiBase()}/api/streams?src=${encodeURIComponent(name)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: (await res.text()) || `go2rtc responded ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Unable to reach go2rtc: ${(err as Error).message}` };
  }
}

/** Verify a stream is really available by pulling one JPEG frame from go2rtc. */
export async function probeStream(name: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${go2rtcApiBase()}/api/frame.jpeg?src=${encodeURIComponent(name)}`,
      { signal: controller.signal },
    );
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    return type.includes('image');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enumerate video capture devices on the machine running go2rtc/ffmpeg.
 * (`ffmpeg -list_devices true -f dshow -i dummy`, parsed from stderr.)
 */
export function listVideoDevices(): Promise<string[]> {
  return new Promise((resolve) => {
    let stderr = '';
    let proc;
    try {
      proc = spawn('ffmpeg', [
        '-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
      ]);
    } catch {
      resolve([]);
      return;
    }
    const done = (devices: string[]) => resolve(devices);
    proc.on('error', () => done([]));
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', () => {
      const devices = [...stderr.matchAll(/"([^"]+)"\s*\(video\)/g)].map((m) => m[1]);
      done([...new Set(devices)]);
    });
  });
}

/** Generate a stable, sanitized internal stream name for a camera. */
export function makeStreamName(cameraId: string): string {
  return `cam_${cameraId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}
