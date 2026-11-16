/**
 * Centralised Telegram message formatting.
 *
 * One place builds every outbound message so alerts, test sends and any future
 * notification share the same look, escaping and timezone behaviour.
 *
 * Rules:
 *  - `parse_mode=HTML`, so every dynamic value goes through `escapeHtml`.
 *  - Timestamps are rendered in Asia/Ho_Chi_Minh (the deployment's locale),
 *    independent of the server's TZ.
 *  - Only absolute http(s) evidence URLs are offered to `sendPhoto`; internal
 *    filesystem paths and camera credentials are never included.
 */
import type { TelegramEventInfo } from './telegram.types';

const DIVIDER = '━━━━━━━━━━━━━━━━━━';
export const TELEGRAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

interface EventStyle {
  emoji: string;
  header: string;
  headline: string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  INTRUSION: {
    emoji: '🚨',
    header: 'SECURITY ALERT',
    headline: 'Security intrusion detected!',
  },
  FIRE: {
    emoji: '🔥',
    header: 'FIRE ALERT',
    headline: 'Fire detected in the monitored area!',
  },
  SMOKE: {
    emoji: '💨',
    header: 'SMOKE ALERT',
    headline: 'Smoke detected in the monitored area!',
  },
  PPE: {
    emoji: '🦺',
    header: 'SAFETY ALERT',
    headline: 'PPE compliance violation detected!',
  },
  FACE: {
    emoji: '👤',
    header: 'ACCESS ALERT',
    headline: 'Unrecognised face detected!',
  },
  VEHICLE: {
    emoji: '🚗',
    header: 'VEHICLE ALERT',
    headline: 'Vehicle activity detected!',
  },
  FLOOD: {
    emoji: '🌊',
    header: 'FLOOD ALERT',
    headline: 'Flood risk detected!',
  },
  TRAFFIC_VIOLATION: {
    emoji: '🚦',
    header: 'TRAFFIC ALERT',
    headline: 'Traffic violation detected!',
  },
};

const FALLBACK_STYLE: EventStyle = {
  emoji: '⚠️',
  header: 'MONITORING ALERT',
  headline: 'Monitoring alert detected!',
};

export function eventStyle(eventType: string): EventStyle {
  return EVENT_STYLES[eventType] ?? FALLBACK_STYLE;
}

