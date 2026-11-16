/**
 * AI Search API.
 *
 *   GET   /api/ai-search/status         (authenticate)          — provider status for the UI
 *   POST  /api/ai-search/query          (authenticate)          — natural-language search
 *   GET   /api/ai-search/settings       (Admin|Manager)
 *   PATCH /api/ai-search/settings       (Admin|Manager)
 *   POST  /api/ai-search/test-provider  (Admin|Manager)
 *
 * Secrets never leave the server: settings responses contain masks only.
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { decryptSecret } from '../services/ai/crypto';
import { isEncryptionConfigured } from '../services/ai/crypto';
import { ruleBasedIntent } from '../services/ai/intent';
import { GeminiProvider } from '../services/ai/provider-gemini';
import { LocalProvider, LocalApiMode } from '../services/ai/provider-local';
import {
  configuredCapabilities,
  getAISettingRow,
  resolveProvider,
  saveAISettings,
  toPublicSettings,
} from '../services/ai/settings';
import { describeNowVN } from '../services/ai/time';
import { executeSearch, loadCameraIndex, SearchWarning } from '../services/ai/search';
import { AIProvider, StructuredSearchIntent } from '../services/ai/types';

const router = Router();

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['GEMINI', 'LOCAL']).optional(),
  geminiApiKey: z.string().max(300).nullable().optional(),
  geminiTextModel: z.string().min(1).max(120).optional(),
  geminiVisionModel: z.string().max(120).nullable().optional(),
  geminiEmbeddingModel: z.string().max(120).nullable().optional(),
  localEndpoint: z.string().max(300).optional(),
  localApiMode: z.enum(['ollama', 'openai']).optional(),
  localApiKey: z.string().max(400).nullable().optional(),
  localTextModel: z.string().max(120).nullable().optional(),
  localVisionModel: z.string().max(120).nullable().optional(),
  localEmbeddingModel: z.string().max(120).nullable().optional(),
  timeoutMs: z.number().int().min(2000).max(180000).optional(),
  visualIndexingEnabled: z.boolean().optional(),
  cloudVisionEnabled: z.boolean().optional(),
  indexingPaused: z.boolean().optional(),
  maxFramesPerVideo: z.number().int().min(1).max(30).optional(),
  frameIntervalMs: z.number().int().min(500).max(60000).optional(),
  maxJobsPerRun: z.number().int().min(1).max(200).optional(),
});

const querySchema = z.object({
  query: z.string().min(2).max(500),
  mode: z.enum(['auto', 'metadata', 'visual', 'hybrid']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const testSchema = z.object({
  provider: z.enum(['GEMINI', 'LOCAL']).optional(),
  draft: settingsPatchSchema.partial().optional(),
});

function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request';
}

/** Strip control characters so a query cannot smuggle prompt delimiters. */
function sanitizeQuery(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── GET /api/ai-search/status ────────────────────────────────────────────────
router.get('/status', authenticate, async (_req: Request, res: Response) => {
  try {
    const row = await getAISettingRow();
    const publicSettings = toPublicSettings(row);
    res.json({
      success: true,
      data: {
        enabled: publicSettings.enabled,
        provider: publicSettings.provider,
        capabilities: publicSettings.capabilities,
        blockedReason: publicSettings.blockedReason,
        visualIndexingEnabled: publicSettings.visualIndexingEnabled,
        cloudVisionEnabled: publicSettings.cloudVisionEnabled,
        indexingPaused: publicSettings.indexingPaused,
        // Whether an LLM is actually usable right now, so the UI can label the
        // rule-based fallback instead of implying an LLM answered.
        llmReady: publicSettings.enabled && !publicSettings.blockedReason,
        updatedAt: publicSettings.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ── POST /api/ai-search/query ────────────────────────────────────────────────
router.post('/query', authenticate, async (req: Request, res: Response) => {
  const started = Date.now();
  try {
    const body = querySchema.parse(req.body);
    const query = sanitizeQuery(body.query);
    if (query.length < 2) {
      res.status(400).json({ success: false, message: 'Câu hỏi quá ngắn.' });
      return;
    }

    const row = await getAISettingRow();
    const { provider, reason } = resolveProvider(row);
    const cameras = await loadCameraIndex();

    const warnings: SearchWarning[] = [];
    let intent: StructuredSearchIntent;
    let interpretedBy: 'gemini' | 'local' | 'rules' = 'rules';

    if (provider) {
      try {
        intent = await provider.interpretQuery({
          query,
          nowLocal: describeNowVN(),
          cameras: cameras.map((c) => ({ name: c.name, location: c.location })),
          knownEventTypes: [
            'INTRUSION',
            'FIRE',
            'SMOKE',
            'PPE',
            'FACE',
            'VEHICLE',
            'FLOOD',
            'TRAFFIC_VIOLATION',
          ],
        });
        interpretedBy = provider.kind === 'GEMINI' ? 'gemini' : 'local';
      } catch (err) {
        intent = ruleBasedIntent(query, cameras);
        warnings.push({
          code: 'LLM_FAILED',
          message: `Không gọi được AI (${(err as Error).message}). Đã chuyển sang diễn giải bằng luật.`,
        });
      }
    } else {
      intent = ruleBasedIntent(query, cameras);
      warnings.push({
        code: 'LLM_DISABLED',
        message: reason || 'AI Search chưa bật — đang diễn giải câu hỏi bằng luật.',
      });
    }

    // Explicit mode override from the UI chips.
    if (body.mode === 'metadata') {
      intent = { ...intent, intent: 'metadata_search', visualQuery: undefined };
    } else if (body.mode === 'visual' && intent.visualQuery) {
      intent = { ...intent, intent: 'visual_search' };
    } else if (body.mode === 'hybrid' && intent.visualQuery) {
      intent = { ...intent, intent: 'hybrid_search' };
    }
    if (body.limit) intent = { ...intent, limit: body.limit };

    const outcome = await executeSearch(intent, {
      provider,
      semanticAvailable: false,
    });
    warnings.push(...outcome.warnings);

    res.json({
      success: true,
      data: {
        query,
        interpretedBy,
        llmReady: Boolean(provider),
        intent: outcome.intent,
        mode: outcome.mode,
        total: outcome.total,
        returned: outcome.returned,
        events: outcome.events,
        groups: outcome.groups,
        plates: outcome.plates,
        answer: outcome.answer,
        appliedFilters: outcome.appliedFilters,
        warnings,
        semanticApplied: outcome.semanticApplied,
        timingMs: Date.now() - started,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: zodMessage(err) });
      return;
    }
    res.status(500).json({ success: false, message: (err as Error).message || 'Search failed' });
  }
});

// ── GET /api/ai-search/settings ──────────────────────────────────────────────
router.get('/settings', authenticate, authorize('Admin', 'Manager'), async (_req: Request, res: Response) => {
  try {
    const row = await getAISettingRow();
    res.json({
      success: true,
      data: {
        ...toPublicSettings(row),
        encryptionConfigured: isEncryptionConfigured(),
        capabilitiesConfigured: configuredCapabilities(row),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

// ── PATCH /api/ai-search/settings ────────────────────────────────────────────
router.patch('/settings', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const patch = settingsPatchSchema.parse(req.body);
    await saveAISettings(patch);
    const row = await getAISettingRow();
    res.json({ success: true, data: toPublicSettings(row) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: zodMessage(err) });
      return;
    }
    res.status(500).json({ success: false, message: (err as Error).message || 'Failed to save settings' });
  }
});

// ── POST /api/ai-search/test-provider ────────────────────────────────────────
router.post('/test-provider', authenticate, authorize('Admin', 'Manager'), async (req: Request, res: Response) => {
  try {
    const body = testSchema.parse(req.body ?? {});
    const row = await getAISettingRow();
    const kind = body.provider || (row.provider as 'GEMINI' | 'LOCAL');
    const draft = body.draft || {};

    let provider: AIProvider | null = null;

    if (kind === 'GEMINI') {
      const apiKey = draft.geminiApiKey
        ? draft.geminiApiKey
        : decryptSecret(row.geminiApiKeyEnc);
      if (!apiKey) {
        res.status(400).json({
          success: false,
          message: 'Chưa có Gemini API key để kiểm tra. Nhập key rồi thử lại.',
        });
        return;
      }
      provider = new GeminiProvider({
        apiKey,
        textModel: draft.geminiTextModel || row.geminiTextModel,
        visionModel:
          draft.geminiVisionModel !== undefined ? draft.geminiVisionModel : row.geminiVisionModel,
        embeddingModel:
          draft.geminiEmbeddingModel !== undefined
            ? draft.geminiEmbeddingModel
            : row.geminiEmbeddingModel,
        timeoutMs: draft.timeoutMs || row.timeoutMs,
      });
    } else {
      const textModel =
        draft.localTextModel !== undefined ? draft.localTextModel : row.localTextModel;
      provider = new LocalProvider({
        endpoint: draft.localEndpoint || row.localEndpoint,
        apiMode: ((draft.localApiMode || row.localApiMode) as LocalApiMode) || 'ollama',
        apiKey: draft.localApiKey ? draft.localApiKey : decryptSecret(row.localApiKeyEnc),
        textModel: textModel || null,
        visionModel:
          draft.localVisionModel !== undefined ? draft.localVisionModel : row.localVisionModel,
        embeddingModel:
          draft.localEmbeddingModel !== undefined
            ? draft.localEmbeddingModel
            : row.localEmbeddingModel,
        timeoutMs: draft.timeoutMs || row.timeoutMs,
      });
    }

    const result = await provider.testConnection();
    res.status(result.ok ? 200 : 400).json({
      success: result.ok,
      data: result,
      message: result.message,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, message: zodMessage(err) });
      return;
    }
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

export default router;
