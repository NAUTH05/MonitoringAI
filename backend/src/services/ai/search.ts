/**
 * Executes a validated StructuredSearchIntent against PostgreSQL.
 *
 * Security: the model produces no SQL. Every query is a Prisma call (or a
 * parameterised Prisma.sql fragment) built from the validated intent, with a
 * hard result cap and explicit bounds on every user-supplied value.
 */
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import aicamPrisma from '../../lib/aicamPrisma';
import { containsNormalized, normalizePlate, normalizeText, tokenCoverage } from './text';
import {
  AIProvider,
  EventTypeCode,
  SearchIntentKind,
  StructuredFilters,
  StructuredSearchIntent,
} from './types';

/** Relations returned with every event — identical to GET /api/events. */
export const eventInclude = {
  camera: { select: { id: true, name: true, location: true } },
  alert: true,
  evidence: { orderBy: { sequence: 'asc' as const } },
} satisfies Prisma.EventInclude;

export interface CameraIndexEntry {
  id: string;
  name: string;
  location: string;
  streamName: string | null;
  rtspUrl: string;
  aiSourceUrl: string | null;
}

export async function loadCameraIndex(): Promise<CameraIndexEntry[]> {
  return prisma.camera.findMany({
    select: {
      id: true,
      name: true,
      location: true,
      streamName: true,
      rtspUrl: true,
      aiSourceUrl: true,
    },
    orderBy: { name: 'asc' },
  });
}

export interface CameraMatch {
  camera: CameraIndexEntry;
  score: number;
}

/**
 * Resolve free text ("cổng chính", "kho", "IP_CAMERA") to a real camera.
 * Exact normalised match wins, then substring, then token overlap.
 * Returns null instead of guessing.
 */
export function matchCamera(
  text: string | undefined,
  cameras: CameraIndexEntry[],
): CameraMatch | null {
  if (!text || !text.trim() || cameras.length === 0) return null;
  const needle = normalizeText(text);

  let best: CameraMatch | null = null;
  for (const camera of cameras) {
    const name = normalizeText(camera.name);
    const location = normalizeText(camera.location);
    let score = 0;

    if (name === needle) score = 1;
    else if (location === needle) score = 0.95;
    else if (needle.includes(name) || name.includes(needle)) score = 0.85;
    else if (location && (needle.includes(location) || location.includes(needle))) score = 0.8;
    else score = Math.max(tokenCoverage(camera.name, needle), tokenCoverage(camera.location, needle) * 0.9);

    if (score > 0 && (!best || score > best.score)) best = { camera, score };
  }

  return best && best.score >= 0.5 ? best : null;
}

/**
 * Map a licence-plate `stream_id` to a camera WITHOUT guessing.
 *
 * The previous implementation fell back to `hash(stream_id) % cameras.length`,
 * which silently attributed plates to arbitrary cameras. We now match the
 * managed stream name, then the RTSP URL, and otherwise return null so the UI
 * can say "camera không xác định" instead of showing a wrong one.
 */
export function matchPlateCamera(
  streamId: string | null | undefined,
  cameras: CameraIndexEntry[],
): CameraIndexEntry | null {
  if (!streamId) return null;
  const key = normalizeText(streamId);
  if (!key) return null;

  const byStream = cameras.find((c) => c.streamName && normalizeText(c.streamName) === key);
  if (byStream) return byStream;

  const byUrl = cameras.find(
    (c) =>
      containsNormalized(c.rtspUrl, key) ||
      (c.aiSourceUrl ? containsNormalized(c.aiSourceUrl, key) : false),
  );
  if (byUrl) return byUrl;

  return cameras.find((c) => normalizeText(c.name) === key) ?? null;
}

export interface AppliedFilter {
  field: string;
  label: string;
  value: string;
}

export interface SearchWarning {
  code: string;
  message: string;
}

export interface GroupCount {
  key: string;
  label: string;
  count: number;
}

