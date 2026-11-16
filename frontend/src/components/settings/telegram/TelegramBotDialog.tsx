"use client";

import { api } from "@/lib/api";
import { ApiResponse, TelegramBot } from "@/types";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ErrorBanner, Field, Modal, Toggle, inputClass } from "./shared";

interface Props {
  /** Undefined = create mode. */
  bot?: TelegramBot;
  onClose: () => void;
  onSaved: (bot: TelegramBot) => void;
}

export function TelegramBotDialog({ bot, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const isEdit = Boolean(bot);

  const [name, setName] = useState(bot?.name ?? "");
  const [token, setToken] = useState("");
  const [isEnabled, setIsEnabled] = useState(bot?.isEnabled ?? true);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("telegram.nameRequired"));
      return;
    }
    if (!isEdit && !token.trim()) {
      setError(t("telegram.tokenRequired"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        // An empty token in edit mode keeps the stored one (the backend preserves it).
        ...(token.trim() ? { token: token.trim() } : {}),
        isEnabled,
      };

      const res = isEdit
        ? await api.patch<ApiResponse<TelegramBot>>(`/telegram/bots/${bot!.id}`, payload)
        : await api.post<ApiResponse<TelegramBot>>("/telegram/bots", payload);

      if (!res.success) throw new Error(res.message ?? t("telegram.saveFailed"));
      onSaved(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("telegram.editBotTitle") : t("telegram.addBotTitle")} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label={t("telegram.name")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder={t("telegram.namePlaceholder")}
            className={inputClass}
          />
        </Field>

        <Field
          label={t("telegram.token")}
          hint={isEdit ? t("telegram.tokenKeepHint") : t("telegram.tokenHint")}
        >
          <div className="relative">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type={showToken ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              required={!isEdit}
              placeholder={
                isEdit && bot
                  ? t("telegram.tokenSaved", { mask: bot.tokenMasked })
                  : t("telegram.tokenPlaceholder")
              }
              className={`${inputClass} pr-10 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Hide token" : "Show token"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300 transition"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        {isEdit && bot && (
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <ShieldCheck className="w-3.5 h-3.5" />
            {bot.username ? `@${bot.username}` : t("telegram.noUsername")}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 py-1">
          <div className="min-w-0">
            <p className="text-sm text-gray-200">{t("telegram.enabled")}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {isEnabled ? t("telegram.enabled") : t("telegram.disabled")}
            </p>
          </div>
          <Toggle checked={isEnabled} onChange={setIsEnabled} label={t("telegram.enabled")} />
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-800">
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? t("common.saving") : isEdit ? t("common.saveChanges") : t("telegram.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