/** Telegram HTML mode only understands &amp; &lt; &gt; &quot; and &#39;. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `16/11/2026 22:30:15` in Asia/Ho_Chi_Minh, regardless of the host TZ. */
export function formatEventTime(date: Date, timeZone: string = TELEGRAM_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

export function formatConfidence(confidence: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  return `${pct}%`;
}

/**
 * Return a URL Telegram's servers can fetch, or null.
 *
 * `imageUrl` is normally an absolute URL, but a relative `/api/aicam-media/...`
 * is accepted when `TELEGRAM_MEDIA_BASE_URL` (public origin of the backend)
 * is configured. Anything else — `file://`, Windows paths, RTSP — is dropped
 * so no internal path leaks into a chat.
 */
export function resolveEvidencePhotoUrl(
  imageUrl: string | null | undefined,
  mediaBaseUrl: string | null = process.env.TELEGRAM_MEDIA_BASE_URL ?? null,
): string | null {
  if (!imageUrl) return null;
  const value = imageUrl.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;

  if (value.startsWith('/') && mediaBaseUrl) {
    const base = mediaBaseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return null;
    return `${base}${value}`;
  }

  return null;
}

export interface FormattedAlert {
  html: string;
  plainText: string;
  photoUrl: string | null;
}

export interface FormatAlertOptions {
  /** Frontend base URL used to build the "View Event Details" link. */
  dashboardUrl?: string | null;
  timeZone?: string;
  mediaBaseUrl?: string | null;
}

function buildEventUrl(eventId: string, dashboardUrl?: string | null): string | null {
  if (!dashboardUrl) return null;
  const base = dashboardUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/events?eventId=${encodeURIComponent(eventId)}`;
}

/**
 * Build the alert notification.
 *
 * The caption used by `sendPhoto` is the same HTML; Telegram caps captions at
 * 1024 characters, so the formatter keeps messages compact by design.
 */
export function buildAlertMessage(
  event: TelegramEventInfo,
  options: FormatAlertOptions = {},
): FormattedAlert {
  const style = eventStyle(event.eventType);
  const cameraName = event.camera?.name ?? 'Unknown camera';
  const location = event.camera?.location ?? null;
  const eventUrl = buildEventUrl(event.id, options.dashboardUrl);
  const photoUrl = resolveEvidencePhotoUrl(event.imageUrl, options.mediaBaseUrl ?? null);
  const time = formatEventTime(event.timestamp, options.timeZone ?? TELEGRAM_TIME_ZONE);

  const lines: string[] = [
    `${style.emoji} <b>MONITORING AI - ${escapeHtml(style.header)}</b>`,
    '',
    DIVIDER,
    '',
    `<b>Event:</b> ${escapeHtml(event.eventType)}`,
    `<b>Camera:</b> ${escapeHtml(cameraName)}`,
  ];

  if (location) lines.push(`<b>Location:</b> ${escapeHtml(location)}`);

  lines.push(
    `<b>Confidence:</b> ${formatConfidence(event.confidence)}`,
    `<b>Time:</b> ${escapeHtml(time)}`,
    '',
    `${style.emoji} <b>${escapeHtml(style.headline)}</b>`,
    '',
    `<b>Event ID:</b> <code>${escapeHtml(event.id)}</code>`,
  );

  if (event.camera?.id) {
    lines.push(`<b>Camera ID:</b> <code>${escapeHtml(event.camera.id)}</code>`);
  }

  lines.push('', DIVIDER);

  if (eventUrl) {
    lines.push('', `🔗 <a href="${escapeHtml(eventUrl)}">View Event Details</a>`);
  }

  const html = lines.join('\n');

  const plainText = [
    `${style.emoji} MONITORING AI - ${style.header}`,
    DIVIDER,
    `Event: ${event.eventType}`,
    `Camera: ${cameraName}`,
    location ? `Location: ${location}` : null,
    `Confidence: ${formatConfidence(event.confidence)}`,
    `Time: ${time}`,
    '',
    `${style.emoji} ${style.headline}`,
    '',
    `Event ID: ${event.id}`,
    event.camera?.id ? `Camera ID: ${event.camera.id}` : null,
    DIVIDER,
    eventUrl ? `View Event Details: ${eventUrl}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { html, plainText, photoUrl };
}

/** Message used by "Send test message" from the Admin UI. */
export function buildTestMessage(
  botName: string,
  recipientName?: string | null,
  options: { dashboardUrl?: string | null; timeZone?: string } = {},
): FormattedAlert {
  const time = formatEventTime(new Date(), options.timeZone ?? TELEGRAM_TIME_ZONE);
  const target = recipientName ? ` → ${escapeHtml(recipientName)}` : '';

  const html = [
    '✅ <b>MONITORING AI - TEST MESSAGE</b>',
    '',
    DIVIDER,
    '',
    `<b>Bot:</b> ${escapeHtml(botName)}${target}`,
    `<b>Time:</b> ${escapeHtml(time)}`,
    '',
    'This is a delivery test from the Monitoring AI dashboard.',
    'If you can read this, alerts will reach this chat.',
    '',
    DIVIDER,
  ].join('\n');

  const plainText = [
    '✅ MONITORING AI - TEST MESSAGE',
    DIVIDER,
    `Bot: ${botName}${recipientName ? ` -> ${recipientName}` : ''}`,
    `Time: ${time}`,
    '',
    'This is a delivery test from the Monitoring AI dashboard.',
  ].join('\n');

  return { html, plainText, photoUrl: null };
}
