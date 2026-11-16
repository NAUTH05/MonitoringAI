/**
 * Natural-language → StructuredSearchIntent.
 *
 * Three paths, all producing the SAME validated shape:
 *   1. Gemini      (provider-gemini.ts)
 *   2. Local model (provider-local.ts)
 *   3. Rule-based  (this file) — deterministic, no model required, and labelled
 *                  as such in the UI so it is never mistaken for an LLM.
 *
 * The model's output is untrusted: it is parsed as JSON, validated with Zod,
 * and normalised (clamped limits, valid enums only, ISO times only). A malformed
 * answer degrades to the rule-based parser instead of failing the search.
 */
import { z } from 'zod';
import { clampNumber, normalizePlate, normalizeText, tokenCoverage } from './text';
import {
  EVENT_TYPES,
  EventTypeCode,
  InterpretQueryInput,
  SearchIntentKind,
  StructuredFilters,
  StructuredSearchIntent,
  VisualDescription,
} from './types';
import { resolvePreset, toIsoOrUndefined, describeNowVN } from './time';

export class IntentParseError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = 'IntentParseError';
  }
}

const filtersSchema = z.object({
  eventType: z.string().optional(),
  cameraName: z.string().max(200).optional(),
  cameraLocation: z.string().max(200).optional(),
  isAlert: z.boolean().optional(),
  minConfidence: z.union([z.number(), z.string()]).optional(),
  maxConfidence: z.union([z.number(), z.string()]).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timeLabel: z.string().max(80).optional(),
  licensePlate: z.string().max(32).optional(),
  vehicleType: z.string().max(64).optional(),
  plateColor: z.string().max(64).optional(),
  hasEvidence: z.boolean().optional(),
});

const visualSchema = z.object({
  description: z.string().max(500).optional(),
  requiresSemanticSearch: z.boolean().optional(),
  mediaType: z.enum(['image', 'video', 'any']).optional(),
});

const rawIntentSchema = z.object({
  intent: z.string().optional(),
  language: z.enum(['vi', 'en']).optional(),
  structuredFilters: filtersSchema.optional(),
  visualQuery: visualSchema.optional(),
  groupBy: z.enum(['camera', 'eventType', 'day', 'hour']).optional(),
  sort: z.enum(['relevance', 'newest', 'oldest']).optional(),
  limit: z.union([z.number(), z.string()]).optional(),
  reasoning: z.string().max(500).optional(),
});

const INTENT_KINDS: SearchIntentKind[] = [
  'metadata_search',
  'visual_search',
  'hybrid_search',
  'license_plate_search',
  'event_count',
  'event_statistics',
  'evidence_lookup',
];

function asEventType(value: string | undefined): EventTypeCode | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase().trim();
  return (EVENT_TYPES as string[]).includes(upper) ? (upper as EventTypeCode) : undefined;
}

function cleanText(value: string | undefined, max = 200): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Validate + normalise a raw intent object into the canonical shape.
 * Throws IntentParseError when the payload is not usable at all.
 */