export interface PlateRow {
  id: string;
  plateText: string | null;
  vehicleType: string | null;
  plateColor: string | null;
  confidence: number | null;
  eventTime: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  cameraName: string | null;
  cameraLocation: string | null;
}

export interface SearchOutcome {
  mode: SearchIntentKind;
  intent: StructuredSearchIntent;
  total: number;
  returned: number;
  events: unknown[];
  groups?: GroupCount[];
  plates?: PlateRow[];
  answer?: string;
  appliedFilters: AppliedFilter[];
  warnings: SearchWarning[];
  timingMs: number;
  /** True when semantic scoring was actually performed (Phase 2). */
  semanticApplied: boolean;
}

const MAX_LIMIT = 50;
const BUCKET_SCAN_CAP = 5000;

function mediaBase(): string | null {
  const raw = process.env.MINIO_PUBLIC_URL;
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** Build the Prisma where-clause from validated filters. */
export function buildEventWhere(
  filters: StructuredFilters,
  cameraId: string | undefined,
): Prisma.EventWhereInput {
  const where: Prisma.EventWhereInput = {};
  if (filters.eventType) where.eventType = filters.eventType as EventTypeCode as never;
  if (cameraId) where.cameraId = cameraId;
  if (typeof filters.isAlert === 'boolean') where.isAlert = filters.isAlert;

  if (filters.startTime || filters.endTime) {
    const range: Prisma.DateTimeFilter = {};
    if (filters.startTime) range.gte = new Date(filters.startTime);
    if (filters.endTime) range.lte = new Date(filters.endTime);
    where.timestamp = range;
  }

  if (filters.minConfidence !== undefined || filters.maxConfidence !== undefined) {
    const conf: Prisma.FloatFilter = {};
    if (filters.minConfidence !== undefined) conf.gte = filters.minConfidence;
    if (filters.maxConfidence !== undefined) conf.lte = filters.maxConfidence;
    where.confidence = conf;
  }

  if (filters.hasEvidence === true) where.evidence = { some: {} };
  if (filters.hasEvidence === false) where.evidence = { none: {} };

  return where;
}

function describeFilters(
  filters: StructuredFilters,
  camera: CameraIndexEntry | null,
): AppliedFilter[] {
  const out: AppliedFilter[] = [];
  if (filters.eventType) out.push({ field: 'eventType', label: 'Loại sự kiện', value: filters.eventType });
  if (camera) out.push({ field: 'camera', label: 'Camera', value: camera.name });
  else if (filters.cameraName) {
    out.push({ field: 'camera', label: 'Camera (chưa khớp)', value: filters.cameraName });
  }
  if (filters.cameraLocation && !camera) {
    out.push({ field: 'location', label: 'Khu vực', value: filters.cameraLocation });
  }
  if (typeof filters.isAlert === 'boolean') {
    out.push({ field: 'isAlert', label: 'Chỉ cảnh báo', value: filters.isAlert ? 'Có' : 'Không' });
  }
  if (filters.startTime || filters.endTime) {
    const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('vi-VN') : '—');
    out.push({
      field: 'time',
      label: filters.timeLabel ? `Thời gian (${filters.timeLabel})` : 'Thời gian',
      value: `${fmt(filters.startTime)} → ${fmt(filters.endTime)}`,
    });
  }
  if (filters.minConfidence !== undefined) {
    out.push({ field: 'confidence', label: 'Độ tin cậy tối thiểu', value: `${Math.round(filters.minConfidence * 100)}%` });
  }
  if (filters.licensePlate) {
    out.push({ field: 'plate', label: 'Biển số', value: filters.licensePlate });
  }
  if (filters.vehicleType) out.push({ field: 'vehicle', label: 'Loại xe', value: filters.vehicleType });
  if (filters.plateColor) out.push({ field: 'plateColor', label: 'Màu biển', value: filters.plateColor });
  if (typeof filters.hasEvidence === 'boolean') {
    out.push({ field: 'evidence', label: 'Có bằng chứng', value: filters.hasEvidence ? 'Có' : 'Không' });
  }
  return out;
}

