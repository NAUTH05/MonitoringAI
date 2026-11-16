"use client";

import { api } from "@/lib/api";
import { AISearchModeOption, AISearchResponse, AIProviderStatus, ApiResponse } from "@/types";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Car,
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const MODES: { value: AISearchModeOption; icon: typeof Search }[] = [
  { value: "auto", icon: Sparkles },
  { value: "metadata", icon: Layers },
  { value: "visual", icon: ImageIcon },
  { value: "hybrid", icon: BrainCircuit },
];

const EXAMPLE_KEYS = ["example1", "example2", "example3", "example4"] as const;

function modeLabel(mode: string, t: (k: string) => string): string {
  return t(`aiSearch.modes.${mode}`);
}

export function EventSearchBar({
  onResult,
}: {
  onResult: (result: AISearchResponse | null) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<AISearchModeOption>("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AISearchResponse | null>(null);
  const [status, setStatus] = useState<AIProviderStatus | null>(null);

  useEffect(() => {
    api
      .get<ApiResponse<AIProviderStatus>>("/ai-search/status")
      .then((res) => setStatus(res.data))
      .catch(() => setStatus(null));
  }, []);

  const runSearch = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length < 2) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.post<ApiResponse<AISearchResponse>>("/ai-search/query", {
          query: text,
          mode,
        });
        setResult(res.data);
        onResult(res.data);
      } catch (err) {
        setError((err as Error).message || t("aiSearch.failed"));
        setResult(null);
        onResult(null);
      } finally {
        setLoading(false);
      }
    },
    [mode, onResult, t],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
    setQuery("");
    onResult(null);
  }, [onResult]);

  const providerBadge = (() => {
    if (!status) return { label: t("aiSearch.statusUnknown"), tone: "text-gray-400 border-gray-700" };
    if (!status.enabled) {
      return { label: t("aiSearch.statusOff"), tone: "text-gray-400 border-gray-700" };
    }
    if (!status.llmReady) {
      return { label: t("aiSearch.statusBlocked"), tone: "text-amber-400 border-amber-500/40" };
    }
    const name = status.provider === "GEMINI" ? "Gemini" : t("aiSearch.localProvider");
    return { label: t("aiSearch.statusOn", { name }), tone: "text-emerald-400 border-emerald-500/40" };
  })();

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">{t("aiSearch.title")}</h2>
          </div>
          <span
            className={cn(
              "text-[11px] px-2 py-1 rounded-full border whitespace-nowrap",
              providerBadge.tone,
            )}
          >
            {providerBadge.label}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) runSearch(query);
              }}
              placeholder={t("aiSearch.placeholder")}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            onClick={() => runSearch(query)}
            disabled={loading || query.trim().length < 2}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? t("aiSearch.searching") : t("aiSearch.search")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-gray-500 uppercase tracking-wide">
            {t("aiSearch.modeLabel")}
          </span>
          {MODES.map(({ value, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition",
                mode === value
                  ? "bg-blue-600/15 border-blue-600/50 text-blue-300"
                  : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200",
              )}
            >
              <Icon className="w-3 h-3" />
              {t(`aiSearch.modeOptions.${value}`)}
            </button>
          ))}
        </div>

        {!result && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {EXAMPLE_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => {
                  const example = t(`aiSearch.examples.${key}`);
                  setQuery(example);
                  runSearch(example);
                }}
                className="text-[11px] px-2 py-1 rounded-md bg-gray-800/50 border border-gray-800 text-gray-400 hover:text-blue-300 hover:border-blue-700/50 transition"
              >
                {t(`aiSearch.examples.${key}`)}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="border-t border-gray-800 bg-gray-950/40 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-white">
                {modeLabel(result.mode, t)}
              </span>
              <span
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-full border",
                  result.interpretedBy === "rules"
                    ? "text-amber-300 border-amber-600/40 bg-amber-500/10"
                    : "text-emerald-300 border-emerald-600/40 bg-emerald-500/10",
                )}
              >
                {result.interpretedBy === "rules"
                  ? t("aiSearch.byRules")
                  : result.interpretedBy === "gemini"
                    ? t("aiSearch.byGemini")
                    : t("aiSearch.byLocal")}
              </span>
              <span className="text-xs text-gray-400">
                {t("aiSearch.resultCount", { count: result.total })}
                {result.returned < result.total
                  ? ` · ${t("aiSearch.showingFirst", { count: result.returned })}`
                  : ""}
              </span>
            </div>
            <button
              onClick={clear}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
            >
              <X className="w-3.5 h-3.5" />
              {t("aiSearch.clear")}
            </button>
          </div>

          {result.appliedFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.appliedFilters.map((f, i) => (
                <span
                  key={`${f.field}-${i}`}
                  className="text-[11px] px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-gray-300"
                >
                  <span className="text-gray-500">{f.label}:</span> {f.value}
                </span>
              ))}
            </div>
          )}

          {result.answer && (
            <div className="flex items-start gap-2 text-sm text-gray-200 bg-blue-950/30 border border-blue-900/40 rounded-lg px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <span>{result.answer}</span>
            </div>
          )}

          {result.groups && result.groups.length > 0 && (
            <div className="rounded-lg border border-gray-800 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-xs text-gray-400">
                <BarChart3 className="w-3.5 h-3.5" />
                {t("aiSearch.breakdown", { by: t(`aiSearch.groupBy.${result.intent.groupBy || "camera"}`) })}
              </div>
              <div className="divide-y divide-gray-800">
                {result.groups.slice(0, 8).map((g) => (
                  <div key={g.key} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-gray-300">{g.label}</span>
                    <span className="text-white font-medium">{g.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.plates && result.plates.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <Car className="w-3.5 h-3.5 text-amber-400" />
              {t("aiSearch.plateResults", { count: result.plates.length })}
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="space-y-1">
              {result.warnings.map((w) => (
                <li key={w.code} className="flex items-start gap-2 text-[11px] text-amber-400/90">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[10px] text-gray-600">
            {t("aiSearch.timing", { ms: result.timingMs })}
          </p>
        </div>
      )}
    </div>
  );
}