export function normalizeIntent(raw: unknown, opts: { source: string }): StructuredSearchIntent {
  const parsed = rawIntentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntentParseError(
      `AI trả về JSON không đúng cấu trúc (${opts.source}): ${parsed.error.issues[0]?.message || 'invalid'}`,
      JSON.stringify(raw).slice(0, 500),
    );
  }
  const value = parsed.data;

  const filters: StructuredFilters = {};
  const rawFilters = value.structuredFilters ?? {};
  const eventType = asEventType(rawFilters.eventType);
  if (eventType) filters.eventType = eventType;

  const cameraName = cleanText(rawFilters.cameraName);
  if (cameraName) filters.cameraName = cameraName;
  const cameraLocation = cleanText(rawFilters.cameraLocation);
  if (cameraLocation) filters.cameraLocation = cameraLocation;

  if (typeof rawFilters.isAlert === 'boolean') filters.isAlert = rawFilters.isAlert;
  if (typeof rawFilters.hasEvidence === 'boolean') filters.hasEvidence = rawFilters.hasEvidence;

  const minC = clampNumber(rawFilters.minConfidence, 0, 1);
  if (minC !== undefined) filters.minConfidence = minC;
  const maxC = clampNumber(rawFilters.maxConfidence, 0, 1);
  if (maxC !== undefined) filters.maxConfidence = maxC;

  const startTime = toIsoOrUndefined(rawFilters.startTime);
  const endTime = toIsoOrUndefined(rawFilters.endTime);
  if (startTime) filters.startTime = startTime;
  if (endTime) filters.endTime = endTime;
  const timeLabel = cleanText(rawFilters.timeLabel, 80);
  if (timeLabel) filters.timeLabel = timeLabel;
  if (filters.startTime && filters.endTime && filters.startTime > filters.endTime) {
    const swap = filters.startTime;
    filters.startTime = filters.endTime;
    filters.endTime = swap;
  }

  const plate = rawFilters.licensePlate ? normalizePlate(rawFilters.licensePlate) : '';
  if (plate) filters.licensePlate = plate;
  const vehicleType = cleanText(rawFilters.vehicleType, 64);
  if (vehicleType) filters.vehicleType = vehicleType;
  const plateColor = cleanText(rawFilters.plateColor, 64);
  if (plateColor) filters.plateColor = plateColor;

  let visualQuery: StructuredSearchIntent['visualQuery'];
  const description = cleanText(value.visualQuery?.description, 500);
  if (description) {
    visualQuery = {
      description,
      requiresSemanticSearch: value.visualQuery?.requiresSemanticSearch !== false,
      mediaType: value.visualQuery?.mediaType || 'any',
    };
  }

  let intent: SearchIntentKind;
  const declared = value.intent?.toLowerCase().trim() as SearchIntentKind | undefined;
  if (declared && INTENT_KINDS.includes(declared)) {
    intent = declared;
  } else if (filters.licensePlate) {
    intent = 'license_plate_search';
  } else if (visualQuery) {
    intent = Object.keys(filters).length > 0 ? 'hybrid_search' : 'visual_search';
  } else {
    intent = 'metadata_search';
  }

  // A declared visual/hybrid intent without a description cannot be executed.
  if ((intent === 'visual_search' || intent === 'hybrid_search') && !visualQuery) {
    intent = filters.licensePlate ? 'license_plate_search' : 'metadata_search';
  }

  const limit = clampNumber(value.limit, 1, 50) ?? 20;

  return {
    intent,
    language: value.language || 'vi',
    structuredFilters: filters,
    visualQuery,
    groupBy: value.groupBy,
    sort: value.sort || 'relevance',
    limit: Math.round(limit),
    reasoning: cleanText(value.reasoning, 500),
  };
}

