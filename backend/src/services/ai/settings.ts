/**
 * Persistence + provider resolution for AI Search settings.
 *
 * One singleton row (`ai_settings.id = 'default'`). Secrets are encrypted on
 * write and never leave this module in plaintext: `toPublicSettings()` returns
 * masks only, so the API cannot leak a key even by accident.
 */
import prisma from '../../lib/prisma';
import { decryptSecret, encryptSecret, maskEncrypted } from './crypto';
import { GeminiProvider } from './provider-gemini';
import { LocalProvider, LocalApiMode } from './provider-local';
import { AICapabilities, AIProvider, AIProviderKind } from './types';

const SETTING_ID = 'default';

type AISettingRow = Awaited<ReturnType<typeof loadRow>>;

async function loadRow() {
  return prisma.aISetting.upsert({
    where: { id: SETTING_ID },
    update: {},
    create: { id: SETTING_ID },
  });
}

export async function getAISettingRow() {
  return loadRow();
}

export interface PublicAISettings {
  enabled: boolean;
  provider: AIProviderKind;
  gemini: {
    hasApiKey: boolean;
    apiKeyMasked: string | null;
    textModel: string;
    visionModel: string | null;
    embeddingModel: string | null;
  };
  local: {
    endpoint: string;
    apiMode: LocalApiMode;
    hasApiKey: boolean;
    apiKeyMasked: string | null;
    textModel: string | null;
    visionModel: string | null;
    embeddingModel: string | null;
  };
  timeoutMs: number;
  visualIndexingEnabled: boolean;
  cloudVisionEnabled: boolean;
  indexingPaused: boolean;
  maxFramesPerVideo: number;
  frameIntervalMs: number;
  maxJobsPerRun: number;
  capabilities: AICapabilities;
  /** Human-readable reason the provider cannot be used, when applicable. */
  blockedReason?: string;
  updatedAt: string;
}

export interface AISettingPatch {
  enabled?: boolean;
  provider?: AIProviderKind;
  geminiApiKey?: string | null;
  geminiTextModel?: string;
  geminiVisionModel?: string | null;
  geminiEmbeddingModel?: string | null;
  localEndpoint?: string;
  localApiMode?: LocalApiMode;
  localApiKey?: string | null;
  localTextModel?: string | null;
  localVisionModel?: string | null;
  localEmbeddingModel?: string | null;
  timeoutMs?: number;
  visualIndexingEnabled?: boolean;
  cloudVisionEnabled?: boolean;
  indexingPaused?: boolean;
  maxFramesPerVideo?: number;
  frameIntervalMs?: number;
  maxJobsPerRun?: number;
}

function emptyCaps(): AICapabilities {
  return { text: false, vision: false, embedding: false };
}

/** Static capability view derived from configuration (no network call). */
export function configuredCapabilities(row: AISettingRow): AICapabilities {
  if (row.provider === 'GEMINI') {
    return {
      text: Boolean(row.geminiTextModel),
      vision: Boolean(row.geminiVisionModel || row.geminiTextModel),
      embedding: Boolean(row.geminiEmbeddingModel),
    };
  }
  return {
    text: Boolean(row.localTextModel),
    vision: Boolean(row.localVisionModel),
    embedding: Boolean(row.localEmbeddingModel),
  };
}