async function searchEvents(intent: StructuredSearchIntent) {
  const cameras = await loadCameraIndex();
  const warnings: SearchWarning[] = [];
  const matched = matchCamera(intent.structuredFilters.cameraName, cameras);
  const locationMatched = matched
    ? null
    : matchCamera(intent.structuredFilters.cameraLocation, cameras);

  const resolved = matched?.camera ?? locationMatched?.camera ?? null;

  if (intent.structuredFilters.cameraName && !matched && !locationMatched) {
    warnings.push({
      code: 'CAMERA_NOT_FOUND',
      message: `Không có camera nào khớp "${intent.structuredFilters.cameraName}" trong hệ thống.`,
    });
  }

  if (intent.structuredFilters.cameraName && !resolved) {
    return {
      cameras,
      camera: null,
      where: buildEventWhere(intent.structuredFilters, undefined),
      events: [] as unknown[],
      total: 0,
      warnings,
      applied: describeFilters(intent.structuredFilters, null),
      blocked: true,
    };
  }

  const where = buildEventWhere(intent.structuredFilters, resolved?.id);
  const limit = Math.min(MAX_LIMIT, Math.max(1, intent.limit || 20));
  const orderBy: Prisma.EventOrderByWithRelationInput =
    intent.sort === 'oldest' ? { timestamp: 'asc' } : { timestamp: 'desc' };

  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, include: eventInclude, orderBy, take: limit }),
    prisma.event.count({ where }),
  ]);

  return {
    cameras,
    camera: resolved,
    where,
    events,
    total,
    warnings,
    applied: describeFilters(intent.structuredFilters, resolved),
    blocked: false,
  };
}

