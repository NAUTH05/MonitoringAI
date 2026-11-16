"use client";

/**
 * Settings → Telegram Bots.
 *
 * Lists every registered bot with its live status and opens the recipient /
 * rule / delivery-history screens. All writes go through `/api/telegram/*`,
 * which is Admin-only; the panel additionally hides the controls for other
 * roles so a Manager does not hit a wall of 403s.
 */
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { ApiResponse, TelegramBot, TelegramStatus, TelegramTestResult } from "@/types";
import { cn, formatDate } from "@/lib/utils";
import {
  AlertTriangle,
  Bot as BotIcon,
  CheckCircle2,
  KeyRound,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TelegramBotDialog } from "./TelegramBotDialog";
import { TelegramDeliveryLogs } from "./TelegramDeliveryLogs";
import { TelegramRecipientsDialog } from "./TelegramRecipientsDialog";
import { TelegramRulesDialog } from "./TelegramRulesDialog";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, StatusDot, Toggle } from "./shared";

type BusyAction = "verify" | "test" | "toggle" | null;

export function TelegramBotsPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // While `user` is still loading we keep the controls enabled (optimistic);
  // once the role is known a non-admin gets a read-only view.
  const readOnly = Boolean(user) && user?.role !== "Admin";
  const isAdmin = !readOnly;

  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState<{ id: string; action: BusyAction } | null>(null);

  const [botDialog, setBotDialog] = useState<{ bot?: TelegramBot } | null>(null);
  const [recipientsFor, setRecipientsFor] = useState<TelegramBot | null>(null);
  const [rulesFor, setRulesFor] = useState<TelegramBot | null>(null);
  const [deleting, setDeleting] = useState<TelegramBot | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [botsRes, statusRes] = await Promise.all([
        api.get<ApiResponse<TelegramBot[]>>("/telegram/bots"),
        api.get<ApiResponse<TelegramStatus>>("/telegram/status"),
      ]);
      if (botsRes.success) setBots(botsRes.data);
      if (statusRes.success) setStatus(statusRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
  };

  const verify = async (bot: TelegramBot) => {
    setBusy({ id: bot.id, action: "verify" });
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<ApiResponse<TelegramBot>>(`/telegram/bots/${bot.id}/verify`, {});
      setBots((prev) => prev.map((b) => (b.id === bot.id ? res.data : b)));
      setNotice(`${bot.name}: ${t("telegram.verified")}`);
    } catch (err) {
      setError(`${bot.name}: ${err instanceof Error ? err.message : t("telegram.verifyFailed")}`);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async (bot: TelegramBot) => {
    setBusy({ id: bot.id, action: "test" });
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<ApiResponse<TelegramTestResult[]>>(`/telegram/bots/${bot.id}/test`, {});
      const results = Array.isArray(res.data) ? res.data : [];
      const ok = results.filter((r) => r.ok).length;
      if (ok > 0) setNotice(t("telegram.testSent", { count: ok }));
      const failure = results.find((r) => !r.ok);
      if (failure) {
        setError(t("telegram.testFailed", { error: `${failure.target}: ${failure.error ?? ""}` }));
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.testFailed", { error: "" }));
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (bot: TelegramBot, next: boolean) => {
    setBusy({ id: bot.id, action: "toggle" });
    setError(null);
    setNotice(null);
    try {
      const res = await api.patch<ApiResponse<TelegramBot>>(`/telegram/bots/${bot.id}`, { isEnabled: next });
      setBots((prev) => prev.map((b) => (b.id === bot.id ? res.data : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/telegram/bots/${deleting.id}`);
      setBots((prev) => prev.filter((b) => b.id !== deleting.id));
      setDeleting(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <BotIcon className="w-4.5 h-4.5 text-gray-400" />
            {t("telegram.title")}
          </h2>
          <p className="text-gray-400 text-sm mt-1">{t("telegram.subtitle")}</p>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => setBotDialog({})}>
            <Plus className="w-4 h-4" />
            {t("telegram.addBot")}
          </Button>
        )}
      </div>

      {readOnly && (
        <div className="bg-amber-900/20 border border-amber-800/60 text-amber-200 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <ShieldX className="w-4 h-4 shrink-0" />
          {t("telegram.onlyAdmin")}
        </div>
      )}

      {status && !status.configured && (
        <div className="bg-amber-900/20 border border-amber-800/60 text-amber-200 rounded-xl px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <KeyRound className="w-4 h-4 shrink-0" />
            {t("telegram.keyMissing")}
          </div>
          <p className="text-[11px] text-amber-200/70 mt-1 ml-6">{t("telegram.keyMissingHint")}</p>
        </div>
      )}

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="bg-emerald-900/20 border border-emerald-800 text-emerald-300 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Bot list */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : bots.length === 0 ? (
        <EmptyState
          icon={<BotIcon className="w-6 h-6" />}
          title={t("telegram.empty")}
          hint={t("telegram.emptyHint")}
          action={
            isAdmin ? (
              <Button variant="primary" onClick={() => setBotDialog({})}>
                <Plus className="w-4 h-4" />
                {t("telegram.addBot")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bots.map((bot) => {
            const botBusy = busy?.id === bot.id ? busy.action : null;
            const statusTone = !bot.isEnabled ? "idle" : bot.lastError ? "bad" : bot.isVerified ? "ok" : "warn";

            return (
              <div
                key={bot.id}
                className={cn(
                  "bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 transition",
                  bot.isEnabled ? "border-gray-800" : "border-gray-800/60 opacity-80",
                )}
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={statusTone} />
                      <h3 className="text-sm font-semibold text-white truncate">{bot.name}</h3>
                    </div>
                    <p className="text-[11px] font-mono text-gray-500 mt-0.5 truncate">
                      {bot.username ? `@${bot.username}` : t("telegram.noUsername")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {bot.isVerified ? (
                      <Badge tone="green">
                        <ShieldCheck className="w-3 h-3" />
                        {t("telegram.verified")}
                      </Badge>
                    ) : (
                      <Badge tone="amber">
                        <ShieldX className="w-3 h-3" />
                        {t("telegram.unverified")}
                      </Badge>
                    )}
                    <Toggle
                      checked={bot.isEnabled}
                      onChange={(next) => toggleEnabled(bot, next)}
                      disabled={!isAdmin || botBusy === "toggle"}
                      label={t("telegram.enabled")}
                    />
                  </div>
                </div>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {t("telegram.statRecipients", {
                      enabled: bot.enabledRecipientCount,
                      total: bot.recipientCount,
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3" />
                    {t("telegram.statRules", { count: bot.ruleCount })}
                  </span>
                  <span>
                    {t("telegram.lastVerified")}:{" "}
                    {bot.lastVerifiedAt ? formatDate(bot.lastVerifiedAt) : t("telegram.never")}
                  </span>
                </div>

                {bot.lastError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-red-400/90 bg-red-950/30 border border-red-900/50 rounded-lg px-2.5 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="break-words min-w-0">
                      <span className="text-red-300/80">{t("telegram.lastError")}: </span>
                      {bot.lastError}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-1.5 pt-1 mt-auto">
                  <Button
                    size="sm"
                    onClick={() => verify(bot)}
                    loading={botBusy === "verify"}
                    disabled={!isAdmin}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {botBusy === "verify" ? t("telegram.verifying") : t("telegram.verify")}
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => sendTest(bot)}
                    loading={botBusy === "test"}
                    disabled={!isAdmin || bot.recipientCount === 0}
                    title={bot.recipientCount === 0 ? t("telegram.recipientsEmpty") : t("telegram.test")}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {t("telegram.test")}
                  </Button>

                  <Button size="sm" onClick={() => setRecipientsFor(bot)}>
                    <Users className="w-3.5 h-3.5" />
                    {t("telegram.recipients")}
                  </Button>

                  <Button size="sm" onClick={() => setRulesFor(bot)}>
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    {t("telegram.rules")}
                  </Button>

                  {isAdmin && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setBotDialog({ bot })} title={t("telegram.editBotTitle")}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(bot)} title={t("telegram.delete")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delivery history */}
      <TelegramDeliveryLogs bots={bots} />

      {/* Dialogs */}
      {botDialog && (
        <TelegramBotDialog
          bot={botDialog.bot}
          onClose={() => setBotDialog(null)}
          onSaved={() => {
            setBotDialog(null);
            refresh();
          }}
        />
      )}

      {recipientsFor && (
        <TelegramRecipientsDialog
          bot={recipientsFor}
          onClose={() => setRecipientsFor(null)}
          onChanged={refresh}
        />
      )}

      {rulesFor && (
        <TelegramRulesDialog bot={rulesFor} onClose={() => setRulesFor(null)} onChanged={refresh} />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("telegram.deleteConfirm")}
          message={`${deleting.name}${deleting.username ? ` (@${deleting.username})` : ""} — ${t("telegram.deleteConfirmHint")}`}
          confirmLabel={t("telegram.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          loading={deleteBusy}
        />
      )}
    </div>
  );
}
