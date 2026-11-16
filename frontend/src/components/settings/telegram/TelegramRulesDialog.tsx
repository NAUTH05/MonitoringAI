"use client";

/**
 * Per-bot notification rules.
 *
 * The event types come from the backend (which mirrors the Prisma EventType
 * enum), so adding a type in the schema surfaces here without a UI change.
 * Each type can be enabled independently and optionally gated by a minimum
 * confidence, which is the only filter the dispatcher applies.
 */
import { api } from "@/lib/api";
import { ApiResponse, EventType, TelegramBot, TelegramRule } from "@/types";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, ErrorBanner, Modal, Toggle, inputClass } from "./shared";

interface Props {
  bot: TelegramBot;
  onClose: () => void;
  onChanged: () => void;
}

interface DraftRule {
  eventType: EventType;
  isEnabled: boolean;
  /** Percent (0-100) as shown in the input; null = no threshold. */
  minConfidencePct: string;
}

export function TelegramRulesDialog({ bot, onClose, onChanged }: Props) {
  const { t } = useTranslation();

  const [rules, setRules] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiResponse<TelegramRule[]>>(`/telegram/bots/${bot.id}/rules`);
      if (res.success) {
        setRules(
          res.data.map((rule) => ({
            eventType: rule.eventType,
            isEnabled: rule.isEnabled,
            minConfidencePct:
              rule.minConfidence === null || rule.minConfidence === undefined
                ? ""
                : String(Math.round(rule.minConfidence * 100)),
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.loadRulesFailed"));
    } finally {
      setLoading(false);
    }
  }, [bot.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (eventType: EventType, patch: Partial<DraftRule>) => {
    setRules((prev) => prev.map((r) => (r.eventType === eventType ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    setError(null);
    setNotice(null);

    let payload: { eventType: EventType; isEnabled: boolean; minConfidence: number | null }[];
    try {
      payload = rules.map((rule) => {
        const trimmed = rule.minConfidencePct.trim();
        const pct = trimmed === "" ? null : Number(trimmed);
        if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
          throw new Error(t("telegram.rulesMinConfidence"));
        }
        return {
          eventType: rule.eventType,
          isEnabled: rule.isEnabled,
          minConfidence: pct === null ? null : pct / 100,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
      return;
    }

    setSaving(true);
    try {
      const res = await api.put<ApiResponse<TelegramRule[]>>(`/telegram/bots/${bot.id}/rules`, { rules: payload });
      if (!res.success) throw new Error(res.message ?? t("telegram.saveFailed"));
      setNotice(t("telegram.rulesSaved"));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("telegram.rulesTitle", { name: bot.name })}
      subtitle={t("telegram.rulesHint")}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={loading}>
            <Save className="w-3.5 h-3.5" />
            {t("telegram.rulesSave")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {notice && (
          <div className="bg-emerald-900/20 border border-emerald-800 text-emerald-300 rounded-lg px-3 py-2.5 text-sm">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="p-6 flex items-center justify-center text-gray-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : rules.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            <SlidersHorizontal className="w-5 h-5 mx-auto mb-2 text-gray-600" />
            {t("telegram.rulesEmpty")}
          </div>
        ) : (
          <div className="border border-gray-800 rounded-xl divide-y divide-gray-800">
            <div className="grid grid-cols-[1fr_auto_7.5rem] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-gray-500">
              <span>{t("telegram.colEvent")}</span>
              <span>{t("telegram.rulesEnabled")}</span>
              <span>{t("telegram.rulesMinConfidence")}</span>
            </div>

            {rules.map((rule) => (
              <div key={rule.eventType} className="grid grid-cols-[1fr_auto_7.5rem] gap-3 items-center px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-gray-200 truncate">{t(`eventTypes.${rule.eventType}`)}</span>
                  {rule.eventType === "INTRUSION" && <Badge tone="blue">default</Badge>}
                </div>

                <Toggle
                  checked={rule.isEnabled}
                  onChange={(next) => update(rule.eventType, { isEnabled: next })}
                  label={t(`eventTypes.${rule.eventType}`)}
                />

                <div className="relative">
                  <input
                    value={rule.minConfidencePct}
                    onChange={(e) =>
                      update(rule.eventType, {
                        minConfidencePct: e.target.value.replace(/[^\d]/g, "").slice(0, 3),
                      })
                    }
                    disabled={!rule.isEnabled}
                    inputMode="numeric"
                    placeholder={t("telegram.rulesNoThreshold")}
                    aria-label={`${t("telegram.rulesMinConfidence")} ${rule.eventType}`}
                    className={`${inputClass} pr-7 py-1.5 text-xs disabled:opacity-40`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