async function searchCount(intent: StructuredSearchIntent) {
  const base = await searchEvents(intent);
  const groups: GroupCount[] = [];

  if (intent.groupBy === 'camera') {
    const rows = await prisma.event.groupBy({
      by: ['cameraId'],
      where: base.where,
      _count: { _all: true },
    });
    const byId = new Map(base.cameras.map((c) => [c.id, c]));
    for (const row of rows) {
      const cam = byId.get(row.cameraId);
      groups.push({
        key: row.cameraId,
        label: cam?.name ?? 'Camera đã xoá',
        count: row._count._all,
      });
    }
    groups.sort((a, b) => b.count - a.count);
  } else if (intent.groupBy === 'eventType') {
    const rows = await prisma.event.groupBy({
      by: ['eventType'],
      where: base.where,
      _count: { _all: true },
    });
    for (const row of rows) {
      groups.push({ key: row.eventType, label: row.eventType, count: row._count._all });
    }
    groups.sort((a, b) => b.count - a.count);
  } else if (intent.groupBy === 'day' || intent.groupBy === 'hour') {
    // Prisma cannot group by a date_trunc expression; bucket a bounded window
    // and say so when the window is smaller than the true total.
    const rows = await prisma.event.findMany({
      where: base.where,
      select: { timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: BUCKET_SCAN_CAP,
    });
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const d = new Date(row.timestamp);
      const key =
        intent.groupBy === 'day'
          ? d.toLocaleDateString('sv-SE') // YYYY-MM-DD
          : `${d.toLocaleDateString('sv-SE')} ${String(d.getHours()).padStart(2, '0')}:00`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    for (const [key, count] of buckets) groups.push({ key, label: key, count });
    groups.sort((a, b) => (a.key < b.key ? 1 : -1));
    if (base.total > rows.length) {
      base.warnings.push({
        code: 'BUCKET_WINDOW',
        message: `Tổng số ${base.total} là chính xác; bảng phân bố chỉ tính trên ${rows.length} bản ghi gần nhất.`,
      });
    }
  }

  return { ...base, groups };
}

async function searchPlates(intent: StructuredSearchIntent): Promise<{
  plates: PlateRow[];
  total: number;
  warnings: SearchWarning[];
}> {
  const warnings: SearchWarning[] = [];
  const cameras = await loadCameraIndex();
  const filters = intent.structuredFilters;
  const plate = normalizePlate(filters.licensePlate || '');
  const limit = Math.min(MAX_LIMIT, Math.max(1, intent.limit || 20));

  const conditions: Prisma.Sql[] = [
    Prisma.sql`plate_text IS NOT NULL AND plate_text <> ''`,
  ];
  if (plate) {
    conditions.push(
      Prisma.sql`regexp_replace(upper(plate_text), '[^A-Z0-9]', '', 'g') LIKE ${`%${plate}%`}`,
    );
  }
  if (filters.startTime) conditions.push(Prisma.sql`event_time >= ${new Date(filters.startTime)}`);
  if (filters.endTime) conditions.push(Prisma.sql`event_time <= ${new Date(filters.endTime)}`);
  if (filters.vehicleType) {
    conditions.push(Prisma.sql`LOWER(vehicle_type) = LOWER(${filters.vehicleType})`);
  }
  if (filters.plateColor) {
    conditions.push(Prisma.sql`LOWER(plate_color) = LOWER(${filters.plateColor})`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');
  const base = mediaBase();

  try {
    const [rows, countRows] = await Promise.all([
      aicamPrisma.$queryRaw<
        Array<{
          id: string;
          stream_id: string | null;
          plate_text: string | null;
          vehicle_type: string | null;
          plate_color: string | null;
          confidence: number | null;
          event_time: Date;
          image_path: string | null;
          thumbnail_path: string | null;
        }>
      >(Prisma.sql`
        SELECT id, stream_id, plate_text, vehicle_type, plate_color, confidence, event_time, image_path, thumbnail_path
        FROM events
        WHERE ${whereClause}
        ORDER BY event_time DESC
        LIMIT ${limit};
      `),
      aicamPrisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM events WHERE ${whereClause};
      `),
    ]);

    const plates: PlateRow[] = rows.map((row) => {
      const camera = matchPlateCamera(row.stream_id, cameras);
      return {
        id: row.id,
        plateText: row.plate_text,
        vehicleType: row.vehicle_type,
        plateColor: row.plate_color,
        confidence: row.confidence,
        eventTime: new Date(row.event_time).toISOString(),
        imageUrl: row.image_path
          ? base
            ? `${base}/${row.image_path}`
            : `/api/aicam-media/${row.image_path}`
          : null,
        thumbnailUrl: row.thumbnail_path
          ? base
            ? `${base}/${row.thumbnail_path}`
            : `/api/aicam-media/${row.thumbnail_path}`
          : null,
        cameraName: camera?.name ?? null,
        cameraLocation: camera?.location ?? null,
      };
    });

    if (rows.length === 0) {
      warnings.push({
        code: 'NO_PLATE_DATA',
        message: 'Không có bản ghi biển số nào khớp trong cơ sở dữ liệu aicam.',
      });
    }

    return { plates, total: Number(countRows[0]?.count ?? 0), warnings };
  } catch (err) {
    return {
      plates: [],
      total: 0,
      warnings: [
        {
          code: 'PLATE_DB_UNAVAILABLE',
          message: `Không truy vấn được cơ sở dữ liệu biển số (aicam): ${(err as Error).message}`,
        },
      ],
    };
  }
}

/** Deterministic Vietnamese sentence used when no LLM summary is available. */
function deterministicAnswer(intent: StructuredSearchIntent, total: number, groups?: GroupCount[]): string {
  const filters = intent.structuredFilters;
  const type = filters.eventType ? ` sự kiện ${filters.eventType}` : ' sự kiện';
  const range = filters.startTime || filters.endTime ? ' trong khoảng thời gian đã chọn' : '';
  const alertPart = filters.isAlert ? ' (chỉ tính cảnh báo)' : '';
  const head = `Có ${total}${type}${range}${alertPart}.`;
  if (!groups || groups.length === 0) return head;
  const top = groups
    .slice(0, 5)
    .map((g) => `${g.label}: ${g.count}`)
    .join(', ');
  return `${head} Phân bố: ${top}.`;
}

export interface ExecuteOptions {
  provider?: AIProvider | null;
  /** Whether a semantic index is available (Phase 2). */
  semanticAvailable?: boolean;
}

/** Run any intent kind and return one uniform response for the API/UI. */
export async function executeSearch(
  intent: StructuredSearchIntent,
  options: ExecuteOptions = {},
): Promise<SearchOutcome> {
  const started = Date.now();
  const warnings: SearchWarning[] = [];
  const semanticApplied = false;

  if (intent.intent === 'visual_search' || intent.intent === 'hybrid_search') {
    warnings.push({
      code: 'SEMANTIC_UNAVAILABLE',
      message: options.semanticAvailable
        ? 'Chỉ mục thị giác chưa có dữ liệu cho phép chấm điểm ngữ nghĩa — đang trả về kết quả theo bộ lọc metadata.'
        : 'Chỉ mục thị giác chưa được xây dựng nên chưa thể tìm theo nội dung hình ảnh; kết quả dưới đây chỉ dựa trên metadata.',
    });
  }

  // A pure visual query cannot be answered without an index. Returning every
  // event would look like a match, so we return nothing and say why.
  if (intent.intent === 'visual_search' && !options.semanticAvailable) {
    return {
      mode: 'visual_search',
      intent,
      total: 0,
      returned: 0,
      events: [],
      appliedFilters: describeFilters(intent.structuredFilters, null),
      warnings,
      timingMs: Date.now() - started,
      semanticApplied: false,
    };
  }

  if (intent.intent === 'license_plate_search') {
    const { plates, total, warnings: plateWarnings } = await searchPlates(intent);
    warnings.push(...plateWarnings);
    return {
      mode: 'license_plate_search',
      intent,
      total,
      returned: plates.length,
      events: [],
      plates,
      answer: total > 0 ? `Tìm thấy ${total} bản ghi biển số khớp.` : 'Không tìm thấy bản ghi biển số nào khớp.',
      appliedFilters: describeFilters(intent.structuredFilters, null),
      warnings,
      timingMs: Date.now() - started,
      semanticApplied,
    };
  }

  if (intent.intent === 'event_count' || intent.intent === 'event_statistics') {
    const result = await searchCount(intent);
    warnings.push(...result.warnings);
    let answer = deterministicAnswer(intent, result.total, result.groups);
    if (options.provider?.summarizeResults && result.total >= 0) {
      try {
        const facts = `total=${result.total}; groups=${JSON.stringify(result.groups ?? [])}`;
        const rows = JSON.stringify(
          result.events.slice(0, 5).map((e) => {
            const ev = e as { eventType?: string; timestamp?: string; camera?: { name?: string } };
            return { type: ev.eventType, time: ev.timestamp, camera: ev.camera?.name };
          }),
        );
        const summary = await options.provider.summarizeResults({
          query: intent.visualQuery?.description || 'tổng hợp sự kiện',
          facts,
          rows,
        });
        if (summary) answer = summary;
      } catch {
        warnings.push({
          code: 'SUMMARY_FAILED',
          message: 'Không tạo được câu trả lời bằng AI — đang hiển thị câu trả lời tính trực tiếp từ cơ sở dữ liệu.',
        });
      }
    }
    return {
      mode: intent.intent,
      intent,
      total: result.total,
      returned: result.events.length,
      events: result.events,
      groups: result.groups,
      answer,
      appliedFilters: result.applied,
      warnings,
      timingMs: Date.now() - started,
      semanticApplied,
    };
  }

  const result = await searchEvents(intent);
  warnings.push(...result.warnings);
  return {
    mode: intent.intent,
    intent,
    total: result.total,
    returned: result.events.length,
    events: result.events,
    appliedFilters: result.applied,
    warnings,
    timingMs: Date.now() - started,
    semanticApplied,
  };
}