export function toPublicSettings(row: AISettingRow): PublicAISettings {
  const geminiKey = decryptSecret(row.geminiApiKeyEnc);
  const localKey = decryptSecret(row.localApiKeyEnc);
  const capabilities = row.enabled ? configuredCapabilities(row) : emptyCaps();

  let blockedReason: string | undefined;
  if (row.enabled) {
    if (row.provider === 'GEMINI' && !geminiKey) {
      blockedReason = 'Chưa có Gemini API key (hoặc key không giải mã được) — hãy nhập lại.';
    }
    if (row.provider === 'LOCAL' && !row.localTextModel) {
      blockedReason = 'Chưa cấu hình model văn bản cho AI cục bộ.';
    }
  }

  return {
    enabled: row.enabled,
    provider: row.provider as AIProviderKind,
    gemini: {
      hasApiKey: Boolean(geminiKey),
      apiKeyMasked: maskEncrypted(row.geminiApiKeyEnc),
      textModel: row.geminiTextModel,
      visionModel: row.geminiVisionModel,
      embeddingModel: row.geminiEmbeddingModel,
    },
    local: {
      endpoint: row.localEndpoint,
      apiMode: (row.localApiMode as LocalApiMode) || 'ollama',
      hasApiKey: Boolean(localKey),
      apiKeyMasked: maskEncrypted(row.localApiKeyEnc),
      textModel: row.localTextModel,
      visionModel: row.localVisionModel,
      embeddingModel: row.localEmbeddingModel,
    },
    timeoutMs: row.timeoutMs,
    visualIndexingEnabled: row.visualIndexingEnabled,
    cloudVisionEnabled: row.cloudVisionEnabled,
    indexingPaused: row.indexingPaused,
    maxFramesPerVideo: row.maxFramesPerVideo,
    frameIntervalMs: row.frameIntervalMs,
    maxJobsPerRun: row.maxJobsPerRun,
    capabilities,
    blockedReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Apply a patch. `undefined` leaves a field untouched; `''` clears a secret.
 * This is what makes "keep the saved token" work from the UI: the form sends
 * nothing for an unchanged masked field.
 */
export async function saveAISettings(patch: AISettingPatch) {
  const data: Record<string, unknown> = {};

  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.provider !== undefined) data.provider = patch.provider;
  if (patch.geminiTextModel !== undefined) data.geminiTextModel = patch.geminiTextModel.trim();
  if (patch.geminiVisionModel !== undefined) {
    data.geminiVisionModel = patch.geminiVisionModel?.trim() || null;
  }
  if (patch.geminiEmbeddingModel !== undefined) {
    data.geminiEmbeddingModel = patch.geminiEmbeddingModel?.trim() || null;
  }
  if (patch.geminiApiKey !== undefined) {
    data.geminiApiKeyEnc = patch.geminiApiKey ? encryptSecret(patch.geminiApiKey.trim()) : null;
  }
  if (patch.localEndpoint !== undefined) {
    data.localEndpoint = patch.localEndpoint.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  }
  if (patch.localApiMode !== undefined) data.localApiMode = patch.localApiMode;
  if (patch.localTextModel !== undefined) data.localTextModel = patch.localTextModel?.trim() || null;
  if (patch.localVisionModel !== undefined) {
    data.localVisionModel = patch.localVisionModel?.trim() || null;
  }
  if (patch.localEmbeddingModel !== undefined) {
    data.localEmbeddingModel = patch.localEmbeddingModel?.trim() || null;
  }
  if (patch.localApiKey !== undefined) {
    data.localApiKeyEnc = patch.localApiKey ? encryptSecret(patch.localApiKey.trim()) : null;
  }
  if (patch.timeoutMs !== undefined) data.timeoutMs = patch.timeoutMs;
  if (patch.visualIndexingEnabled !== undefined) data.visualIndexingEnabled = patch.visualIndexingEnabled;
  if (patch.cloudVisionEnabled !== undefined) data.cloudVisionEnabled = patch.cloudVisionEnabled;
  if (patch.indexingPaused !== undefined) data.indexingPaused = patch.indexingPaused;
  if (patch.maxFramesPerVideo !== undefined) data.maxFramesPerVideo = patch.maxFramesPerVideo;
  if (patch.frameIntervalMs !== undefined) data.frameIntervalMs = patch.frameIntervalMs;
  if (patch.maxJobsPerRun !== undefined) data.maxJobsPerRun = patch.maxJobsPerRun;

  return prisma.aISetting.upsert({
    where: { id: SETTING_ID },
    update: data,
    create: { id: SETTING_ID, ...data },
  });
}

export interface ResolveResult {
  provider: AIProvider | null;
  reason?: string;
}

/** Build the live provider for the current settings, or explain why not. */
export function resolveProvider(row: AISettingRow): ResolveResult {
  if (!row.enabled) {
    return { provider: null, reason: 'AI Search đang tắt trong Cài đặt.' };
  }

  if (row.provider === 'GEMINI') {
    const apiKey = decryptSecret(row.geminiApiKeyEnc);
    if (!apiKey) {
      return {
        provider: null,
        reason: 'Chưa có Gemini API key (hoặc key không giải mã được). Nhập lại trong Cài đặt.',
      };
    }
    return {
      provider: new GeminiProvider({
        apiKey,
        textModel: row.geminiTextModel,
        visionModel: row.geminiVisionModel,
        embeddingModel: row.geminiEmbeddingModel,
        timeoutMs: row.timeoutMs,
      }),
    };
  }

  if (!row.localTextModel) {
    return { provider: null, reason: 'Chưa cấu hình model văn bản cho AI cục bộ.' };
  }
  return {
    provider: new LocalProvider({
      endpoint: row.localEndpoint,
      apiMode: (row.localApiMode as LocalApiMode) || 'ollama',
      apiKey: decryptSecret(row.localApiKeyEnc),
      textModel: row.localTextModel,
      visionModel: row.localVisionModel,
      embeddingModel: row.localEmbeddingModel,
      timeoutMs: row.timeoutMs,
    }),
  };
}

/** Resolve using a provider override (used by the "test connection" endpoint). */
export async function resolveProviderForTest(
  row: AISettingRow,
  override: { provider?: AIProviderKind },
): Promise<ResolveResult> {
  const kind = override.provider || (row.provider as AIProviderKind);
  if (kind === row.provider) return resolveProvider({ ...row, enabled: true });

  if (kind === 'GEMINI') {
    const apiKey = decryptSecret(row.geminiApiKeyEnc);
    if (!apiKey) return { provider: null, reason: 'Chưa có Gemini API key.' };
    return {
      provider: new GeminiProvider({
        apiKey,
        textModel: row.geminiTextModel,
        visionModel: row.geminiVisionModel,
        embeddingModel: row.geminiEmbeddingModel,
        timeoutMs: row.timeoutMs,
      }),
    };
  }
  return {
    provider: new LocalProvider({
      endpoint: row.localEndpoint,
      apiMode: (row.localApiMode as LocalApiMode) || 'ollama',
      apiKey: decryptSecret(row.localApiKeyEnc),
      textModel: row.localTextModel,
      visionModel: row.localVisionModel,
      embeddingModel: row.localEmbeddingModel,
      timeoutMs: row.timeoutMs,
    }),
  };
}

export { SETTING_ID };