/** Parse a model response into a validated intent. */
export function parseIntentJson(
  raw: string,
  opts: { source: string } = { source: 'llm' },
): StructuredSearchIntent {
  // Models routinely wrap JSON in ```json fences even when told not to.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    throw new IntentParseError(`AI không trả về JSON hợp lệ (${opts.source}).`, raw.slice(0, 500));
  }
  return normalizeIntent(json, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

export function buildIntentPrompt(input: InterpretQueryInput): string {
  const cameras =
    input.cameras.length > 0
      ? input.cameras.map((c) => `- "${c.name}" (khu vực: ${c.location})`).join('\n')
      : '(chưa có camera nào trong hệ thống)';

  return [
    'You translate a surveillance operator question into ONE JSON search intent.',
    '',
    `CURRENT TIME in Asia/Ho_Chi_Minh: ${input.nowLocal}`,
    'Use this exact time to resolve relative expressions. Never invent a different current date.',
    '',
    'CAMERAS THAT EXIST IN THE DATABASE (use these exact names; if none matches, omit cameraName):',
    cameras,
    '',
    `ALLOWED eventType values: ${input.knownEventTypes.join(', ')}`,
    '',
    'Return ONLY this JSON object (no prose, no markdown):',
    '{',
    '  "intent": "metadata_search | visual_search | hybrid_search | license_plate_search | event_count | event_statistics | evidence_lookup",',
    '  "language": "vi | en",',
    '  "structuredFilters": {',
    '    "eventType": "ONE_ALLOWED_VALUE (optional)",',
    '    "cameraName": "exact camera name from the list (optional)",',
    '    "cameraLocation": "location text (optional)",',
    '    "isAlert": true|false (optional),',
    '    "minConfidence": 0.0-1.0 (optional),',
    '    "maxConfidence": 0.0-1.0 (optional),',
    '    "startTime": "ISO-8601 UTC (optional)",',
    '    "endTime": "ISO-8601 UTC (optional)",',
    '    "licensePlate": "plate text (optional)",',
    '    "vehicleType": "car|motorbike|truck (optional)",',
    '    "plateColor": "white|yellow|blue|red (optional)",',
    '    "hasEvidence": true|false (optional)',
    '  },',
    '  "visualQuery": { "description": "what to look for visually", "requiresSemanticSearch": true, "mediaType": "image|video|any" },',
    '  "groupBy": "camera|eventType|day|hour (optional)",',
    '  "sort": "relevance|newest|oldest",',
    '  "limit": 1-50,',
    '  "reasoning": "one short sentence in Vietnamese explaining the filters"',
    '}',
    '',
    'RULES:',
    '- If the question asks for a COUNT or statistics, use "event_count" / "event_statistics" and put a real groupBy when it asks per camera/day.',
    '- If the question mentions a licence plate, use "license_plate_search" and fill licensePlate.',
    '- If the question describes appearance/colour/objects/actions, fill visualQuery and use "visual_search" or "hybrid_search".',
    '- If the question only restricts metadata (time, camera, type, alert), use "metadata_search" and OMIT visualQuery.',
    '- Only include a filter the question actually implies. Do not add defaults.',
    '- Times must be ISO-8601 in UTC. Convert from Asia/Ho_Chi_Minh (UTC+7).',
    '- Never output SQL.',
    '',
    `QUESTION: ${input.query}`,
  ].join('\n');
}

export function buildImagePrompt(context?: string): string {
  return [
    'You describe surveillance evidence for a searchable index.',
    'Describe ONLY what is visibly present. Do not identify people, do not guess names, age, ethnicity or emotions.',
    'If something is unclear, put it in "uncertainty" instead of guessing.',
    '',
    context ? `CONTEXT: ${context}` : '',
    '',
    'Return ONLY JSON:',
    '{',
    '  "summary": "one or two sentences, English",',
    '  "objects": ["person", "backpack"],',
    '  "attributes": ["red shirt", "dark trousers"],',
    '  "activities": ["walking"],',
    '  "scene": "warehouse entrance",',
    '  "uncertainty": ["colour of shoes unclear"]',
    '}',
    '',
    'Keep attributes concrete and visual (colours, clothing, carried objects, vehicle type/colour).',
    'Use short lowercase English phrases so they can be matched by a text search.',
  ]
    .filter(Boolean)
    .join('\n');
}

const visualDescriptionSchema = z.object({
  summary: z.string().max(1000).optional(),
  objects: z.array(z.string()).optional(),
  attributes: z.array(z.string()).optional(),
  activities: z.array(z.string()).optional(),
  scene: z.string().max(200).optional(),
  uncertainty: z.array(z.string()).optional(),
});

/** Validate a vision-model description; never throws on partial output. */
export function parseVisualDescription(raw: string): VisualDescription {
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      summary: raw.trim().slice(0, 800),
      objects: [],
      attributes: [],
      activities: [],
      uncertainty: ['Model không trả về JSON — chỉ lưu mô tả thô.'],
    };
  }
  const parsed = visualDescriptionSchema.safeParse(json);
  if (!parsed.success) {
    return {
      summary: '',
      objects: [],
      attributes: [],
      activities: [],
      uncertainty: ['Mô tả không đúng cấu trúc mong đợi.'],
    };
  }
  const clean = (arr?: string[]) =>
    (arr || [])
      .map((s) => String(s).trim().toLowerCase())
      .filter((s) => s.length > 0 && s.length <= 120)
      .slice(0, 20);

  const objects = clean(parsed.data.objects);
  const attributes = clean(parsed.data.attributes);
  const activities = clean(parsed.data.activities);
  const summary =
    parsed.data.summary?.trim() ||
    [objects.join(', '), attributes.join(', ')].filter(Boolean).join(' — ') ||
    '';

  return {
    summary: summary.slice(0, 800),
    objects,
    attributes,
    activities,
    scene: parsed.data.scene?.trim().toLowerCase().slice(0, 200) || undefined,
    uncertainty: clean(parsed.data.uncertainty),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule-based fallback (no model required)
// ─────────────────────────────────────────────────────────────────────────────

interface TimeHit {
  startTime?: string;
  endTime?: string;
  label: string;
}

const EVENT_KEYWORDS: Array<{ type: EventTypeCode; words: string[] }> = [
  { type: 'INTRUSION', words: ['xam nhap', 'dot nhap', 'intrusion', 'trespass'] },
  { type: 'FIRE', words: ['chay', 'hoa hoan', 'fire', 'flame'] },
  { type: 'SMOKE', words: ['khoi', 'smoke'] },
  { type: 'PPE', words: ['bao ho', 'ppe', 'do bao ho', 'protective equipment'] },
  { type: 'FACE', words: ['khuon mat', 'face', 'nhan dien khuon mat'] },
  { type: 'FLOOD', words: ['ngap', 'lu lut', 'flood'] },
  { type: 'TRAFFIC_VIOLATION', words: ['giao thong', 'traffic', 'vi pham giao thong'] },
  { type: 'VEHICLE', words: ['phuong tien', 'vehicle', 'o to', 'xe tai', 'xe buyt'] },
];

const COUNT_WORDS = ['bao nhieu', 'how many', 'count', 'so luong', 'tong so'];
const STATS_WORDS = ['thong ke', 'statistics', 'bieu do', 'chart', 'theo camera', 'group by', 'phan bo'];
const ALERT_WORDS = ['canh bao', 'alert', 'bao dong', 'warning'];

/**
 * Visual detection for the rule-based parser.
 *
 * Vietnamese colour words collide badly once diacritics are stripped:
 *   "xâm" (intrusion) → "xam" = xám (grey)
 *   "tìm" (find)      → "tim" = tím (purple)
 *   "đến" (arrive)    → "den" = đen (black)
 *   "đếm" (count)     → "dem" = đêm (night)
 * So colours are only accepted inside an explicit clothing/vehicle context, and
 * the diacritic form is required when the query itself has diacritics.
 */
const CLOTHING_CONTEXT = '(?:ao|quan|mu|non|vay|do mac|trang phuc|xe|giay|khan|balo|ba lo)';

/**
 * Vietnamese patterns deliberately avoid `\b`: JS word boundaries are ASCII-only,
 * so `\bmặc\b` never matches ("ặ" is a non-word char, so the trailing boundary
 * fails). Substring matching with an explicit context word is both simpler and
 * correct for diacritics.
 */
const VISUAL_PATTERNS_DIACRITIC: RegExp[] = [
  /(?:áo|quần|mũ|nón|váy|đồ mặc|trang phục|giày|khăn|ba lô|balo|xe)\s+(?:màu\s+)?(đỏ|xanh|vàng|đen|trắng|xám|hồng|tím|cam|nâu)/i,
  /màu\s+(đỏ|xanh|vàng|đen|trắng|xám|hồng|tím|cam|nâu)/i,
  /(?:đội|mặc|mang|cầm|xách|đeo)[^.]{0,24}(đỏ|xanh|vàng|đen|trắng|xám|hồng|tím)/i,
  /(ba lô|balo|mũ bảo hiểm|khẩu trang|gậy|vali|túi xách)/i,
];

const VISUAL_PATTERNS_UNACCENTED: RegExp[] = [
  new RegExp(`${CLOTHING_CONTEXT}\\s+(?:mau\\s+)?(do|xanh|vang|den|trang|xam|hong|tim|cam|nau)\\b`, 'i'),
  /\bmau\s+(do|xanh|vang|den|trang|xam|hong|tim|cam|nau)\b/i,
  /\b(balo|ba lo|mu bao hiem|khau trang|gay|vali|tui xach)\b/i,
];

const VISUAL_PATTERNS_ENGLISH: RegExp[] = [
  /\b(red|green|blue|yellow|black|white|gray|grey|pink|purple|orange|brown)\b/i,
  /\b(backpack|helmet|face mask|suitcase|handbag|luggage)\b/i,
];

const HAS_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;

function detectVisualSignals(query: string, normalized: string): string[] {
  const hits: string[] = [];
  const withDiacritics = HAS_DIACRITICS.test(query);

  for (const re of VISUAL_PATTERNS_ENGLISH) {
    const m = normalized.match(re) || query.toLowerCase().match(re);
    if (m) hits.push(m[0].trim());
  }
  for (const re of VISUAL_PATTERNS_DIACRITIC) {
    const m = query.match(re);
    if (m) hits.push(m[0].trim().toLowerCase());
  }
  // Unaccented colour forms are only trusted when the user typed no diacritics
  // at all — otherwise "xâm" would be read as grey.
  if (!withDiacritics) {
    for (const re of VISUAL_PATTERNS_UNACCENTED) {
      const m = normalized.match(re);
      if (m) hits.push(m[0].trim());
    }
  }
  return Array.from(new Set(hits));
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(
    haystack,
  );
}

function detectTime(normalized: string, now: Date): TimeHit | null {
  const hoursAgo = normalized.match(/(\d{1,2})\s*(?:gio|hour|hours|h)\s*(?:gan day|truoc|qua|ago)?/);
  if (hoursAgo && /gio|hour|h\b/.test(normalized)) {
    const n = Math.max(1, Math.min(720, Number(hoursAgo[1])));
    if (n <= 48) {
      return {
        startTime: new Date(now.getTime() - n * 3600_000).toISOString(),
        endTime: now.toISOString(),
        label: `${n} giờ gần đây`,
      };
    }
  }

  const daysAgo = normalized.match(/(\d{1,3})\s*(?:ngay|day|days)\s*(?:gan day|truoc|qua|ago)?/);
  if (daysAgo && /ngay|day/.test(normalized)) {
    const n = Math.max(1, Math.min(365, Number(daysAgo[1])));
    const r = resolvePreset(`last_n_days:${n}` as const, now);
    return { startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(), label: r.label };
  }

  const presets: Array<{ test: RegExp; preset: Parameters<typeof resolvePreset>[0] }> = [
    { test: /hom qua|yesterday/, preset: 'yesterday' },
    { test: /toi qua|dem qua|last night/, preset: 'last_night' },
    { test: /sang nay|this morning/, preset: 'this_morning' },
    { test: /chieu nay|this afternoon/, preset: 'this_afternoon' },
    { test: /toi nay|this evening/, preset: 'this_evening' },
    { test: /tuan truoc|last week/, preset: 'last_week' },
    { test: /tuan nay|this week/, preset: 'this_week' },
    { test: /thang truoc|last month/, preset: 'last_month' },
    { test: /thang nay|this month/, preset: 'this_month' },
    { test: /hom nay|today/, preset: 'today' },
    { test: /24\s*(?:gio|hour)/, preset: 'last_24h' },
  ];

  for (const p of presets) {
    if (p.test.test(normalized)) {
      const r = resolvePreset(p.preset, now);
      return { startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(), label: r.label };
    }
  }
  return null;
}

/** Detect a Vietnamese licence plate inside free text. */
export function extractPlate(query: string): string | undefined {
  const compact = query.toUpperCase().replace(/[.\s]/g, '');
  const match = compact.match(/\b(\d{2}[A-Z]{1,2}-?\d{3,5})\b/);
  if (match) return normalizePlate(match[1]);
  const loose = query.match(/\b(\d{2}[A-Za-z]{1,2}[-\s.]?\d{3,4}[.\s]?\d{0,2})\b/);
  return loose ? normalizePlate(loose[1]) : undefined;
}

/** Deterministic intent parser used when no AI provider is available. */
export function ruleBasedIntent(
  query: string,
  cameras: Array<{ name: string; location: string }>,
  now: Date = new Date(),
): StructuredSearchIntent {
  const normalized = normalizeText(query);
  const filters: StructuredFilters = {};
  const notes: string[] = [];

  const plate = extractPlate(query);
  if (plate) {
    filters.licensePlate = plate;
    notes.push(`biển số ${plate}`);
  }

  for (const entry of EVENT_KEYWORDS) {
    if (entry.words.some((w) => hasPhrase(normalized, w))) {
      filters.eventType = entry.type;
      notes.push(`loại ${entry.type}`);
      break;
    }
  }

  if (ALERT_WORDS.some((w) => hasPhrase(normalized, w))) {
    filters.isAlert = true;
    notes.push('chỉ cảnh báo');
  }

  const time = detectTime(normalized, now);
  if (time?.startTime) {
    filters.startTime = time.startTime;
    filters.endTime = time.endTime;
    filters.timeLabel = time.label;
    notes.push(`thời gian: ${time.label}`);
  }

  let bestCamera: { name: string; score: number } | null = null;
  for (const cam of cameras) {
    // Coverage (not Jaccard): a short camera/location field inside a long
    // question should still count as a strong match.
    const nameScore = tokenCoverage(cam.name, normalized);
    const locScore = tokenCoverage(cam.location, normalized) * 0.9;
    const direct = normalizeText(cam.name) && normalized.includes(normalizeText(cam.name)) ? 1 : 0;
    const score = Math.max(nameScore, locScore, direct);
    if (score >= 0.6 && (!bestCamera || score > bestCamera.score)) {
      bestCamera = { name: cam.name, score };
    }
  }
  if (bestCamera) {
    filters.cameraName = bestCamera.name;
    notes.push(`camera "${bestCamera.name}"`);
  }

  const visualWords = detectVisualSignals(query, normalized);
  const wantsVisual = visualWords.length > 0;
  const wantsCount = COUNT_WORDS.some((w) => hasPhrase(normalized, w));
  const wantsStats = STATS_WORDS.some((w) => hasPhrase(normalized, w));

  let intent: SearchIntentKind = 'metadata_search';
  if (plate) intent = 'license_plate_search';
  else if (wantsCount) intent = 'event_count';
  else if (wantsStats) intent = 'event_statistics';
  else if (wantsVisual) intent = Object.keys(filters).length > 0 ? 'hybrid_search' : 'visual_search';

  const groupBy = wantsStats
    ? /camera/.test(normalized)
      ? 'camera'
      : /ngay|day/.test(normalized)
        ? 'day'
        : /gio|hour/.test(normalized)
          ? 'hour'
          : 'eventType'
    : undefined;

  const reasoningParts = notes.length > 0 ? notes : ['không có điều kiện cụ thể'];
  const reasoning =
    `Diễn giải bằng luật (không dùng LLM): ${reasoningParts.join(', ')}` +
    (wantsVisual ? `; nội dung hình ảnh: ${visualWords.slice(0, 4).join(', ')}` : '');

  return {
    intent,
    language: /[àáảãạăâđêôơư]/i.test(query)
      ? 'vi'
      : /\b(the|show|find|last|today|yesterday|events?|alerts?|with)\b/i.test(normalized)
        ? 'en'
        : 'vi',
    structuredFilters: filters,
    visualQuery: wantsVisual
      ? {
          description: query.trim().slice(0, 500),
          requiresSemanticSearch: true,
          mediaType: /video/.test(normalized) ? 'video' : 'any',
        }
      : undefined,
    groupBy,
    sort: intent === 'event_count' || intent === 'event_statistics' ? 'newest' : 'relevance',
    limit: 20,
    reasoning,
  };
}

/** Convenience: describe "now" for prompts, exported for tests. */
export const currentTimeForPrompt = describeNowVN;
