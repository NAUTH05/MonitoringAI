/**
 * Google Gemini provider (official `@google/genai` SDK).
 *
 * - Text/vision model ids are configurable — nothing is pinned to a deprecated
 *   model name.
 * - Structured output is requested as JSON and then validated with Zod by the
 *   caller; the SDK's response schema is intentionally not used so a model swap
 *   cannot break request serialisation.
 * - Embeddings are optional: if no embedding model is configured we report
 *   `embedding: false` and the search falls back to caption/keyword retrieval.
 */
import { GoogleGenAI } from '@google/genai';
import { httpJson } from './http';
import {
  AICapabilities,
  AIProvider,
  ConnectionResult,
  ImageAnalysisInput,
  InterpretQueryInput,
  StructuredSearchIntent,
  VisualDescription,
} from './types';

export interface GeminiConfig {
  apiKey: string;
  textModel: string;
  visionModel?: string | null;
  embeddingModel?: string | null;
  timeoutMs: number;
}

const DEFAULT_VISION_MODEL = 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

export class GeminiProvider implements AIProvider {
  readonly kind = 'GEMINI' as const;
  readonly modelLabel: string;
  private readonly client: GoogleGenAI;

  constructor(private readonly cfg: GeminiConfig) {
    this.modelLabel = cfg.textModel;
    this.client = new GoogleGenAI({
      apiKey: cfg.apiKey,
      httpOptions: { timeout: cfg.timeoutMs },
    });
  }

  private get visionModel(): string {
    return this.cfg.visionModel || this.cfg.textModel || DEFAULT_VISION_MODEL;
  }

  private get embeddingModel(): string | null {
    return this.cfg.embeddingModel || null;
  }

  capabilities(): AICapabilities {
    return {
      text: true,
      vision: Boolean(this.visionModel),
      embedding: Boolean(this.embeddingModel),
    };
  }

  async testConnection(): Promise<ConnectionResult> {
    const started = Date.now();
    try {
      const res = await this.client.models.generateContent({
        model: this.cfg.textModel,
        contents: 'Reply with the single word: OK',
        config: { temperature: 0 },
      });
      const text = (res.text || '').trim();
      if (!text) {
        return {
          ok: false,
          message: 'Gemini responded but returned no text — check the model id and API key permissions.',
          capabilities: this.capabilities(),
          provider: this.kind,
        };
      }
      return {
        ok: true,
        message: `Kết nối Gemini thành công (${this.cfg.textModel}).`,
        capabilities: this.capabilities(),
        provider: this.kind,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        message: this.describeError(err),
        capabilities: this.capabilities(),
        provider: this.kind,
      };
    }
  }

  private describeError(err: unknown): string {
    const msg = (err as Error)?.message || String(err);
    if (/API key|PERMISSION_DENIED|401|403/i.test(msg)) {
      return `Gemini từ chối API key hoặc quyền truy cập: ${msg}`;
    }
    if (/404|NOT_FOUND|model/i.test(msg)) {
      return `Không tìm thấy model "${this.cfg.textModel}" với API key này: ${msg}`;
    }
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      return `Gemini báo hết quota / rate limit: ${msg}`;
    }
    return `Lỗi gọi Gemini: ${msg}`;
  }

  async interpretQuery(input: InterpretQueryInput): Promise<StructuredSearchIntent> {
    const { buildIntentPrompt } = await import('./intent');
    const prompt = buildIntentPrompt(input);
    const res = await this.client.models.generateContent({
      model: this.cfg.textModel,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        systemInstruction:
          'You convert surveillance search questions into a strict JSON search intent. ' +
          'You never invent cameras, event types or timestamps that are not implied by the question.',
      },
    });
    const raw = res.text || '';
    const { parseIntentJson } = await import('./intent');
    return parseIntentJson(extractJson(raw), { source: 'gemini' });
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<VisualDescription> {
    const { buildImagePrompt } = await import('./intent');
    const res = await this.client.models.generateContent({
      model: this.visionModel,
      contents: [
        { inlineData: { mimeType: input.mimeType, data: input.base64 } },
        { text: buildImagePrompt(input.context) },
      ],
      config: { temperature: 0, responseMimeType: 'application/json' },
    });
    const { parseVisualDescription } = await import('./intent');
    return parseVisualDescription(extractJson(res.text || ''));
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    const model = this.embeddingModel;
    if (!model) return null;
    try {
      const res = await this.client.models.embedContent({
        model,
        contents: [text],
      });
      const values = res.embeddings?.[0]?.values;
      return Array.isArray(values) && values.length > 0 ? values : null;
    } catch {
      return null;
    }
  }

  async summarizeResults(input: { query: string; facts: string; rows: string }): Promise<string> {
    const prompt = [
      'Bạn là trợ lý giám sát camera. Trả lời bằng tiếng Việt, ngắn gọn (tối đa 3 câu).',
      'CHỈ dùng số liệu trong phần SỐ LIỆU CHÍNH XÁC. Không suy đoán, không bịa thêm.',
      '',
      `Câu hỏi: ${input.query}`,
      `SỐ LIỆU CHÍNH XÁC: ${input.facts}`,
      `Một vài dòng dữ liệu: ${input.rows}`,
    ].join('\n');
    const res = await this.client.models.generateContent({
      model: this.cfg.textModel,
      contents: prompt,
      config: { temperature: 0.2 },
    });
    return (res.text || '').trim();
  }

  /** Lightweight reachability probe that does not spend tokens. */
  async ping(): Promise<boolean> {
    const res = await httpJson('https://generativelanguage.googleapis.com/', { timeoutMs: 5000 });
    return res.status > 0;
  }
}
