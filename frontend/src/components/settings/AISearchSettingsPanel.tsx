"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AIConnectionResult, AISettings, ApiResponse } from "@/types";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Type,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm text-gray-200">{label}</p>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative shrink-0 w-10 h-5 rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-blue-600" : "bg-gray-700",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
            checked ? "left-5" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-600">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600";

function CapabilityBadge({
  on,
  icon: Icon,
  label,
}: {
  on: boolean;
  icon: typeof Type;
  label: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border",
        on
          ? "text-emerald-300 border-emerald-600/40 bg-emerald-500/10"
          : "text-gray-500 border-gray-700 bg-gray-800/40",
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
      <span className="opacity-70">{on ? "✓" : "—"}</span>
    </span>
  );
}

export function AISearchSettingsPanel() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AIConnectionResult | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Draft values only for secrets — everything else is edited in `settings`.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState("");
  const [localKeyDraft, setLocalKeyDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiResponse<AISettings>>("/ai-search/settings");
      setSettings(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (partial: Partial<AISettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const body: Record<string, unknown> = {
        enabled: settings.enabled,
        provider: settings.provider,
        geminiTextModel: settings.gemini.textModel,
        geminiVisionModel: settings.gemini.visionModel || null,
        geminiEmbeddingModel: settings.gemini.embeddingModel || null,
        localEndpoint: settings.local.endpoint,
        localApiMode: settings.local.apiMode,
        localTextModel: settings.local.textModel || null,
        localVisionModel: settings.local.visionModel || null,
        localEmbeddingModel: settings.local.embeddingModel || null,
        timeoutMs: settings.timeoutMs,
        visualIndexingEnabled: settings.visualIndexingEnabled,
        cloudVisionEnabled: settings.cloudVisionEnabled,
        indexingPaused: settings.indexingPaused,
        maxFramesPerVideo: settings.maxFramesPerVideo,
        frameIntervalMs: settings.frameIntervalMs,
        maxJobsPerRun: settings.maxJobsPerRun,
      };
      // Only send a secret when the operator actually typed a new one.
      if (geminiKeyDraft.trim()) body.geminiApiKey = geminiKeyDraft.trim();
      if (localKeyDraft.trim()) body.localApiKey = localKeyDraft.trim();

      const res = await api.patch<ApiResponse<AISettings>>("/ai-search/settings", body);
      setSettings({ ...res.data });
      setGeminiKeyDraft("");
      setLocalKeyDraft("");
      setNotice(t("aiSearch.settings.saved"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!settings) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const draft: Record<string, unknown> = {
        timeoutMs: settings.timeoutMs,
      };
      if (settings.provider === "GEMINI") {
        draft.geminiTextModel = settings.gemini.textModel;
        draft.geminiVisionModel = settings.gemini.visionModel || null;
        draft.geminiEmbeddingModel = settings.gemini.embeddingModel || null;
        if (geminiKeyDraft.trim()) draft.geminiApiKey = geminiKeyDraft.trim();
      } else {
        draft.localEndpoint = settings.local.endpoint;
        draft.localApiMode = settings.local.apiMode;
        draft.localTextModel = settings.local.textModel || null;
        draft.localVisionModel = settings.local.visionModel || null;
        draft.localEmbeddingModel = settings.local.embeddingModel || null;
        if (localKeyDraft.trim()) draft.localApiKey = localKeyDraft.trim();
      }
      const res = await api.post<ApiResponse<AIConnectionResult>>("/ai-search/test-provider", {
        provider: settings.provider,
        draft,
      });
      setTestResult(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 p-6">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6 text-sm text-red-400">
        {error || t("aiSearch.settings.loadFailed")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {settings.blockedReason && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{settings.blockedReason}</span>
        </div>
      )}
      {!settings.encryptionConfigured && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t("aiSearch.settings.noEncryptionKey")}</span>
        </div>
      )}

      {/* Master + provider */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1">
        <Toggle
          checked={settings.enabled}
          onChange={(v) => patch({ enabled: v })}
          label={t("aiSearch.settings.enable")}
          hint={t("aiSearch.settings.enableHint")}
        />
        <div className="pt-3 border-t border-gray-800">
          <Field label={t("aiSearch.settings.provider")}>
            <div className="flex gap-2">
              {(["GEMINI", "LOCAL"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => patch({ provider: p })}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg text-sm border transition",
                    settings.provider === p
                      ? "bg-blue-600/15 border-blue-600/50 text-blue-300"
                      : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200",
                  )}
                >
                  {p === "GEMINI" ? "Google Gemini" : t("aiSearch.localProvider")}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-3">
          <CapabilityBadge on={settings.capabilities.text} icon={Type} label={t("aiSearch.caps.text")} />
          <CapabilityBadge on={settings.capabilities.vision} icon={Eye} label={t("aiSearch.caps.vision")} />
          <CapabilityBadge
            on={settings.capabilities.embedding}
            icon={Waypoints}
            label={t("aiSearch.caps.embedding")}
          />
        </div>
      </div>

      {/* Provider config */}
      {settings.provider === "GEMINI" ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            {t("aiSearch.settings.geminiTitle")}
          </h3>

          <Field
            label={t("aiSearch.settings.apiKey")}
            hint={
              settings.gemini.hasApiKey
                ? t("aiSearch.settings.keySaved", { mask: settings.gemini.apiKeyMasked })
                : t("aiSearch.settings.keyMissing")
            }
          >
            <div className="relative">
              <KeyRound className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showKey ? "text" : "password"}
                value={geminiKeyDraft}
                onChange={(e) => setGeminiKeyDraft(e.target.value)}
                placeholder={settings.gemini.hasApiKey ? "••••••••••••" : "AIza..."}
                autoComplete="off"
                className={`${inputClass} pl-9 pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                aria-label={showKey ? "hide" : "show"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t("aiSearch.settings.textModel")}>
              <input
                value={settings.gemini.textModel}
                onChange={(e) => patch({ gemini: { ...settings.gemini, textModel: e.target.value } })}
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.visionModel")} hint={t("aiSearch.settings.optional")}>
              <input
                value={settings.gemini.visionModel || ""}
                onChange={(e) => patch({ gemini: { ...settings.gemini, visionModel: e.target.value } })}
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.embeddingModel")} hint={t("aiSearch.settings.optional")}>
              <input
                value={settings.gemini.embeddingModel || ""}
                onChange={(e) =>
                  patch({ gemini: { ...settings.gemini, embeddingModel: e.target.value } })
                }
                placeholder="gemini-embedding-001"
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.timeout")}>
              <input
                type="number"
                min={2000}
                max={180000}
                step={1000}
                value={settings.timeoutMs}
                onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-emerald-400" />
            {t("aiSearch.settings.localTitle")}
          </h3>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t("aiSearch.settings.endpoint")} hint="http://127.0.0.1:11434">
              <input
                value={settings.local.endpoint}
                onChange={(e) => patch({ local: { ...settings.local, endpoint: e.target.value } })}
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.apiMode")}>
              <select
                value={settings.local.apiMode}
                onChange={(e) =>
                  patch({
                    local: { ...settings.local, apiMode: e.target.value as "ollama" | "openai" },
                  })
                }
                className={inputClass}
              >
                <option value="ollama">Ollama (native)</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </Field>
          </div>

          <Field label={t("aiSearch.settings.apiKey")} hint={t("aiSearch.settings.localKeyHint")}>
            <input
              type="password"
              value={localKeyDraft}
              onChange={(e) => setLocalKeyDraft(e.target.value)}
              placeholder={settings.local.hasApiKey ? settings.local.apiKeyMasked || "••••" : "—"}
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t("aiSearch.settings.textModel")}>
              <input
                value={settings.local.textModel || ""}
                onChange={(e) => patch({ local: { ...settings.local, textModel: e.target.value } })}
                placeholder="qwen2.5:7b"
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.visionModel")}>
              <input
                value={settings.local.visionModel || ""}
                onChange={(e) => patch({ local: { ...settings.local, visionModel: e.target.value } })}
                placeholder="llava:7b"
                className={inputClass}
              />
            </Field>
            <Field label={t("aiSearch.settings.embeddingModel")}>
              <input
                value={settings.local.embeddingModel || ""}
                onChange={(e) =>
                  patch({ local: { ...settings.local, embeddingModel: e.target.value } })
                }
                placeholder="nomic-embed-text"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label={t("aiSearch.settings.timeout")}>
            <input
              type="number"
              min={2000}
              max={180000}
              step={1000}
              value={settings.timeoutMs}
              onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
              className={`${inputClass} max-w-[200px]`}
            />
          </Field>
        </div>
      )}

      {/* Visual indexing (used from Phase 2 onward) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1">
          {t("aiSearch.settings.indexingTitle")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-2">{t("aiSearch.settings.indexingHint")}</p>
        <Toggle
          checked={settings.visualIndexingEnabled}
          onChange={(v) => patch({ visualIndexingEnabled: v })}
          label={t("aiSearch.settings.visualIndexing")}
        />
        <Toggle
          checked={settings.cloudVisionEnabled}
          onChange={(v) => patch({ cloudVisionEnabled: v })}
          label={t("aiSearch.settings.cloudVision")}
          hint={t("aiSearch.settings.cloudVisionHint")}
        />
        <Toggle
          checked={settings.indexingPaused}
          onChange={(v) => patch({ indexingPaused: v })}
          label={t("aiSearch.settings.indexingPaused")}
        />
        <div className="grid sm:grid-cols-3 gap-3 pt-3 border-t border-gray-800 mt-2">
          <Field label={t("aiSearch.settings.maxFrames")}>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.maxFramesPerVideo}
              onChange={(e) => patch({ maxFramesPerVideo: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field label={t("aiSearch.settings.frameInterval")}>
            <input
              type="number"
              min={500}
              max={60000}
              step={500}
              value={settings.frameIntervalMs}
              onChange={(e) => patch({ frameIntervalMs: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
          <Field label={t("aiSearch.settings.maxJobs")}>
            <input
              type="number"
              min={1}
              max={200}
              value={settings.maxJobsPerRun}
              onChange={(e) => patch({ maxJobsPerRun: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button
          onClick={testConnection}
          disabled={testing}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-4 py-2.5 rounded-lg text-sm border border-gray-700 transition"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {testing ? t("aiSearch.settings.testing") : t("aiSearch.settings.testConnection")}
        </button>
        <button
          onClick={load}
          className="text-xs text-gray-400 hover:text-white transition px-2"
        >
          {t("common.refresh")}
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {notice}
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 border",
            testResult.ok
              ? "text-emerald-300 bg-emerald-950/30 border-emerald-900/50"
              : "text-red-300 bg-red-950/30 border-red-900/50",
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <div className="space-y-1">
            <p>{testResult.message}</p>
            {testResult.models && testResult.models.length > 0 && (
              <p className="text-gray-400">
                {t("aiSearch.settings.modelsFound")}: {testResult.models.slice(0, 8).join(", ")}
              </p>
            )}
            {testResult.latencyMs !== undefined && (
              <p className="text-gray-500">{testResult.latencyMs} ms</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
