/**
 * Local AI provider — Ollama (native REST) or any OpenAI-compatible server.
 *
 * Nothing here assumes a specific model: text/vision/embedding model ids are
 * configured, and a capability is only advertised when the endpoint actually
 * lists that model. When Ollama is not running, every call fails cleanly with a
 * message the UI can show — the rest of MonitoringAI keeps working.
 */
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

export type LocalApiMode = 'ollama' | 'openai';

export interface LocalConfig {
  endpoint: string;
  apiMode: LocalApiMode;
  apiKey?: string | null;
  textModel?: string | null;
  visionModel?: string | null;
  embeddingModel?: string | null;
  timeoutMs: number;
}

interface OllamaTags {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaShow {
  capabilities?: string[];
}

interface OllamaChat {
  message?: { content?: string };
  error?: string;
}

interface OllamaEmbed {
  embeddings?: number[][];
  error?: string;
}

interface OpenAIModels {
  data?: Array<{ id?: string }>;
}

interface OpenAIChat {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface OpenAIEmbed {
  data?: Array<{ embedding?: number[] }>;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

export class LocalProvider implements AIProvider {
  readonly kind = 'LOCAL' as const;
  readonly modelLabel: string;

  constructor(private readonly cfg: LocalConfig) {
    this.modelLabel = cfg.textModel || '(chưa cấu hình model)';
  }

  private get base(): string {
    return trimSlash(this.cfg.endpoint);
  }

  private get isOpenAI(): boolean {
    return this.cfg.apiMode === 'openai';
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  capabilities(): AICapabilities {
    return {
      text: Boolean(this.cfg.textModel),
      vision: Boolean(this.cfg.visionModel),
      embedding: Boolean(this.cfg.embeddingModel),
    };
  }

  /** List models the endpoint exposes. Empty array when unreachable. */
  async listModels(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    if (this.isOpenAI) {
      const res = await httpJson<OpenAIModels>(`${this.base}/v1/models`, {
        headers: this.headers(),
        timeoutMs: Math.min(this.cfg.timeoutMs, 10000),
      });
      if (!res.ok) {
        return { ok: false, models: [], error: res.error || 'Không kết nối được endpoint' };
      }
      return { ok: true, models: (res.data?.data || []).map((m) => m.id || '').filter(Boolean) };
    }
    const res = await httpJson<OllamaTags>(`${this.base}/api/tags`, {
      headers: this.headers(),
      timeoutMs: Math.min(this.cfg.timeoutMs, 10000),
    });
    if (!res.ok) {
      return {
        ok: false,
        models: [],
        error:
          res.status === 0
            ? `Không kết nối được ${this.base} (Ollama chưa chạy?)`
            : res.error || 'Endpoint trả lỗi',
      };
    }
    return {
      ok: true,
      models: (res.data?.models || []).map((m) => m.name || m.model || '').filter(Boolean),
    };
  }

  /** Ollama exposes declared capabilities; OpenAI-compatible servers do not. */
  private async ollamaCapabilities(model: string): Promise<string[] | null> {
    if (this.isOpenAI) return null;
    const res = await httpJson<OllamaShow>(`${this.base}/api/show`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model }),
      timeoutMs: Math.min(this.cfg.timeoutMs, 10000),
    });
    if (!res.ok) return null;
    return res.data?.capabilities ?? null;
  }

