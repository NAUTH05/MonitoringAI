/**
 * Shared types for the AI Search subsystem.
 *
 * The LLM never produces SQL. It produces a `StructuredSearchIntent`, which is
 * validated with Zod and then executed by `search.ts` using Prisma. Anything
 * the model invents outside this shape is discarded.
 */

export type AIProviderKind = 'GEMINI' | 'LOCAL';

/** Every retrieval strategy the backend knows how to execute. */
export type SearchIntentKind =
  | 'metadata_search'
  | 'visual_search'
  | 'hybrid_search'
  | 'license_plate_search'
  | 'event_count'
  | 'event_statistics'
  | 'evidence_lookup';

export type EventTypeCode =
  | 'INTRUSION'
  | 'FIRE'
  | 'SMOKE'
  | 'PPE'
  | 'FACE'
  | 'VEHICLE'
  | 'FLOOD'
  | 'TRAFFIC_VIOLATION';

export const EVENT_TYPES: EventTypeCode[] = [
  'INTRUSION',
  'FIRE',
  'SMOKE',
  'PPE',
  'FACE',
  'VEHICLE',
  'FLOOD',
  'TRAFFIC_VIOLATION',
];

export interface StructuredFilters {
  eventType?: EventTypeCode;
  /** Free text taken from the query; resolved to a real camera afterwards. */
  cameraName?: string;
  cameraLocation?: string;
  isAlert?: boolean;
  minConfidence?: number;
  maxConfidence?: number;
  /** ISO-8601 UTC instants. */
  startTime?: string;
  endTime?: string;
  /** Human label for the resolved range ("Hôm qua", "7 ngày gần đây"). */
  timeLabel?: string;
  licensePlate?: string;
  vehicleType?: string;
  plateColor?: string;
  hasEvidence?: boolean;
}

export interface VisualQuery {
  description: string;
  requiresSemanticSearch: boolean;
  mediaType?: 'image' | 'video' | 'any';
}

export interface StructuredSearchIntent {
  intent: SearchIntentKind;
  language: 'vi' | 'en';
  structuredFilters: StructuredFilters;
  visualQuery?: VisualQuery;
  groupBy?: 'camera' | 'eventType' | 'day' | 'hour';
  sort: 'relevance' | 'newest' | 'oldest';
  limit: number;
  /** Short human-readable explanation of how the query was understood. */
  reasoning?: string;
}

export interface AICapabilities {
  text: boolean;
  vision: boolean;
  embedding: boolean;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
  capabilities: AICapabilities;
  models?: string[];
  /** Provider that was actually exercised. */
  provider: AIProviderKind;
  latencyMs?: number;
}

export interface ImageAnalysisInput {
  base64: string;
  mimeType: string;
  /** Optional hint so the model focuses on the right scene. */
  context?: string;
}

export interface VisualDescription {
  summary: string;
  objects: string[];
  attributes: string[];
  activities: string[];
  scene?: string;
  uncertainty: string[];
}

export interface InterpretQueryInput {
  query: string;
  /** Pre-formatted "now" in Asia/Ho_Chi_Minh, so the model never guesses it. */
  nowLocal: string;
  cameras: Array<{ name: string; location: string }>;
  knownEventTypes: string[];
}

/**
 * Provider contract. Capabilities are optional because not every model can do
 * vision or embeddings — the UI reports exactly what the configured model
 * supports instead of pretending.
 */
export interface AIProvider {
  readonly kind: AIProviderKind;
  readonly modelLabel: string;
  testConnection(): Promise<ConnectionResult>;
  interpretQuery(input: InterpretQueryInput): Promise<StructuredSearchIntent>;
  analyzeImage?(input: ImageAnalysisInput): Promise<VisualDescription>;
  generateEmbedding?(text: string): Promise<number[] | null>;
  summarizeResults?(input: { query: string; facts: string; rows: string }): Promise<string>;
}
