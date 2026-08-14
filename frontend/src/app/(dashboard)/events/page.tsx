"use client";

import { EventDetailDialog } from "@/components/events/EventDetailDialog";
import { useSocket } from "@/hooks/useSocket";
import { api } from "@/lib/api";
import {
  cn,
  formatConfidence,
  formatDate,
  getConfidenceColor,
  getEventTypeColor,
} from "@/lib/utils";
import { Event, EventType, PaginatedResponse } from "@/types";
import { Activity, AlertTriangle, CheckCircle2, Eye, Filter, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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

export default function EventsPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [alertFilter, setAlertFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const limit = 20;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(typeFilter && { type: typeFilter }),
        ...(alertFilter && { isAlert: alertFilter }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });
      const res = await api.get<PaginatedResponse<Event>>(`/events?${params}`);
      if (res.success) {
        setEvents(res.data);
        setTotal(res.meta.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, alertFilter, startDate, endDate]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Listen for new events via Socket.IO
  const handleNewEvent = useCallback((event: Event) => {
    setEvents((prev) => [event, ...prev.slice(0, limit - 1)]);
    setTotal((t) => t + 1);
  }, []);

  useSocket(undefined, handleNewEvent);

  const totalPages = Math.ceil(total / limit);

  const stats = useMemo(() => {
    const alertCount = events.filter((e) => e.isAlert).length;
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = events.filter((e) => new Date(e.timestamp).toISOString().slice(0, 10) === todayStr).length;
    const avgConfidence = events.length > 0
      ? (events.reduce((acc, e) => acc + (e.confidence || 0), 0) / events.length) * 100
      : 0;

    return { alertCount, todayCount, avgConfidence };
  }, [events]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("events.title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{t("events.totalEvents", { total })}</p>
        </div>
        <button
          onClick={() => fetchEvents()}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2.5 rounded-lg transition text-sm border border-gray-700"
        >
          <RefreshCw className="w-4 h-4" />
          {t("common.refresh")}
        </button>
      </div>

      {/* Event Statistics Summary Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium">Tổng số sự kiện</p>
            <h3 className="text-2xl font-bold text-white mt-1">{total.toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium">Cảnh báo nguy cơ</p>
            <h3 className="text-2xl font-bold text-red-400 mt-1">{stats.alertCount.toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-red-500/10 rounded-xl text-red-400 border border-red-500/20">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium">Sự kiện hôm nay</p>
            <h3 className="text-2xl font-bold text-emerald-400 mt-1">{stats.todayCount.toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 font-medium">Độ tin cậy AI trung bình</p>
            <h3 className="text-2xl font-bold text-amber-400 mt-1">{stats.avgConfidence.toFixed(1)}%</h3>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
            <Zap className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-gray-900 border border-gray-800 rounded-xl">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Filter className="w-4 h-4" />
          <span>{t("events.filters")}</span>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">{t("events.allTypes")}</option>
          {EVENT_TYPES.map((et) => (
            <option key={et} value={et}>
              {t(`eventTypes.${et}`)}
            </option>
          ))}
        </select>
        <select
          value={alertFilter}
          onChange={(e) => {
            setAlertFilter(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">{t("events.allEvents")}</option>
          <option value="true">{t("events.alertsOnly")}</option>
          <option value="false">{t("events.nonAlertOnly")}</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        {(typeFilter || alertFilter || startDate || endDate) && (
          <button
            onClick={() => {
              setTypeFilter("");
              setAlertFilter("");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
            className="text-sm text-gray-400 hover:text-white transition underline"
          >
            {t("events.clearFilters")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/50">
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colEventId")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colCamera")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colType")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colConfidence")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colAlert")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colTimestamp")}
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("events.colDetail")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">
                    {t("events.noEvents")}
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr
                    key={event.id}
                    className="hover:bg-gray-800/40 transition"
                  >
                    <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
                      {event.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-white font-medium">
                        {event.camera?.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {event.camera?.location}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium border",
                          getEventTypeColor(event.eventType),
                        )}
                      >
                        {event.eventType}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "font-semibold",
                          getConfidenceColor(event.confidence),
                        )}
                      >
                        {formatConfidence(event.confidence)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {event.isAlert ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                          ALERT
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs text-gray-500">
                          Log
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs">
                      {formatDate(event.timestamp)}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedEvent(event)}
                        className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-400">
              {t("common.showingRange", {
                from: (page - 1) * limit + 1,
                to: Math.min(page * limit, total),
                total,
              })}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 transition"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 transition"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedEvent && (
        <EventDetailDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