  async testConnection(): Promise<ConnectionResult> {
    const started = Date.now();
    const listed = await this.listModels();
    if (!listed.ok) {
      return {
        ok: false,
        message: listed.error || 'Không kết nối được endpoint AI cục bộ.',
        capabilities: this.capabilities(),
        provider: this.kind,
      };
    }

    const wanted = this.cfg.textModel;
    if (wanted && !listed.models.includes(wanted)) {
      return {
        ok: false,
        message: `Endpoint hoạt động nhưng không có model "${wanted}". Model đang có: ${listed.models.slice(0, 8).join(', ') || '(trống)'}`,
        capabilities: this.capabilities(),
        models: listed.models,
        provider: this.kind,
      };
    }

    if (!wanted) {
      return {
        ok: false,
        message: 'Endpoint hoạt động nhưng chưa cấu hình model văn bản.',
        capabilities: this.capabilities(),
        models: listed.models,
        provider: this.kind,
      };
    }

    // Prove inference actually runs, not just that the port is open.
    try {
      const reply = await this.chat('Trả lời đúng một từ: OK', 16);
      if (!reply) {
        return {
          ok: false,
          message: `Model "${wanted}" không trả về nội dung.`,
          capabilities: this.capabilities(),
          models: listed.models,
          provider: this.kind,
        };
      }
    } catch (err) {
      return {
        ok: false,
        message: `Không chạy được suy luận với "${wanted}": ${(err as Error).message}`,
        capabilities: this.capabilities(),
        models: listed.models,
        provider: this.kind,
      };
    }

    // Refine capabilities using what the server declares, when it tells us.
    const caps = this.capabilities();
    if (this.cfg.visionModel) {
      const declared = await this.ollamaCapabilities(this.cfg.visionModel);
      if (declared && !declared.includes('vision')) {
        caps.vision = false;
      }
    }

    return {
      ok: true,
      message: `Kết nối AI cục bộ thành công (${this.cfg.apiMode}, model ${wanted}).`,
      capabilities: caps,
      models: listed.models,
      provider: this.kind,
      latencyMs: Date.now() - started,
    };
  }

  private async chat(prompt: string, maxTokens = 1024): Promise<string> {
    const model = this.cfg.textModel;
    if (!model) throw new Error('Chưa cấu hình model văn bản cho AI cục bộ');

    if (this.isOpenAI) {
      const res = await httpJson<OpenAIChat>(`${this.base}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        timeoutMs: this.cfg.timeoutMs,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) throw new Error(res.data?.error?.message || res.error || 'Chat completion failed');
      return res.data?.choices?.[0]?.message?.content || '';
    }

    const res = await httpJson<OllamaChat>(`${this.base}/api/chat`, {
      method: 'POST',
      headers: this.headers(),
      timeoutMs: this.cfg.timeoutMs,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0, num_predict: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(res.data?.error || res.error || 'Ollama chat failed');
    return res.data?.message?.content || '';
  }

  async interpretQuery(input: InterpretQueryInput): Promise<StructuredSearchIntent> {
    const { buildIntentPrompt, parseIntentJson } = await import('./intent');
    const raw = await this.chat(buildIntentPrompt(input), 900);
    return parseIntentJson(extractJson(raw), { source: 'local' });
  }

  async analyzeImage(input: ImageAnalysisInput): Promise<VisualDescription> {
    const model = this.cfg.visionModel;
    if (!model) throw new Error('Chưa cấu hình model thị giác cho AI cục bộ');

    const { buildImagePrompt, parseVisualDescription } = await import('./intent');
    const prompt = buildImagePrompt(input.context);

    if (this.isOpenAI) {
      const res = await httpJson<OpenAIChat>(`${this.base}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        timeoutMs: this.cfg.timeoutMs,
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 600,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.base64}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(res.data?.error?.message || res.error || 'Vision request failed');
      return parseVisualDescription(extractJson(res.data?.choices?.[0]?.message?.content || ''));
    }

    const res = await httpJson<OllamaChat>(`${this.base}/api/chat`, {
      method: 'POST',
      headers: this.headers(),
      timeoutMs: this.cfg.timeoutMs,
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [{ role: 'user', content: prompt, images: [input.base64] }],
      }),
    });
    if (!res.ok) throw new Error(res.data?.error || res.error || 'Ollama vision failed');
    return parseVisualDescription(extractJson(res.data?.message?.content || ''));
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    const model = this.cfg.embeddingModel;
    if (!model) return null;
    try {
      if (this.isOpenAI) {
        const res = await httpJson<OpenAIEmbed>(`${this.base}/v1/embeddings`, {
          method: 'POST',
          headers: this.headers(),
          timeoutMs: this.cfg.timeoutMs,
          body: JSON.stringify({ model, input: text }),
        });
        if (!res.ok) return null;
        const values = res.data?.data?.[0]?.embedding;
        return Array.isArray(values) && values.length > 0 ? values : null;
      }
      const res = await httpJson<OllamaEmbed>(`${this.base}/api/embed`, {
        method: 'POST',
        headers: this.headers(),
        timeoutMs: this.cfg.timeoutMs,
        body: JSON.stringify({ model, input: text }),
      });
      if (!res.ok) return null;
      const values = res.data?.embeddings?.[0];
      return Array.isArray(values) && values.length > 0 ? values : null;
    } catch {
      return null;
    }
  }
}
