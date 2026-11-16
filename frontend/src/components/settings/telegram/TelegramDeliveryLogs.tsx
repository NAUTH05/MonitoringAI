"use client";

/**
 * Delivery history: every alert delivery attempt (and test send), with the
 * per-recipient status, retry count and Telegram's error message.
 */
import { api } from "@/lib/api";
import { useEventDetail } from "@/components/events/EventDetailProvider";
import {
  PaginatedResponse,
  TelegramBot,
  TelegramDeliveryLog,
  TelegramDeliveryStatus,
  EventType,
} from "@/types";
import { cn, formatDate } from "@/lib/utils";
import { ChevronLeft, ChevronRight, History, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, EmptyState, ErrorBanner, selectClass } from "./shared";

const STATUSES: TelegramDeliveryStatus[] = ["PENDING", "PROCESSING", "SENT", "FAILED", "SKIPPED"];

const EVENT_TYPES: EventType[] = [
  "INTRUSION",
  "FIRE",
  "SMOKE",
  "PPE",
  "FACE",
  "VEHICLE",
  "FLOOD",
  "TRAFFIC_VIOLATION",
];

function statusTone(status: TelegramDeliveryStatus): "green" | "red" | "amber" | "blue" | "gray" {
  switch (status) {
    case "SENT":
      return "green";
    case "FAILED":
      return "red";
    case "PENDING":
      return "amber";
    case "PROCESSING":
      return "blue";
    default:
      return "gray";
  }
}

export function TelegramDeliveryLogs({ bots }: { bots: TelegramBot[] }) {
  const { t } = useTranslation();
  const { openEvent } = useEventDetail();

  const [rows, setRows] = useState<TelegramDeliveryLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [botId, setBotId] = useState("");
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(botId ? { botId } : {}),
        ...(status ? { status } : {}),
        ...(eventType ? { eventType } : {}),
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      });

      const res = await api.get<PaginatedResponse<TelegramDeliveryLog>>(`/telegram/delivery-logs?${params}`);
      if (res.success) {
        setRows(res.data);
        setTotal(res.meta.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.logsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, botId, status, eventType, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFilters = Boolean(botId || status || eventType || from || to);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const clearFilters = () => {
    setBotId("");
    setStatus("");
    setEventType("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            {t("telegram.logsTitle")}
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">{t("telegram.logsHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">{t("telegram.totalDeliveries", { total })}</span>
          <Button size="sm" variant="ghost" onClick={() => load()} title={t("common.refresh")}>
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-gray-800 bg-gray-950/30">
        <select
          value={botId}
          onChange={(e) => {
            setBotId(e.target.value);
            setPage(1);
          }}
          className={`${selectClass} text-xs py-1.5`}
          aria-label={t("telegram.colBot")}
        >
          <option value="">{t("telegram.allBots")}</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={`${selectClass} text-xs py-1.5`}
          aria-label={t("telegram.colStatus")}
        >
          <option value="">{t("telegram.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`telegram.status${s.charAt(0)}${s.slice(1).toLowerCase()}`)}
            </option>
          ))}
        </select>

        <select
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            setPage(1);
          }}
          className={`${selectClass} text-xs py-1.5`}
          aria-label={t("telegram.colEvent")}
        >
          <option value="">{t("telegram.allTypes")}</option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`eventTypes.${type}`)}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          aria-label={t("telegram.from")}
          className={`${selectClass} text-xs py-1.5`}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          aria-label={t("telegram.to")}
          className={`${selectClass} text-xs py-1.5`}
        />

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-gray-400 hover:text-white underline transition"
          >
            {t("telegram.clearFilters")}
          </button>
        )}
      </div>

      {error ? (
        <div className="p-4">
          <ErrorBanner message={error} />
        </div>
      ) : loading ? (
        <div className="p-10 flex items-center justify-center text-gray-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={<History className="w-6 h-6" />} title={t("telegram.logsEmpty")} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/50">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colEvent")}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colBot")}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colRecipient")}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colStatus")}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colAttempts")}
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {t("telegram.colTime")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-800/30 transition align-top">
                  <td className="px-4 py-3">
                    {row.event ? (
                      <button
                        type="button"
                        onClick={() => openEvent(row.event!.id)}
                        className="text-left group"
                        title={t("alertToast.openDetail")}
                      >
                        <span className="text-xs text-white group-hover:text-blue-400 transition">
                          {t(`eventTypes.${row.event.eventType}`)}
                        </span>
                        <span className="block text-[11px] text-gray-500">
                          {Math.round(row.event.confidence * 100)}% · {formatDate(row.event.timestamp)}
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{t("telegram.testMessage")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-300">{row.bot?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-300">{row.recipient?.name ?? "—"}</span>
                    {row.recipient?.chatId && (
                      <span className="block text-[11px] font-mono text-gray-600">{row.recipient.chatId}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(row.status)}>
                      {t(`telegram.status${row.status.charAt(0)}${row.status.slice(1).toLowerCase()}`)}
                    </Badge>
                    {row.errorMessage && (
                      <span className="block text-[11px] text-red-400/80 mt-1 max-w-[16rem] break-words">
                        {row.errorMessage}
                      </span>
                    )}
                    {row.status === "PENDING" && row.nextAttemptAt && (
                      <span className="block text-[11px] text-amber-400/80 mt-1">
                        {t("telegram.nextRetry", { time: formatDate(row.nextAttemptAt) })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{row.attemptCount}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-500 whitespace-nowrap">
                    {formatDate(row.sentAt ?? row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
          <p className="text-[11px] text-gray-500">
            {t("common.showingRange", {
              from: (page - 1) * limit + 1,
              to: Math.min(page * limit, total),
              total,
            })}
          </p>
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
